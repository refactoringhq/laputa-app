import { useEffect, useCallback, useMemo, useRef, useContext, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { trackEvent } from '../lib/telemetry'
import {
  useCreateBlockNote,
  SuggestionMenuController,
  BlockNoteViewRaw,
  ComponentsContext,
  DeleteLinkButton,
  EditLinkButton,
  LinkToolbar,
  LinkToolbarController,
  SideMenuController,
  useComponentsContext,
  useDictionary,
  type LinkToolbarProps,
} from '@blocknote/react'
import { components } from '@blocknote/mantine'
import { MantineContext, MantineProvider } from '@mantine/core'
import { Copy } from '@phosphor-icons/react'
import { ExternalLink } from 'lucide-react'
import { useDocumentThemeMode } from '../hooks/useDocumentThemeMode'
import { useEditorTheme } from '../hooks/useTheme'
import { useImageDrop } from '../hooks/useImageDrop'
import { useImageLightbox } from '../hooks/useImageLightbox'
import { createTranslator, type AppLocale } from '../lib/i18n'
import { isTauri } from '../mock-tauri'
import { buildTypeEntryMap } from '../utils/typeColors'
import { preFilterWikilinks, deduplicateByPath, MIN_QUERY_LENGTH } from '../utils/wikilinkSuggestions'
import { filterPersonMentions, PERSON_MENTION_MIN_QUERY } from '../utils/personMentionSuggestions'
import { attachClickHandlers, enrichSuggestionItems } from '../utils/suggestionEnrichment'
import { openExternalUrl } from '../utils/url'
import { observeNativeTextAssistanceDisabled } from '../lib/nativeTextAssistance'
import { getRuntimeStyleNonce } from '../lib/runtimeStyleNonce'
import { WikilinkSuggestionMenu, type WikilinkSuggestionItem } from './WikilinkSuggestionMenu'
import type { VaultEntry } from '../types'
import { _wikilinkEntriesRef } from './editorSchema'
import { useBlockNoteSideMenuHoverGuard } from './blockNoteSideMenuHoverGuard'
import { getTolariaSlashMenuItems } from './tolariaEditorFormattingConfig'
import {
  TolariaFormattingToolbar,
  TolariaFormattingToolbarController,
} from './tolariaEditorFormatting'
import { TolariaSideMenu } from './tolariaBlockNoteSideMenu'
import { useEditorLinkActivation } from './useEditorLinkActivation'
import { findNearestTextCursorBlock } from './blockNoteCursorTarget'
import { ImageLightbox } from './ImageLightbox'
import { ActionTooltip } from './ui/action-tooltip'
import { Button } from './ui/button'
import {
  activatePlainTextPasteTarget,
  registerPlainTextPasteTarget,
  type PlainTextPasteTarget,
} from '../utils/plainTextPaste'

const TEST_TABLE_MARKDOWN = `| Head 1 | Head 2 | Head 3 |
| --- | --- | --- |
| A | B | C |
| D | E | F |
`
const CONTAINER_CLICK_IGNORE_SELECTOR = [
  '[contenteditable="true"]',
  '.bn-formatting-toolbar',
  '.bn-link-toolbar',
  '.bn-side-menu',
  '.bn-form-popover',
  '[data-editor-code-copy]',
  '[role="menu"]',
  '[role="dialog"]',
].join(', ')
const TOOLBAR_MOUSE_DOWN_ALLOW_SELECTOR = [
  '[role="menu"]',
  '[role="dialog"]',
  'button[aria-haspopup]',
  'input',
  'textarea',
  '[contenteditable="true"]',
].join(', ')

type TestTableBlock = {
  type?: string
  content?: { type?: string; columnWidths?: Array<number | null> }
}
type SuggestionAction = () => void
type SuggestionItemWithClick = { onItemClick?: SuggestionAction }

function isEditorReadyForSuggestionAction(
  editor: ReturnType<typeof useCreateBlockNote>,
  container: HTMLElement | null,
) {
  if (!container?.isConnected) return false

  const editorElement = editor.domElement
  if (!(editorElement instanceof HTMLElement)) return true

  return editorElement.isConnected && container.contains(editorElement)
}

function runSuggestionActionSafely({
  action,
  container,
  editor,
}: {
  action: SuggestionAction
  container: HTMLElement | null
  editor: ReturnType<typeof useCreateBlockNote>
}) {
  if (!isEditorReadyForSuggestionAction(editor, container)) return

  try {
    action()
  } catch (error) {
    console.warn('[editor] Ignored stale suggestion menu action:', error)
  }
}

function guardSuggestionMenuItems<T extends SuggestionItemWithClick>(
  items: T[],
  runEditorAction: (action: SuggestionAction) => void,
): T[] {
  return items.map((item) => {
    if (!item.onItemClick) return item

    const onItemClick = item.onItemClick
    return {
      ...item,
      onItemClick: () => runEditorAction(onItemClick),
    }
  })
}

function SharedContextBlockNoteView(props: React.ComponentProps<typeof BlockNoteViewRaw>) {
  const { children, className, theme, ...rest } = props
  const mantineContext = useContext(MantineContext)
  const colorScheme = theme === 'dark' ? 'dark' : 'light'
  const view = (
    <ComponentsContext.Provider value={components}>
      <BlockNoteViewRaw
        {...rest}
        className={['bn-mantine', className].filter(Boolean).join(' ')}
        data-mantine-color-scheme={colorScheme}
        theme={theme}
      >
        {children}
      </BlockNoteViewRaw>
    </ComponentsContext.Provider>
  )

  if (mantineContext) return view

  return (
    <MantineProvider
      // BlockNote scopes Mantine defaults under `.bn-mantine` instead of `:root`.
      withCssVariables={false}
      getStyleNonce={getRuntimeStyleNonce}
      getRootElement={() => undefined}
    >
      {view}
    </MantineProvider>
  )
}

function shouldAllowToolbarMouseDown(target: HTMLElement) {
  return Boolean(target.closest(TOOLBAR_MOUSE_DOWN_ALLOW_SELECTOR))
}

function handleToolbarMouseDownCapture(
  event: Pick<React.MouseEvent<HTMLElement>, 'target' | 'preventDefault'>,
) {
  if (!(event.target instanceof HTMLElement) || shouldAllowToolbarMouseDown(event.target)) {
    return
  }

  event.preventDefault()
}

function TolariaOpenLinkButton({ url }: Pick<LinkToolbarProps, 'url'>) {
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const handleOpen = useCallback(() => {
    void openExternalUrl(url).catch((error) => {
      console.warn('[link] Failed to open URL from toolbar:', error)
    })
  }, [url])

  return (
    <Components.LinkToolbar.Button
      className="bn-button"
      label={dict.link_toolbar.open.tooltip}
      mainTooltip={dict.link_toolbar.open.tooltip}
      isSelected={false}
      onClick={handleOpen}
      icon={<ExternalLink size={16} />}
    />
  )
}

function TolariaLinkToolbar(props: LinkToolbarProps) {
  return (
    <LinkToolbar {...props}>
      <EditLinkButton
        url={props.url}
        text={props.text}
        range={props.range}
        setToolbarOpen={props.setToolbarOpen}
        setToolbarPositionFrozen={props.setToolbarPositionFrozen}
      />
      <TolariaOpenLinkButton url={props.url} />
      <DeleteLinkButton
        range={props.range}
        setToolbarOpen={props.setToolbarOpen}
      />
    </LinkToolbar>
  )
}

function applySeededColumnWidths(
  parsedBlocks: Array<TestTableBlock>,
  columnWidths?: Array<number | null>,
) {
  if (!columnWidths) return

  const tableBlock = parsedBlocks[0]
  if (tableBlock?.type !== 'table') return

  const tableContent = tableBlock.content
  if (tableContent?.type !== 'tableContent') return

  tableContent.columnWidths = [...columnWidths]
}

async function seedEditorWithTestTable(
  editor: ReturnType<typeof useCreateBlockNote>,
  columnWidths?: Array<number | null>,
) {
  const parsedBlocks = await Promise.resolve(
    editor.tryParseMarkdownToBlocks(TEST_TABLE_MARKDOWN),
  ) as Array<TestTableBlock>

  applySeededColumnWidths(parsedBlocks, columnWidths)

  const tableHtml = editor.blocksToHTMLLossy([
    ...parsedBlocks,
    { type: 'paragraph', content: [], children: [] },
  ] as typeof editor.document)
  editor._tiptapEditor.commands.setContent(tableHtml)
  editor.focus()
}

function useSeedBlockNoteTableBridge(editor: ReturnType<typeof useCreateBlockNote>) {
  useEffect(() => {
    const seedBlockNoteTable = (columnWidths?: Array<number | null>) => (
      seedEditorWithTestTable(editor, columnWidths)
    )

    window.__laputaTest = {
      ...window.__laputaTest,
      seedBlockNoteTable,
    }

    return () => {
      if (window.__laputaTest?.seedBlockNoteTable === seedBlockNoteTable) {
        delete window.__laputaTest.seedBlockNoteTable
      }
    }
  }, [editor])
}

function shouldIgnoreContainerClick(target: HTMLElement) {
  return Boolean(target.closest(CONTAINER_CLICK_IGNORE_SELECTOR))
}

function normalizeSuggestionQuery(query: string, triggerCharacter: string): string {
  return query.startsWith(triggerCharacter)
    ? query.slice(triggerCharacter.length)
    : query
}

function isSelectionInsideElement(element: HTMLElement): boolean {
  const selection = window.getSelection()
  const anchorNode = selection?.anchorNode ?? null
  const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement ?? null
  return Boolean(anchorElement && element.contains(anchorElement))
}

const TITLE_HEADING_SELECTOR = 'h1, [data-content-type="heading"][data-level="1"], [data-content-type="heading"]:not([data-level])'
const TITLE_HEADING_WRAPPER_SELECTOR = '.bn-block-outer, .bn-block'
const CODE_BLOCK_SELECTOR = '[data-content-type="codeBlock"]'
const CLIPBOARD_INLINE_FORMAT_SELECTOR = 'a, b, code, em, i, s, span, strong, u'
const CODE_BLOCK_COPY_RESET_MS = 1200

function nodeElement(node: Node | null): HTMLElement | null {
  if (!node) return null
  if (node instanceof HTMLElement) return node
  return node.parentElement
}

function hasSingleActiveRange(selection: Selection | null): selection is Selection {
  return Boolean(selection && selection.rangeCount === 1 && !selection.isCollapsed)
}

function closestCodeBlockInContainer(options: {
  range: Range
  container: HTMLElement
}): HTMLElement | null {
  const { range, container } = options
  const codeBlock = nodeElement(range.commonAncestorContainer)
    ?.closest<HTMLElement>(CODE_BLOCK_SELECTOR)

  return codeBlock && container.contains(codeBlock) ? codeBlock : null
}

function nodeBelongsToElement(node: Node, element: HTMLElement): boolean {
  const elementNode = nodeElement(node)
  return Boolean(elementNode && element.contains(elementNode))
}

function rangeBelongsToElement(range: Range, element: HTMLElement): boolean {
  return nodeBelongsToElement(range.startContainer, element)
    && nodeBelongsToElement(range.endContainer, element)
}

function selectedCodeBlockRange(options: {
  selection: Selection | null
  container: HTMLElement
}): Range | null {
  const { selection, container } = options
  if (!hasSingleActiveRange(selection)) return null

  const range = selection.getRangeAt(0)
  const codeBlock = closestCodeBlockInContainer({ range, container })
  if (!codeBlock || !rangeBelongsToElement(range, codeBlock)) return null

  return range
}

function selectedCodeBlockText(options: {
  selection: Selection | null
  container: HTMLElement
}): string | null {
  const range = selectedCodeBlockRange(options)
  if (!range) return null

  return options.selection?.toString() || range.cloneContents().textContent || ''
}

function selectedEditorRange(selection: Selection | null, container: HTMLElement): Range | null {
  if (!hasSingleActiveRange(selection)) return null

  const range = selection.getRangeAt(0)
  return rangeBelongsToElement(range, container) ? range : null
}

function selectedEditorPlainText(selection: Selection, range: Range): string | null {
  const text = selection.toString() || range.cloneContents().textContent || ''
  if (text.length === 0) return null

  return text.replace(/\r?\n$/, '')
}

function selectedEditorHtml(range: Range): string {
  const wrapper = document.createElement('div')
  const selectedContent = range.cloneContents()
  const commonElement = nodeElement(range.commonAncestorContainer)

  if (commonElement?.matches(CLIPBOARD_INLINE_FORMAT_SELECTOR)) {
    const inlineWrapper = commonElement.cloneNode(false)
    inlineWrapper.appendChild(selectedContent)
    wrapper.appendChild(inlineWrapper)
    return wrapper.innerHTML
  }

  wrapper.appendChild(selectedContent)
  return wrapper.innerHTML
}

function codeBlockText(codeBlock: HTMLElement): string {
  const codeElement = codeBlock.querySelector<HTMLElement>('pre code')
  return codeElement?.textContent ?? ''
}

async function writeClipboardText(text: string): Promise<void> {
  if (isTauri()) {
    await invoke('copy_text_to_clipboard', { text })
    return
  }

  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard API is unavailable')
  }

  await navigator.clipboard.writeText(text)
}

