import { useCallback, useState } from 'react'
import type { SidebarSelection, VaultEntry } from '../../types'
import {
  folderLabel,
  invokeRenameFolder,
  type FolderTab,
  updateSelectionAfterFolderRename,
  updateTabsAfterFolderRename,
} from './folderActionUtils'

interface UseFolderRenameInput {
  activeTabPathRef: React.MutableRefObject<string | null>
  handleSwitchTab: (path: string) => void
  reloadFolders: () => Promise<unknown>
  reloadVault: () => Promise<VaultEntry[]>
  selection: SidebarSelection
  setSelection: (selection: SidebarSelection) => void
  setTabs: React.Dispatch<React.SetStateAction<FolderTab[]>>
  setToastMessage: (message: string | null) => void
  vaultPath: string
}

export function useFolderRename({
  activeTabPathRef,
  handleSwitchTab,
  reloadFolders,
  reloadVault,
  selection,
  setSelection,
  setTabs,
  setToastMessage,
  vaultPath,
}: UseFolderRenameInput) {
  const [renamingFolderPath, setRenamingFolderPath] = useState<string | null>(null)

  const cancelFolderRename = useCallback(() => setRenamingFolderPath(null), [])
  const startFolderRename = useCallback((folderPath: string) => setRenamingFolderPath(folderPath), [])

  const renameFolder = useCallback(async (folderPath: string, nextName: string) => {
    const trimmedName = nextName.trim()
    if (trimmedName === folderLabel({ folderPath })) {
      setRenamingFolderPath(null)
      return true
    }

    try {
      const renameResult = await invokeRenameFolder({ vaultPath, folderPath, newName: trimmedName })
      setRenamingFolderPath(null)
      await reloadFolders()
      const refreshedEntries = await reloadVault()
      updateTabsAfterFolderRename({
        activeTabPathRef,
        handleSwitchTab,
        refreshedEntries,
        renameResult,
        setTabs,
        vaultPath,
      })
      updateSelectionAfterFolderRename({
        refreshedEntries,
        renameResult,
        selection,
        setSelection,
        vaultPath,
      })
      setToastMessage(`Renamed folder to "${trimmedName}"`)
      return true
    } catch (error) {
      setToastMessage(`Failed to rename folder: ${error}`)
      return false
    }
  }, [activeTabPathRef, handleSwitchTab, reloadFolders, reloadVault, selection, setSelection, setTabs, setToastMessage, vaultPath])

  const renameSelectedFolder = useCallback(() => {
    if (selection.kind !== 'folder' || !selection.path) return
    startFolderRename(selection.path)
  }, [selection, startFolderRename])

  return {
    cancelFolderRename,
    renameFolder,
    renameSelectedFolder,
    renamingFolderPath,
    startFolderRename,
  }
}
