import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { VaultEntry, FolderNode, GitCommit, ModifiedFile, NoteStatus, GitPushResult, ViewFile } from '../types'
import {
  GITIGNORED_VISIBILITY_CHANGED_EVENT,
  notifyGitignoredVisibilityApplied,
  type GitignoredVisibilityChangedEvent,
} from '../lib/gitignoredVisibilityEvents'
import { clearPrefetchCache } from './useTabManagement'
import {
  checkVaultPathAvailability,
  commitWithPush,
  hasVaultPath,
  loadVaultChrome,
  loadVaultData,
  loadVaultFolders,
  loadVaultViews,
  reloadVaultEntries,
  tauriCall,
} from './vaultLoaderCommands'
import { normalizeVaultEntry } from '../utils/vaultMetadataNormalization'
import { useUnavailableVaultState } from './useUnavailableVaultState'
import { resetVaultState } from './vaultStateReset'

interface InitialVaultLoadStateOptions {
  handleVaultAvailable: (path: string) => void
  path: string
  handleVaultUnavailable: (path: string) => void
  isCurrentVaultPath: (path: string) => boolean
  setEntries: (entries: VaultEntry[]) => void
  setFolders: (folders: FolderNode[]) => void
  setIsLoading: (isLoading: boolean) => void
  setViews: (views: ViewFile[]) => void
}

interface InitialVaultChromeOptions extends Pick<
  InitialVaultLoadStateOptions,
  'handleVaultUnavailable' | 'isCurrentVaultPath' | 'path' | 'setFolders' | 'setViews'
> {
  shouldApplyChrome: () => boolean
}

async function loadInitialVaultChromeState(options: InitialVaultChromeOptions): Promise<boolean> {
  const { handleVaultUnavailable, isCurrentVaultPath, path, setFolders, setViews, shouldApplyChrome } = options
  try {
    const { folders, views } = await loadVaultChrome({ vaultPath: path })
    if (shouldApplyChrome()) {
      setFolders(folders)
      setViews(views)
    }
  } catch (err) {
    const unavailable = await handleUnavailableVaultPath({ handleVaultUnavailable, isCurrentVaultPath, path })
    if (unavailable) return true
    console.warn('Vault chrome load failed:', err)
  }
  return false
}

async function loadInitialVaultEntriesState(options: Pick<
  InitialVaultLoadStateOptions,
  'handleVaultAvailable' | 'handleVaultUnavailable' | 'isCurrentVaultPath' | 'path' | 'setEntries'
>): Promise<boolean> {
  const { handleVaultAvailable, handleVaultUnavailable, isCurrentVaultPath, path, setEntries } = options

  try {
    const { entries } = await loadVaultData({ vaultPath: path })
    if (isCurrentVaultPath(path)) {
      handleVaultAvailable(path)
      setEntries(entries)
    }
  } catch (err) {
    const unavailable = await handleUnavailableVaultPath({ handleVaultUnavailable, isCurrentVaultPath, path })
    if (unavailable) return true
    console.warn('Vault scan failed:', err)
  }
  return false
}

async function loadInitialVaultState(options: InitialVaultLoadStateOptions) {
  const { path, isCurrentVaultPath, setIsLoading } = options
  let vaultUnavailable = false
  const chromeLoad = loadInitialVaultChromeState({
    ...options,
    shouldApplyChrome: () => !vaultUnavailable && isCurrentVaultPath(path),
  })

  setIsLoading(true)
  vaultUnavailable = await loadInitialVaultEntriesState(options)
  if (isCurrentVaultPath(path)) setIsLoading(false)
  await chromeLoad
}

async function handleUnavailableVaultPath(options: {
  handleVaultUnavailable: (path: string) => void
  isCurrentVaultPath: (path: string) => boolean
  path: string
}): Promise<boolean> {
  const { handleVaultUnavailable, isCurrentVaultPath, path } = options
  if (!isCurrentVaultPath(path)) return true

  const available = await checkVaultPathAvailability({ vaultPath: path })
  if (available !== false) return false
  if (isCurrentVaultPath(path)) handleVaultUnavailable(path)
  return true
}

