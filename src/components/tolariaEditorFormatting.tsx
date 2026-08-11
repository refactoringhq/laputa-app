import {
  FormattingToolbar,
  getFormattingToolbarItems,
  PositionPopover,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useEditorState,
  useExtension,
  useExtensionState,
} from '@blocknote/react'
import type {
  FloatingUIOptions,
  FormattingToolbarProps,
} from '@blocknote/react'
import {
  blockHasType,
  defaultProps,
  editorHasBlockWithType,
  type DefaultProps,
} from '@blocknote/core'
import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core'
import { FormattingToolbarExtension } from '@blocknote/core/extensions'
import { useEditorComposing } from './useEditorComposing'
import { CodeBlockLanguageControls } from './codeBlockLanguageControls'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FC,
  type MutableRefObject,
  type ReactElement,
  type SetStateAction,
} from 'react'
import {
  Button as MantineButton,
  CheckIcon as MantineCheckIcon,
  Menu as MantineMenu,
} from '@mantine/core'
import {
  ArrowSquareOut as ExternalLink,
  CaretDown as ChevronDown,
  Code as Code2,
  Highlighter,
  TextB as Bold,
  TextItalic as Italic,
  TextStrikethrough as Strikethrough,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react'
import { MARKDOWN_HIGHLIGHT_STYLE } from '../utils/markdownHighlightMarkdown'
import {
  filterTolariaFormattingToolbarItems,
  getTolariaBlockTypeSelectItems,
} from './tolariaEditorFormattingConfig'
import { translate, type AppLocale } from '../lib/i18n'
import { useBlockNoteFormattingToolbarHoverGuard } from './blockNoteFormattingToolbarHoverGuard'
import { openEditorAttachmentOrUrl } from './editorAttachmentActions'
import { turnBlocksIntoType } from './richEditorBlockTypeCommands'

type TolariaBasicTextStyle =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | typeof MARKDOWN_HIGHLIGHT_STYLE

const FORMATTER_CLOSE_GRACE_MS = 160
const FORMATTER_VIEWPORT_PADDING_PX = 8
type TolariaFloatingOptions = NonNullable<FloatingUIOptions['useFloatingOptions']>
type TolariaFloatingMiddleware = NonNullable<TolariaFloatingOptions['middleware']>[number]

function isFocusStillWithinToolbar(
  currentTarget: EventTarget & Element,
  nextTarget: EventTarget | null,
) {
  return nextTarget instanceof Node && currentTarget.contains(nextTarget)
}

function clearToolbarCloseGrace(
  timeoutRef: MutableRefObject<number | null>,
  setCloseGraceActive: Dispatch<SetStateAction<boolean>>,
) {
  if (timeoutRef.current !== null) {
    window.clearTimeout(timeoutRef.current)
    timeoutRef.current = null
  }
  setCloseGraceActive(false)
}

function startToolbarCloseGrace(
  timeoutRef: MutableRefObject<number | null>,
  setCloseGraceActive: Dispatch<SetStateAction<boolean>>,
) {
  setCloseGraceActive(true)
  if (timeoutRef.current !== null) {
    window.clearTimeout(timeoutRef.current)
  }
  timeoutRef.current = window.setTimeout(() => {
    timeoutRef.current = null
    setCloseGraceActive(false)
  }, FORMATTER_CLOSE_GRACE_MS)
}

function useFormattingToolbarCloseGrace({
  show,
  toolbarHasFocus,
  toolbarHovered,
}: {
  show: boolean
  toolbarHasFocus: boolean
  toolbarHovered: boolean
}) {
  const [closeGraceActive, setCloseGraceActive] = useState(false)
  const closeGraceTimeoutRef = useRef<number | null>(null)
  const previousShowRef = useRef(show)

  const clearCloseGrace = useCallback(() => {
    clearToolbarCloseGrace(closeGraceTimeoutRef, setCloseGraceActive)
  }, [])
  const dismissImmediately = useCallback(() => {
    previousShowRef.current = false
    clearCloseGrace()
  }, [clearCloseGrace])

  useEffect(() => {
    const toolbarInteractionActive = show || toolbarHasFocus || toolbarHovered

    if (toolbarInteractionActive) {
      clearCloseGrace()
    } else if (previousShowRef.current) {
      startToolbarCloseGrace(closeGraceTimeoutRef, setCloseGraceActive)
    }

    previousShowRef.current = show
  }, [clearCloseGrace, show, toolbarHasFocus, toolbarHovered])

  useEffect(() => () => {
    if (closeGraceTimeoutRef.current !== null) {
      window.clearTimeout(closeGraceTimeoutRef.current)
    }
  }, [])

  return { closeGraceActive, clearCloseGrace, dismissImmediately }
}

type FormattingToolbarStore = {
  setState(open: boolean): void
}

type BlockTypeMenuState = {
  opened: boolean
  setOpened(opened: boolean): void
}

const BlockTypeMenuContext = createContext<BlockTypeMenuState | null>(null)

function useBlockTypeMenuState(): BlockTypeMenuState {
  const sharedState = useContext(BlockTypeMenuContext)
  const [localOpened, setLocalOpened] = useState(false)
  return sharedState ?? { opened: localOpened, setOpened: setLocalOpened }
}

function useCloseBlockTypeMenuOnEditorInteraction(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
  opened: boolean,
  closeMenu: () => void,
) {
  useEffect(() => {
    if (!opened || !editor.domElement) return
    const editorElement = editor.domElement
    editorElement.addEventListener('pointerdown', closeMenu, true)
    editorElement.addEventListener('keydown', closeMenu, true)
    editorElement.addEventListener('beforeinput', closeMenu, true)
    return () => {
      editorElement.removeEventListener('pointerdown', closeMenu, true)
      editorElement.removeEventListener('keydown', closeMenu, true)
      editorElement.removeEventListener('beforeinput', closeMenu, true)
    }
  }, [closeMenu, editor, opened])
}

function useDeduplicatedFormattingToolbarStore(
  store: FormattingToolbarStore,
  show: boolean,
) {
  const openRef = useRef(show)

  useEffect(() => {
    openRef.current = show
  }, [show])

  return useCallback((open: boolean) => {
    if (openRef.current === open) return
    openRef.current = open
    store.setState(open)
  }, [store])
}

const TOLARIA_BASIC_TEXT_STYLE_TOOLTIPS = {
  bold: {
    label: 'Bold',
    mainTooltip: 'Bold (persists in markdown)',
    secondaryTooltip: '**strong**',
  },
  italic: {
    label: 'Italic',
    mainTooltip: 'Italic (persists in markdown)',
    secondaryTooltip: '*emphasis*',
  },
  strike: {
    label: 'Strikethrough',
    mainTooltip: 'Strikethrough (persists in markdown)',
    secondaryTooltip: '~~strike~~',
  },
  code: {
    label: 'Inline code',
    mainTooltip: 'Inline code (persists in markdown)',
    secondaryTooltip: '`code`',
  },
} satisfies Record<
  Exclude<TolariaBasicTextStyle, typeof MARKDOWN_HIGHLIGHT_STYLE>,
  { label: string; mainTooltip: string; secondaryTooltip: string }
>

const TOLARIA_BASIC_TEXT_STYLE_ICONS = {
  bold: Bold,
  italic: Italic,
  strike: Strikethrough,
  code: Code2,
  [MARKDOWN_HIGHLIGHT_STYLE]: Highlighter,
} satisfies Record<TolariaBasicTextStyle, PhosphorIcon>

type TolariaSelectedBlock = ReturnType<
  BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>['getTextCursorPosition']
>['block']

type TolariaSelectedFileBlock = {
  type: string
  url: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTolariaSelectedBlock(value: unknown): value is TolariaSelectedBlock {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.type === 'string'
    && isRecord(value.props)
}

function tolariaSelectedBlocks(value: unknown): TolariaSelectedBlock[] {
  return Array.isArray(value) ? value.filter(isTolariaSelectedBlock) : []
}

const FORMATTING_TOOLBAR_FILE_BLOCK_TYPES = new Set([
  'audio',
  'file',
  'image',
  'video',
])

type TolariaBlockTypeSelectOption = ReturnType<
  typeof getTolariaBlockTypeSelectItems
>[number] & {
  iconElement: ReactElement
  isSelected: boolean
}

function textAlignmentToPlacement(
  textAlignment: DefaultProps['textAlignment'],
) {
  switch (textAlignment) {
    case 'left':
      return 'top-start'
    case 'center':
      return 'top'
    case 'right':
      return 'top-end'
    default:
      return 'top-start'
  }
}

function viewportClampMiddleware(): TolariaFloatingMiddleware {
  return {
    name: 'tolariaViewportClamp',
    fn({ x, rects }: { rects: { floating: { width: number } }; x: number }) {
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth
      const minX = FORMATTER_VIEWPORT_PADDING_PX
      const maxX = Math.max(
        minX,
        viewportWidth - rects.floating.width - FORMATTER_VIEWPORT_PADDING_PX,
      )

      return {
        x: Math.min(Math.max(x, minX), maxX),
      }
    },
  }
}

function withViewportSafeMiddleware(
  options?: TolariaFloatingOptions,
): TolariaFloatingOptions {
  if (!options) {
    return {
      middleware: [viewportClampMiddleware()],
    }
  }

  return {
    ...options,
    middleware: [
      ...(options.middleware ?? []),
      viewportClampMiddleware(),
    ],
  }
}

function editorSupportsTextStyle(
  style: TolariaBasicTextStyle,
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
) {
  const styleSchema = Reflect.get(editor.schema.styleSchema, style) as {
    type?: string
    propSchema?: unknown
  } | undefined
  return (
    style in editor.schema.styleSchema &&
    styleSchema?.type === style &&
    styleSchema.propSchema === 'boolean'
  )
}

function getSelectedBlocksSafely(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
): TolariaSelectedBlock[] {
  try {
    const selectionBlocks = tolariaSelectedBlocks(editor.getSelection()?.blocks)
    if (selectionBlocks.length) return selectionBlocks
  } catch {
    // BlockNote can briefly expose an invalid selection while inline actions remount blocks.
  }

  try {
    const block = editor.getTextCursorPosition().block
    return isTolariaSelectedBlock(block) ? [block] : []
  } catch {
    return []
  }
}

function getCursorBlockSafely(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
): TolariaSelectedBlock | null {
  try {
    const block = editor.getTextCursorPosition().block
    return isTolariaSelectedBlock(block) ? block : null
  } catch {
    return null
  }
}

function selectionSupportsInlineFormatting(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
) {
  return getSelectedBlocksSafely(editor).some((block) => block.content !== undefined)
}

function getBasicTextStyleButtonState(
  basicTextStyle: TolariaBasicTextStyle,
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
) {
  if (!editor.isEditable) return undefined
  if (!editorSupportsTextStyle(basicTextStyle, editor)) return undefined
  if (!selectionSupportsInlineFormatting(editor)) return undefined

  return {
    active: basicTextStyle in editor.getActiveStyles(),
  }
}

function getBlockTypeItemIconElement(
  item: ReturnType<typeof getTolariaBlockTypeSelectItems>[number],
) {
  const Icon = item.icon
  return <Icon size={16} />
}

function isSelectedBlockTypeItem(
  item: ReturnType<typeof getTolariaBlockTypeSelectItems>[number],
  firstSelectedBlock: TolariaSelectedBlock,
) {
  if (item.type !== firstSelectedBlock.type) return false

  return Object.entries(item.props || {}).every(
    ([propName, propValue]) =>
      propValue === Reflect.get(firstSelectedBlock.props, propName),
  )
}

function getTolariaBlockTypeSelectOptions(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
  firstSelectedBlock: TolariaSelectedBlock,
) {
  return getTolariaBlockTypeSelectItems()
    .filter((item) =>
      editorHasBlockWithType(
        editor,
        item.type,
        Object.fromEntries(
          Object.entries(item.props || {}).map(([propName, propValue]) => [
            propName,
            typeof propValue,
          ]),
        ) as Record<string, 'string' | 'number' | 'boolean'>,
      ),
    )
    .map((item) => ({
      ...item,
      iconElement: getBlockTypeItemIconElement(item),
      isSelected: isSelectedBlockTypeItem(item, firstSelectedBlock),
    }))
}

function getFormattingToolbarBridgeBlockId(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
) {
  const selectedBlock = getSelectedBlocksSafely(editor).at(0)
  if (!selectedBlock) return null

  return FORMATTING_TOOLBAR_FILE_BLOCK_TYPES.has(selectedBlock.type)
    ? selectedBlock.id
    : null
}

function getSelectedFileBlockState(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
): TolariaSelectedFileBlock | null {
  const selectedBlocks = getSelectedBlocksSafely(editor)
  if (selectedBlocks.length !== 1) return null

  const block = selectedBlocks.at(0)
  if (!block) return null
  if (!FORMATTING_TOOLBAR_FILE_BLOCK_TYPES.has(block.type)) return null

  const url = (block.props as Record<string, unknown>).url
  return typeof url === 'string' && url.trim().length > 0
    ? { type: block.type, url }
    : null
}

type FormattingToolbarDictionary = {
  formatting_toolbar?: {
    file_download?: {
      tooltip?: Record<string, string>
    }
  }
}

function fileDownloadTooltips(dict: unknown): Record<string, string> {
  const toolbar = (dict as FormattingToolbarDictionary).formatting_toolbar
  if (!toolbar) return {}
  const fileDownload = toolbar.file_download
  if (!fileDownload) return {}
  return fileDownload.tooltip ?? {}
}

function fileDownloadTooltip(dict: unknown, blockType: string): string {
  const tooltips = fileDownloadTooltips(dict)
  const specificTooltip = Reflect.get(tooltips, blockType)
  if (typeof specificTooltip === 'string') return specificTooltip
  return tooltips.file ?? 'Download file'
}

function getFormattingToolbarAnchorElement(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
) {
  const anchor = editor.domElement?.firstElementChild
  return anchor instanceof Element && anchor.isConnected ? anchor : null
}

function useRequiredComponentsContext() {
  const components = useComponentsContext()
  if (!components) throw new Error('BlockNote components context is unavailable')
  return components
}

function TolariaBasicTextStyleButton({
  basicTextStyle,
  locale = 'en',
}: {
  basicTextStyle: TolariaBasicTextStyle
  locale?: AppLocale
}) {
  const Components = useRequiredComponentsContext()
  const editor = useBlockNoteEditor<
    BlockSchema,
    InlineContentSchema,
    StyleSchema
  >()
  const buttonState = useEditorState({
    editor,
    selector: ({ editor }) => getBasicTextStyleButtonState(basicTextStyle, editor),
  })

  const toggleStyle = useCallback(() => {
    editor.focus()
    editor.toggleStyles({ [basicTextStyle]: true } as never)
  }, [basicTextStyle, editor])

  if (buttonState === undefined) return null

  const Icon = Reflect.get(TOLARIA_BASIC_TEXT_STYLE_ICONS, basicTextStyle) as PhosphorIcon
  const copy = basicTextStyleCopy(basicTextStyle, locale)

  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      data-test={basicTextStyle}
      onClick={toggleStyle}
      isSelected={buttonState.active}
      label={copy.label}
      mainTooltip={copy.mainTooltip}
      secondaryTooltip={copy.secondaryTooltip}
      icon={<Icon />}
    />
  )
}

function basicTextStyleCopy(
  basicTextStyle: TolariaBasicTextStyle,
  locale: AppLocale,
) {
  if (basicTextStyle === MARKDOWN_HIGHLIGHT_STYLE) {
    return {
      label: translate(locale, 'editor.formatting.highlight'),
      mainTooltip: translate(locale, 'editor.formatting.highlightTooltip'),
      secondaryTooltip: '==highlight==',
    }
  }

  return Reflect.get(TOLARIA_BASIC_TEXT_STYLE_TOOLTIPS, basicTextStyle) as {
    label: string
    mainTooltip: string
    secondaryTooltip: string
  }
}

function TolariaBlockTypeSelect() {
  const editor = useBlockNoteEditor<
    BlockSchema,
    InlineContentSchema,
    StyleSchema
  >()
  const selectedBlocks = useEditorState({
    editor,
    selector: ({ editor }): TolariaSelectedBlock[] => getSelectedBlocksSafely(editor),
  })
  const firstSelectedBlock = selectedBlocks[0] ?? null
  const selectItems = useMemo(
    () => (
      firstSelectedBlock
        ? getTolariaBlockTypeSelectOptions(editor, firstSelectedBlock)
        : []
    ),
    [editor, firstSelectedBlock],
  )
  const selectedItem = selectItems.find(
    (item): item is TolariaBlockTypeSelectOption => item.isSelected,
  )
  const menuState = useBlockTypeMenuState()
  const selectedBlockIdsRef = useRef<string[]>([])
  const captureSelectedBlockIds = useCallback(() => {
    selectedBlockIdsRef.current = selectedBlocks.map((block) => block.id)
  }, [selectedBlocks])
  const handleMenuChange = useCallback((opened: boolean) => {
    if (opened) captureSelectedBlockIds()
    menuState.setOpened(opened)
  }, [captureSelectedBlockIds, menuState])
  const handleBlockTypeChange = useCallback((item: TolariaBlockTypeSelectOption) => {
    const blockIds = selectedBlockIdsRef.current.length
      ? selectedBlockIdsRef.current
      : selectedBlocks.map((block) => block.id)
    turnBlocksIntoType({
      blockIds,
      editor,
      source: 'block_menu',
      target: item,
    })
    menuState.setOpened(false)
  }, [editor, menuState, selectedBlocks])

  if (!selectedItem || !editor.isEditable) return null

  return (
    <MantineMenu
      opened={menuState.opened}
      onChange={handleMenuChange}
      withinPortal={false}
      transitionProps={{ exitDuration: 0 }}
      middlewares={{ flip: true, shift: true, inline: false, size: true }}
    >
      <MantineMenu.Target>
        <MantineButton
          onMouseDown={(event) => {
            captureSelectedBlockIds()
            event.preventDefault()
            event.currentTarget.focus()
          }}
          leftSection={selectedItem.iconElement}
          rightSection={<ChevronDown size={16} />}
          size="xs"
          variant="subtle"
        >
          {selectedItem.name}
        </MantineButton>
      </MantineMenu.Target>
      <MantineMenu.Dropdown className="bn-select">
        {selectItems.map((item) => (
          <MantineMenu.Item
            key={item.name}
            onClick={() => {
              handleBlockTypeChange(item)
            }}
            leftSection={item.iconElement}
            rightSection={item.isSelected
              ? <MantineCheckIcon size={10} className="bn-tick-icon" />
              : <div className="bn-tick-space" />}
          >
            {item.name}
          </MantineMenu.Item>
        ))}
      </MantineMenu.Dropdown>
    </MantineMenu>
  )
}

function TolariaFileDownloadButton({ vaultPath }: { vaultPath?: string }) {
  const Components = useRequiredComponentsContext()
  const dict = useDictionary()
  const editor = useBlockNoteEditor<
    BlockSchema,
    InlineContentSchema,
    StyleSchema
  >()
  const selectedFileBlock = useEditorState({
    editor,
    selector: ({ editor }) => getSelectedFileBlockState(editor),
  })
  const handleOpen = useCallback(() => {
    if (!selectedFileBlock) return

    editor.focus()
    openEditorAttachmentOrUrl({
      url: selectedFileBlock.url,
      vaultPath,
      source: 'file',
    })
  }, [editor, selectedFileBlock, vaultPath])

  if (!selectedFileBlock || !editor.isEditable) return null

  const label = fileDownloadTooltip(dict, selectedFileBlock.type)
  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      data-test="fileDownload"
      onClick={handleOpen}
      isSelected={false}
      label={label}
      mainTooltip={label}
      icon={<ExternalLink />}
    />
  )
}

