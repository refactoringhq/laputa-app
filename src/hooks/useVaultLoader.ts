import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { VaultEntry, FolderNode, GitCommit, ModifiedFile, NoteStatus, GitPushResult, ViewFile } from '../types'
import type { VaultOption } from '../components/status-bar/types'
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
  loadMountedVaultFolders,
  loadVaultFolders,
  loadVaultViews,
  loadWorkspaceEntries,
  reloadVaultEntries,
  tauriCall,
} from './vaultLoaderCommands'
import { normalizeVaultEntry } from '../utils/vaultMetadataNormalization'
import { useUnavailableVaultState } from './useUnavailableVaultState'
import { resetVaultState } from './vaultStateReset'
import {
  initialVaultsForPath,
  loadedWorkspacePathsFromEntries,
  pruneEntriesOutsideWorkspaceSet,
  replaceLoadedWorkspaceEntries,
  replaceWorkspaceEntries,
  retagEntriesForWorkspaceMetadata,
  uniqueWorkspacePathsFromVaults,
  workspacePathSetKey,
} from './vaultWorkspaceEntries'

interface InitialVaultLoadStateOptions {
  defaultWorkspacePath?: string | null
  handleVaultAvailable: (path: string) => void
  path: string
  handleVaultUnavailable: (path: string) => void
  isCurrentVaultPath: (path: string) => boolean
  setEntries: Dispatch<SetStateAction<VaultEntry[]>>
  setFolders: (folders: FolderNode[]) => void
  setIsLoading: (isLoading: boolean) => void
  setViews: (views: ViewFile[]) => void
  vaults?: VaultOption[]
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
  'defaultWorkspacePath' | 'handleVaultAvailable' | 'handleVaultUnavailable' | 'isCurrentVaultPath' | 'path' | 'setEntries' | 'vaults'
>): Promise<boolean> {
  const { handleVaultAvailable, handleVaultUnavailable, isCurrentVaultPath, path, setEntries } = options

  try {
    const { entries } = await loadVaultData({
      vaultPath: path,
      vaults: initialVaultsForPath(path, options.vaults),
      defaultWorkspacePath: options.defaultWorkspacePath,
      forceReload: true,
    })
    if (isCurrentVaultPath(path)) {
      handleVaultAvailable(path)
      setEntries((currentEntries) => replaceLoadedWorkspaceEntries({
        defaultWorkspacePath: options.defaultWorkspacePath,
        entries: currentEntries,
        fallbackVaultPath: path,
        loadedEntries: entries,
        vaults: options.vaults,
      }))
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

function useCoalescedAsyncTask<T>(runTask: () => Promise<T>) {
  const inFlightRef = useRef<Promise<T> | null>(null)
  const requestedDuringFlightRef = useRef(false)
  const latestTaskRef = useRef<(() => Promise<T>) | null>(null)

  const task = useCallback(async () => {
    if (inFlightRef.current) {
      requestedDuringFlightRef.current = true
      return inFlightRef.current
    }

    const next = (async () => {
      try {
        return await runTask()
      } finally {
        inFlightRef.current = null
        if (requestedDuringFlightRef.current) {
          requestedDuringFlightRef.current = false
          void latestTaskRef.current?.()
        }
      }
    })()
    inFlightRef.current = next
    return next
  }, [runTask])

  useEffect(() => {
    latestTaskRef.current = task
  }, [task])

  return task
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
  defaultWorkspacePath?: string | null
  handleVaultAvailable: (path: string) => void
  handleVaultUnavailable: (path: string) => void
  isWorkspacePathLoaded: (path: string) => boolean
  vaultPath: string
  vaults?: VaultOption[]
  tracker: ReturnType<typeof useNewNoteTracker>
  unsaved: ReturnType<typeof useUnsavedTracker>
  isCurrentVaultPath: (path: string) => boolean
  resetReloading: () => void
  setEntries: Dispatch<SetStateAction<VaultEntry[]>>
  setFolders: (folders: FolderNode[]) => void
  setIsLoading: (isLoading: boolean) => void
  setModifiedFiles: (files: ModifiedFile[]) => void
  setModifiedFilesError: (message: string | null) => void
  setViews: (views: ViewFile[]) => void
}

interface InitialVaultLoadSnapshot {
  defaultWorkspacePath?: string | null
  vaults?: VaultOption[]
}

interface InitialVaultLoadEffectOptions extends Omit<InitialVaultLoadOptions, 'tracker' | 'unsaved'> {
  clearNewPaths: () => void
  clearUnsaved: () => void
}

function useInitialVaultLoadSnapshot(vaults?: VaultOption[], defaultWorkspacePath?: string | null) {
  const loadOptionsRef = useRef<InitialVaultLoadSnapshot>({ vaults, defaultWorkspacePath })

  useEffect(() => {
    loadOptionsRef.current = { vaults, defaultWorkspacePath }
  }, [defaultWorkspacePath, vaults])

  return loadOptionsRef
}

function shouldReuseLoadedWorkspaceEntries(
  path: string,
  loadOptions: InitialVaultLoadSnapshot,
  isWorkspacePathLoaded: (path: string) => boolean,
): boolean {
  return !!loadOptions.vaults?.length && isWorkspacePathLoaded(path)
}

function resetInitialVaultLoadState(options: InitialVaultLoadEffectOptions, reuseLoadedWorkspaceEntries: boolean) {
  clearPrefetchCache()
  options.setViews([])
  resetVaultState({
    clearNewPaths: options.clearNewPaths,
    clearUnsaved: options.clearUnsaved,
    setEntries: reuseLoadedWorkspaceEntries ? () => {} : options.setEntries,
    setFolders: options.setFolders,
    setIsLoading: options.setIsLoading,
    setModifiedFiles: options.setModifiedFiles,
    setModifiedFilesError: options.setModifiedFilesError,
    setViews: reuseLoadedWorkspaceEntries ? () => {} : options.setViews,
  })
  options.resetReloading()
}

function startReusableWorkspaceChromeLoad(
  options: InitialVaultLoadEffectOptions,
  path: string,
  isActivePath: (candidate: string) => boolean,
) {
  void loadInitialVaultChromeState({
    handleVaultUnavailable: options.handleVaultUnavailable,
    isCurrentVaultPath: isActivePath,
    path,
    setFolders: options.setFolders,
    setViews: options.setViews,
    shouldApplyChrome: () => isActivePath(path),
  })
}

function startFreshInitialVaultLoad(
  options: InitialVaultLoadEffectOptions,
  path: string,
  loadOptions: InitialVaultLoadSnapshot,
  isActivePath: (candidate: string) => boolean,
) {
  void loadInitialVaultState({
    handleVaultAvailable: options.handleVaultAvailable,
    path,
    handleVaultUnavailable: options.handleVaultUnavailable,
    isCurrentVaultPath: isActivePath,
    vaults: loadOptions.vaults,
    defaultWorkspacePath: loadOptions.defaultWorkspacePath,
    setEntries: options.setEntries,
    setFolders: options.setFolders,
    setIsLoading: options.setIsLoading,
    setViews: options.setViews,
  })
}

function useInitialVaultLoad(options: InitialVaultLoadOptions) {
  const {
    handleVaultAvailable,
    handleVaultUnavailable,
    isWorkspacePathLoaded,
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
    vaults,
    defaultWorkspacePath,
  } = options
  const loadOptionsRef = useInitialVaultLoadSnapshot(vaults, defaultWorkspacePath)

  useEffect(() => {
    const path = vaultPath
    const loadOptions = loadOptionsRef.current
    const effectOptions = {
      defaultWorkspacePath: loadOptions.defaultWorkspacePath, handleVaultAvailable, handleVaultUnavailable, isCurrentVaultPath,
      isWorkspacePathLoaded, resetReloading,
      clearNewPaths: tracker.clear,
      clearUnsaved: unsaved.clearAll,
      setEntries, setFolders, setIsLoading, setModifiedFiles, setModifiedFilesError, setViews,
      vaultPath, vaults: loadOptions.vaults,
    }
    const reuseLoadedWorkspaceEntries = shouldReuseLoadedWorkspaceEntries(path, loadOptions, isWorkspacePathLoaded)
    resetInitialVaultLoadState(effectOptions, reuseLoadedWorkspaceEntries)

    if (!hasVaultPath({ vaultPath: path })) return

    let cancelled = false
    const isActivePath = (candidate: string) => !cancelled && isCurrentVaultPath(candidate)
    if (reuseLoadedWorkspaceEntries) {
      startReusableWorkspaceChromeLoad(effectOptions, path, isActivePath)
      return () => { cancelled = true }
    }

    startFreshInitialVaultLoad(effectOptions, path, loadOptions, isActivePath)
    return () => { cancelled = true }
  }, [
    handleVaultAvailable,
    handleVaultUnavailable,
    vaultPath,
    tracker.clear,
    unsaved.clearAll,
    isCurrentVaultPath,
    isWorkspacePathLoaded,
    resetReloading,
    setEntries, setFolders, setIsLoading, setModifiedFiles, setModifiedFilesError, setViews,
    loadOptionsRef,
  ])
}

function useModifiedFilesLoader(vaultPath: string, isCurrentVaultPath: (path: string) => boolean) {
  const [modifiedFiles, setModifiedFiles] = useState<ModifiedFile[]>([])
  const [modifiedFilesError, setModifiedFilesError] = useState<string | null>(null)

  const runModifiedFilesLoad = useCallback(async () => {
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

  const loadModifiedFiles = useCoalescedAsyncTask(runModifiedFilesLoad)

  useEffect(() => { loadModifiedFiles() }, [loadModifiedFiles])

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
  defaultWorkspacePath?: string | null
  folderVaults?: VaultOption[]
  handleVaultAvailable: (path: string) => void
  handleVaultUnavailable: (path: string) => void
  vaultPath: string
  isCurrentVaultPath: (path: string) => boolean
  loadModifiedFiles: () => Promise<void>
  setEntries: (entries: VaultEntry[]) => void
  setFolders: (folders: FolderNode[]) => void
  setViews: (views: ViewFile[]) => void
  vaults?: VaultOption[]
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
  folderVaults,
  handleVaultUnavailable,
  isCurrentVaultPath,
  setFolders,
  vaultPath,
}: Pick<VaultReloadOptions, 'defaultWorkspacePath' | 'folderVaults' | 'handleVaultUnavailable' | 'isCurrentVaultPath' | 'setFolders' | 'vaultPath'>) {
  return useCallback(() => reloadVaultCollection({
    handleVaultUnavailable,
    isCurrentVaultPath,
    loadCollection: folderVaults?.length
      ? (options) => loadMountedVaultFolders({ ...options, vaults: folderVaults })
      : loadVaultFolders,
    path: vaultPath,
    setCollection: setFolders,
  }), [folderVaults, handleVaultUnavailable, vaultPath, isCurrentVaultPath, setFolders])
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
  vaults,
  defaultWorkspacePath,
}: EntryReloadOptions) {
  const runEntryReload = useCallback(async () => {
    const path = vaultPath
    if (!hasVaultPath({ vaultPath: path })) return [] as VaultEntry[]
    clearPrefetchCache()
    beginReload()
    try {
      const entries = await reloadVaultEntries({ vaultPath: path, vaults, defaultWorkspacePath })
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
  }, [handleVaultAvailable, handleVaultUnavailable, vaultPath, vaults, defaultWorkspacePath, beginReload, finishReload, loadModifiedFiles, isCurrentVaultPath, setEntries])

  return useCoalescedAsyncTask(runEntryReload)
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

function useInitialFolderSetter(folderVaults: VaultOption[] | undefined, setFolders: (folders: FolderNode[]) => void) {
  const folderVaultsRef = useRef(folderVaults)

  useEffect(() => {
    folderVaultsRef.current = folderVaults
  }, [folderVaults])

  return useCallback((nextFolders: FolderNode[]) => {
    if ((folderVaultsRef.current?.length ?? 0) === 0) setFolders(nextFolders)
  }, [setFolders])
}

function useVaultChromeReloadEffect(
  vaultPath: string,
  reloadFoldersForCurrentVault: () => Promise<FolderNode[]>,
  reloadViewsForCurrentVault: () => Promise<ViewFile[]>,
) {
  useEffect(() => {
    if (!hasVaultPath({ vaultPath })) return
    void Promise.all([
      reloadFoldersForCurrentVault(),
      reloadViewsForCurrentVault(),
    ])
  }, [vaultPath, reloadFoldersForCurrentVault, reloadViewsForCurrentVault])
}

interface WorkspaceLoadRefs {
  initialLoadedVaultPathRef: MutableRefObject<string | null>
  loadedWorkspacePathsRef: MutableRefObject<Set<string>>
  loadingWorkspacePathsRef: MutableRefObject<Set<string>>
}

function useDesiredWorkspacePaths(vaultPath: string, vaults?: VaultOption[]) {
  const desiredWorkspacePaths = useMemo(
    () => uniqueWorkspacePathsFromVaults(vaultPath, vaults),
    [vaultPath, vaults],
  )
  const desiredWorkspaceKey = useMemo(
    () => workspacePathSetKey(desiredWorkspacePaths),
    [desiredWorkspacePaths],
  )
  return { desiredWorkspaceKey, desiredWorkspacePaths }
}

function useWorkspaceLoadRefs() {
  const loadedWorkspacePathsRef = useRef<Set<string>>(new Set())
  const loadingWorkspacePathsRef = useRef<Set<string>>(new Set())
  const initialLoadedVaultPathRef = useRef<string | null>(null)
  const isWorkspacePathLoaded = useCallback((path: string) => (
    path.trim().length > 0 && loadedWorkspacePathsRef.current.has(path)
  ), [])

  return {
    initialLoadedVaultPathRef,
    isWorkspacePathLoaded,
    loadedWorkspacePathsRef,
    loadingWorkspacePathsRef,
  }
}

function keepDesiredWorkspacePaths(
  paths: Set<string>,
  desiredWorkspacePaths: readonly string[],
): Set<string> {
  const desiredPathSet = new Set(desiredWorkspacePaths)
  return new Set([...paths].filter((path) => desiredPathSet.has(path)))
}

function usePrunedWorkspaceLoadRefs(
  {
    loadedWorkspacePathsRef,
    loadingWorkspacePathsRef,
  }: Pick<WorkspaceLoadRefs, 'loadedWorkspacePathsRef' | 'loadingWorkspacePathsRef'>,
  desiredWorkspaceKey: string,
  desiredWorkspacePaths: readonly string[],
) {
  useEffect(() => {
    loadedWorkspacePathsRef.current = keepDesiredWorkspacePaths(
      loadedWorkspacePathsRef.current,
      desiredWorkspacePaths,
    )
    loadingWorkspacePathsRef.current = keepDesiredWorkspacePaths(
      loadingWorkspacePathsRef.current,
      desiredWorkspacePaths,
    )
  }, [desiredWorkspaceKey, desiredWorkspacePaths, loadedWorkspacePathsRef, loadingWorkspacePathsRef])
}

function useInitialLoadedWorkspaceMarker({
  entries,
  initialLoadedVaultPathRef,
  isLoading,
  loadedWorkspacePathsRef,
  vaultPath,
}: {
  entries: VaultEntry[]
  initialLoadedVaultPathRef: MutableRefObject<string | null>
  isLoading: boolean
  loadedWorkspacePathsRef: MutableRefObject<Set<string>>
  vaultPath: string
}) {
  useEffect(() => {
    if (isLoading || !hasVaultPath({ vaultPath }) || initialLoadedVaultPathRef.current === vaultPath) return
    initialLoadedVaultPathRef.current = vaultPath
    loadedWorkspacePathsRef.current = new Set([
      ...loadedWorkspacePathsRef.current,
      ...loadedWorkspacePathsFromEntries(entries, vaultPath),
    ])
  }, [entries, initialLoadedVaultPathRef, isLoading, loadedWorkspacePathsRef, vaultPath])
}

function useWorkspaceMetadataRetagEffect({
  defaultWorkspacePath,
  desiredWorkspaceKey,
  desiredWorkspacePaths,
  setEntries,
  vaultPath,
  vaults,
}: {
  defaultWorkspacePath?: string | null
  desiredWorkspaceKey: string
  desiredWorkspacePaths: readonly string[]
  setEntries: Dispatch<SetStateAction<VaultEntry[]>>
  vaultPath: string
  vaults?: VaultOption[]
}) {
  useEffect(() => {
    if (!hasVaultPath({ vaultPath })) return

    setEntries((currentEntries) => retagEntriesForWorkspaceMetadata({
      defaultWorkspacePath,
      entries: pruneEntriesOutsideWorkspaceSet({
        desiredPaths: desiredWorkspacePaths,
        entries: currentEntries,
        fallbackVaultPath: vaultPath,
      }),
      fallbackVaultPath: vaultPath,
      vaults,
    }))
  }, [defaultWorkspacePath, desiredWorkspaceKey, desiredWorkspacePaths, setEntries, vaultPath, vaults])
}

function missingWorkspaceVaults({
  desiredWorkspacePaths,
  loadedPaths,
  loadingPaths,
  vaults,
}: {
  desiredWorkspacePaths: readonly string[]
  loadedPaths: Set<string>
  loadingPaths: Set<string>
  vaults?: VaultOption[]
}): VaultOption[] {
  if (!vaults?.length) return []
  return vaults.filter((vault) => (
    desiredWorkspacePaths.includes(vault.path)
    && !loadedPaths.has(vault.path)
    && !loadingPaths.has(vault.path)
  ))
}

function loadMissingWorkspaceEntries({
  defaultWorkspacePath,
  isCurrentVaultPath,
  loadedPaths,
  loadingPaths,
  setEntries,
  vault,
  vaultPath,
  vaults,
}: {
  defaultWorkspacePath?: string | null
  isCurrentVaultPath: (path: string) => boolean
  loadedPaths: Set<string>
  loadingPaths: Set<string>
  setEntries: Dispatch<SetStateAction<VaultEntry[]>>
  vault: VaultOption
  vaultPath: string
  vaults?: VaultOption[]
}) {
  void loadWorkspaceEntries(vault, defaultWorkspacePath)
    .then((loadedEntries) => {
      if (!isCurrentVaultPath(vaultPath)) return
      loadedPaths.add(vault.path)
      setEntries((currentEntries) => replaceWorkspaceEntries({
        defaultWorkspacePath,
        entries: currentEntries,
        fallbackVaultPath: vaultPath,
        loadedEntries,
        loadedWorkspacePath: vault.path,
        vaults,
      }))
    })
    .catch((error: unknown) => {
      console.warn(`Failed to load workspace entries for ${vault.path}:`, error)
    })
    .finally(() => {
      loadingPaths.delete(vault.path)
    })
}

function useMissingWorkspaceLoads({
  defaultWorkspacePath,
  desiredWorkspaceKey,
  desiredWorkspacePaths,
  isCurrentVaultPath,
  isLoading,
  loadedWorkspacePathsRef,
  loadingWorkspacePathsRef,
  setEntries,
  vaultPath,
  vaults,
}: {
  defaultWorkspacePath?: string | null
  desiredWorkspaceKey: string
  desiredWorkspacePaths: readonly string[]
  isCurrentVaultPath: (path: string) => boolean
  isLoading: boolean
  loadedWorkspacePathsRef: MutableRefObject<Set<string>>
  loadingWorkspacePathsRef: MutableRefObject<Set<string>>
  setEntries: Dispatch<SetStateAction<VaultEntry[]>>
  vaultPath: string
  vaults?: VaultOption[]
}) {
  useEffect(() => {
    if (!hasVaultPath({ vaultPath }) || !vaults?.length || isLoading) return

    const loadedPaths = loadedWorkspacePathsRef.current
    const loadingPaths = loadingWorkspacePathsRef.current
    const missingVaults = missingWorkspaceVaults({ desiredWorkspacePaths, loadedPaths, loadingPaths, vaults })
    if (missingVaults.length === 0) return

    for (const vault of missingVaults) loadingPaths.add(vault.path)
    for (const vault of missingVaults) {
      loadMissingWorkspaceEntries({
        defaultWorkspacePath,
        isCurrentVaultPath,
        loadedPaths,
        loadingPaths,
        setEntries,
        vault,
        vaultPath,
        vaults,
      })
    }
  }, [
    defaultWorkspacePath,
    desiredWorkspaceKey,
    desiredWorkspacePaths,
    isCurrentVaultPath,
    isLoading,
    loadedWorkspacePathsRef,
    loadingWorkspacePathsRef,
    setEntries,
    vaultPath,
    vaults,
  ])
}

function useWorkspaceEntrySync({
  defaultWorkspacePath,
  entries,
  isCurrentVaultPath,
  isLoading,
  setEntries,
  vaultPath,
  vaults,
}: {
  defaultWorkspacePath?: string | null
  entries: VaultEntry[]
  isCurrentVaultPath: (path: string) => boolean
  isLoading: boolean
  setEntries: Dispatch<SetStateAction<VaultEntry[]>>
  vaultPath: string
  vaults?: VaultOption[]
}) {
  const { desiredWorkspaceKey, desiredWorkspacePaths } = useDesiredWorkspacePaths(vaultPath, vaults)
  const refs = useWorkspaceLoadRefs()

  usePrunedWorkspaceLoadRefs(refs, desiredWorkspaceKey, desiredWorkspacePaths)
  useInitialLoadedWorkspaceMarker({ entries, vaultPath, isLoading, ...refs })
  useWorkspaceMetadataRetagEffect({
    defaultWorkspacePath,
    desiredWorkspaceKey,
    desiredWorkspacePaths,
    setEntries,
    vaultPath,
    vaults,
  })
  useMissingWorkspaceLoads({
    defaultWorkspacePath,
    desiredWorkspaceKey,
    desiredWorkspacePaths,
    isCurrentVaultPath,
    isLoading,
    setEntries,
    vaultPath,
    vaults,
    ...refs,
  })

  return refs.isWorkspacePathLoaded
}

interface VaultLoaderResultOptions {
  entryMutations: ReturnType<typeof useEntryMutations>
  gitLoaders: ReturnType<typeof useGitLoaders>
  state: ReturnType<typeof useVaultState>
  unavailableVault: ReturnType<typeof useVaultUnavailable>
  vaultReloads: ReturnType<typeof useVaultReloads>
}

function useVaultLoaderResult({
  entryMutations,
  gitLoaders,
  state,
  unavailableVault,
  vaultReloads,
}: VaultLoaderResultOptions) {
  const { modified, pendingSave, tracker, unsaved } = state
  const getNoteStatus = useCallback((path: string): NoteStatus =>
    resolveNoteStatus({
      path,
      newPaths: tracker.newPaths,
      modifiedFiles: modified.modifiedFiles,
      pendingSavePaths: pendingSave.pendingSavePaths,
      unsavedPaths: unsaved.unsavedPaths,
    }), [tracker.newPaths, modified.modifiedFiles, pendingSave.pendingSavePaths, unsaved.unsavedPaths])

  return {
    entries: state.entries,
    folders: state.folders,
    isLoading: state.isLoading,
    isReloading: vaultReloads.isReloading,
    views: state.views,
    modifiedFiles: modified.modifiedFiles,
    modifiedFilesError: modified.modifiedFilesError,
    unavailableVaultPath: unavailableVault.unavailableVaultPath,
    ...entryMutations,
    loadModifiedFiles: modified.loadModifiedFiles,
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

export function useVaultLoader(vaultPath: string, vaults?: VaultOption[], defaultWorkspacePath?: string | null, folderVaults?: VaultOption[]) {
  const state = useVaultState(vaultPath)
  const setInitialFolders = useInitialFolderSetter(folderVaults, state.setFolders)
  const entryMutations = useEntryMutations(state.setEntries, state.tracker.trackNew)
  const gitLoaders = useGitLoaders(vaultPath)
  const unavailableVault = useVaultUnavailable(vaultPath, state)
  const vaultReloads = useVaultReloads({
    handleVaultAvailable: unavailableVault.markVaultAvailable,
    handleVaultUnavailable: unavailableVault.markVaultUnavailable,
    defaultWorkspacePath,
    folderVaults,
    vaultPath,
    vaults,
    isCurrentVaultPath: state.isCurrentVaultPath,
    loadModifiedFiles: state.modified.loadModifiedFiles,
    setEntries: state.setEntries,
    setFolders: state.setFolders,
    setViews: state.setViews,
  })

  useGitignoredVisibilityReloads(vaultReloads)
  useVaultChromeReloadEffect(vaultPath, vaultReloads.reloadFolders, vaultReloads.reloadViews)

  const isWorkspacePathLoaded = useWorkspaceEntrySync({
    defaultWorkspacePath,
    entries: state.entries,
    isCurrentVaultPath: state.isCurrentVaultPath,
    isLoading: state.isLoading,
    setEntries: state.setEntries,
    vaultPath,
    vaults,
  })

  useInitialVaultLoad({
    handleVaultAvailable: unavailableVault.markVaultAvailable,
    handleVaultUnavailable: unavailableVault.markVaultUnavailable,
    vaultPath,
    vaults,
    defaultWorkspacePath,
    isWorkspacePathLoaded,
    tracker: state.tracker,
    unsaved: state.unsaved,
    isCurrentVaultPath: state.isCurrentVaultPath,
    resetReloading: vaultReloads.resetReloading,
    setEntries: state.setEntries,
    setFolders: setInitialFolders,
    setIsLoading: state.setIsLoading,
    setModifiedFiles: state.modified.setModifiedFiles,
    setModifiedFilesError: state.modified.setModifiedFilesError,
    setViews: state.setViews,
  })

  return useVaultLoaderResult({ entryMutations, gitLoaders, state, unavailableVault, vaultReloads })
}
