import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry, FolderNode, GitCommit, ModifiedFile, NoteStatus, GitPushResult, ViewFile } from '../types'
import {
  GITIGNORED_VISIBILITY_CHANGED_EVENT,
  notifyGitignoredVisibilityApplied,
  type GitignoredVisibilityChangedEvent,
} from '../lib/gitignoredVisibilityEvents'
import { clearPrefetchCache } from './useTabManagement'

function tauriCall<T>(command: string, tauriArgs: Record<string, unknown>, mockArgs?: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, tauriArgs) : mockInvoke<T>(command, mockArgs ?? tauriArgs)
}

function hasVaultPath(vaultPath: string): boolean {
  return vaultPath.trim().length > 0
}

function loadVaultEntries(vaultPath: string): Promise<VaultEntry[]> {
  const command = isTauri() ? 'reload_vault' : 'list_vault'
  return tauriCall<VaultEntry[]>(command, { path: vaultPath })
}

async function loadVaultData(vaultPath: string) {
  if (!isTauri()) console.info('[mock] Using mock Tauri data for browser testing')
  const entries = await loadVaultEntries(vaultPath)
  console.log(`Vault scan complete: ${entries.length} entries found`)
  return { entries }
}

function loadVaultFolders(vaultPath: string): Promise<FolderNode[]> {
  return tauriCall<FolderNode[]>('list_vault_folders', { path: vaultPath })
}

function loadVaultViews(vaultPath: string): Promise<ViewFile[]> {
  return tauriCall<ViewFile[]>('list_views', { vaultPath })
}

async function loadVaultChrome(vaultPath: string) {
  const [folders, views] = await Promise.all([
    loadVaultFolders(vaultPath).catch(() => [] as FolderNode[]),
    loadVaultViews(vaultPath).catch(() => [] as ViewFile[]),
  ])

  return {
    folders: folders ?? [],
    views: views ?? [],
  }
}

function resetVaultState(options: {
  clearNewPaths: () => void
  clearUnsaved: () => void
  setEntries: (entries: VaultEntry[]) => void
  setFolders: (folders: FolderNode[]) => void
  setIsLoading: (isLoading: boolean) => void
  setModifiedFiles: (files: ModifiedFile[]) => void
  setModifiedFilesError: (message: string | null) => void
  setViews: (views: ViewFile[]) => void
}) {
  options.setEntries([])
  options.setFolders([])
  options.setViews([])
  options.setModifiedFiles([])
  options.setModifiedFilesError(null)
  options.setIsLoading(false)
  options.clearNewPaths()
  options.clearUnsaved()
}

async function loadInitialVaultState(options: {
  path: string
  isCurrentVaultPath: (path: string) => boolean
  setEntries: (entries: VaultEntry[]) => void
  setFolders: (folders: FolderNode[]) => void
  setIsLoading: (isLoading: boolean) => void
  setViews: (views: ViewFile[]) => void
}) {
  const { path, isCurrentVaultPath, setEntries, setFolders, setIsLoading, setViews } = options
  const chromeLoad = loadVaultChrome(path)

  setIsLoading(true)
  try {
    const { entries } = await loadVaultData(path)
    if (isCurrentVaultPath(path)) setEntries(entries)
  } catch (err) {
    console.warn('Vault scan failed:', err)
  } finally {
    if (isCurrentVaultPath(path)) setIsLoading(false)
  }

  const { folders, views } = await chromeLoad
  if (!isCurrentVaultPath(path)) return
  setFolders(folders)
  setViews(views)
}

function useCurrentVaultPathGuard(vaultPath: string) {
  const currentPathRef = useRef(vaultPath)

  useEffect(() => {
    currentPathRef.current = vaultPath
  }, [vaultPath])

  return useCallback((path: string) => currentPathRef.current === path, [])
}

async function commitWithPush(vaultPath: string, message: string): Promise<GitPushResult> {
  if (!isTauri()) {
    await mockInvoke<string>('git_commit', { message })
    return mockInvoke<GitPushResult>('git_push', {})
  }
  await invoke<string>('git_commit', { vaultPath, message })
  return invoke<GitPushResult>('git_push', { vaultPath })
}

function useNewNoteTracker() {
  const [newPaths, setNewPaths] = useState<Set<string>>(new Set())

  const trackNew = useCallback((path: string) => {
    setNewPaths((prev) => new Set(prev).add(path))
  }, [])

  const clear = useCallback(() => setNewPaths(new Set()), [])

  return { newPaths, trackNew, clear }
}