function replaceToolbarControls(items: ReactElement[], vaultPath?: string) {
  return items.flatMap((item) => {
    switch (String(item.key)) {
      case 'blockTypeSelect':
        return [<TolariaBlockTypeSelect key={item.key} />]
      case 'boldStyleButton':
        return [<TolariaBasicTextStyleButton basicTextStyle="bold" key={item.key} />]
      case 'italicStyleButton':
        return [<TolariaBasicTextStyleButton basicTextStyle="italic" key={item.key} />]
      case 'strikeStyleButton':
        return [<TolariaBasicTextStyleButton basicTextStyle="strike" key={item.key} />]
      case 'fileDownloadButton':
        return [<TolariaFileDownloadButton key={item.key} vaultPath={vaultPath} />]
      default:
        return [item]
    }
  })
}

function insertExtraTextStyleButtons(items: ReactElement[], locale: AppLocale) {
  const strikeButtonIndex = items.findIndex(
    (item) => String(item.key) === 'strikeStyleButton',
  )
  if (strikeButtonIndex === -1) return items

  return [
    ...items.slice(0, strikeButtonIndex + 1),
    <TolariaBasicTextStyleButton basicTextStyle="code" key="codeStyleButton" />,
    <TolariaBasicTextStyleButton
      basicTextStyle={MARKDOWN_HIGHLIGHT_STYLE}
      key="highlightStyleButton"
      locale={locale}
    />,
    ...items.slice(strikeButtonIndex + 1),
  ]
}

