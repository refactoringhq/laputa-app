import type { VaultEntry } from '../types'
import { findByNotePath, joinVaultPath, normalizeNotePathForIdentity, notePathsMatch } from './notePathIdentity'

interface PulledVaultRefreshOptions {
  activeTabPath: string | null
  getActiveTabPath?: () => string | null
  closeAllTabs: () => void
  hasUnsavedChanges: (path: string) => boolean
  reloadFolders: () => Promise<unknown> | unknown
  reloadVault: () => Promise<VaultEntry[]>
  reloadViews: () => Promise<unknown> | unknown
  replaceActiveTab: (entry: VaultEntry) => Promise<void>
  updatedFiles: string[]
  vaultPath: string
}

function resolveUpdatedFilePath(path: string, vaultPath: string): string {
  if (path.startsWith('/')) return normalizeNotePathForIdentity(path)
  return normalizeNotePathForIdentity(joinVaultPath(vaultPath, path))
}

function didPullUpdateActiveNote(updatedFiles: string[], vaultPath: string, activeTabPath: string): boolean {
  return updatedFiles.some((path) => notePathsMatch(resolveUpdatedFilePath(path, vaultPath), activeTabPath))
}

function didActivePathChange(initialPath: string, latestPath: string): boolean {
  return !notePathsMatch(initialPath, latestPath)
}

export async function refreshPulledVaultState(options: PulledVaultRefreshOptions): Promise<VaultEntry[]> {
  const {
    activeTabPath,
    closeAllTabs,
    getActiveTabPath,
    hasUnsavedChanges,
    reloadFolders,
    reloadVault,
    reloadViews,
    replaceActiveTab,
    updatedFiles,
    vaultPath,
  } = options

  const [entries] = await Promise.all([
    reloadVault(),
    Promise.resolve(reloadFolders()),
    Promise.resolve(reloadViews()),
  ])

  const latestActiveTabPath = getActiveTabPath?.() ?? activeTabPath
  if (!activeTabPath || !latestActiveTabPath) return entries
  if (didActivePathChange(activeTabPath, latestActiveTabPath)) return entries
  if (hasUnsavedChanges(latestActiveTabPath)) return entries

  const refreshedEntry = findByNotePath(entries, latestActiveTabPath)
  if (!refreshedEntry) {
    closeAllTabs()
    return entries
  }
  if (!didPullUpdateActiveNote(updatedFiles, vaultPath, latestActiveTabPath)) return entries

  // Native BlockNote can keep rendering the previous document after a pull that
  // changes the active file in place. Dropping the tab first forces a full
  // reopen for that specific case without affecting unrelated pull updates.
  closeAllTabs()
  await replaceActiveTab(refreshedEntry)
  return entries
}
