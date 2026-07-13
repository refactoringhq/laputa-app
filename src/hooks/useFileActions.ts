import { useCallback, useMemo } from 'react'
import type { SidebarSelection } from '../types'
import { folderAbsolutePath } from './folder-actions/folderActionUtils'
import { copyLocalPath, openLocalFile, revealLocalPath } from '../utils/url'
import {
  translate,
  type AppLocale,
  type TranslationKey,
} from '../lib/i18n'
import { localizedStreamErrorMessage as localizedErrorMessage } from '../lib/localizedStreamError'

export interface FolderFileActions {
  copyFolderPath: (folderPath: string) => void
  revealFolder: (folderPath: string) => void
}

interface UseFileActionsInput {
  locale: AppLocale
  selection: SidebarSelection
  setToastMessage: (message: string) => void
  vaultPath: string
}

type FileActionErrorKey = Extract<
  TranslationKey,
  | 'fileActions.error.copyFolderPath'
  | 'fileActions.error.copyPath'
  | 'fileActions.error.openFile'
  | 'fileActions.error.revealPath'
>

function fileActionErrorDetail(locale: AppLocale, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return localizedErrorMessage({ message, locale })
}

export function fileActionErrorMessage(
  locale: AppLocale,
  key: FileActionErrorKey,
  error: unknown,
): string {
  return translate(locale, key, {
    detail: fileActionErrorDetail(locale, error),
  })
}

export function useFileActions({
  locale,
  selection,
  setToastMessage,
  vaultPath,
}: UseFileActionsInput) {
  const revealFile = useCallback((path: string) => {
    void revealLocalPath(path).catch((error) => {
      setToastMessage(fileActionErrorMessage(locale, 'fileActions.error.revealPath', error))
    })
  }, [locale, setToastMessage])

  const copyFilePath = useCallback((path: string) => {
    void copyLocalPath(path)
      .then(() => setToastMessage(translate(locale, 'fileActions.copied.filePath')))
      .catch((error) => {
        setToastMessage(fileActionErrorMessage(locale, 'fileActions.error.copyPath', error))
      })
  }, [locale, setToastMessage])

  const openExternalFile = useCallback((path: string) => {
    void openLocalFile(path, vaultPath).catch((error) => {
      setToastMessage(fileActionErrorMessage(locale, 'fileActions.error.openFile', error))
    })
  }, [locale, setToastMessage, vaultPath])

  const resolveFolderPath = useCallback((folderPath: string, rootPath?: string) => (
    folderAbsolutePath({ vaultPath: rootPath ?? vaultPath, folderPath })
  ), [vaultPath])

  const folderActions = useMemo<FolderFileActions>(() => ({
    copyFolderPath: (folderPath) => {
      const absolutePath = resolveFolderPath(folderPath)
      void copyLocalPath(absolutePath)
        .then(() => setToastMessage(translate(locale, 'fileActions.copied.folderPath')))
        .catch((error) => {
          setToastMessage(fileActionErrorMessage(locale, 'fileActions.error.copyFolderPath', error))
        })
    },
    revealFolder: (folderPath) => revealFile(resolveFolderPath(folderPath)),
  }), [locale, resolveFolderPath, revealFile, setToastMessage])

  const revealSelectedFolder = useCallback(() => {
    if (selection.kind !== 'folder') return
    revealFile(resolveFolderPath(selection.path, selection.rootPath))
  }, [resolveFolderPath, revealFile, selection])

  const copySelectedFolderPath = useCallback(() => {
    if (selection.kind !== 'folder') return
    const absolutePath = resolveFolderPath(selection.path, selection.rootPath)
    void copyLocalPath(absolutePath)
      .then(() => setToastMessage(translate(locale, 'fileActions.copied.folderPath')))
      .catch((error) => {
        setToastMessage(fileActionErrorMessage(locale, 'fileActions.error.copyFolderPath', error))
      })
  }, [locale, resolveFolderPath, selection, setToastMessage])

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
