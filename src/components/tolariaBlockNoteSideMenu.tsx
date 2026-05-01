import { SideMenuExtension, SuggestionMenu } from '@blocknote/core/extensions'
import type {
  BlockNoteEditor,
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
import { GripVertical, Plus } from 'lucide-react'
import { useCallback, type ComponentType, type DragEvent, type ReactNode } from 'react'

type TolariaBlockNoteEditor = BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>
type SideMenuBlock = {
  content?: unknown
  id: string
  type: string
}
type TableHeaderContent = Record<string, unknown> & {
  headerCols?: unknown
  headerRows?: unknown
}

function liveSideMenuBlock(editor: TolariaBlockNoteEditor, block: SideMenuBlock | undefined) {
  if (!block) return undefined
  return editor.getBlock(block.id)
}

function runSideMenuAction(action: () => void) {
  try {
    action()
  } catch (error) {
    console.warn('[editor] Ignored stale block side-menu action:', error)
  }
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
          content: state.block.content,
          id: state.block.id,
          type: state.block.type,
        }
      : undefined,
  })

  return { block, editor }
}

function TolariaAddBlockButton() {
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const suggestionMenu = useExtension(SuggestionMenu)
  const { block, editor } = useSideMenuBlock()

  const onClick = useCallback(() => {
    runSideMenuAction(() => {
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
    })
  }, [block, editor, suggestionMenu])

  if (!block) return null

  return (
    <Components.SideMenu.Button
      className="bn-button"
      label={dict.side_menu.add_block_label}
      onClick={onClick}
      icon={<Plus size={20} data-test="dragHandleAdd" />}
    />
  )
}

function TolariaDragHandleButton({
  children,
  dragHandleMenu,
}: SideMenuProps & { children?: ReactNode }) {
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const sideMenu = useExtension(SideMenuExtension)
  const { block, editor } = useSideMenuBlock()
  const MenuComponent: ComponentType<{ children?: ReactNode }> = dragHandleMenu ?? DragHandleMenu

  const onDragStart = useCallback((event: DragEvent) => {
    runSideMenuAction(() => {
      const liveBlock = liveSideMenuBlock(editor, block)
      if (!liveBlock) {
        event.preventDefault()
        return
      }

      sideMenu.blockDragStart(event, liveBlock)
    })
  }, [block, editor, sideMenu])

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
        <Components.SideMenu.Button
          label={dict.side_menu.drag_handle_label}
          draggable
          onDragStart={onDragStart}
          onDragEnd={sideMenu.blockDragEnd}
          className="bn-button"
          icon={<GripVertical size={20} data-test="dragHandle" />}
        />
      </Components.Generic.Menu.Trigger>
      <MenuComponent>{children}</MenuComponent>
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

function TolariaDragHandleMenu() {
  const dict = useDictionary()

  return (
    <DragHandleMenu>
      <TolariaRemoveBlockItem>{dict.drag_handle.delete_menuitem}</TolariaRemoveBlockItem>
      <TolariaTableHeaderItem header="row">{dict.drag_handle.header_row_menuitem}</TolariaTableHeaderItem>
      <TolariaTableHeaderItem header="column">{dict.drag_handle.header_column_menuitem}</TolariaTableHeaderItem>
    </DragHandleMenu>
  )
}

export function TolariaSideMenu(props: SideMenuProps) {
  return (
    <SideMenu {...props}>
      <TolariaDragHandleButton dragHandleMenu={TolariaDragHandleMenu} />
      <TolariaAddBlockButton />
    </SideMenu>
  )
}
