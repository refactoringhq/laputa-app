import { useCallback, useEffect, useRef, useState } from 'react'
import type { VaultEntry } from '../types'
import {
  beginNoteOpenTrace,
  failNoteOpenTrace,
  finishNoteOpenTrace,
  markNoteOpenTrace,
} from '../utils/noteOpenPerformance'
import {
  cacheNoteContent as cacheNoteContentInMemory,
  clearNoteContentCache,
  getCachedNoteContentEntry,
  hasResolvedCachedContent,
  isNoActiveVaultSelectedError,
  isUnreadableNoteContentError,
  loadContentForOpen,
  NOTE_CONTENT_CACHE_LIMIT,
  NOTE_CONTENT_CACHE_MAX_BYTES,
  NOTE_CONTENT_ENTRY_MAX_BYTES,
  prefetchNoteContent as prefetchNoteContentInMemory,
} from './noteContentCache'
import { clearParsedNoteBlockCache } from './editorParsedBlockCache'

interface Tab {
  entry: VaultEntry
  content: string
}

export {
  NOTE_CONTENT_CACHE_LIMIT,
  NOTE_CONTENT_CACHE_MAX_BYTES,
  NOTE_CONTENT_ENTRY_MAX_BYTES,
}

export function prefetchNoteContent(target: string | VaultEntry): void {
  prefetchNoteContentInMemory(target)
}

export function cacheNoteContent(path: string, content: string, entry?: VaultEntry): void {
  cacheNoteContentInMemory(path, content, entry)
}

/** Clear note-open caches. Call on vault reload to prevent stale content. */
export function clearPrefetchCache(): void {
  clearNoteContentCache()
  clearParsedNoteBlockCache()
}

export type { Tab }

interface TabManagementOptions {
  beforeNavigate?: (fromPath: string, toPath: string) => Promise<void>
  hasUnsavedChanges?: (path: string) => boolean
  onMissingActiveVault?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onMissingNotePath?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onUnreadableNoteContent?: (entry: VaultEntry, error: unknown) => void | Promise<void>
}

interface NavigateToEntryOptions {
  entry: VaultEntry
  forceReload?: boolean
  navSeqRef: React.MutableRefObject<number>
  tabsRef: React.MutableRefObject<Tab[]>
  activeTabPathRef: React.MutableRefObject<string | null>
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>
  hasUnsavedChanges?: (path: string) => boolean
  onMissingActiveVault?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onMissingNotePath?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onUnreadableNoteContent?: (entry: VaultEntry, error: unknown) => void | Promise<void>
}

function syncActiveTabPath(
  activeTabPathRef: React.MutableRefObject<string | null>,
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>,
  path: string | null,
) {
  activeTabPathRef.current = path
  setActiveTabPath(path)
}

function resetRequestedPathIfStillPending(
  requestedActiveTabPathRef: React.MutableRefObject<string | null>,
  activeTabPathRef: React.MutableRefObject<string | null>,
  pendingPath: string,
) {
  if (requestedActiveTabPathRef.current === pendingPath) {
    requestedActiveTabPathRef.current = activeTabPathRef.current
  }
}

function normalizeComparablePath(path: string): string {
  return path
    .replaceAll('\\', '/')
    .replace(/^\/private\/tmp(?=\/|$)/u, '/tmp')
    .replace(/\/+$/u, '')
}

function pathsMatch(leftPath: string | null, rightPath: string | null): boolean {
  if (!leftPath || !rightPath) return false
  return normalizeComparablePath(leftPath) === normalizeComparablePath(rightPath)
}

function setSingleTab(
  tabsRef: React.MutableRefObject<Tab[]>,
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  nextTab: Tab,
) {
  tabsRef.current = [nextTab]
  setTabs([nextTab])
}

function clearTabs(
  tabsRef: React.MutableRefObject<Tab[]>,
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
) {
  tabsRef.current = []
  setTabs([])
}

function isAlreadyViewingPath(
  tabsRef: React.MutableRefObject<Tab[]>,
  activeTabPathRef: React.MutableRefObject<string | null>,
  path: string,
) {
  return pathsMatch(activeTabPathRef.current, path)
    || tabsRef.current.some((tab) => pathsMatch(tab.entry.path, path))
}

