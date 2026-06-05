import { useCallback } from 'react'
import type { VaultEntry } from '../types'
import { refreshPulledVaultState } from '../utils/pulledVaultRefresh'

interface VaultBridgeDeps {
  entriesByPath: Map<string, VaultEntry>
  resolvedPath: string
  reloadVault: () => Promise<VaultEntry[]>
  reloadFolders: () => Promise<unknown> | unknown
  reloadViews: () => Promise<unknown> | unknown
  closeAllTabs: () => void
  replaceActiveTab: (entry: VaultEntry) => Promise<void>
  refocusActiveEditor?: (path: string) => void
  hasUnsavedChanges: (path: string) => boolean
  shouldRefocusActiveEditor?: () => boolean
  onSelectNote: (entry: VaultEntry) => void
  activeTabPath: string | null
  getActiveTabPath?: () => string | null
}

type RefreshAgentChangesOptions = Pick<
  VaultBridgeDeps,
  | 'activeTabPath'
  | 'closeAllTabs'
  | 'getActiveTabPath'
  | 'hasUnsavedChanges'
  | 'refocusActiveEditor'
  | 'reloadFolders'
  | 'reloadVault'
  | 'reloadViews'
  | 'replaceActiveTab'
  | 'resolvedPath'
  | 'shouldRefocusActiveEditor'
> & { updatedFiles: string[] }
type RefreshAgentChangesDeps = Omit<RefreshAgentChangesOptions, 'updatedFiles'>

function findEntry(entriesByPath: Map<string, VaultEntry>, resolvedPath: string, path: string): VaultEntry | undefined {
  return entriesByPath.get(path) ?? entriesByPath.get(`${resolvedPath}/${path}`)
}

function findInFresh(entries: VaultEntry[], resolvedPath: string, path: string): VaultEntry | undefined {
  return entries.find(e => e.path === path || e.path === `${resolvedPath}/${path}`)
}

function refreshAgentChangedFiles(options: RefreshAgentChangesOptions) {
  const { resolvedPath, updatedFiles, ...refreshOptions } = options
  return refreshPulledVaultState({
    ...refreshOptions,
    updatedFiles,
    vaultPath: resolvedPath,
  })
}

function useRefreshAgentChanges({
  activeTabPath,
  closeAllTabs,
  getActiveTabPath,
  hasUnsavedChanges,
  refocusActiveEditor,
  reloadFolders,
  reloadVault,
  reloadViews,
  replaceActiveTab,
  resolvedPath,
  shouldRefocusActiveEditor,
}: RefreshAgentChangesDeps) {
  return useCallback((updatedFiles: string[]) => (
    refreshAgentChangedFiles({
      activeTabPath,
      closeAllTabs,
      getActiveTabPath,
      hasUnsavedChanges,
      reloadFolders,
      reloadVault,
      reloadViews,
      replaceActiveTab,
      refocusActiveEditor,
      shouldRefocusActiveEditor,
      updatedFiles,
      resolvedPath,
    })
  ), [
    activeTabPath,
    closeAllTabs,
    getActiveTabPath,
    hasUnsavedChanges,
    reloadFolders,
    reloadVault,
    reloadViews,
    replaceActiveTab,
    refocusActiveEditor,
    resolvedPath,
    shouldRefocusActiveEditor,
  ])
}

export function useVaultBridge({
  entriesByPath,
  resolvedPath,
  reloadVault,
  reloadFolders,
  reloadViews,
  closeAllTabs,
  replaceActiveTab,
  refocusActiveEditor,
  hasUnsavedChanges,
  shouldRefocusActiveEditor,
  onSelectNote,
  activeTabPath,
  getActiveTabPath,
}: VaultBridgeDeps) {
  const reloadAndOpen = useCallback((path: string) => {
    reloadVault().then(fresh => {
      const entry = findInFresh(fresh, resolvedPath, path)
      if (entry) onSelectNote(entry)
    })
  }, [reloadVault, onSelectNote, resolvedPath])

  const refreshAgentChanges = useRefreshAgentChanges({
    activeTabPath,
    closeAllTabs,
    getActiveTabPath,
    hasUnsavedChanges,
    reloadFolders,
    reloadVault,
    reloadViews,
    replaceActiveTab,
    refocusActiveEditor,
    resolvedPath,
    shouldRefocusActiveEditor,
  })

  const openNoteByPath = useCallback((path: string) => {
    const entry = findEntry(entriesByPath, resolvedPath, path)
    if (entry) onSelectNote(entry)
    else reloadAndOpen(path)
  }, [entriesByPath, resolvedPath, onSelectNote, reloadAndOpen])

  const handlePulseOpenNote = useCallback((relativePath: string) => {
    const entry = findEntry(entriesByPath, resolvedPath, `${resolvedPath}/${relativePath}`)
      ?? entriesByPath.get(relativePath)
    if (entry) onSelectNote(entry)
  }, [entriesByPath, resolvedPath, onSelectNote])

  const handleAgentFileModified = useCallback((relativePath: string) => {
    void refreshAgentChanges([relativePath])
  }, [refreshAgentChanges])

  const handleAgentVaultChanged = useCallback(() => {
    void refreshAgentChanges([])
  }, [refreshAgentChanges])

  return {
    openNoteByPath,
    handlePulseOpenNote,
    handleAgentFileCreated: reloadAndOpen,
    handleAgentFileModified,
    handleAgentVaultChanged,
  }
}