function useUnsavedTracker() {
  const [unsavedPaths, setUnsavedPaths] = useState<Set<string>>(new Set())

  const trackUnsaved = useCallback((path: string) => {
    setUnsavedPaths((prev) => new Set(prev).add(path))
  }, [])

  const clearUnsaved = useCallback((path: string) => {
    setUnsavedPaths((prev) => {
      const next = new Set(prev)
      next.delete(path)
      return next
    })
  }, [])

  const clearAll = useCallback(() => setUnsavedPaths(new Set()), [])

  return { unsavedPaths, trackUnsaved, clearUnsaved, clearAll }
}

function usePendingSaveTracker() {
  const [pendingSavePaths, setPendingSavePaths] = useState<Set<string>>(new Set())

  const addPendingSave = useCallback((path: string) => {
    setPendingSavePaths((prev) => new Set(prev).add(path))
  }, [])

  const removePendingSave = useCallback((path: string) => {
    setPendingSavePaths((prev) => {
      const next = new Set(prev)
      next.delete(path)
      return next
    })
  }, [])

  return { pendingSavePaths, addPendingSave, removePendingSave }
}

interface ResolveNoteStatusOptions {
  path: string
  newPaths: Set<string>
  modifiedFiles: ModifiedFile[]
  pendingSavePaths?: Set<string>
  unsavedPaths?: Set<string>
}

function resolveTransientNoteStatus({
  path,
  pendingSavePaths,
  unsavedPaths,
}: Pick<ResolveNoteStatusOptions, 'path' | 'pendingSavePaths' | 'unsavedPaths'>): NoteStatus | null {
  if (unsavedPaths?.has(path)) return 'unsaved'
  if (pendingSavePaths?.has(path)) return 'pendingSave'
  return null
}

function resolveGitBackedNoteStatus(file: ModifiedFile | undefined): NoteStatus {
  if (!file) return 'clean'
  if (file.status === 'untracked' || file.status === 'added') return 'new'
  if (file.status === 'modified' || file.status === 'deleted') return 'modified'
  return 'clean'
}

export function resolveNoteStatus({
  path,
  newPaths,
  modifiedFiles,
  pendingSavePaths,
  unsavedPaths,
}: ResolveNoteStatusOptions): NoteStatus {
  const transientStatus = resolveTransientNoteStatus({ path, pendingSavePaths, unsavedPaths })
  if (transientStatus) return transientStatus
  if (newPaths.has(path)) return 'new'
  return resolveGitBackedNoteStatus(modifiedFiles.find((file) => file.path === path))
}

function useInitialVaultLoad({
  vaultPath,
  tracker,
  unsaved,
  isCurrentVaultPath,
  resetReloading,
  setEntries,
  setFolders,
  setIsLoading,
  setModifiedFiles,
  setModifiedFilesError,
  setViews,
}: {
  vaultPath: string
  tracker: ReturnType<typeof useNewNoteTracker>
  unsaved: ReturnType<typeof useUnsavedTracker>
  isCurrentVaultPath: (path: string) => boolean
  resetReloading: () => void
  setEntries: (entries: VaultEntry[]) => void
  setFolders: (folders: FolderNode[]) => void
  setIsLoading: (isLoading: boolean) => void
  setModifiedFiles: (files: ModifiedFile[]) => void
  setModifiedFilesError: (message: string | null) => void
  setViews: (views: ViewFile[]) => void
}) {
  useEffect(() => {
    const path = vaultPath
    resetVaultState({
      clearNewPaths: tracker.clear,
      clearUnsaved: unsaved.clearAll,
      setEntries,
      setFolders,
      setIsLoading,
      setModifiedFiles,
      setModifiedFilesError,
      setViews,
    })
    resetReloading()

    if (!hasVaultPath(path)) return

    let cancelled = false
    void loadInitialVaultState({
      path,
      isCurrentVaultPath: (candidate) => !cancelled && isCurrentVaultPath(candidate),
      setEntries,
      setFolders,
      setIsLoading,
      setViews,
    })
    return () => { cancelled = true }
  }, [
    vaultPath,
    tracker.clear,
    unsaved.clearAll,
    isCurrentVaultPath,
    resetReloading,
    setEntries,
    setFolders,
    setIsLoading,
    setModifiedFiles,
    setModifiedFilesError,
    setViews,
  ])
}

