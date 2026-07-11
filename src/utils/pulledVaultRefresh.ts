import type { VaultEntry } from '../types'
import { findByNotePath, joinVaultPath, normalizeNotePathForIdentity, notePathsMatch } from './notePathIdentity'

interface PulledVaultRefreshOptions {
  activeTabPath: string | null
  getActiveTabPath?: () => string | null
  closeAllTabs: () => void
  hasUnsavedChanges: (path: string) => boolean
  isActiveTabContentCurrent?: (path: string) => Promise<boolean> | boolean
  reloadFolders: () => Promise<unknown> | unknown
  reloadVault: () => Promise<VaultEntry[]>
  reloadViews: () => Promise<unknown> | unknown
  replaceActiveTab: (entry: VaultEntry) => Promise<void>
  refocusActiveEditor?: (path: string) => void
  shouldRefocusActiveEditor?: () => boolean
  updatedFiles: string[]
  vaultPath: string
}

function resolveUpdatedFilePath(options: { path: string; vaultPath: string }): string {
  const { path, vaultPath } = options
  if (path.startsWith('/')) return normalizeNotePathForIdentity(path)
  return normalizeNotePathForIdentity(joinVaultPath(vaultPath, path))
}

function didPullUpdateActiveNote(options: {
  updatedFiles: string[]
  vaultPath: string
  activeTabPath: string
}): boolean {
  const { activeTabPath, updatedFiles, vaultPath } = options
  return updatedFiles.some((path) => notePathsMatch(resolveUpdatedFilePath({ path, vaultPath }), activeTabPath))
}

function didActivePathChange(options: { initialPath: string; latestPath: string }): boolean {
  const { initialPath, latestPath } = options
  return !notePathsMatch(initialPath, latestPath)
}

function findExternallyMovedActiveEntry(options: {
  activeTabPath: string
  entries: VaultEntry[]
  updatedFiles: string[]
  vaultPath: string
}): VaultEntry | null {
  const { activeTabPath, entries, updatedFiles, vaultPath } = options
  if (updatedFiles.length === 0) return null
  const activeFilename = normalizeNotePathForIdentity(activeTabPath).split('/').pop()
  const updatedPaths = new Set(updatedFiles.map((path) => resolveUpdatedFilePath({ path, vaultPath })))
  const candidates = entries.filter((entry) =>
    !notePathsMatch(entry.path, activeTabPath)
    && entry.filename === activeFilename
    && updatedPaths.has(normalizeNotePathForIdentity(entry.path)),
  )

  const [candidate] = candidates
  return candidates.length === 1 && candidate ? candidate : null
}

function isActivePathBlocked(options: {
  activeTabPath: string | null
  latestActiveTabPath: string | null
  hasUnsavedChanges: PulledVaultRefreshOptions['hasUnsavedChanges']
}): boolean {
  const { activeTabPath, latestActiveTabPath, hasUnsavedChanges } = options
  if (!activeTabPath) return true
  if (!latestActiveTabPath) return true
  if (didActivePathChange({ initialPath: activeTabPath, latestPath: latestActiveTabPath })) return true
  return hasUnsavedChanges(latestActiveTabPath)
}

function shouldReplaceActiveEntry(options: {
  activePath: string
  movedEntry: VaultEntry | null
  refreshedEntry: VaultEntry | null
  updatedFiles: string[]
  vaultPath: string
}): boolean {
  const {
    activePath,
    movedEntry,
    refreshedEntry,
    updatedFiles,
    vaultPath,
  } = options
  if (movedEntry) return true
  if (!refreshedEntry) return false
  return didPullUpdateActiveNote({ updatedFiles, vaultPath, activeTabPath: activePath })
}

async function shouldKeepCurrentActiveEntryMounted(options: {
  activePath: string
  isActiveTabContentCurrent?: PulledVaultRefreshOptions['isActiveTabContentCurrent']
  movedEntry: VaultEntry | null
  shouldReplace: boolean | null
}): Promise<boolean> {
  const {
    activePath,
    isActiveTabContentCurrent,
    movedEntry,
    shouldReplace,
  } = options
  if (!shouldReplace || movedEntry || !isActiveTabContentCurrent) return false
  return await isActiveTabContentCurrent(activePath) === true
}

async function applyActiveEntryReplacement(options: {
  closeAllTabs: PulledVaultRefreshOptions['closeAllTabs']
  replaceActiveTab: PulledVaultRefreshOptions['replaceActiveTab']
  refocusActiveEditor?: PulledVaultRefreshOptions['refocusActiveEditor']
  replacementEntry: VaultEntry | null
  shouldRefocusActiveEditor?: PulledVaultRefreshOptions['shouldRefocusActiveEditor']
  shouldReplace: boolean | null
}): Promise<boolean> {
  const {
    closeAllTabs,
    replaceActiveTab,
    refocusActiveEditor,
    replacementEntry,
    shouldRefocusActiveEditor,
    shouldReplace,
  } = options
  if (!replacementEntry || !shouldReplace) return false

  const shouldRefocus = shouldRefocusActiveEditor?.() === true
  closeAllTabs()
  await replaceActiveTab(replacementEntry)
  if (shouldRefocus) refocusActiveEditor?.(replacementEntry.path)
  return true
}

export async function refreshPulledVaultState(options: PulledVaultRefreshOptions): Promise<VaultEntry[]> {
  const {
    activeTabPath,
    closeAllTabs,
    getActiveTabPath,
    hasUnsavedChanges,
    isActiveTabContentCurrent,
    reloadFolders,
    reloadVault,
    reloadViews,
    replaceActiveTab,
    refocusActiveEditor,
    shouldRefocusActiveEditor,
    updatedFiles,
    vaultPath,
  } = options

  const [entries] = await Promise.all([
    reloadVault(),
    Promise.resolve(reloadFolders()),
    Promise.resolve(reloadViews()),
  ])

  const latestActiveTabPath = getActiveTabPath?.() ?? activeTabPath
  if (isActivePathBlocked({ activeTabPath, latestActiveTabPath, hasUnsavedChanges })) return entries

  const activePath = latestActiveTabPath as string
  const refreshedEntry = findByNotePath(entries, activePath) ?? null
  const movedEntry = refreshedEntry ? null : findExternallyMovedActiveEntry({
    activeTabPath: activePath,
    entries,
    updatedFiles,
    vaultPath,
  })
  const replacementEntry = refreshedEntry ?? movedEntry

  const shouldReplace = replacementEntry && shouldReplaceActiveEntry({
    activePath,
    movedEntry,
    refreshedEntry,
    updatedFiles,
    vaultPath,
  })

  if (await shouldKeepCurrentActiveEntryMounted({
    activePath,
    isActiveTabContentCurrent,
    movedEntry,
    shouldReplace,
  })) return entries

  const handledReplacement = await applyActiveEntryReplacement({
    closeAllTabs,
    replaceActiveTab,
    refocusActiveEditor,
    replacementEntry,
    shouldRefocusActiveEditor,
    shouldReplace,
  })
  if (handledReplacement) return entries

  if (!replacementEntry) closeAllTabs()
  return entries
}