function startEntryNavigation(options: {
  entry: VaultEntry
  navSeqRef: React.MutableRefObject<number>
  activeTabPathRef: React.MutableRefObject<string | null>
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const {
    entry,
    navSeqRef,
    activeTabPathRef,
    setActiveTabPath,
  } = options

  const seq = ++navSeqRef.current
  const cachedEntry = getCachedNoteContentEntry(entry.path)
  syncActiveTabPath(activeTabPathRef, setActiveTabPath, entry.path)
  if (hasResolvedCachedContent(cachedEntry)) {
    markNoteOpenTrace(entry.path, 'cacheReady')
  }

  return { seq, cachedEntry }
}

function openBinaryEntry(options: {
  entry: VaultEntry
  navSeqRef: React.MutableRefObject<number>
  tabsRef: React.MutableRefObject<Tab[]>
  activeTabPathRef: React.MutableRefObject<string | null>
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const {
    entry,
    navSeqRef,
    tabsRef,
    activeTabPathRef,
    setTabs,
    setActiveTabPath,
  } = options

  navSeqRef.current += 1
  syncActiveTabPath(activeTabPathRef, setActiveTabPath, entry.path)
  setSingleTab(tabsRef, setTabs, { entry, content: '' })
  finishNoteOpenTrace(entry.path)
}

function isMissingNotePathError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : String(error)
  return /does not exist|not found|enoent/i.test(message)
}

function shouldApplyLoadedEntry(options: {
  seq: number
  navSeqRef: React.MutableRefObject<number>
  content: string
  forceReload: boolean
  activeTabPathRef: React.MutableRefObject<string | null>
  tabsRef: React.MutableRefObject<Tab[]>
  path: string
}) {
  const {
    seq,
    navSeqRef,
    content,
    forceReload,
    activeTabPathRef,
    tabsRef,
    path,
  } = options

  if (navSeqRef.current !== seq) return false
  if (forceReload) return true
  if (!pathsMatch(activeTabPathRef.current, path)) return true
  const openTab = tabsRef.current.find((tab) => pathsMatch(tab.entry.path, path))
  return !openTab || openTab.content !== content
}

type EntryLoadFailureKind =
  | 'missing-active-vault'
  | 'missing-path'
  | 'unreadable-content'
  | 'load-failed'

type RecoverableEntryLoadFailureKind = Exclude<EntryLoadFailureKind, 'load-failed'>

function getEntryLoadFailureKind(error: unknown): EntryLoadFailureKind {
  if (isNoActiveVaultSelectedError(error)) return 'missing-active-vault'
  if (isMissingNotePathError(error)) return 'missing-path'
  if (isUnreadableNoteContentError(error)) return 'unreadable-content'
  return 'load-failed'
}

function resetFailedEntrySelection(options: {
  tabsRef: React.MutableRefObject<Tab[]>
  activeTabPathRef: React.MutableRefObject<string | null>
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const { tabsRef, activeTabPathRef, setTabs, setActiveTabPath } = options
  clearTabs(tabsRef, setTabs)
  syncActiveTabPath(activeTabPathRef, setActiveTabPath, null)
}

function runEntryFailureCallback(options: {
  callback?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  entry: VaultEntry
  error: unknown
  warning: string
}) {
  const { callback, entry, error, warning } = options
  Promise.resolve(callback?.(entry, error)).catch((callbackError) => {
    console.warn(warning, callbackError)
  })
}

function handleRecoverableEntryLoadFailure(options: {
  kind: RecoverableEntryLoadFailureKind
  entry: VaultEntry
  tabsRef: React.MutableRefObject<Tab[]>
  activeTabPathRef: React.MutableRefObject<string | null>
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>
  error: unknown
  onMissingActiveVault?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onMissingNotePath?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onUnreadableNoteContent?: (entry: VaultEntry, error: unknown) => void | Promise<void>
}) {
  const {
    kind,
    entry,
    tabsRef,
    activeTabPathRef,
    setTabs,
    setActiveTabPath,
    error,
    onMissingActiveVault,
    onMissingNotePath,
    onUnreadableNoteContent,
  } = options

  if (kind === 'missing-active-vault') {
    clearPrefetchCache()
  }

  resetFailedEntrySelection({
    tabsRef,
    activeTabPathRef,
    setTabs,
    setActiveTabPath,
  })
  failNoteOpenTrace(entry.path, kind)

  if (kind === 'missing-active-vault') {
    runEntryFailureCallback({
      callback: onMissingActiveVault,
      entry,
      error,
      warning: 'Failed to handle missing active vault:',
    })
    return
  }

  if (kind === 'missing-path') {
    runEntryFailureCallback({
      callback: onMissingNotePath,
      entry,
      error,
      warning: 'Failed to handle missing note path:',
    })
    return
  }

  if (kind === 'unreadable-content') {
    runEntryFailureCallback({
      callback: onUnreadableNoteContent,
      entry,
      error,
      warning: 'Failed to handle unreadable note content:',
    })
  }
}

function handleEntryLoadFailure(options: {
  entry: VaultEntry
  seq: number
  navSeqRef: React.MutableRefObject<number>
  tabsRef: React.MutableRefObject<Tab[]>
  activeTabPathRef: React.MutableRefObject<string | null>
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>
  error: unknown
  onMissingActiveVault?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onMissingNotePath?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onUnreadableNoteContent?: (entry: VaultEntry, error: unknown) => void | Promise<void>
}) {
  const {
    entry,
    seq,
    navSeqRef,
    tabsRef,
    activeTabPathRef,
    setTabs,
    setActiveTabPath,
    error,
    onMissingActiveVault,
    onMissingNotePath,
    onUnreadableNoteContent,
  } = options

  console.warn('Failed to load note content:', error)
  if (navSeqRef.current !== seq) return

  const failureKind = getEntryLoadFailureKind(error)
  if (failureKind !== 'load-failed') {
    handleRecoverableEntryLoadFailure({
      kind: failureKind,
      entry,
      tabsRef,
      activeTabPathRef,
      setTabs,
      setActiveTabPath,
      error,
      onMissingActiveVault,
      onMissingNotePath,
      onUnreadableNoteContent,
    })
    return
  }

  setSingleTab(tabsRef, setTabs, { entry, content: '' })
  failNoteOpenTrace(entry.path, 'load-failed')
}

function reopenAlreadyViewingEntry({
  entry,
  tabsRef,
  activeTabPathRef,
  setActiveTabPath,
  hasUnsavedChanges,
}: Pick<NavigateToEntryOptions, 'entry' | 'tabsRef' | 'activeTabPathRef' | 'setActiveTabPath' | 'hasUnsavedChanges'>): boolean {
  if (!isAlreadyViewingPath(tabsRef, activeTabPathRef, entry.path)) return false
  if (!hasUnsavedChanges?.(entry.path)) return false
  syncActiveTabPath(activeTabPathRef, setActiveTabPath, entry.path)
  finishNoteOpenTrace(entry.path)
  return true
}

async function loadTextEntry(options: Required<Pick<NavigateToEntryOptions, 'forceReload'>> & NavigateToEntryOptions) {
  const {
    entry,
    forceReload,
    navSeqRef,
    tabsRef,
    activeTabPathRef,
    setTabs,
    setActiveTabPath,
    onMissingActiveVault,
    onMissingNotePath,
    onUnreadableNoteContent,
  } = options

  const { seq, cachedEntry } = startEntryNavigation({
    entry,
    navSeqRef,
    activeTabPathRef,
    setActiveTabPath,
  })

  try {
    markNoteOpenTrace(entry.path, 'contentLoadStart')
    const content = await loadContentForOpen({
      entry,
      forceReload,
      cachedEntry,
    })
    markNoteOpenTrace(entry.path, 'contentLoadEnd')
    if (!shouldApplyLoadedEntry({
      seq,
      navSeqRef,
      content,
      forceReload,
      activeTabPathRef,
      tabsRef,
      path: entry.path,
    })) return
    setSingleTab(tabsRef, setTabs, { entry, content })
  } catch (err) {
    handleEntryLoadFailure({
      entry,
      seq,
      navSeqRef,
      tabsRef,
      activeTabPathRef,
      setTabs,
      setActiveTabPath,
      error: err,
      onMissingActiveVault,
      onMissingNotePath,
      onUnreadableNoteContent,
    })
  }
}

async function navigateToEntry(options: NavigateToEntryOptions) {
  const forceReload = options.forceReload ?? false

  if (options.entry.fileKind === 'binary') {
    openBinaryEntry(options)
    return
  }

  if (!forceReload && reopenAlreadyViewingEntry(options)) return

  await loadTextEntry({ ...options, forceReload })
}

export function useTabManagement(options: TabManagementOptions = {}) {
  // Single-note model: tabs has 0 or 1 elements.
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  const activeTabPathRef = useRef(activeTabPath)
  const requestedActiveTabPathRef = useRef<string | null>(activeTabPath)
  useEffect(() => { activeTabPathRef.current = activeTabPath })
  const tabsRef = useRef(tabs)
  useEffect(() => { tabsRef.current = tabs })

  // Sequence counter for rapid-switch safety: only the latest navigation wins.
  const navSeqRef = useRef(0)
  const beforeNavigateSeqRef = useRef(0)
  const beforeNavigate = options.beforeNavigate
  const hasUnsavedChanges = options.hasUnsavedChanges
  const onMissingActiveVault = options.onMissingActiveVault
  const onMissingNotePath = options.onMissingNotePath
  const onUnreadableNoteContent = options.onUnreadableNoteContent

  const executeNavigationWithBoundary = useCallback(async (
    targetPath: string,
    navigate: () => void | Promise<void>,
  ) => {
    const seq = ++beforeNavigateSeqRef.current
    const currentPath = activeTabPathRef.current
    if (beforeNavigate && currentPath && !pathsMatch(currentPath, targetPath)) {
      try {
        markNoteOpenTrace(targetPath, 'beforeNavigateStart')
        await beforeNavigate(currentPath, targetPath)
        markNoteOpenTrace(targetPath, 'beforeNavigateEnd')
      } catch (err) {
        console.warn('Failed to persist note before navigation:', err)
        failNoteOpenTrace(targetPath, 'before-navigate-failed')
        return false
      }
      if (beforeNavigateSeqRef.current !== seq) return false
    }
    await navigate()
    return true
  }, [beforeNavigate])

  /** Open a note — replaces the current note (single-note model). */
  const handleSelectNote = useCallback(async (entry: VaultEntry) => {
    requestedActiveTabPathRef.current = entry.path
    const alreadyViewingDirtyEntry = pathsMatch(entry.path, activeTabPathRef.current)
      && !!hasUnsavedChanges?.(entry.path)
    if (!alreadyViewingDirtyEntry) {
      beginNoteOpenTrace(entry.path, 'select-note')
    }
    const navigated = await executeNavigationWithBoundary(entry.path, () => navigateToEntry({
      entry,
      navSeqRef,
      tabsRef,
      activeTabPathRef,
      setTabs,
      setActiveTabPath,
      hasUnsavedChanges,
      onMissingActiveVault,
      onMissingNotePath,
      onUnreadableNoteContent,
    }))
    if (!navigated) {
      resetRequestedPathIfStillPending(requestedActiveTabPathRef, activeTabPathRef, entry.path)
    }
  }, [executeNavigationWithBoundary, hasUnsavedChanges, onMissingActiveVault, onMissingNotePath, onUnreadableNoteContent])

  const handleSwitchTab = useCallback((path: string) => {
    requestedActiveTabPathRef.current = path
    syncActiveTabPath(activeTabPathRef, setActiveTabPath, path)
  }, [])

  /** Open a tab with known content — no IPC round-trip. Used for newly created notes. */
  const openTabWithContent = useCallback((entry: VaultEntry, content: string) => {
    requestedActiveTabPathRef.current = entry.path
    void executeNavigationWithBoundary(entry.path, () => {
      cacheNoteContent(entry.path, content, entry)
      setSingleTab(tabsRef, setTabs, { entry, content })
      syncActiveTabPath(activeTabPathRef, setActiveTabPath, entry.path)
    }).then((navigated) => {
      if (!navigated) resetRequestedPathIfStillPending(requestedActiveTabPathRef, activeTabPathRef, entry.path)
    })
  }, [executeNavigationWithBoundary])

  const handleReplaceActiveTab = useCallback(async (entry: VaultEntry) => {
    requestedActiveTabPathRef.current = entry.path
    const replacingDifferentEntry = !pathsMatch(entry.path, activeTabPathRef.current)
    if (replacingDifferentEntry) {
      beginNoteOpenTrace(entry.path, 'replace-active-tab')
    }
    const navigated = await executeNavigationWithBoundary(entry.path, () => navigateToEntry({
      entry,
      forceReload: !replacingDifferentEntry,
      navSeqRef,
      tabsRef,
      activeTabPathRef,
      setTabs,
      setActiveTabPath,
      onMissingActiveVault,
      onMissingNotePath,
      onUnreadableNoteContent,
    }))
    if (!navigated) {
      resetRequestedPathIfStillPending(requestedActiveTabPathRef, activeTabPathRef, entry.path)
    }
  }, [executeNavigationWithBoundary, onMissingActiveVault, onMissingNotePath, onUnreadableNoteContent])

  const closeAllTabs = useCallback(() => {
    tabsRef.current = []
    setTabs([])
    requestedActiveTabPathRef.current = null
    syncActiveTabPath(activeTabPathRef, setActiveTabPath, null)
  }, [])

  return {
    tabs,
    setTabs,
    activeTabPath,
    activeTabPathRef,
    requestedActiveTabPathRef,
    handleSelectNote,
    openTabWithContent,
    handleSwitchTab,
    handleReplaceActiveTab,
    closeAllTabs,
  }
}
