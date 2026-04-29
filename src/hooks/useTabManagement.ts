import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import {
  beginNoteOpenTrace,
  failNoteOpenTrace,
  finishNoteOpenTrace,
  markNoteOpenTrace,
} from '../utils/noteOpenPerformance'
import { getNoteWindowParams, isNoteWindow } from '../utils/windowMode'

interface Tab {
  entry: VaultEntry
  content: string
}

type NotePath = VaultEntry['path']

// --- Content prefetch cache ---
// Stores in-flight or recently loaded note content promises, keyed by path.
// Cleared on vault reload to prevent stale content after external edits.
// Latency profile: deduplicates rapid note switches and keeps revisits instant.
interface NoteContentCacheEntry {
  path: NotePath
  promise: Promise<string>
  value: string | null
  byteSize: number
}

const prefetchCache = new Map<string, NoteContentCacheEntry>()
const contentSizeEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null

export const NOTE_CONTENT_CACHE_RESOLVED_EVENT = 'laputa:note-content-cache-resolved'
export const NOTE_CONTENT_CACHE_LIMIT = 48
export const NOTE_CONTENT_ENTRY_MAX_BYTES = 256 * 1024
export const NOTE_CONTENT_CACHE_MAX_BYTES = 1024 * 1024

function measureNoteContentBytes(content: string): number {
  return contentSizeEncoder ? contentSizeEncoder.encode(content).byteLength : content.length
}

function getRetainedPrefetchCacheBytes(): number {
  let totalBytes = 0
  for (const entry of prefetchCache.values()) {
    totalBytes += entry.byteSize
  }
  return totalBytes
}

function dropOldestPrefetchEntry(): void {
  const oldestPath = prefetchCache.keys().next().value
  if (!oldestPath) return
  prefetchCache.delete(oldestPath)
}

function trimPrefetchCache(): void {
  while (
    prefetchCache.size > NOTE_CONTENT_CACHE_LIMIT
    || getRetainedPrefetchCacheBytes() > NOTE_CONTENT_CACHE_MAX_BYTES
  ) {
    if (prefetchCache.size === 0) return
    dropOldestPrefetchEntry()
  }
}

function rememberNoteContent(entry: NoteContentCacheEntry): NoteContentCacheEntry {
  const { path } = entry
  if (prefetchCache.has(path)) prefetchCache.delete(path)
  prefetchCache.set(path, entry)
  trimPrefetchCache()
  return entry
}

function retainResolvedNoteContent(entry: NoteContentCacheEntry, content: string): void {
  const byteSize = measureNoteContentBytes(content)
  if (byteSize > NOTE_CONTENT_ENTRY_MAX_BYTES) {
    prefetchCache.delete(entry.path)
    return
  }

  entry.value = content
  entry.byteSize = byteSize
  rememberNoteContent(entry)
  dispatchResolvedNoteContent(entry.path)
}

function getNoteContentCommandPayload(path: string): { path: string; vaultPath?: string } {
  if (!isNoteWindow()) {
    return { path }
  }

  const noteWindowParams = getNoteWindowParams()
  return noteWindowParams
    ? { path, vaultPath: noteWindowParams.vaultPath }
    : { path }
}

function getValidateNoteContentCommandPayload(path: string, content: string): { path: string; content: string; vaultPath?: string } {
  return { ...getNoteContentCommandPayload(path), content }
}

function dispatchResolvedNoteContent(path: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(NOTE_CONTENT_CACHE_RESOLVED_EVENT, {
    detail: { path },
  }))
}

function requestNoteContent({ path }: Pick<NoteContentCacheEntry, 'path'>): NoteContentCacheEntry {
  const cacheEntry: NoteContentCacheEntry = {
    path,
    promise: Promise.resolve(''),
    value: null,
    byteSize: 0,
  }
  const commandPayload = getNoteContentCommandPayload(path)
  const promise = (isTauri()
    ? invoke<string>('get_note_content', commandPayload)
    : mockInvoke<string>('get_note_content', commandPayload)
  )
    .then((content) => {
      retainResolvedNoteContent(cacheEntry, content)
      return content
    })
    .catch((err) => {
      prefetchCache.delete(path)
      throw err
    })

  cacheEntry.promise = promise
  return rememberNoteContent(cacheEntry)
}

/** Prefetch a note's content into the in-memory cache.
 *  Safe to call multiple times — deduplicates concurrent requests for the same path.
 *  Cache is short-lived: cleared on vault reload via clearPrefetchCache(). */
export function prefetchNoteContent(path: string): void {
  if (prefetchCache.has(path)) return
  void requestNoteContent({ path }).promise.catch((error) => {
    if (isNoActiveVaultSelectedError(error) || isUnreadableNoteContentError(error)) return
    console.warn('Failed to prefetch note content:', error)
  })
}

export function cacheNoteContent(path: string, content: string): void {
  const byteSize = measureNoteContentBytes(content)
  if (byteSize > NOTE_CONTENT_ENTRY_MAX_BYTES) {
    prefetchCache.delete(path)
    return
  }

  rememberNoteContent({
    path,
    promise: Promise.resolve(content),
    value: content,
    byteSize,
  })
  dispatchResolvedNoteContent(path)
}

/** Clear the prefetch cache. Call on vault reload to prevent stale content. */
export function clearPrefetchCache(): void {
  prefetchCache.clear()
}

export function getResolvedCachedNoteContent(path: string): { path: string; content: string } | null {
  const entry = prefetchCache.get(path)
  if (!entry || entry.value === null) return null
  return { path: entry.path, content: entry.value }
}