function useCurrentVaultPathGuard(vaultPath: string) {
  const currentPathRef = useRef(vaultPath)

  useEffect(() => {
    currentPathRef.current = vaultPath
  }, [vaultPath])

  return useCallback((path: string) => currentPathRef.current === path, [])
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

interface InitialVaultLoadOptions {
  handleVaultAvailable: (path: string) => void
  handleVaultUnavailable: (path: string) => void
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
}

function useInitialVaultLoad(options: InitialVaultLoadOptions) {
  const {
    handleVaultAvailable,
    handleVaultUnavailable,
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
  } = options

  useEffect(() => {
    const path = vaultPath
    clearPrefetchCache()
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

    if (!hasVaultPath({ vaultPath: path })) return

    let cancelled = false
    void loadInitialVaultState({
      handleVaultAvailable,
      path,
      handleVaultUnavailable,
      isCurrentVaultPath: (candidate) => !cancelled && isCurrentVaultPath(candidate),
      setEntries,
      setFolders,
      setIsLoading,
      setViews,
    })
    return () => { cancelled = true }
  }, [
    handleVaultAvailable,
    handleVaultUnavailable,
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

    if (!hasVaultPath({ vaultPath: path })) {
      setModifiedFiles([])
      return
    }

    try {
      const files = await tauriCall<ModifiedFile[]>({
        command: 'get_modified_files',
        tauriArgs: { vaultPath: path },
        mockArgs: {},
      })
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
    const normalizedEntry = normalizeVaultEntry(entry)
    setEntries((prev) => {
      if (prev.some(e => e.path === normalizedEntry.path)) return prev
      return [normalizedEntry, ...prev]
    })
    trackNew(normalizedEntry.path)
  }, [setEntries, trackNew])

  const updateEntry = useCallback((path: string, patch: Partial<VaultEntry>) => {
    setEntries((prev) => {
      let changed = false
      const next = prev.map((entry, index) => {
        if (entry.path === path) {
          changed = true
          return normalizeVaultEntry({ ...entry, ...patch }, '', index)
        }
        return entry
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
    setEntries((prev) => prev.map((entry, index) =>
      entry.path === oldPath ? normalizeVaultEntry({ ...entry, ...patch }, '', index) : entry,
    ))
  }, [setEntries])

  return { addEntry, updateEntry, removeEntry, removeEntries, replaceEntry }
}

function useGitLoaders(vaultPath: string) {
  const loadGitHistory = useCallback(async (path: string): Promise<GitCommit[]> => {
    try {
      return await tauriCall<GitCommit[]>({
        command: 'get_file_history',
        tauriArgs: { vaultPath, path },
        mockArgs: { path },
      })
    }
    catch (err) { console.warn('Failed to load git history:', err); return [] }
  }, [vaultPath])

  const loadDiffAtCommit = useCallback((path: string, commitHash: string): Promise<string> =>
    tauriCall<string>({
      command: 'get_file_diff_at_commit',
      tauriArgs: { vaultPath, path, commitHash },
      mockArgs: { path, commitHash },
    }), [vaultPath])

  const loadDiff = useCallback((path: string): Promise<string> =>
    tauriCall<string>({
      command: 'get_file_diff',
      tauriArgs: { vaultPath, path },
      mockArgs: { path },
    }), [vaultPath])

  const commitAndPush = useCallback((message: string): Promise<GitPushResult> =>
    commitWithPush({ vaultPath, message }), [vaultPath])

  return { loadGitHistory, loadDiffAtCommit, loadDiff, commitAndPush }
}

interface VaultReloadOptions {
  handleVaultAvailable: (path: string) => void
  handleVaultUnavailable: (path: string) => void
  vaultPath: string
  isCurrentVaultPath: (path: string) => boolean
  loadModifiedFiles: () => Promise<void>
  setEntries: (entries: VaultEntry[]) => void
  setFolders: (folders: FolderNode[]) => void
  setViews: (views: ViewFile[]) => void
}

interface EntryReloadOptions extends VaultReloadOptions {
  beginReload: () => void
  finishReload: () => void
}

interface CollectionReloadOptions<T> {
  handleVaultUnavailable: (path: string) => void
  isCurrentVaultPath: (path: string) => boolean
  loadCollection: (options: { vaultPath: string }) => Promise<T[]>
  path: string
  setCollection: (items: T[]) => void
}

async function reloadVaultCollection<T>(options: CollectionReloadOptions<T>): Promise<T[]> {
  const { handleVaultUnavailable, isCurrentVaultPath, loadCollection, path, setCollection } = options
  if (!hasVaultPath({ vaultPath: path })) return []
  try {
    const items = await loadCollection({ vaultPath: path })
    if (!isCurrentVaultPath(path)) return []
    const nextItems = items ?? []
    setCollection(nextItems)
    return nextItems
  } catch {
    await handleUnavailableVaultPath({ handleVaultUnavailable, isCurrentVaultPath, path })
    return []
  }
}

function useFolderReload({
  handleVaultUnavailable,
  isCurrentVaultPath,
  setFolders,
  vaultPath,
}: Pick<VaultReloadOptions, 'handleVaultUnavailable' | 'isCurrentVaultPath' | 'setFolders' | 'vaultPath'>) {
  return useCallback(() => reloadVaultCollection({
    handleVaultUnavailable,
    isCurrentVaultPath,
    loadCollection: loadVaultFolders,
    path: vaultPath,
    setCollection: setFolders,
  }), [handleVaultUnavailable, vaultPath, isCurrentVaultPath, setFolders])
}

function useEntryReload({
  beginReload,
  finishReload,
  handleVaultAvailable,
  handleVaultUnavailable,
  isCurrentVaultPath,
  loadModifiedFiles,
  setEntries,
  vaultPath,
}: EntryReloadOptions) {
  return useCallback(async () => {
    const path = vaultPath
    if (!hasVaultPath({ vaultPath: path })) return [] as VaultEntry[]
    clearPrefetchCache()
    beginReload()
    try {
      const entries = await reloadVaultEntries({ vaultPath: path })
      if (!isCurrentVaultPath(path)) return [] as VaultEntry[]
      handleVaultAvailable(path)
      setEntries(entries)
      void loadModifiedFiles()
      return entries
    } catch (err) {
      if (await handleUnavailableVaultPath({ handleVaultUnavailable, isCurrentVaultPath, path })) return [] as VaultEntry[]
      console.warn('Vault reload failed:', err)
      return [] as VaultEntry[]
    } finally {
      finishReload()
    }
  }, [handleVaultAvailable, handleVaultUnavailable, vaultPath, beginReload, finishReload, loadModifiedFiles, isCurrentVaultPath, setEntries])
}

function useViewReload({
  handleVaultUnavailable,
  isCurrentVaultPath,
  setViews,
  vaultPath,
}: Pick<VaultReloadOptions, 'handleVaultUnavailable' | 'isCurrentVaultPath' | 'setViews' | 'vaultPath'>) {
  return useCallback(() => reloadVaultCollection({
    handleVaultUnavailable,
    isCurrentVaultPath,
    loadCollection: loadVaultViews,
    path: vaultPath,
    setCollection: setViews,
  }), [handleVaultUnavailable, vaultPath, isCurrentVaultPath, setViews])
}

function useVaultReloads(options: VaultReloadOptions) {
  const [activeReloads, setActiveReloads] = useState(0)
  const isReloading = activeReloads > 0
  const beginReload = useCallback(() => setActiveReloads((count) => count + 1), [])
  const finishReload = useCallback(() => setActiveReloads((count) => Math.max(0, count - 1)), [])
  const resetReloading = useCallback(() => setActiveReloads(0), [])
  const reloadFolders = useFolderReload(options)
  const reloadVault = useEntryReload({ ...options, beginReload, finishReload })
  const reloadViews = useViewReload(options)

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

function useVaultState(vaultPath: string) {
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [folders, setFolders] = useState<FolderNode[]>([])
  const [isLoading, setIsLoading] = useState(() => hasVaultPath({ vaultPath }))
  const [views, setViews] = useState<ViewFile[]>([])
  const tracker = useNewNoteTracker()
  const pendingSave = usePendingSaveTracker()
  const unsaved = useUnsavedTracker()
  const isCurrentVaultPath = useCurrentVaultPathGuard(vaultPath)
  const modified = useModifiedFilesLoader(vaultPath, isCurrentVaultPath)

  return {
    entries,
    folders,
    isCurrentVaultPath,
    isLoading,
    modified,
    pendingSave,
    setEntries,
    setFolders,
    setIsLoading,
    setViews,
    tracker,
    unsaved,
    views,
  }
}

function useVaultUnavailable(vaultPath: string, state: ReturnType<typeof useVaultState>) {
  const {
    isCurrentVaultPath,
    modified,
    setEntries,
    setFolders,
    setIsLoading,
    setViews,
    tracker,
    unsaved,
  } = state

  return useUnavailableVaultState({
    clearNewPaths: tracker.clear,
    clearUnsaved: unsaved.clearAll,
    isCurrentVaultPath,
    setEntries,
    setFolders,
    setIsLoading,
    setModifiedFiles: modified.setModifiedFiles,
    setModifiedFilesError: modified.setModifiedFilesError,
    setViews,
    vaultPath,
  })
}

export function useVaultLoader(vaultPath: string) {
  const state = useVaultState(vaultPath)
  const { entries, folders, isCurrentVaultPath, isLoading, modified, pendingSave, setEntries, setFolders, setIsLoading, setViews, tracker, unsaved, views } = state
  const {
    modifiedFiles,
    modifiedFilesError,
    setModifiedFiles,
    setModifiedFilesError,
    loadModifiedFiles,
  } = modified
  const entryMutations = useEntryMutations(setEntries, tracker.trackNew)
  const gitLoaders = useGitLoaders(vaultPath)
  const unavailableVault = useVaultUnavailable(vaultPath, state)
  const vaultReloads = useVaultReloads({
    handleVaultAvailable: unavailableVault.markVaultAvailable,
    handleVaultUnavailable: unavailableVault.markVaultUnavailable,
    vaultPath,
    isCurrentVaultPath,
    loadModifiedFiles,
    setEntries,
    setFolders,
    setViews,
  })
  useGitignoredVisibilityReloads(vaultReloads)

  useInitialVaultLoad({
    handleVaultAvailable: unavailableVault.markVaultAvailable,
    handleVaultUnavailable: unavailableVault.markVaultUnavailable,
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
    unavailableVaultPath: unavailableVault.unavailableVaultPath,
    ...entryMutations,
    loadModifiedFiles,
    ...gitLoaders,
    getNoteStatus,
    reloadVault: vaultReloads.reloadVault,
    reloadFolders: vaultReloads.reloadFolders,
    reloadViews: vaultReloads.reloadViews,
    markVaultUnavailable: unavailableVault.markVaultUnavailable,
    addPendingSave: pendingSave.addPendingSave,
    removePendingSave: pendingSave.removePendingSave,
    unsavedPaths: unsaved.unsavedPaths,
    trackUnsaved: unsaved.trackUnsaved,
    clearUnsaved: unsaved.clearUnsaved,
  }
}
