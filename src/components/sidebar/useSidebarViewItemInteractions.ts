import {
  useCallback, useRef, useState, type Dispatch, type KeyboardEvent, type MouseEvent, type RefObject,
  type SetStateAction,
} from 'react'
import type { ViewDefinition, ViewFile } from '../../types'
import { getElementMenuPosition, useOutsideClick, useSidebarContextMenu } from './sidebarHooks'
import type { MenuPosition, ViewDefinitionPatchHandler } from './SidebarViewActions'

interface SidebarViewItemInteractionInput {
  view: ViewFile
  onSelect: () => void
  onEditView?: (filename: string) => void
  onDeleteView?: (filename: string) => void
  onUpdateViewDefinition?: ViewDefinitionPatchHandler
}

type RowKeyboardAction = 'select' | 'rename' | 'menu'

function getRowKeyboardAction(event: KeyboardEvent<HTMLDivElement>): RowKeyboardAction | null {
  if (event.key === 'Enter' || event.key === ' ') return 'select'
  if (event.key === 'F2') return 'rename'
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) return 'menu'
  return null
}

function commitViewRename(
  view: ViewFile,
  nextName: string,
  onUpdateViewDefinition?: (filename: string, patch: Partial<ViewDefinition>) => void,
) {
  const trimmed = nextName.trim()
  if (trimmed && trimmed !== view.definition.name) {
    onUpdateViewDefinition?.(view.filename, { name: trimmed })
  }
}

function useViewInteractionState() {
  const [customizePos, setCustomizePos] = useState<MenuPosition | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const customizeRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const {
    closeContextMenu,
    contextMenu,
    contextMenuRef,
    openContextMenuAt,
    openContextMenuFromPointer,
  } = useSidebarContextMenu<string>()
  const closeCustomize = useCallback(() => setCustomizePos(null), [])

  useOutsideClick(customizeRef, !!customizePos, closeCustomize)

  return {
    closeContextMenu,
    closeCustomize,
    contextMenuPos: contextMenu?.pos ?? null,
    contextMenuRef,
    customizePos,
    customizeRef,
    isRenaming,
    rowRef,
    setCustomizePos,
    setIsRenaming,
    openContextMenuAt,
    openContextMenuFromPointer,
  }
}

function useViewRenameActions({
  closeContextMenu,
  closeCustomize,
  onUpdateViewDefinition,
  setIsRenaming,
  view,
}: {
  closeContextMenu: () => void
  closeCustomize: () => void
  onUpdateViewDefinition?: ViewDefinitionPatchHandler
  setIsRenaming: Dispatch<SetStateAction<boolean>>
  view: ViewFile
}) {
  const startRename = useCallback(() => {
    closeContextMenu()
    closeCustomize()
    setIsRenaming(true)
  }, [closeContextMenu, closeCustomize, setIsRenaming])

  const handleRenameSubmit = useCallback((nextName: string) => {
    setIsRenaming(false)
    commitViewRename(view, nextName, onUpdateViewDefinition)
  }, [onUpdateViewDefinition, setIsRenaming, view])

  return { handleRenameSubmit, startRename }
}