function useModifiedFilesLoader(vaultPath: string, isCurrentVaultPath: (path: string) => boolean) {
  const [modifiedFiles, setModifiedFiles] = useState<ModifiedFile[]>([])
  const [modifiedFilesError, setModifiedFilesError] = useState<string | null>(null)

  const loadModifiedFiles = useCallback(async () => {
    const path = vaultPath
    setModifiedFilesError(null)

    if (!hasVaultPath(path)) {
      setModifiedFiles([])
      return
    }

    try {
      const files = await tauriCall<ModifiedFile[]>('get_modified_files', { vaultPath: path }, {})
      if (isCurrentVaultPath(path)) setModifiedFiles(files)
    } catch (err) {
      if (!isCurrentVaultPath(path)) return
      const message = typeof err === 'string' ? err : 'Failed to load changes'
      console.warn('Failed to load modified files:', err)
      setModifiedFilesError(message)
      setModifiedFiles([])
    }
  }, [vaultPath, isCurrentVaultPath])

  useEffect(() => { loadModifiedFiles() }, [loadModifiedFiles]) // eslint-disable-line react-hooks/set-state-in-effect -- trigger initial load

  return {
    modifiedFiles,
    modifiedFilesError,
    setModifiedFiles,
    setModifiedFilesError,
    loadModifiedFiles,
  }
}

function useEntryMutations(
  setEntries: Dispatch<SetStateAction<VaultEntry[]>>,
  trackNew: (path: string) => void,
) {
  const addEntry = useCallback((entry: VaultEntry) => {
    setEntries((prev) => {
      if (prev.some(e => e.path === entry.path)) return prev
      return [entry, ...prev]
    })
    trackNew(entry.path)
  }, [setEntries, trackNew])

  const updateEntry = useCallback((path: string, patch: Partial<VaultEntry>) => {
    setEntries((prev) => {
      let changed = false
      const next = prev.map((e) => {
        if (e.path === path) { changed = true; return { ...e, ...patch } }
        return e
      })
      return changed ? next : prev
    })
  }, [setEntries])

  const removeEntry = useCallback((path: string) => {
    setEntries((prev) => prev.filter((e) => e.path !== path))
  }, [setEntries])

  const removeEntries = useCallback((paths: string[]) => {
    if (paths.length === 0) return
    const pathSet = new Set(paths)
    setEntries((prev) => prev.filter((entry) => !pathSet.has(entry.path)))
  }, [setEntries])

  const replaceEntry = useCallback((oldPath: string, patch: Partial<VaultEntry> & { path: string }) => {
    setEntries((prev) => prev.map((e) => e.path === oldPath ? { ...e, ...patch } : e))
  }, [setEntries])

  return { addEntry, updateEntry, removeEntry, removeEntries, replaceEntry }
}

function useGitLoaders(vaultPath: string) {
  const loadGitHistory = useCallback(async (path: string): Promise<GitCommit[]> => {
    try { return await tauriCall<GitCommit[]>('get_file_history', { vaultPath, path }, { path }) }
    catch (err) { console.warn('Failed to load git history:', err); return [] }
  }, [vaultPath])

  const loadDiffAtCommit = useCallback((path: string, commitHash: string): Promise<string> =>
    tauriCall<string>('get_file_diff_at_commit', { vaultPath, path, commitHash }, { path, commitHash }), [vaultPath])

  const loadDiff = useCallback((path: string): Promise<string> =>
    tauriCall<string>('get_file_diff', { vaultPath, path }, { path }), [vaultPath])

  const commitAndPush = useCallback((message: string): Promise<GitPushResult> =>
    commitWithPush(vaultPath, message), [vaultPath])

  return { loadGitHistory, loadDiffAtCommit, loadDiff, commitAndPush }
}

function useVaultReloads({
  vaultPath,
  isCurrentVaultPath,
  loadModifiedFiles,
  setEntries,
  setFolders,
  setViews,
}: {
  vaultPath: string
  isCurrentVaultPath: (path: string) => boolean
  loadModifiedFiles: () => Promise<void>
  setEntries: (entries: VaultEntry[]) => void
  setFolders: (folders: FolderNode[]) => void
  setViews: (views: ViewFile[]) => void
}) {
  const [activeReloads, setActiveReloads] = useState(0)
  const isReloading = activeReloads > 0
  const beginReload = useCallback(() => setActiveReloads((count) => count + 1), [])
  const finishReload = useCallback(() => setActiveReloads((count) => Math.max(0, count - 1)), [])
  const resetReloading = useCallback(() => setActiveReloads(0), [])

  const reloadFolders = useCallback(async () => {
    const path = vaultPath
    if (!hasVaultPath(path)) return [] as FolderNode[]
    try {
      const folders = await loadVaultFolders(path)
      if (!isCurrentVaultPath(path)) return [] as FolderNode[]
      const nextFolders = folders ?? []
      setFolders(nextFolders)
      return nextFolders
    } catch {
      return [] as FolderNode[]
    }
  }, [vaultPath, isCurrentVaultPath, setFolders])

  const reloadVault = useCallback(async () => {
    const path = vaultPath
    if (!hasVaultPath(path)) return [] as VaultEntry[]
    clearPrefetchCache()
    beginReload()
    try {
      const entries = await tauriCall<VaultEntry[]>('reload_vault', { path })
      if (!isCurrentVaultPath(path)) return [] as VaultEntry[]
      setEntries(entries)
      void loadModifiedFiles()
      return entries
    } catch (err) {
      console.warn('Vault reload failed:', err)
      return [] as VaultEntry[]
    } finally {
      finishReload()
    }
  }, [vaultPath, beginReload, finishReload, loadModifiedFiles, isCurrentVaultPath, setEntries])

  const reloadViews = useCallback(async () => {
    const path = vaultPath
    if (!hasVaultPath(path)) return []
    try {
      const nextViews = await loadVaultViews(path)
      if (!isCurrentVaultPath(path)) return []
      const resolvedViews = nextViews ?? []
      setViews(resolvedViews)
      return resolvedViews
    } catch { /* views are optional */ }
    return []
  }, [vaultPath, isCurrentVaultPath, setViews])

  return { isReloading, reloadFolders, reloadVault, reloadViews, resetReloading }
}