type CodeBlockCopyTarget = {
  codeBlock: HTMLElement
  left: number
  top: number
}

function codeBlockCopyTarget(codeBlock: HTMLElement, container: HTMLElement): CodeBlockCopyTarget {
  const codeBlockRect = codeBlock.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()

  return {
    codeBlock,
    left: codeBlockRect.right - containerRect.left + container.scrollLeft - 30,
    top: codeBlockRect.top - containerRect.top + container.scrollTop + 6,
  }
}

function sameCopyTarget(left: CodeBlockCopyTarget | null, right: CodeBlockCopyTarget): boolean {
  return Boolean(
    left
      && left.codeBlock === right.codeBlock
      && left.left === right.left
      && left.top === right.top,
  )
}

function useCodeBlockCopyTarget(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [copyTarget, setCopyTarget] = useState<CodeBlockCopyTarget | null>(null)

  const showCopyTarget = useCallback((codeBlock: HTMLElement) => {
    const container = containerRef.current
    if (!container || !container.contains(codeBlock)) return

    const nextTarget = codeBlockCopyTarget(codeBlock, container)
    setCopyTarget((previous) => sameCopyTarget(previous, nextTarget) ? previous : nextTarget)
  }, [containerRef])

  const updateFromEventTarget = useCallback((target: EventTarget | null) => {
    const container = containerRef.current
    if (!(target instanceof HTMLElement) || !container) return
    if (target.closest('[data-editor-code-copy]')) return

    const codeBlock = target.closest<HTMLElement>(CODE_BLOCK_SELECTOR)
    if (codeBlock && container.contains(codeBlock)) {
      showCopyTarget(codeBlock)
      return
    }

    setCopyTarget(null)
  }, [containerRef, showCopyTarget])

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    updateFromEventTarget(event.target)
  }, [updateFromEventTarget])

  const handleFocus = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    updateFromEventTarget(event.target)
  }, [updateFromEventTarget])

  const clearCopyTarget = useCallback(() => setCopyTarget(null), [])

  return { clearCopyTarget, copyTarget, handleFocus, handleMouseMove }
}

