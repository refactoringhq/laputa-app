import type { FolderNode, ModifiedFile, VaultEntry, ViewFile } from '../types'

export interface VaultStateResetOptions {
  clearNewPaths: () => void
  clearUnsaved: () => void
  setEntries: (entries: VaultEntry[]) => void
  setFolders: (folders: FolderNode[]) => void
  setIsLoading: (isLoading: boolean) => void
  setModifiedFiles: (files: ModifiedFile[]) => void
  setModifiedFilesError: (message: string | null) => void
  setViews: (views: ViewFile[]) => void
}

export function resetVaultState(options: VaultStateResetOptions) {
  options.setEntries([])
  options.setFolders([])
  options.setViews([])
  options.setModifiedFiles([])
  options.setModifiedFilesError(null)
  options.setIsLoading(false)
  options.clearNewPaths()
  options.clearUnsaved()
}