function getTolariaFormattingToolbarItems(vaultPath: string | undefined, locale: AppLocale) {
  return insertExtraTextStyleButtons(
    replaceToolbarControls(
      filterTolariaFormattingToolbarItems(
        getFormattingToolbarItems(),
      ),
      vaultPath,
    ),
    locale,
  )
}

export function TolariaFormattingToolbar({
  locale = 'en',
  vaultPath,
}: {
  locale?: AppLocale
  vaultPath?: string
} = {}) {
  return <FormattingToolbar>{getTolariaFormattingToolbarItems(vaultPath, locale)}</FormattingToolbar>
}

type TolariaFormattingToolbarControllerProps = {
  formattingToolbar?: FC<FormattingToolbarProps>;
  floatingUIOptions?: FloatingUIOptions;
}

function useFormattingToolbarInteractionState({
  editor,
  formattingToolbarStore,
  isComposing,
  show,
}: {
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>
  formattingToolbarStore: FormattingToolbarStore
  isComposing: boolean
  show: boolean
}) {
  const [toolbarHasFocus, setToolbarHasFocus] = useState(false)
  const [toolbarHovered, setToolbarHovered] = useState(false)
  const [blockTypeMenuOpened, setBlockTypeMenuOpened] = useState(false)
  const blockTypeMenuState = useMemo<BlockTypeMenuState>(() => ({
    opened: blockTypeMenuOpened,
    setOpened: setBlockTypeMenuOpened,
  }), [blockTypeMenuOpened])
  const { closeGraceActive, clearCloseGrace, dismissImmediately } = useFormattingToolbarCloseGrace({
    show,
    toolbarHasFocus,
    toolbarHovered,
  })
  const setFormattingToolbarOpen = useDeduplicatedFormattingToolbarStore(
    formattingToolbarStore,
    show,
  )
  const closeBlockTypeMenuFromEditor = useCallback(() => {
    setBlockTypeMenuOpened(false)
    setToolbarHasFocus(false)
    setToolbarHovered(false)
    dismissImmediately()
    setFormattingToolbarOpen(false)
  }, [dismissImmediately, setFormattingToolbarOpen])
  useCloseBlockTypeMenuOnEditorInteraction(editor, blockTypeMenuOpened, closeBlockTypeMenuFromEditor)

  return {
    blockTypeMenuState,
    clearCloseGrace,
    isOpen: !isComposing
      && (show || toolbarHasFocus || toolbarHovered || blockTypeMenuOpened || closeGraceActive),
    setBlockTypeMenuOpened,
    setFormattingToolbarOpen,
    setToolbarHasFocus,
    setToolbarHovered,
  }
}