function CodeBlockCopyButton({ copyTarget, locale }: { copyTarget: CodeBlockCopyTarget; locale: AppLocale }) {
  const [active, setActive] = useState(false)
  const resetTimerRef = useRef<number | null>(null)
  const t = useMemo(() => createTranslator(locale), [locale])
  const label = t('editor.codeBlock.copy')

  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
  }, [])

  const handleCopy = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    void writeClipboardText(codeBlockText(copyTarget.codeBlock))
      .then(() => {
        trackEvent('code_block_copied')
        setActive(true)
        if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
        resetTimerRef.current = window.setTimeout(() => {
          setActive(false)
          resetTimerRef.current = null
        }, CODE_BLOCK_COPY_RESET_MS)
      })
      .catch((error) => {
        console.warn('[editor] Failed to copy code block:', error)
      })
  }, [copyTarget])

  const stopEditorMouseDown = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  return (
    <div
      className="editor__code-block-copy"
      contentEditable={false}
      data-editor-code-copy
      style={{ left: copyTarget.left, top: copyTarget.top }}
    >
      <ActionTooltip copy={{ label }} side="left" align="center">
        <Button
          aria-label={label}
          className="border-transparent bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground focus-visible:bg-transparent focus-visible:text-foreground"
          data-editor-code-copy-button
          onBlur={() => setActive(false)}
          onClick={handleCopy}
          onFocus={() => setActive(true)}
          onMouseDown={stopEditorMouseDown}
          onMouseEnter={() => setActive(true)}
          onMouseLeave={() => setActive(false)}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <Copy aria-hidden="true" className="size-6" weight={active ? 'fill' : 'regular'} />
        </Button>
      </ActionTooltip>
    </div>
  )
}

