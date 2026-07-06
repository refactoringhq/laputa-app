import {
  CaretDown,
  CaretRight,
  DotsSixVertical as GripVertical,
  Plus,
} from '@phosphor-icons/react'
import { SideMenuExtension, SuggestionMenu } from '@blocknote/core/extensions'
import type {
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core'
import {
  DragHandleMenu,
  SideMenu,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useExtension,
  useExtensionState,
  type SideMenuProps,
} from '@blocknote/react'
import { translate, type AppLocale } from '../lib/i18n'
import { richEditorBlockTypeName } from '../utils/richEditorBlockTypes'
import {
  useCallback,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { usePointerBlockReorder } from './tolariaBlockReorder'
import { useSideMenuTextAlignment } from './tolariaSideMenuAlignment'
import {
  blockHeadingLevel,
  isCollapsibleSectionBlockForEditor,
  toggleCollapsedHeading,
  useCollapsedHeadingIds,
  useCollapsedHeadingRendering,
  type CollapsibleBlock,
} from './tolariaCollapsedSections'
import {
  liveSideMenuBlock,
  runSideMenuAction,
  type SideMenuBlock,
} from './tolariaSideMenuBlocks'
import { turnBlockIntoType } from './richEditorBlockTypeCommands'
import {
  createTolariaSlashMenuIcon,
  getTolariaBlockTypeSelectItems,
} from './tolariaEditorFormattingConfig'

type TableHeaderContent = Record<string, unknown> & {
  headerCols?: unknown
  headerRows?: unknown
}

type TolariaSideMenuProps = SideMenuProps & {
  locale?: AppLocale
}

function isInlineBlockEmpty(block: { content?: unknown }) {
  return Array.isArray(block.content) && block.content.length === 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tableHeaderContent(block: unknown): TableHeaderContent | undefined {
  if (!isRecord(block) || block.type !== 'table' || !isRecord(block.content)) return undefined
  return block.content
}

function useSideMenuBlock() {
  const editor = useBlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>()
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state): SideMenuBlock | undefined => state?.block
      ? {
          children: state.block.children as CollapsibleBlock[] | undefined,
          content: state.block.content,
          id: state.block.id,
          props: state.block.props as Record<string, unknown> | undefined,
          type: state.block.type,
        }
      : undefined,
  })

  return { block, editor }
}

function stopSideMenuClick(event: ReactMouseEvent<Element>) {
  event.preventDefault()
  event.stopPropagation()
}

function editorElementFromSideMenuControl(control: Element): HTMLElement | undefined {
  const container = control.closest('.editor__blocknote-container')
  const editorElement = container?.querySelector('.bn-editor')
  if (editorElement instanceof HTMLElement) return editorElement

  const documentEditors = Array.from(control.ownerDocument.querySelectorAll('.bn-editor'))
    .filter((element): element is HTMLElement => element instanceof HTMLElement)
  return documentEditors.find((element) => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }) ?? documentEditors.at(-1)
}

type EditorScrollSnapshot = {
  scrollArea: HTMLElement
  scrollLeft: number
  scrollTop: number
}

function visibleRichEditorScrollArea(ownerDocument: Document): HTMLElement | null {
  const scrollAreas = Array.from(ownerDocument.querySelectorAll('.editor-scroll-area'))
    .filter((element): element is HTMLElement => element instanceof HTMLElement)

  return scrollAreas.find((scrollArea) => {
    if (scrollArea.classList.contains('editor-scroll-area--sheet')) return false
    if (!scrollArea.querySelector('.editor__blocknote-container .bn-editor')) return false

    const rect = scrollArea.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }) ?? null
}

function scrollAreaFromSideMenuControl(control: Element): HTMLElement | null {
  const directScrollArea = control.closest('.editor-scroll-area')
  if (directScrollArea instanceof HTMLElement) return directScrollArea

  const editorElement = editorElementFromSideMenuControl(control)
  const editorScrollArea = editorElement?.closest('.editor-scroll-area')
  return editorScrollArea instanceof HTMLElement
    ? editorScrollArea
    : visibleRichEditorScrollArea(control.ownerDocument)
}

function captureSideMenuScroll(control: Element): EditorScrollSnapshot | null {
  const scrollArea = scrollAreaFromSideMenuControl(control)
  return scrollArea
    ? {
        scrollArea,
        scrollLeft: scrollArea.scrollLeft,
        scrollTop: scrollArea.scrollTop,
      }
    : null
}

function restoreEditorScroll(snapshot: EditorScrollSnapshot | null) {
  if (!snapshot?.scrollArea.isConnected) return
  snapshot.scrollArea.scrollLeft = snapshot.scrollLeft
  snapshot.scrollArea.scrollTop = snapshot.scrollTop
}