function useGitignoredVisibilityReloads(
  reloads: Pick<ReturnType<typeof useVaultReloads>, 'reloadFolders' | 'reloadVault' | 'reloadViews'>,
) {
  const { reloadFolders, reloadVault, reloadViews } = reloads

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleVisibilityChanged = (event: Event) => {
      const { hide } = (event as GitignoredVisibilityChangedEvent).detail
      void Promise.all([
        reloadVault(),
        reloadFolders(),
        reloadViews(),
      ]).then(([entries]) => {
        notifyGitignoredVisibilityApplied(hide, entries)
      })
    }

    window.addEventListener(GITIGNORED_VISIBILITY_CHANGED_EVENT, handleVisibilityChanged)
    return () => {
      window.removeEventListener(GITIGNORED_VISIBILITY_CHANGED_EVENT, handleVisibilityChanged)
    }
  }, [reloadFolders, reloadVault, reloadViews])
}

export function useVaultLoader(vaultPath: string) {
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [folders, setFolders] = useState<FolderNode[]>([])
  const [isLoading, setIsLoading] = useState(() => hasVaultPath(vaultPath))
  const [views, setViews] = useState<ViewFile[]>([])
  const tracker = useNewNoteTracker()
  const pendingSave = usePendingSaveTracker()
  const unsaved = useUnsavedTracker()
  const isCurrentVaultPath = useCurrentVaultPathGuard(vaultPath)
  const {
    modifiedFiles,
    modifiedFilesError,
    setModifiedFiles,
    setModifiedFilesError,
    loadModifiedFiles,
  } = useModifiedFilesLoader(vaultPath, isCurrentVaultPath)
  const entryMutations = useEntryMutations(setEntries, tracker.trackNew)
  const gitLoaders = useGitLoaders(vaultPath)
  const vaultReloads = useVaultReloads({
    vaultPath,
    isCurrentVaultPath,
    loadModifiedFiles,
    setEntries,
    setFolders,
    setViews,
  })
  useGitignoredVisibilityReloads(vaultReloads)

  useInitialVaultLoad({
    vaultPath,
    tracker,
    unsaved,
    isCurrentVaultPath,
    resetReloading: vaultReloads.resetReloading,
    setEntries,
    setFolders,
    setIsLoading,
    setModifiedFiles,
    setModifiedFilesError,
    setViews,
  })

  const getNoteStatus = useCallback((path: string): NoteStatus =>
    resolveNoteStatus({
      path,
      newPaths: tracker.newPaths,
      modifiedFiles,
      pendingSavePaths: pendingSave.pendingSavePaths,
      unsavedPaths: unsaved.unsavedPaths,
    }), [tracker.newPaths, modifiedFiles, pendingSave.pendingSavePaths, unsaved.unsavedPaths])

  return {
    entries, folders, isLoading, isReloading: vaultReloads.isReloading, views, modifiedFiles, modifiedFilesError,
    ...entryMutations,
    loadModifiedFiles,
    ...gitLoaders,
    getNoteStatus,
    reloadVault: vaultReloads.reloadVault,
    reloadFolders: vaultReloads.reloadFolders,
    reloadViews: vaultReloads.reloadViews,
    addPendingSave: pendingSave.addPendingSave,
    removePendingSave: pendingSave.removePendingSave,
    unsavedPaths: unsaved.unsavedPaths,
    trackUnsaved: unsaved.trackUnsaved,
    clearUnsaved: unsaved.clearUnsaved,
  }
}