function findTitleHeadingElement(target: HTMLElement): HTMLElement | null {
  const directHeading = target.closest<HTMLElement>(TITLE_HEADING_SELECTOR)
  if (directHeading) return directHeading

  const titleWrapper = target.closest<HTMLElement>(TITLE_HEADING_WRAPPER_SELECTOR)
  return titleWrapper?.querySelector<HTMLElement>(TITLE_HEADING_SELECTOR) ?? null
}

function richClipboardPlainText(clipboardData: DataTransfer): string | null {
  const text = clipboardData.getData('text/plain')
  const html = clipboardData.getData('text/html')

  return text.length > 0 && html.length > 0 ? text : null
}

function eventTargetElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Node)) return null
  return nodeElement(target)
}

function useTitleHeadingRichPasteHandler(options: {
  editable: boolean
  editor: ReturnType<typeof useCreateBlockNote>
  runEditorAction: (action: SuggestionAction) => void
}) {
  const { editable, editor, runEditorAction } = options

  return useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    if (!editable) return

    const target = eventTargetElement(event.target)
    if (!target) return

    const titleHeading = findTitleHeadingElement(target)
    if (!titleHeading || !event.currentTarget.contains(titleHeading)) return

    const text = richClipboardPlainText(event.clipboardData)
    if (!text) return

    event.preventDefault()
    runEditorAction(() => {
      editor.focus()
      editor.insertInlineContent(text, { updateSelection: true })
    })
  }, [editable, editor, runEditorAction])
}

function queueTitleHeadingCursorRepair(
  target: HTMLElement,
  editor: ReturnType<typeof useCreateBlockNote>,
): boolean {
  const titleHeading = findTitleHeadingElement(target)
  if (!titleHeading) return false

  queueMicrotask(() => {
    if (isSelectionInsideElement(titleHeading)) return

    const firstBlock = editor.document[0]
    if (firstBlock?.type !== 'heading') return

    try {
      editor.setTextCursorPosition(firstBlock.id, 'end')
    } catch {
      return
    }
    editor.focus()
  })

  return true
}

type EditorClientPoint = Pick<MouseEvent, 'clientX' | 'clientY'>
type TiptapSelectionRange = { from: number; to: number }
type TiptapSelectionBridge = {
  commands?: {
    setTextSelection?: (selection: number | TiptapSelectionRange) => unknown
  }
  state?: {
    doc?: {
      content?: { size?: unknown }
    }
  }
  view?: {
    dom?: Element
    posAtCoords?: (coords: { left: number; top: number }) => { pos?: unknown } | null
  }
}
type EditorWithTiptapSelection = {
  _tiptapEditor?: TiptapSelectionBridge
}
type WhitespaceSelectionStart = {
  anchor: number
  tiptapEditor: TiptapSelectionBridge
}
type WhitespaceDragState = WhitespaceSelectionStart & {
  moved: boolean
  startX: number
  startY: number
}
type WhitespaceMouseDownEvent = EditorClientPoint & {
  button: number
  target: EventTarget | null
  preventDefault: () => void
}

const EDGE_SELECTION_INSET_PX = 1
const DRAG_SELECTION_THRESHOLD_PX = 3

function getTiptapSelectionBridge(
  editor: ReturnType<typeof useCreateBlockNote>,
): TiptapSelectionBridge | null {
  return (editor as EditorWithTiptapSelection)._tiptapEditor ?? null
}

