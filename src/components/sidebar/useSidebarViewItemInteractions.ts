import {
  useCallback, useRef, useState, type Dispatch, type KeyboardEvent, type MouseEvent, type RefObject,
  type SetStateAction,
} from 'react'
import type { ViewDefinition, ViewFile } from '../../types'
import { useOutsideClick } from './sidebarHooks'
import type { MenuPosition, ViewDefinitionPatchHandler } from './SidebarViewActions'

interface SidebarViewItemInteractionInput {
  view: ViewFile
  onSelect: () => void
  onEditView?: (filename: string) => void
  onDeleteView?: (filename: string) => void
  onUpdateViewDefinition?: ViewDefinitionPatchHandler
}

type RowKeyboardAction = 'select' | 'rename' | 'menu'

function getKeyboardMenuPosition(row: HTMLDivElement | null): MenuPosition {
  const bounds = row?.getBoundingClientRect()
  return {
    x: bounds ? bounds.left + 16 : 20,
    y: bounds ? bounds.top + bounds.height : 100,
  }
}

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
  const [contextMenuPos, setContextMenuPos] = useState<MenuPosition | null>(null)
  const [customizePos, setCustomizePos] = useState<MenuPosition | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const customizeRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const closeContextMenu = useCallback(() => setContextMenuPos(null), [])
  const closeCustomize = useCallback(() => setCustomizePos(null), [])

  useOutsideClick(contextMenuRef, !!contextMenuPos, closeContextMenu)
  useOutsideClick(customizeRef, !!customizePos, closeCustomize)

  return {
    closeContextMenu,
    closeCustomize,
    contextMenuPos,
    contextMenuRef,
    customizePos,
    customizeRef,
    isRenaming,
    rowRef,
    setContextMenuPos,
    setCustomizePos,
    setIsRenaming,
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
  rowRef,
  setContextMenuPos,
  setCustomizePos,
}: SidebarViewItemInteractionInput & {
  closeContextMenu: () => void
  contextMenuPos: MenuPosition | null
  rowRef: RefObject<HTMLDivElement | null>
  setContextMenuPos: Dispatch<SetStateAction<MenuPosition | null>>
  setCustomizePos: Dispatch<SetStateAction<MenuPosition | null>>
}) {
  const hasMenuActions = !!(onEditView || onDeleteView || onUpdateViewDefinition)

  const handleContextMenu = useCallback((event: MouseEvent) => {
    if (!hasMenuActions) return
    event.preventDefault()
    event.stopPropagation()
    setCustomizePos(null)
    setContextMenuPos({ x: event.clientX, y: event.clientY })
  }, [hasMenuActions, setContextMenuPos, setCustomizePos])

  const openKeyboardContextMenu = useCallback(() => {
    setCustomizePos(null)
    setContextMenuPos(getKeyboardMenuPosition(rowRef.current))
  }, [rowRef, setContextMenuPos, setCustomizePos])

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
    rowRef: state.rowRef,
    setContextMenuPos: state.setContextMenuPos,
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
