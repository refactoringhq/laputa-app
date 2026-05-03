import { useCallback, useState } from 'react'
import { clearPrefetchCache } from './useTabManagement'
import { resetVaultState, type VaultStateResetOptions } from './vaultStateReset'

interface UnavailableVaultStateOptions extends VaultStateResetOptions {
  isCurrentVaultPath: (path: string) => boolean
  vaultPath: string
}

export function useUnavailableVaultState(options: UnavailableVaultStateOptions) {
  const [unavailableVaultPath, setUnavailableVaultPath] = useState<string | null>(null)
  const {
    clearNewPaths,
    clearUnsaved,
    isCurrentVaultPath,
    setEntries,
    setFolders,
    setIsLoading,
    setModifiedFiles,
    setModifiedFilesError,
    setViews,
    vaultPath,
  } = options

  const markVaultUnavailable = useCallback((path: string) => {
    if (!isCurrentVaultPath(path)) return
    clearPrefetchCache()
    resetVaultState({
      clearNewPaths,
      clearUnsaved,
      setEntries,
      setFolders,
      setIsLoading,
      setModifiedFiles,
      setModifiedFilesError,
      setViews,
    })
    setUnavailableVaultPath(path)
  }, [
    clearNewPaths,
    clearUnsaved,
    isCurrentVaultPath,
    setEntries,
    setFolders,
    setIsLoading,
    setModifiedFiles,
    setModifiedFilesError,
    setViews,
  ])

  const markVaultAvailable = useCallback((path: string) => {
    if (isCurrentVaultPath(path)) setUnavailableVaultPath(null)
  }, [isCurrentVaultPath])

  return {
    markVaultAvailable,
    markVaultUnavailable,
    unavailableVaultPath: unavailableVaultPath === vaultPath ? unavailableVaultPath : null,
  }
}