function isValidDocumentPosition(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function textSelectionDocumentBounds(
  tiptapEditor: TiptapSelectionBridge,
): { start: number; end: number } | null {
  const size = tiptapEditor.state?.doc?.content?.size
  if (!isValidDocumentPosition(size)) return null
  if (size <= 0) return { start: 0, end: 0 }

  const end = Math.max(1, Math.floor(size) - 1)
  return { start: Math.min(1, end), end }
}

function clampCoordinate(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (max <= min) return min
  return Math.min(max, Math.max(min, value))
}

function clampedEditorCoords(
  point: EditorClientPoint,
  editorRect: DOMRect,
): { left: number; top: number } {
  return {
    left: clampCoordinate(
      point.clientX,
      editorRect.left + EDGE_SELECTION_INSET_PX,
      editorRect.right - EDGE_SELECTION_INSET_PX,
    ),
    top: clampCoordinate(
      point.clientY,
      editorRect.top + EDGE_SELECTION_INSET_PX,
      editorRect.bottom - EDGE_SELECTION_INSET_PX,
    ),
  }
}

function fallbackTextPosition(
  tiptapEditor: TiptapSelectionBridge,
  point: EditorClientPoint,
  editorRect: DOMRect,
): number | null {
  const bounds = textSelectionDocumentBounds(tiptapEditor)
  if (!bounds) return null

  return point.clientY < editorRect.top ? bounds.start : bounds.end
}

function textPositionAtEditorPoint(
  tiptapEditor: TiptapSelectionBridge,
  point: EditorClientPoint,
): number | null {
  const view = tiptapEditor.view
  const editorDom = view?.dom
  if (!editorDom || typeof view.posAtCoords !== 'function') return null

  const editorRect = editorDom.getBoundingClientRect()
  const position = view.posAtCoords(clampedEditorCoords(point, editorRect))?.pos
  if (isValidDocumentPosition(position)) return position

  return fallbackTextPosition(tiptapEditor, point, editorRect)
}

function applyTiptapTextSelection(
  tiptapEditor: TiptapSelectionBridge,
  anchor: number,
  head: number,
): boolean {
  const setTextSelection = tiptapEditor.commands?.setTextSelection
  if (typeof setTextSelection !== 'function') return false

  const range = {
    from: Math.min(anchor, head),
    to: Math.max(anchor, head),
  }

  try {
    setTextSelection(range)
    return true
  } catch {
    return false
  }
}

function suppressNextContainerClick(suppressNextContainerClickRef: React.MutableRefObject<boolean>) {
  suppressNextContainerClickRef.current = true
  window.setTimeout(() => {
    suppressNextContainerClickRef.current = false
  }, 0)
}

function whitespaceSelectionStartFromEvent(options: {
  editable: boolean
  editor: ReturnType<typeof useCreateBlockNote>
  event: WhitespaceMouseDownEvent
  selectionRoot: HTMLElement
}): WhitespaceSelectionStart | null {
  const { editable, editor, event, selectionRoot } = options
  if (!editable || event.button !== 0) return null

  const target = eventTargetElement(event.target)
  if (!target || !selectionRoot.contains(target)) return null
  if (shouldIgnoreContainerClick(target)) return null

  const tiptapEditor = getTiptapSelectionBridge(editor)
  if (!tiptapEditor) return null

  const anchor = textPositionAtEditorPoint(tiptapEditor, event)
  return anchor === null ? null : { anchor, tiptapEditor }
}

function movedPastDragThreshold(state: WhitespaceDragState, point: EditorClientPoint): boolean {
  const movedDistance = Math.max(
    Math.abs(point.clientX - state.startX),
    Math.abs(point.clientY - state.startY),
  )

  return movedDistance >= DRAG_SELECTION_THRESHOLD_PX
}

function updateWhitespaceDragSelection(
  state: WhitespaceDragState,
  point: EditorClientPoint,
): boolean {
  const head = textPositionAtEditorPoint(state.tiptapEditor, point)
  if (head === null) return false

  state.moved = state.moved || movedPastDragThreshold(state, point) || head !== state.anchor
  return applyTiptapTextSelection(state.tiptapEditor, state.anchor, head)
}

function installWhitespaceSelectionDrag(options: {
  cleanupDragRef: React.MutableRefObject<(() => void) | null>
  state: WhitespaceDragState
  suppressNextContainerClickRef: React.MutableRefObject<boolean>
}): () => void {
  const { cleanupDragRef, state, suppressNextContainerClickRef } = options

  function cleanupDrag() {
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('mouseup', handleMouseUp)
    if (cleanupDragRef.current === cleanupDrag) {
      cleanupDragRef.current = null
    }
  }

  function handleMouseMove(moveEvent: MouseEvent) {
    if ((moveEvent.buttons & 1) !== 1) {
      cleanupDrag()
      return
    }

    if (updateWhitespaceDragSelection(state, moveEvent)) {
      moveEvent.preventDefault()
    }
  }

  function handleMouseUp(upEvent: MouseEvent) {
    updateWhitespaceDragSelection(state, upEvent)
    if (state.moved) {
      suppressNextContainerClick(suppressNextContainerClickRef)
    }
    cleanupDrag()
  }

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
  return cleanupDrag
}

function closestEditorScrollArea(container: HTMLElement): HTMLElement | null {
  const scrollArea = container.closest('.editor-scroll-area')
  return scrollArea instanceof HTMLElement ? scrollArea : null
}

function eventTargetIsOutsideContainer(event: MouseEvent, container: HTMLElement): boolean {
  const target = eventTargetElement(event.target)
  return !target || !container.contains(target)
}

function installScrollAreaWhitespaceSelection(options: {
  beginWhitespaceSelection: (event: WhitespaceMouseDownEvent, selectionRoot: HTMLElement) => void
  container: HTMLElement
}): (() => void) | undefined {
  const { beginWhitespaceSelection, container } = options
  const scrollArea = closestEditorScrollArea(container)
  if (!scrollArea || scrollArea === container) return undefined
  const selectionRoot = scrollArea

  function handleScrollAreaMouseDown(event: MouseEvent) {
    if (eventTargetIsOutsideContainer(event, container)) {
      beginWhitespaceSelection(event, selectionRoot)
    }
  }

  selectionRoot.addEventListener('mousedown', handleScrollAreaMouseDown, true)
  return () => {
    selectionRoot.removeEventListener('mousedown', handleScrollAreaMouseDown, true)
  }
}

function useEditorWhitespaceMouseSelection(options: {
  containerRef: React.RefObject<HTMLDivElement | null>
  editable: boolean
  editor: ReturnType<typeof useCreateBlockNote>
  suppressNextContainerClickRef: React.MutableRefObject<boolean>
}) {
  const { containerRef, editable, editor, suppressNextContainerClickRef } = options
  const cleanupDragRef = useRef<(() => void) | null>(null)

  useEffect(() => () => {
    cleanupDragRef.current?.()
  }, [])

  const beginWhitespaceSelection = useCallback((
    event: WhitespaceMouseDownEvent,
    selectionRoot: HTMLElement,
  ) => {
    const selectionStart = whitespaceSelectionStartFromEvent({
      editable,
      editor,
      event,
      selectionRoot,
    })
    if (!selectionStart) return

    cleanupDragRef.current?.()
    editor.focus()

    const { anchor, tiptapEditor } = selectionStart
    if (!applyTiptapTextSelection(tiptapEditor, anchor, anchor)) return
    event.preventDefault()

    const state: WhitespaceDragState = {
      ...selectionStart,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
    }

    cleanupDragRef.current = installWhitespaceSelectionDrag({
      cleanupDragRef,
      state,
      suppressNextContainerClickRef,
    })
  }, [editable, editor, suppressNextContainerClickRef])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    return installScrollAreaWhitespaceSelection({ beginWhitespaceSelection, container })
  }, [beginWhitespaceSelection, containerRef])

  return useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    beginWhitespaceSelection(event, event.currentTarget)
  }, [beginWhitespaceSelection])
}

