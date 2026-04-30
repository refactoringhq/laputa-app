import { useEffect, useCallback, useMemo, useRef, useContext } from 'react'
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
import { ExternalLink } from 'lucide-react'
import { useDocumentThemeMode } from '../hooks/useDocumentThemeMode'
import { useEditorTheme } from '../hooks/useTheme'
import { useImageDrop } from '../hooks/useImageDrop'
import { useImageLightbox } from '../hooks/useImageLightbox'
import type { AppLocale } from '../lib/i18n'
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

function findTitleHeadingElement(target: HTMLElement): HTMLElement | null {
  const directHeading = target.closest<HTMLElement>(TITLE_HEADING_SELECTOR)
  if (directHeading) return directHeading

  const titleWrapper = target.closest<HTMLElement>(TITLE_HEADING_WRAPPER_SELECTOR)
  return titleWrapper?.querySelector<HTMLElement>(TITLE_HEADING_SELECTOR) ?? null
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

function useEditorContainerClickHandler(options: {
  editable: boolean
  editor: ReturnType<typeof useCreateBlockNote>
}) {
  const { editable, editor } = options

  return useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!editable) return
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
  }, [editor, editable])
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

function handleCodeBlockCopy(event: React.ClipboardEvent<HTMLDivElement>) {
  const codeText = selectedCodeBlockText({
    selection: window.getSelection(),
    container: event.currentTarget,
  })
  if (codeText === null) return

  event.clipboardData.setData('text/plain', codeText)
  event.preventDefault()
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
  const handleContainerClick = useEditorContainerClickHandler({ editable, editor })
  const handleEditorChange = useCompositionAwareEditorChange({ containerRef, onChange })
  const onImageUrl = useInsertImageCallback(editor)
  const { isDragOver } = useImageDrop({ containerRef, onImageUrl, vaultPath })
  const lightbox = useImageLightbox({ containerRef })
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
  const insertWikilink = useInsertWikilink(editor, runEditorAction)
  const {
    getWikilinkItems,
    getPersonMentionItems,
    getSlashMenuItems,
  } = useSuggestionMenuItems({
    baseItems,
    editor,
    insertWikilink,
    runEditorAction,
    typeEntryMap,
    vaultPath,
  })

  return (
    <div ref={containerRef} className={`editor__blocknote-container${isDragOver ? ' editor__blocknote-container--drag-over' : ''}`} style={cssVars as React.CSSProperties} onClick={handleContainerClick} onCopyCapture={handleCodeBlockCopy}>
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
      </SharedContextBlockNoteView>
      <ImageLightbox image={lightbox.image} locale={locale} onClose={lightbox.close} />
    </div>
  )
}