function useViewMenuActions({
  view,
  onEditView,
  onDeleteView,
  onUpdateViewDefinition,
  closeContextMenu,
  contextMenuPos,
  openContextMenuAt,
  openContextMenuFromPointer,
  rowRef,
  setCustomizePos,
}: SidebarViewItemInteractionInput & {
  closeContextMenu: () => void
  contextMenuPos: MenuPosition | null
  openContextMenuAt: (target: string, pos: MenuPosition) => void
  openContextMenuFromPointer: (target: string, event: MouseEvent) => void
  rowRef: RefObject<HTMLDivElement | null>
  setCustomizePos: Dispatch<SetStateAction<MenuPosition | null>>
}) {
  const hasMenuActions = !!(onEditView || onDeleteView || onUpdateViewDefinition)

  const handleContextMenu = useCallback((event: MouseEvent) => {
    if (!hasMenuActions) return
    setCustomizePos(null)
    openContextMenuFromPointer(view.filename, event)
  }, [hasMenuActions, openContextMenuFromPointer, setCustomizePos, view.filename])

  const openKeyboardContextMenu = useCallback(() => {
    setCustomizePos(null)
    openContextMenuAt(view.filename, getElementMenuPosition(rowRef.current))
  }, [openContextMenuAt, rowRef, setCustomizePos, view.filename])

  const handleEdit = useCallback(() => {
    closeContextMenu()
    onEditView?.(view.filename)
  }, [closeContextMenu, onEditView, view.filename])

  const handleDelete = useCallback(() => {
    closeContextMenu()
    onDeleteView?.(view.filename)
  }, [closeContextMenu, onDeleteView, view.filename])

  const handleCustomize = useCallback(() => {
    setCustomizePos(contextMenuPos ?? { x: 20, y: 100 })
    closeContextMenu()
  }, [closeContextMenu, contextMenuPos, setCustomizePos])

  return {
    handleContextMenu,
    handleCustomize,
    handleDelete,
    handleEdit,
    openKeyboardContextMenu,
  }
}

function useViewRowKeyboardActions({
  isRenaming,
  onSelect,
  openKeyboardContextMenu,
  startRename,
}: {
  isRenaming: boolean
  onSelect: () => void
  openKeyboardContextMenu: () => void
  startRename: () => void
}) {
  const runKeyboardAction = useCallback((action: RowKeyboardAction) => {
    const actions: Record<RowKeyboardAction, () => void> = {
      select: onSelect,
      rename: startRename,
      menu: openKeyboardContextMenu,
    }
    actions[action]()
  }, [onSelect, openKeyboardContextMenu, startRename])

  return useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (isRenaming) return
    const action = getRowKeyboardAction(event)
    if (!action) return
    event.preventDefault()
    runKeyboardAction(action)
  }, [isRenaming, runKeyboardAction])
}

export function useSidebarViewItemInteractions({
  view,
  onSelect,
  onEditView,
  onDeleteView,
  onUpdateViewDefinition,
}: SidebarViewItemInteractionInput) {
  const state = useViewInteractionState()
  const rename = useViewRenameActions({
    closeContextMenu: state.closeContextMenu,
    closeCustomize: state.closeCustomize,
    onUpdateViewDefinition,
    setIsRenaming: state.setIsRenaming,
    view,
  })
  const menu = useViewMenuActions({
    view,
    onSelect,
    onEditView,
    onDeleteView,
    onUpdateViewDefinition,
    closeContextMenu: state.closeContextMenu,
    contextMenuPos: state.contextMenuPos,
    openContextMenuAt: state.openContextMenuAt,
    openContextMenuFromPointer: state.openContextMenuFromPointer,
    rowRef: state.rowRef,
    setCustomizePos: state.setCustomizePos,
  })
  const handleRowKeyDown = useViewRowKeyboardActions({
    isRenaming: state.isRenaming,
    onSelect,
    openKeyboardContextMenu: menu.openKeyboardContextMenu,
    startRename: rename.startRename,
  })

  return {
    closeCustomize: state.closeCustomize,
    contextMenuPos: state.contextMenuPos,
    contextMenuRef: state.contextMenuRef,
    customizePos: state.customizePos,
    customizeRef: state.customizeRef,
    handleContextMenu: menu.handleContextMenu,
    handleCustomize: menu.handleCustomize,
    handleDelete: menu.handleDelete,
    handleEdit: menu.handleEdit,
    handleRenameSubmit: rename.handleRenameSubmit,
    handleRowKeyDown,
    isRenaming: state.isRenaming,
    rowRef: state.rowRef,
    setIsRenaming: state.setIsRenaming,
    startRename: rename.startRename,
  }
}