function useEditorContainerClickHandler(options: {
  editable: boolean
  editor: ReturnType<typeof useCreateBlockNote>
  suppressNextContainerClickRef: React.MutableRefObject<boolean>
}) {
  const { editable, editor, suppressNextContainerClickRef } = options

  return useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!editable) return
    if (suppressNextContainerClickRef.current) {
      suppressNextContainerClickRef.current = false
      return
    }

    const target = e.target as HTMLElement
    if (queueTitleHeadingCursorRepair(target, editor)) return
    if (shouldIgnoreContainerClick(target)) return
    const blocks = editor.document
    if (blocks.length > 0) {
      const targetBlock = findNearestTextCursorBlock(blocks, blocks.length - 1)
      if (targetBlock) {
        try {
          editor.setTextCursorPosition(targetBlock.id, 'end')
        } catch {
          // Ignore transient BlockNote selection errors and at least restore focus.
        }
      }
    }
    editor.focus()
  }, [editor, editable, suppressNextContainerClickRef])
}

function useCompositionAwareEditorChange(options: {
  containerRef: React.RefObject<HTMLDivElement | null>
  onChange?: () => void
}) {
  const { containerRef, onChange } = options
  const onChangeRef = useRef(onChange)
  const composingRef = useRef(false)
  const pendingChangeRef = useRef(false)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const flushPendingChange = () => {
      if (composingRef.current || !pendingChangeRef.current) return
      pendingChangeRef.current = false
      onChangeRef.current?.()
    }

    const handleCompositionStart = () => {
      composingRef.current = true
    }

    const handleCompositionEnd = () => {
      composingRef.current = false
      queueMicrotask(flushPendingChange)
    }

    container.addEventListener('compositionstart', handleCompositionStart, true)
    container.addEventListener('compositionend', handleCompositionEnd, true)
    return () => {
      container.removeEventListener('compositionstart', handleCompositionStart, true)
      container.removeEventListener('compositionend', handleCompositionEnd, true)
    }
  }, [containerRef])

  return useCallback(() => {
    if (composingRef.current) {
      pendingChangeRef.current = true
      return
    }

    pendingChangeRef.current = false
    onChangeRef.current?.()
  }, [])
}

function handleCodeBlockCopy(event: React.ClipboardEvent<HTMLDivElement>): boolean {
  const codeText = selectedCodeBlockText({
    selection: window.getSelection(),
    container: event.currentTarget,
  })
  if (codeText === null) return false

  event.clipboardData.setData('text/plain', codeText)
  event.preventDefault()
  return true
}

function handleSelectedEditorCopy(event: React.ClipboardEvent<HTMLDivElement>) {
  const selection = window.getSelection()
  const range = selectedEditorRange(selection, event.currentTarget)
  if (!selection || !range) return

  const plainText = selectedEditorPlainText(selection, range)
  if (plainText === null) return

  event.clipboardData.setData('text/plain', plainText)

  const html = selectedEditorHtml(range)
  if (html.length > 0) {
    event.clipboardData.setData('text/html', html)
  }

  event.preventDefault()
}

function handleEditorCopy(event: React.ClipboardEvent<HTMLDivElement>) {
  if (handleCodeBlockCopy(event)) return

  handleSelectedEditorCopy(event)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function markdownStem(value: string): string {
  return value.replace(/\.md$/i, '')
}

function pathStem(path: string): string {
  return markdownStem(path.split('/').pop() ?? path)
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => nonEmptyString(item) !== null)
    : []
}

