import { useCallback, useMemo } from 'react'
import type { SidebarSelection } from '../types'
import { folderAbsolutePath } from './folder-actions/folderActionUtils'
import { copyLocalPath, openLocalFile, revealLocalPath } from '../utils/url'

export interface FolderFileActions {
  copyFolderPath: (folderPath: string) => void
  revealFolder: (folderPath: string) => void
}

interface UseFileActionsInput {
  selection: SidebarSelection
  setToastMessage: (message: string) => void
  vaultPath: string
}

function fileActionErrorMessage(action: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `Failed to ${action}: ${detail}`
}

export function useFileActions({
  selection,
  setToastMessage,
  vaultPath,
}: UseFileActionsInput) {
  const revealFile = useCallback((path: string) => {
    void revealLocalPath(path).catch((error) => {
      setToastMessage(fileActionErrorMessage('reveal path', error))
    })
  }, [setToastMessage])

  const copyFilePath = useCallback((path: string) => {
    void copyLocalPath(path)
      .then(() => setToastMessage('File path copied'))
      .catch((error) => {
        setToastMessage(fileActionErrorMessage('copy path', error))
      })
  }, [setToastMessage])

  const openExternalFile = useCallback((path: string) => {
    void openLocalFile(path, vaultPath).catch((error) => {
      setToastMessage(fileActionErrorMessage('open file', error))
    })
  }, [setToastMessage, vaultPath])

  const resolveFolderPath = useCallback((folderPath: string) => (
    folderAbsolutePath({ vaultPath, folderPath })
  ), [vaultPath])

  const folderActions = useMemo<FolderFileActions>(() => ({
    copyFolderPath: (folderPath) => {
      const absolutePath = resolveFolderPath(folderPath)
      void copyLocalPath(absolutePath)
        .then(() => setToastMessage('Folder path copied'))
        .catch((error) => {
          setToastMessage(fileActionErrorMessage('copy folder path', error))
        })
    },
    revealFolder: (folderPath) => revealFile(resolveFolderPath(folderPath)),
  }), [resolveFolderPath, revealFile, setToastMessage])

  const revealSelectedFolder = useCallback(() => {
    if (selection.kind !== 'folder') return
    folderActions.revealFolder(selection.path)
  }, [folderActions, selection])

  const copySelectedFolderPath = useCallback(() => {
    if (selection.kind !== 'folder') return
    folderActions.copyFolderPath(selection.path)
  }, [folderActions, selection])

  return useMemo(() => ({
    copyFilePath,
    copySelectedFolderPath,
    folderActions,
    openExternalFile,
    revealFile,
    revealSelectedFolder,
  }), [
    copyFilePath,
    copySelectedFolderPath,
    folderActions,
    openExternalFile,
    revealFile,
    revealSelectedFolder,
  ])
}