type FormattingToolbarSurfaceProps = {
  Component?: FC<FormattingToolbarProps>
  blockTypeMenuState: BlockTypeMenuState
  floatingUIOptions: FloatingUIOptions
  position: { from: number; to: number } | undefined
  setBlockTypeMenuOpened: Dispatch<SetStateAction<boolean>>
  setFormattingToolbarOpen: (open: boolean) => void
  setToolbarHasFocus: Dispatch<SetStateAction<boolean>>
  setToolbarHovered: Dispatch<SetStateAction<boolean>>
  shouldRender: boolean
}

function FormattingToolbarSurface(props: FormattingToolbarSurfaceProps) {
  const {
    Component,
    blockTypeMenuState,
    floatingUIOptions,
    position,
    setBlockTypeMenuOpened,
    setFormattingToolbarOpen,
    setToolbarHasFocus,
    setToolbarHovered,
    shouldRender,
  } = props
  return (
    <PositionPopover position={position} {...floatingUIOptions}>
      {shouldRender && (
        <div
          onPointerEnter={() => setToolbarHovered(true)}
          onPointerLeave={(event) => {
            if (!isFocusStillWithinToolbar(event.currentTarget, event.relatedTarget)) setToolbarHovered(false)
          }}
          onFocusCapture={() => setToolbarHasFocus(true)}
          onBlurCapture={(event) => {
            if (isFocusStillWithinToolbar(event.currentTarget, event.relatedTarget)) return
            setToolbarHasFocus(false)
            setBlockTypeMenuOpened(false)
            setFormattingToolbarOpen(false)
          }}
        >
          <BlockTypeMenuContext.Provider value={blockTypeMenuState}>
            {Component ? <Component /> : <TolariaFormattingToolbar />}
          </BlockTypeMenuContext.Provider>
        </div>
      )}
    </PositionPopover>
  )
}