function scheduleEditorScrollRestore(snapshot: EditorScrollSnapshot | null) {
  restoreEditorScroll(snapshot)
  queueMicrotask(() => restoreEditorScroll(snapshot))

  const ownerWindow = snapshot?.scrollArea.ownerDocument.defaultView
  if (!ownerWindow) return

  ownerWindow.setTimeout(() => restoreEditorScroll(snapshot), 0)
  ownerWindow.setTimeout(() => restoreEditorScroll(snapshot), 32)
  ownerWindow.setTimeout(() => restoreEditorScroll(snapshot), 96)
  ownerWindow.setTimeout(() => restoreEditorScroll(snapshot), 192)
  ownerWindow.requestAnimationFrame(() => {
    restoreEditorScroll(snapshot)
    ownerWindow.requestAnimationFrame(() => restoreEditorScroll(snapshot))
  })
}

function runSideMenuActionPreservingScroll(
  action: () => void,
  snapshot: EditorScrollSnapshot | null,
) {
  runSideMenuAction(() => {
    action()
    scheduleEditorScrollRestore(snapshot)
  })
}

function TolariaAddBlockButton() {
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const suggestionMenu = useExtension(SuggestionMenu)
  const { block, editor } = useSideMenuBlock()

  const addBlock = useCallback((snapshot: EditorScrollSnapshot | null) => {
    runSideMenuActionPreservingScroll(() => {
      const liveBlock = liveSideMenuBlock(editor, block)
      if (!liveBlock) return

      if (isInlineBlockEmpty(liveBlock)) {
        editor.setTextCursorPosition(liveBlock.id)
        suggestionMenu.openSuggestionMenu('/')
        return
      }

      const insertedBlock = editor.insertBlocks([{ type: 'paragraph' }], liveBlock.id, 'after')[0]
      if (!insertedBlock) return
      editor.setTextCursorPosition(insertedBlock.id)
      suggestionMenu.openSuggestionMenu('/')
    }, snapshot)
  }, [block, editor, suggestionMenu])
  const onButtonClick = useCallback((event: ReactMouseEvent<Element>) => {
    stopSideMenuClick(event)
    addBlock(captureSideMenuScroll(event.currentTarget))
  }, [addBlock])

  if (!block) return null

  return (
    <Components.SideMenu.Button
      className="bn-button"
      label={dict.side_menu.add_block_label}
      onClick={onButtonClick}
      icon={<Plus size={20} data-test="dragHandleAdd" />}
    />
  )
}

function headingCollapseButtonLabel(locale: AppLocale, isHeading: boolean, isCollapsed: boolean) {
  if (isHeading) return sectionCollapseButtonLabel(locale, isCollapsed)
  return itemCollapseButtonLabel(locale, isCollapsed)
}

function sectionCollapseButtonLabel(locale: AppLocale, isCollapsed: boolean) {
  return translate(locale, isCollapsed ? 'editor.sideMenu.expandSection' : 'editor.sideMenu.collapseSection')
}

function itemCollapseButtonLabel(locale: AppLocale, isCollapsed: boolean) {
  return translate(locale, isCollapsed ? 'editor.sideMenu.expandItem' : 'editor.sideMenu.collapseItem')
}

function TolariaHeadingCollapseButton({ locale }: { locale: AppLocale }) {
  const Components = useComponentsContext()!
  const { block, editor } = useSideMenuBlock()
  const collapsedHeadingIds = useCollapsedHeadingIds(editor)
  const isCollapsed = Boolean(block?.id && collapsedHeadingIds.has(block.id))
  const isHeading = blockHeadingLevel(block) !== null
  const isCollapsible = isCollapsibleSectionBlockForEditor(editor, block)
  const Icon = isCollapsed ? CaretRight : CaretDown
  const label = headingCollapseButtonLabel(locale, isHeading, isCollapsed)

  const toggleHeading = useCallback((editorElement?: HTMLElement) => {
    runSideMenuAction(() => {
      const liveBlock = liveSideMenuBlock(editor, block)
      if (!liveBlock) return
      if (!isCollapsibleSectionBlockForEditor(editor, liveBlock as CollapsibleBlock | undefined)) return
      toggleCollapsedHeading(editor, liveBlock.id, editorElement)
    })
  }, [block, editor])
  const onButtonClick = useCallback((event: ReactMouseEvent<Element>) => {
    stopSideMenuClick(event)
    toggleHeading(editorElementFromSideMenuControl(event.currentTarget))
  }, [toggleHeading])

  if (!isCollapsible) return null

  return (
    <Components.SideMenu.Button
      className="bn-button"
      label={label}
      onClick={onButtonClick}
      icon={<Icon size={20} onClick={onButtonClick} data-test="headingCollapseToggle" />}
    />
  )
}

function TolariaSectionControlButton({ locale }: { locale: AppLocale }) {
  const { block, editor } = useSideMenuBlock()
  if (isCollapsibleSectionBlockForEditor(editor, block)) return <TolariaHeadingCollapseButton locale={locale} />

  return <TolariaAddBlockButton />
}

