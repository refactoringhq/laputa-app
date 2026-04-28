import {
  FormattingToolbar,
  getFormattingToolbarItems,
  PositionPopover,
  useBlockNoteEditor,
  useComponentsContext,
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
import {
  useCallback,
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
  Bold,
  ChevronDown,
  Code2,
  Italic,
  Strikethrough,
  type LucideIcon,
} from 'lucide-react'
import {
  filterTolariaFormattingToolbarItems,
  getTolariaBlockTypeSelectItems,
} from './tolariaEditorFormattingConfig'
import { useBlockNoteFormattingToolbarHoverGuard } from './blockNoteFormattingToolbarHoverGuard'

type TolariaBasicTextStyle = 'bold' | 'italic' | 'strike' | 'code'

const FORMATTER_CLOSE_GRACE_MS = 160

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

  return { closeGraceActive, clearCloseGrace }
}

type FormattingToolbarStore = {
  setState(open: boolean): void
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
  TolariaBasicTextStyle,
  { label: string; mainTooltip: string; secondaryTooltip: string }
>

const TOLARIA_BASIC_TEXT_STYLE_ICONS = {
  bold: Bold,
  italic: Italic,
  strike: Strikethrough,
  code: Code2,
} satisfies Record<TolariaBasicTextStyle, LucideIcon>

type TolariaSelectedBlock = ReturnType<
  BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>['getTextCursorPosition']
>['block']

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

function editorSupportsTextStyle(
  style: TolariaBasicTextStyle,
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
) {
  return (
    style in editor.schema.styleSchema &&
    editor.schema.styleSchema[style].type === style &&
    editor.schema.styleSchema[style].propSchema === 'boolean'
  )
}

function getSelectedBlocksSafely(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
): TolariaSelectedBlock[] {
  try {
    const selectionBlocks = editor.getSelection()?.blocks
    if (selectionBlocks?.length) {
      return selectionBlocks as TolariaSelectedBlock[]
    }
  } catch {
    // BlockNote can briefly expose an invalid selection while inline actions remount blocks.
  }

  try {
    return [editor.getTextCursorPosition().block as TolariaSelectedBlock]
  } catch {
    return []
  }
}

function getCursorBlockSafely(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
): TolariaSelectedBlock | null {
  try {
    return editor.getTextCursorPosition().block as TolariaSelectedBlock
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
      propValue === firstSelectedBlock.props[propName],
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
  const selectedBlock = getSelectedBlocksSafely(editor)[0]
  if (!selectedBlock) return null

  return FORMATTING_TOOLBAR_FILE_BLOCK_TYPES.has(selectedBlock.type)
    ? selectedBlock.id
    : null
}

function getFormattingToolbarAnchorElement(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
) {
  const anchor = editor.domElement?.firstElementChild
  return anchor instanceof Element && anchor.isConnected ? anchor : null
}

function updateSelectedBlocksToType(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
  selectedBlocks: TolariaSelectedBlock[],
  item: ReturnType<typeof getTolariaBlockTypeSelectItems>[number],
) {
  editor.focus()
  editor.transact(() => {
    for (const block of selectedBlocks) {
      editor.updateBlock(block, {
        type: item.type as never,
        props: item.props as never,
      })
    }
  })
}

function TolariaBasicTextStyleButton({
  basicTextStyle,
}: {
  basicTextStyle: TolariaBasicTextStyle
}) {
  const Components = useComponentsContext()!
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

  const Icon = TOLARIA_BASIC_TEXT_STYLE_ICONS[basicTextStyle]
  const copy = TOLARIA_BASIC_TEXT_STYLE_TOOLTIPS[basicTextStyle]

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

  if (!selectedItem || !editor.isEditable) return null

  return (
    <MantineMenu
      withinPortal={false}
      transitionProps={{ exitDuration: 0 }}
      middlewares={{ flip: true, shift: true, inline: false, size: true }}
    >
      <MantineMenu.Target>
        <MantineButton
          onMouseDown={(event) => {
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
              updateSelectedBlocksToType(editor, selectedBlocks, item)
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

function replaceToolbarControls(items: ReactElement[]) {
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
      default:
        return [item]
    }
  })
}

function insertInlineCodeButton(items: ReactElement[]) {
  const strikeButtonIndex = items.findIndex(
    (item) => String(item.key) === 'strikeStyleButton',
  )
  if (strikeButtonIndex === -1) return items

  return [
    ...items.slice(0, strikeButtonIndex + 1),
    <TolariaBasicTextStyleButton basicTextStyle="code" key="codeStyleButton" />,
    ...items.slice(strikeButtonIndex + 1),
  ]
}

function getTolariaFormattingToolbarItems() {
  return insertInlineCodeButton(
    replaceToolbarControls(
      filterTolariaFormattingToolbarItems(
        getFormattingToolbarItems(),
      ),
    ),
  )
}

export function TolariaFormattingToolbar() {
  return <FormattingToolbar>{getTolariaFormattingToolbarItems()}</FormattingToolbar>
}

export function TolariaFormattingToolbarController(props: {
  formattingToolbar?: FC<FormattingToolbarProps>;
  floatingUIOptions?: FloatingUIOptions;
}) {
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
  const [toolbarHasFocus, setToolbarHasFocus] = useState(false)
  const [toolbarHovered, setToolbarHovered] = useState(false)
  const { closeGraceActive, clearCloseGrace } = useFormattingToolbarCloseGrace({
    show,
    toolbarHasFocus,
    toolbarHovered,
  })
  const setFormattingToolbarOpen = useDeduplicatedFormattingToolbarStore(
    formattingToolbar.store,
    show,
  )

  const isOpen = show || toolbarHasFocus || toolbarHovered || closeGraceActive
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
            clearCloseGrace()
          }
          if (reason === 'escape-key') {
            editor.focus()
          }
        },
        placement,
        ...props.floatingUIOptions?.useFloatingOptions,
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
      setFormattingToolbarOpen,
      shouldRenderFloatingToolbar,
    ],
  )

  const Component = props.formattingToolbar || TolariaFormattingToolbar

  return (
    <PositionPopover position={position} {...floatingUIOptions}>
      {shouldRenderFloatingToolbar && (
        <div
          onPointerEnter={() => {
            setToolbarHovered(true)
          }}
          onPointerLeave={(event) => {
            if (isFocusStillWithinToolbar(event.currentTarget, event.relatedTarget)) {
              return
            }

            setToolbarHovered(false)
          }}
          onFocusCapture={() => {
            setToolbarHasFocus(true)
          }}
          onBlurCapture={(event) => {
            if (isFocusStillWithinToolbar(event.currentTarget, event.relatedTarget)) {
              return
            }

            setToolbarHasFocus(false)
            setFormattingToolbarOpen(false)
          }}
        >
          <Component />
        </div>
      )}
    </PositionPopover>
  )
}