function hasResolvedCachedContent(entry: NoteContentCacheEntry | null): entry is NoteContentCacheEntry & { value: string } {
  if (!entry) return false
  return entry.value !== null
}

function getCachedNoteContentEntry(path: string): NoteContentCacheEntry | null {
  return prefetchCache.get(path) ?? null
}

async function validateCachedNoteContent(entry: NoteContentCacheEntry): Promise<boolean> {
  if (entry.value === null) return false
  const payload = getValidateNoteContentCommandPayload(entry.path, entry.value)
  return isTauri()
    ? invoke<boolean>('validate_note_content', payload)
    : mockInvoke<boolean>('validate_note_content', payload)
}

async function loadNoteContent(path: string, forceFresh = false): Promise<string> {
  if (forceFresh) return requestNoteContent({ path }).promise
  return prefetchCache.get(path)?.promise ?? requestNoteContent({ path }).promise
}

async function loadCachedContentIfFresh(entry: NoteContentCacheEntry): Promise<string | null> {
  if (entry.value === null) return null
  markNoteOpenTrace(entry.path, 'freshnessCheckStart')
  const isFresh = await validateCachedNoteContent(entry)
  markNoteOpenTrace(entry.path, 'freshnessCheckEnd')
  if (isFresh) {
    rememberNoteContent(entry)
    return entry.value
  }
  prefetchCache.delete(entry.path)
  return null
}

async function loadContentForOpen(options: {
  path: string
  forceReload: boolean
  cachedEntry: NoteContentCacheEntry | null
}): Promise<string> {
  const { path, forceReload, cachedEntry } = options

  if (!forceReload && hasResolvedCachedContent(cachedEntry)) {
    const cachedContent = await loadCachedContentIfFresh(cachedEntry)
    if (cachedContent !== null) return cachedContent
  }

  return loadNoteContent(path, forceReload || hasResolvedCachedContent(cachedEntry))
}

export type { Tab }

interface TabManagementOptions {
  beforeNavigate?: (fromPath: string, toPath: string) => Promise<void>
  hasUnsavedChanges?: (path: string) => boolean
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

function isNoActiveVaultSelectedError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : String(error)
  return /no active vault selected/i.test(message)
}

function isUnreadableNoteContentError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : String(error)
  return /not valid utf-8 text|invalid utf-8|stream did not contain valid utf-8/i.test(message)
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
      path: entry.path,
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
  useEffect(() => { activeTabPathRef.current = activeTabPath })
  const tabsRef = useRef(tabs)
  useEffect(() => { tabsRef.current = tabs })

  // Sequence counter for rapid-switch safety: only the latest navigation wins.
  const navSeqRef = useRef(0)
  const beforeNavigateSeqRef = useRef(0)
  const beforeNavigate = options.beforeNavigate
  const hasUnsavedChanges = options.hasUnsavedChanges
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
        return
      }
      if (beforeNavigateSeqRef.current !== seq) return
    }
    await navigate()
  }, [beforeNavigate])

  /** Open a note — replaces the current note (single-note model). */
  const handleSelectNote = useCallback(async (entry: VaultEntry) => {
    const alreadyViewingDirtyEntry = pathsMatch(entry.path, activeTabPathRef.current)
      && !!hasUnsavedChanges?.(entry.path)
    if (!alreadyViewingDirtyEntry) {
      beginNoteOpenTrace(entry.path, 'select-note')
    }
    await executeNavigationWithBoundary(entry.path, () => navigateToEntry({
      entry,
      navSeqRef,
      tabsRef,
      activeTabPathRef,
      setTabs,
      setActiveTabPath,
      hasUnsavedChanges,
      onMissingNotePath,
      onUnreadableNoteContent,
    }))
  }, [executeNavigationWithBoundary, hasUnsavedChanges, onMissingNotePath, onUnreadableNoteContent])

  const handleSwitchTab = useCallback((path: string) => {
    syncActiveTabPath(activeTabPathRef, setActiveTabPath, path)
  }, [])

  /** Open a tab with known content — no IPC round-trip. Used for newly created notes. */
  const openTabWithContent = useCallback((entry: VaultEntry, content: string) => {
    void executeNavigationWithBoundary(entry.path, () => {
      setSingleTab(tabsRef, setTabs, { entry, content })
      syncActiveTabPath(activeTabPathRef, setActiveTabPath, entry.path)
    })
  }, [executeNavigationWithBoundary])

  const handleReplaceActiveTab = useCallback(async (entry: VaultEntry) => {
    if (!pathsMatch(entry.path, activeTabPathRef.current)) {
      beginNoteOpenTrace(entry.path, 'replace-active-tab')
    }
    await executeNavigationWithBoundary(entry.path, () => navigateToEntry({
      entry,
      forceReload: true,
      navSeqRef,
      tabsRef,
      activeTabPathRef,
      setTabs,
      setActiveTabPath,
      onMissingNotePath,
      onUnreadableNoteContent,
    }))
  }, [executeNavigationWithBoundary, onMissingNotePath, onUnreadableNoteContent])

  const closeAllTabs = useCallback(() => {
    tabsRef.current = []
    setTabs([])
    syncActiveTabPath(activeTabPathRef, setActiveTabPath, null)
  }, [])

  return {
    tabs,
    setTabs,
    activeTabPath,
    activeTabPathRef,
    handleSelectNote,
    openTabWithContent,
    handleSwitchTab,
    handleReplaceActiveTab,
    closeAllTabs,
  }
}