export function TolariaFormattingToolbarController(props: TolariaFormattingToolbarControllerProps) {
  const editor = useBlockNoteEditor<
    BlockSchema,
    InlineContentSchema,
    StyleSchema
  >()
  const formattingToolbar = useExtension(FormattingToolbarExtension, {
    editor,
  })
  const show = useExtensionState(FormattingToolbarExtension, {
    editor,
  })
  const isComposing = useEditorComposing(editor)
  const {
    blockTypeMenuState,
    clearCloseGrace,
    isOpen,
    setBlockTypeMenuOpened,
    setFormattingToolbarOpen,
    setToolbarHasFocus,
    setToolbarHovered,
  } = useFormattingToolbarInteractionState({
    editor,
    formattingToolbarStore: formattingToolbar.store,
    isComposing,
    show,
  })
  const hasFloatingToolbarAnchor = getFormattingToolbarAnchorElement(editor) !== null
  const shouldRenderFloatingToolbar = isOpen && hasFloatingToolbarAnchor
  const currentBridgeBlockId = useEditorState({
    editor,
    selector: ({ editor }) => getFormattingToolbarBridgeBlockId(editor),
  })

  useBlockNoteFormattingToolbarHoverGuard({
    editor,
    container:
      editor.domElement?.closest('.editor__blocknote-container') ??
      editor.domElement ??
      null,
    selectedFileBlockId: currentBridgeBlockId,
    isOpen,
  })

  const position = useEditorState({
    editor,
    selector: ({ editor }) => (
      shouldRenderFloatingToolbar
        ? {
            from: editor.prosemirrorState.selection.from,
            to: editor.prosemirrorState.selection.to,
          }
        : undefined
    ),
  })

  const placement = useEditorState({
    editor,
    selector: ({ editor }) => {
      const block = getCursorBlockSafely(editor)
      if (!block) return 'top-start'

      if (!blockHasType(block, editor, block.type, {
        textAlignment: defaultProps.textAlignment,
      })) {
        return 'top-start'
      }

      return textAlignmentToPlacement(block.props.textAlignment)
    },
  })

  const floatingUIOptions = useMemo<FloatingUIOptions>(
    () => ({
      ...props.floatingUIOptions,
      useFloatingOptions: {
        open: shouldRenderFloatingToolbar,
        onOpenChange: (open, _event, reason) => {
          setFormattingToolbarOpen(open)
          if (!open) {
            setToolbarHasFocus(false)
            setToolbarHovered(false)
            setBlockTypeMenuOpened(false)
            clearCloseGrace()
          }
          if (reason === 'escape-key') {
            editor.focus()
          }
        },
        placement,
        ...withViewportSafeMiddleware(props.floatingUIOptions?.useFloatingOptions),
      },
      elementProps: {
        style: {
          zIndex: 40,
        },
        ...props.floatingUIOptions?.elementProps,
      },
    }),
    [
      clearCloseGrace,
      editor,
      placement,
      props.floatingUIOptions,
      setBlockTypeMenuOpened,
      setFormattingToolbarOpen,
      setToolbarHasFocus,
      setToolbarHovered,
      shouldRenderFloatingToolbar,
    ],
  )

  return (
    <>
      <CodeBlockLanguageControls editor={editor} />
      <FormattingToolbarSurface
        Component={props.formattingToolbar}
        blockTypeMenuState={blockTypeMenuState}
        floatingUIOptions={floatingUIOptions}
        position={position}
        setBlockTypeMenuOpened={setBlockTypeMenuOpened}
        setFormattingToolbarOpen={setFormattingToolbarOpen}
        setToolbarHasFocus={setToolbarHasFocus}
        setToolbarHovered={setToolbarHovered}
        shouldRender={shouldRenderFloatingToolbar}
      />
    </>
  )
}