function buildBaseSuggestionItems(entries: VaultEntry[]) {
  return deduplicateByPath(entries.flatMap(entry => {
    const path = nonEmptyString(entry.path)
    if (!path) return []

    const filename = nonEmptyString(entry.filename)
    const filenameStem = filename ? markdownStem(filename) : pathStem(path)
    const title = nonEmptyString(entry.title) ?? filenameStem
    const entryType = nonEmptyString(entry.isA)
    return [{
      title,
      aliases: [...new Set([filenameStem, ...safeStringArray(entry.aliases)])],
      group: entryType ?? 'Note',
      entryType,
      entryTitle: title,
      path,
    }]
  }))
}

function useInsertWikilink(
  editor: ReturnType<typeof useCreateBlockNote>,
  runEditorAction: (action: SuggestionAction) => void,
) {
  return useCallback((target: string) => {
    runEditorAction(() => {
      editor.insertInlineContent([
        { type: 'wikilink' as const, props: { target } },
        " ",
      ], { updateSelection: true })
      trackEvent('wikilink_inserted')
    })
  }, [editor, runEditorAction])
}

function useSuggestionMenuItems(options: {
  baseItems: ReturnType<typeof buildBaseSuggestionItems>
  editor: ReturnType<typeof useCreateBlockNote>
  insertWikilink: (target: string) => void
  runEditorAction: (action: SuggestionAction) => void
  typeEntryMap: Record<string, VaultEntry>
  vaultPath?: string
}) {
  const {
    baseItems,
    editor,
    insertWikilink,
    runEditorAction,
    typeEntryMap,
    vaultPath,
  } = options

  const buildItems = useCallback((query: string, triggerCharacter: '[[' | '@') => {
    const normalizedQuery = normalizeSuggestionQuery(query, triggerCharacter)
    const minLength = triggerCharacter === '[[' ? MIN_QUERY_LENGTH : PERSON_MENTION_MIN_QUERY
    if (normalizedQuery.length < minLength) return null

    const candidates = triggerCharacter === '[['
      ? preFilterWikilinks(baseItems, normalizedQuery)
      : filterPersonMentions(baseItems, normalizedQuery)

    const items = attachClickHandlers(candidates, insertWikilink, vaultPath ?? '')
    return guardSuggestionMenuItems(
      enrichSuggestionItems(items, normalizedQuery, typeEntryMap),
      runEditorAction,
    )
  }, [baseItems, insertWikilink, runEditorAction, typeEntryMap, vaultPath])

  const getWikilinkItems = useCallback(async (query: string): Promise<WikilinkSuggestionItem[]> => (
    buildItems(query, '[[') ?? []
  ), [buildItems])

  const getPersonMentionItems = useCallback(async (query: string): Promise<WikilinkSuggestionItem[]> => (
    buildItems(query, '@') ?? []
  ), [buildItems])

  const getSlashMenuItems = useCallback(async (query: string) => {
    try {
      return guardSuggestionMenuItems(
        await Promise.resolve(getTolariaSlashMenuItems(editor, query)),
        runEditorAction,
      )
    } catch (error) {
      console.warn('[editor] Ignored stale slash menu query:', error)
      return []
    }
  }, [editor, runEditorAction])

  return {
    getWikilinkItems,
    getPersonMentionItems,
    getSlashMenuItems,
  }
}

type EditorInteractionControllersProps = ReturnType<typeof useSuggestionMenuItems> & {
  runEditorAction: (action: SuggestionAction) => void
}

function EditorInteractionControllers({
  getPersonMentionItems,
  getSlashMenuItems,
  getWikilinkItems,
  runEditorAction,
}: EditorInteractionControllersProps) {
  return (
    <>
      <SideMenuController sideMenu={TolariaSideMenu} />
      <TolariaFormattingToolbarController
        formattingToolbar={TolariaFormattingToolbar}
        floatingUIOptions={{
          elementProps: {
            onMouseDownCapture: handleToolbarMouseDownCapture,
          },
        }}
      />
      <LinkToolbarController
        linkToolbar={TolariaLinkToolbar}
        floatingUIOptions={{
          elementProps: {
            onMouseDownCapture: handleToolbarMouseDownCapture,
          },
        }}
      />
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={getSlashMenuItems}
      />
      <SuggestionMenuController
        triggerCharacter="[["
        getItems={getWikilinkItems}
        suggestionMenuComponent={WikilinkSuggestionMenu}
        onItemClick={(item: WikilinkSuggestionItem) => runEditorAction(item.onItemClick)}
      />
      <SuggestionMenuController
        triggerCharacter="@"
        getItems={getPersonMentionItems}
        suggestionMenuComponent={WikilinkSuggestionMenu}
        onItemClick={(item: WikilinkSuggestionItem) => runEditorAction(item.onItemClick)}
      />
    </>
  )
}

/** Insert an image block after the current cursor position. */
function useInsertImageCallback(editor: ReturnType<typeof useCreateBlockNote>) {
  const editorRef = useRef(editor)
  useEffect(() => { editorRef.current = editor }, [editor])
  return useCallback((url: string) => {
    const e = editorRef.current
    const cursorBlock = e.getTextCursorPosition().block
    e.insertBlocks([{ type: 'image' as const, props: { url } }], cursorBlock, 'after')
  }, [])
}

