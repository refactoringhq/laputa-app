import type { VaultEntry } from '../types'
import { refreshPulledVaultState } from './pulledVaultRefresh'

interface NoteWindowVaultRefreshOptions {
  activeTabPath: string | null
  applyEntry: (entry: VaultEntry) => void
  closeAllTabs: () => void
  currentEntries: VaultEntry[]
  getActiveTabPath?: () => string | null
  hasUnsavedChanges: (path: string) => boolean
  isActiveTabContentCurrent?: (path: string) => Promise<boolean> | boolean
  paths: string[]
  refreshFullVault: (paths: string[]) => Promise<VaultEntry[]>
  reloadEntry: (path: string) => Promise<VaultEntry | null>
  replaceActiveTab: (entry: VaultEntry) => Promise<void>
  refocusActiveEditor?: (path: string) => void
  shouldRefocusActiveEditor?: () => boolean
  vaultPath: string
}

function mergeReloadedEntries(currentEntries: VaultEntry[], reloadedEntries: VaultEntry[]): VaultEntry[] {
  const reloadedByPath = new Map(reloadedEntries.map((entry) => [entry.path, entry]))
  const merged = currentEntries.map((entry) => reloadedByPath.get(entry.path) ?? entry)
  const currentPaths = new Set(currentEntries.map((entry) => entry.path))
  return [...merged, ...reloadedEntries.filter((entry) => !currentPaths.has(entry.path))]
}

export async function refreshNoteWindowVaultChanges(
  options: NoteWindowVaultRefreshOptions,
): Promise<VaultEntry[]> {
  if (options.paths.length === 0) return options.refreshFullVault(options.paths)

  let reloadedEntries: Array<VaultEntry | null>
  try {
    reloadedEntries = await Promise.all(options.paths.map((path) => options.reloadEntry(path)))
  } catch {
    return options.refreshFullVault(options.paths)
  }
  if (reloadedEntries.some((entry) => !entry)) return options.refreshFullVault(options.paths)

  const presentEntries = reloadedEntries.filter((entry): entry is VaultEntry => entry !== null)
  for (const entry of presentEntries) options.applyEntry(entry)
  const nextEntries = mergeReloadedEntries(options.currentEntries, presentEntries)
  return refreshPulledVaultState({
    activeTabPath: options.activeTabPath,
    closeAllTabs: options.closeAllTabs,
    getActiveTabPath: options.getActiveTabPath,
    hasUnsavedChanges: options.hasUnsavedChanges,
    isActiveTabContentCurrent: options.isActiveTabContentCurrent,
    reloadFolders: () => undefined,
    reloadVault: () => Promise.resolve(nextEntries),
    reloadViews: () => undefined,
    replaceActiveTab: options.replaceActiveTab,
    refocusActiveEditor: options.refocusActiveEditor,
    shouldRefocusActiveEditor: options.shouldRefocusActiveEditor,
    updatedFiles: options.paths,
    vaultPath: options.vaultPath,
  })
}