function TolariaDragHandleButton({
  children,
  dragHandleMenu,
  locale = 'en',
}: SideMenuProps & { children?: ReactNode; locale?: AppLocale }) {
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const sideMenu = useExtension(SideMenuExtension)
  const { block, editor } = useSideMenuBlock()
  const MenuComponent: ComponentType<{ children?: ReactNode }> = dragHandleMenu ?? DragHandleMenu
  const { onClickCapture, onPointerDown } = usePointerBlockReorder(editor, block)

  if (!block) return null

  return (
    <Components.Generic.Menu.Root
      onOpenChange={(open: boolean) => {
        if (open) sideMenu.freezeMenu()
        else sideMenu.unfreezeMenu()
      }}
      position="left"
    >
      <Components.Generic.Menu.Trigger>
        <span
          className="tolaria-block-drag-handle"
          onPointerDown={onPointerDown}
          onClickCapture={onClickCapture}
        >
          <Components.SideMenu.Button
            label={dict.side_menu.drag_handle_label}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            onDragEnd={sideMenu.blockDragEnd}
            className="bn-button"
            icon={<GripVertical size={20} data-test="dragHandle" />}
          />
        </span>
      </Components.Generic.Menu.Trigger>
      {dragHandleMenu
        ? <MenuComponent>{children}</MenuComponent>
        : <TolariaDragHandleMenu locale={locale}>{children}</TolariaDragHandleMenu>}
    </Components.Generic.Menu.Root>
  )
}

function TolariaRemoveBlockItem({ children }: { children: ReactNode }) {
  const Components = useComponentsContext()!
  const { block, editor } = useSideMenuBlock()

  if (!block) return null

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => {
        runSideMenuAction(() => {
          const liveBlock = liveSideMenuBlock(editor, block)
          if (!liveBlock) return
          editor.removeBlocks([liveBlock.id])
        })
      }}
    >
      {children}
    </Components.Generic.Menu.Item>
  )
}

function TolariaTableHeaderItem({
  children,
  header,
}: {
  children: ReactNode
  header: 'column' | 'row'
}) {
  const Components = useComponentsContext()!
  const { block, editor } = useSideMenuBlock()
  const liveBlock = liveSideMenuBlock(editor, block)
  const tableContent = tableHeaderContent(liveBlock)

  if (!tableContent || !editor.settings.tables.headers) return null

  const checked = header === 'row'
    ? Boolean(tableContent.headerRows)
    : Boolean(tableContent.headerCols)

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      checked={checked}
      onClick={() => {
        runSideMenuAction(() => {
          const currentBlock = liveSideMenuBlock(editor, block)
          const currentContent = tableHeaderContent(currentBlock)
          if (!currentBlock || !currentContent) return

          editor.updateBlock(currentBlock.id, {
            content: {
              ...currentContent,
              [header === 'row' ? 'headerRows' : 'headerCols']: checked ? undefined : 1,
            } as never,
          })
        })
      }}
    >
      {children}
    </Components.Generic.Menu.Item>
  )
}

function TolariaTurnBlockIntoSubmenu({ locale }: { locale: AppLocale }) {
  const Components = useComponentsContext()!
  const { block, editor } = useSideMenuBlock()

  if (!block) return null

  return (
    <Components.Generic.Menu.Root sub position="right">
      <Components.Generic.Menu.Trigger sub>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger>
          {translate(locale, 'editor.sideMenu.turnIntoMenu')}
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown sub>
        {getTolariaBlockTypeSelectItems().map((item) => (
          <Components.Generic.Menu.Item
            key={item.key}
            className="bn-menu-item"
            icon={createTolariaSlashMenuIcon(item.icon)}
            onClick={() => {
              runSideMenuAction(() => {
                turnBlockIntoType(editor, block.id, item, 'block_menu')
              })
            }}
          >
            {richEditorBlockTypeName(locale, item)}
          </Components.Generic.Menu.Item>
        ))}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  )
}

function TolariaDragHandleMenu({
  children,
  locale = 'en',
}: {
  children?: ReactNode
  locale?: AppLocale
}) {
  const dict = useDictionary()

  return (
    <DragHandleMenu>
      {children}
      <TolariaRemoveBlockItem>{dict.drag_handle.delete_menuitem}</TolariaRemoveBlockItem>
      <TolariaTurnBlockIntoSubmenu locale={locale} />
      <TolariaTableHeaderItem header="row">{dict.drag_handle.header_row_menuitem}</TolariaTableHeaderItem>
      <TolariaTableHeaderItem header="column">{dict.drag_handle.header_column_menuitem}</TolariaTableHeaderItem>
    </DragHandleMenu>
  )
}

export function TolariaSideMenu({ locale = 'en', ...props }: TolariaSideMenuProps) {
  const { block, editor } = useSideMenuBlock()
  useSideMenuTextAlignment(editor, block)

  return (
    <SideMenu {...props}>
      <TolariaDragHandleButton locale={locale} />
      <TolariaSectionControlButton locale={locale} />
    </SideMenu>
  )
}

export function TolariaCollapsedHeadingsController() {
  const editor = useBlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>()
  useCollapsedHeadingRendering(editor)

  return null
}