function useRichEditorPlainTextPasteTarget(options: {
  containerRef: React.RefObject<HTMLDivElement | null>
  editable: boolean
  editor: ReturnType<typeof useCreateBlockNote>
  runEditorAction: (action: SuggestionAction) => void
}) {
  const { containerRef, editable, editor, runEditorAction } = options
  const targetRef = useRef<PlainTextPasteTarget | null>(null)

  useEffect(() => {
    const target: PlainTextPasteTarget = {
      surface: 'rich_editor',
      contains: (element) => Boolean(element && containerRef.current?.contains(element)),
      isConnected: () => containerRef.current?.isConnected === true,
      insert: (text) => {
        if (!editable) return false

        let inserted = false
        runEditorAction(() => {
          editor.focus()
          editor.insertInlineContent(text, { updateSelection: true })
          inserted = true
        })
        return inserted
      },
    }
    targetRef.current = target
    const unregister = registerPlainTextPasteTarget(target)

    return () => {
      unregister()
      if (targetRef.current === target) {
        targetRef.current = null
      }
    }
  }, [containerRef, editable, editor, runEditorAction])

  return useCallback(() => {
    if (targetRef.current) {
      activatePlainTextPasteTarget(targetRef.current)
    }
  }, [])
}

/** Single BlockNote editor view — content is swapped via replaceBlocks */
export function SingleEditorView({ editor, entries, onNavigateWikilink, onChange, vaultPath, editable = true, locale = 'en' }: {
  editor: ReturnType<typeof useCreateBlockNote>
  entries: VaultEntry[]
  onNavigateWikilink: (target: string) => void
  onChange?: () => void
  vaultPath?: string
  editable?: boolean
  locale?: AppLocale
}) {
  const { cssVars } = useEditorTheme()
  const themeMode = useDocumentThemeMode()
  const containerRef = useRef<HTMLDivElement>(null)
  const suppressNextContainerClickRef = useRef(false)
  const handleContainerClick = useEditorContainerClickHandler({
    editable,
    editor,
    suppressNextContainerClickRef,
  })
  const handleWhitespaceMouseSelection = useEditorWhitespaceMouseSelection({
    containerRef,
    editable,
    editor,
    suppressNextContainerClickRef,
  })
  const handleEditorChange = useCompositionAwareEditorChange({ containerRef, onChange })
  const onImageUrl = useInsertImageCallback(editor)
  const { isDragOver } = useImageDrop({ containerRef, onImageUrl, vaultPath })
  const lightbox = useImageLightbox({ containerRef })
  const {
    clearCopyTarget,
    copyTarget,
    handleFocus: handleCodeBlockCopyFocus,
    handleMouseMove: handleCodeBlockCopyMouseMove,
  } = useCodeBlockCopyTarget(containerRef)
  useBlockNoteSideMenuHoverGuard(containerRef)
  useEditorLinkActivation(containerRef, onNavigateWikilink)

  useEffect(() => {
    _wikilinkEntriesRef.current = entries
  }, [entries])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    return observeNativeTextAssistanceDisabled(container)
  }, [])

  useSeedBlockNoteTableBridge(editor)

  const typeEntryMap = useMemo(() => buildTypeEntryMap(entries), [entries])
  const baseItems = useMemo(() => buildBaseSuggestionItems(entries), [entries])
  const runEditorAction = useCallback((action: SuggestionAction) => {
    runSuggestionActionSafely({
      action,
      container: containerRef.current,
      editor,
    })
  }, [editor])
  const activatePlainTextPaste = useRichEditorPlainTextPasteTarget({
    containerRef,
    editable,
    editor,
    runEditorAction,
  })
  const handleTitleHeadingRichPaste = useTitleHeadingRichPasteHandler({
    editable,
    editor,
    runEditorAction,
  })
  const handleFocusCapture = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    activatePlainTextPaste()
    handleCodeBlockCopyFocus(event)
  }, [activatePlainTextPaste, handleCodeBlockCopyFocus])
  const handleMouseDownCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    activatePlainTextPaste()
    handleWhitespaceMouseSelection(event)
  }, [activatePlainTextPaste, handleWhitespaceMouseSelection])
  const insertWikilink = useInsertWikilink(editor, runEditorAction)
  const suggestionMenuItems = useSuggestionMenuItems({
    baseItems,
    editor,
    insertWikilink,
    runEditorAction,
    typeEntryMap,
    vaultPath,
  })

  return (
    <div
      ref={containerRef}
      className={`editor__blocknote-container${isDragOver ? ' editor__blocknote-container--drag-over' : ''}`}
      style={cssVars as React.CSSProperties}
      onClick={handleContainerClick}
      onCopyCapture={handleEditorCopy}
      onFocusCapture={handleFocusCapture}
      onMouseLeave={clearCopyTarget}
      onMouseDownCapture={handleMouseDownCapture}
      onMouseMove={handleCodeBlockCopyMouseMove}
      onPasteCapture={handleTitleHeadingRichPaste}
    >
      {isDragOver && (
        <div className="editor__drop-overlay">
          <div className="editor__drop-overlay-label">Drop image here</div>
        </div>
      )}
      <SharedContextBlockNoteView
        editor={editor}
        theme={themeMode}
        onChange={handleEditorChange}
        editable={editable}
        formattingToolbar={false}
        linkToolbar={false}
        slashMenu={false}
        sideMenu={false}
      >
        <EditorInteractionControllers
          {...suggestionMenuItems}
          runEditorAction={runEditorAction}
        />
      </SharedContextBlockNoteView>
      {copyTarget && <CodeBlockCopyButton copyTarget={copyTarget} locale={locale} />}
      <ImageLightbox image={lightbox.image} locale={locale} onClose={lightbox.close} />
    </div>
  )
}
