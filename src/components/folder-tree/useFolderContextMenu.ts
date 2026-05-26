import { useCallback, type MouseEvent as ReactMouseEvent } from 'react'
import type { FolderNode } from '../../types'
import type { FolderFileActions } from '../../hooks/useFileActions'
import { requestCreateNoteInFolder } from '../../hooks/noteCreationRequests'
import { useSidebarContextMenu } from '../sidebar/sidebarHooks'

interface UseFolderContextMenuInput {
  onDeleteFolder?: (folderPath: string) => void
  folderFileActions?: FolderFileActions
  onStartRenameFolder?: (folderPath: string) => void
}

export function useFolderContextMenu({
  onDeleteFolder,
  folderFileActions,
  onStartRenameFolder,
}: UseFolderContextMenuInput) {
  const {
    closeContextMenu,
    contextMenu,
    contextMenuRef,
    openContextMenuFromPointer,
  } = useSidebarContextMenu<{ path: string; rootPath?: string }>()

  const handleOpenMenu = useCallback((node: FolderNode, event: ReactMouseEvent<HTMLElement>) => {
    openContextMenuFromPointer({ path: node.path, rootPath: node.rootPath }, event)
  }, [openContextMenuFromPointer])

  const handleCreateNoteFromMenu = useCallback((folderPath: string, rootPath?: string) => {
    closeContextMenu()
    requestCreateNoteInFolder(folderPath, rootPath)
  }, [closeContextMenu])

  const handleRenameFromMenu = useCallback((folderPath: string) => {
    closeContextMenu()
    onStartRenameFolder?.(folderPath)
  }, [closeContextMenu, onStartRenameFolder])

  const handleDeleteFromMenu = useCallback((folderPath: string) => {
    closeContextMenu()
    onDeleteFolder?.(folderPath)
  }, [closeContextMenu, onDeleteFolder])

  const handleRevealFromMenu = useCallback((folderPath: string) => {
    closeContextMenu()
    folderFileActions?.revealFolder(folderPath)
  }, [closeContextMenu, folderFileActions])

  const handleCopyPathFromMenu = useCallback((folderPath: string) => {
    closeContextMenu()
    folderFileActions?.copyFolderPath(folderPath)
  }, [closeContextMenu, folderFileActions])
  const menu = contextMenu ? {
    path: contextMenu.target.path,
    rootPath: contextMenu.target.rootPath,
    x: contextMenu.pos.x,
    y: contextMenu.pos.y,
  } : null

  return {
    closeContextMenu,
    contextMenu: menu,
    handleCopyPathFromMenu,
    handleCreateNoteFromMenu,
    handleDeleteFromMenu,
    handleOpenMenu,
    handleRevealFromMenu,
    handleRenameFromMenu,
    menuRef: contextMenuRef,
  }
}
