import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauri } from '../mock-tauri'
import { isPathInsideVaultRoot } from '../utils/vaultPathContainment'

export const VAULT_CHANGED_EVENT = 'vault-changed'
export const VAULT_WATCHER_DEBOUNCE_MS = 350
export const INTERNAL_WRITE_SUPPRESSION_MS = 4000

type WatchPath = string
type TimestampProvider = () => number

interface VaultChangedPayload {
  vaultPath: WatchPath
  paths: WatchPath[]
}

interface UseVaultWatcherOptions {
  vaultPath?: WatchPath
  vaultPaths?: WatchPath[]
  onVaultChanged: (paths: WatchPath[]) => Promise<void> | void
  debounceMs?: number
  filterChangedPaths?: (paths: WatchPath[]) => WatchPath[]
}

interface ChangedPathOptions {
  path: WatchPath
  vaultPath: WatchPath
}

interface PathContainmentOptions {
  path: WatchPath
  parent: WatchPath
}

function isAbsoluteWatchPath(path: WatchPath): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//u.test(path)
}

function trimTrailingSlash(path: WatchPath): WatchPath {
  return path.length > 1 ? path.replace(/\/+$/u, '') : path
}

export function normalizeWatchPath(path: WatchPath): WatchPath {
  return trimTrailingSlash(path.replaceAll('\\', '/').replace(/^\/private\/tmp(?=\/|$)/u, '/tmp'))
}

export function resolveChangedPath({ path, vaultPath }: ChangedPathOptions): WatchPath {
  const normalizedPath = normalizeWatchPath(path)
  if (isAbsoluteWatchPath(normalizedPath)) return normalizedPath
  return normalizeWatchPath(`${vaultPath}/${normalizedPath}`)
}

function isSamePathOrChild({ path, parent }: PathContainmentOptions): boolean {
  return isPathInsideVaultRoot(normalizeWatchPath(path), normalizeWatchPath(parent))
}

function uniqueWatchRoots(paths: WatchPath[]): WatchPath[] {
  return [...new Set(paths.map(normalizeWatchPath).filter(Boolean))]
}

function watchRootsFromOptions(vaultPath?: WatchPath, vaultPaths?: WatchPath[]): WatchPath[] {
  if (vaultPaths && vaultPaths.length > 0) return uniqueWatchRoots(vaultPaths)
  return uniqueWatchRoots(vaultPath ? [vaultPath] : [])
}

function watchRootsKeyFor(watchRoots: readonly WatchPath[]): string {
  return watchRoots.join('\u0000')
}

function useWatchRootsRef(watchRoots: WatchPath[]) {
  const watchRootsRef = useRef(watchRoots)
  const watchRootsKey = watchRootsKeyFor(watchRoots)

  useEffect(() => {
    watchRootsRef.current = watchRoots
  }, [watchRoots])

  return { watchRootsRef, watchRootsKey }
}

function rootForPath(path: WatchPath, roots: readonly WatchPath[]): WatchPath | null {
  const normalizedPath = normalizeWatchPath(path)
  return roots.find((root) => isSamePathOrChild({ path: normalizedPath, parent: root })) ?? null
}

function resolvePathForKnownRoots({
  path,
  fallbackRoot,
  roots,
}: {
  path: WatchPath
  fallbackRoot: WatchPath
  roots: readonly WatchPath[]
}): WatchPath | null {
  const normalizedPath = normalizeWatchPath(path)
  if (isAbsoluteWatchPath(normalizedPath)) return normalizedPath
  const root = fallbackRoot || roots[0]
  return root ? resolveChangedPath({ path: normalizedPath, vaultPath: root }) : null
}

function eventRootForPayload(vaultPath: WatchPath, roots: readonly WatchPath[]): WatchPath | null {
  const eventRoot = normalizeWatchPath(vaultPath)
  return roots.some((root) => isSamePathOrChild({ path: eventRoot, parent: root })) ? eventRoot : null
}

function pruneRecentWrites(writes: Map<string, number>, now: number) {
  for (const [path, timestamp] of writes) {
    if (now - timestamp > INTERNAL_WRITE_SUPPRESSION_MS) writes.delete(path)
  }
}

function useLatestRef<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}

function useVaultPathRef(vaultPath: WatchPath) {
  const vaultPathRef = useRef(normalizeWatchPath(vaultPath))

  useEffect(() => {
    vaultPathRef.current = normalizeWatchPath(vaultPath)
  }, [vaultPath])

  return vaultPathRef
}

export function useRecentVaultWrites({
  vaultPath = '',
  vaultPaths,
  now = Date.now,
}: {
  vaultPath?: WatchPath
  vaultPaths?: WatchPath[]
  now?: TimestampProvider
}) {
  const recentWritesRef = useRef<Map<string, number>>(new Map())
  const watchRoots = useMemo(() => watchRootsFromOptions(vaultPath, vaultPaths), [vaultPath, vaultPaths])
  const { watchRootsRef, watchRootsKey } = useWatchRootsRef(watchRoots)
  const vaultPathRef = useVaultPathRef(vaultPath)

  useEffect(() => {
    void watchRootsKey
    recentWritesRef.current.clear()
  }, [watchRootsKey])

  const markInternalWrite = useCallback((path: WatchPath) => {
    const resolvedPath = resolvePathForKnownRoots({
      path,
      fallbackRoot: vaultPathRef.current,
      roots: watchRootsRef.current,
    })
    if (resolvedPath && rootForPath(resolvedPath, watchRootsRef.current)) {
      recentWritesRef.current.set(resolvedPath, now())
    }
  }, [now, vaultPathRef, watchRootsRef])

  const filterExternalPaths = useCallback((paths: WatchPath[]) => {
    if (watchRootsRef.current.length === 0 || paths.length === 0) return paths
    const currentTime = now()
    pruneRecentWrites(recentWritesRef.current, currentTime)
    return paths.filter((path) => {
      const resolvedPath = resolvePathForKnownRoots({
        path,
        fallbackRoot: vaultPathRef.current,
        roots: watchRootsRef.current,
      })
      return !resolvedPath || !recentWritesRef.current.has(resolvedPath)
    })
  }, [now, vaultPathRef, watchRootsRef])

  return { markInternalWrite, filterExternalPaths }
}

function clearRefreshQueue({
  debounceTimerRef,
  queuedPathsRef,
  fullRefreshPendingRef,
}: {
  debounceTimerRef: RefObject<ReturnType<typeof setTimeout> | null>
  queuedPathsRef: RefObject<Set<string>>
  fullRefreshPendingRef: RefObject<boolean>
}) {
  if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
  debounceTimerRef.current = null
  queuedPathsRef.current.clear()
  fullRefreshPendingRef.current = false
}

function addQueuedChangedPaths({
  root,
  paths,
  queuedPaths,
  fullRefreshPendingRef,
}: {
  root: WatchPath
  paths: WatchPath[]
  queuedPaths: Set<string>
  fullRefreshPendingRef: RefObject<boolean>
}) {
  if (paths.length === 0) {
    fullRefreshPendingRef.current = true
    return
  }
  for (const path of paths) {
    const resolvedPath = resolveChangedPath({ path, vaultPath: root })
    if (isSamePathOrChild({ path: resolvedPath, parent: root })) queuedPaths.add(resolvedPath)
  }
}

function hasRefreshWork({
  queuedPathsRef,
  fullRefreshPendingRef,
}: {
  queuedPathsRef: RefObject<Set<string>>
  fullRefreshPendingRef: RefObject<boolean>
}) {
  return fullRefreshPendingRef.current || queuedPathsRef.current.size > 0
}

function pendingRefreshPaths({
  queuedPathsRef,
  fullRefreshPendingRef,
}: {
  queuedPathsRef: RefObject<Set<string>>
  fullRefreshPendingRef: RefObject<boolean>
}) {
  const fullRefresh = fullRefreshPendingRef.current
  return {
    fullRefresh,
    queuedPaths: fullRefresh ? [] : Array.from(queuedPathsRef.current),
  }
}

function filteredRefreshPaths({
  fullRefresh,
  queuedPaths,
  filterChangedPaths,
}: {
  fullRefresh: boolean
  queuedPaths: WatchPath[]
  filterChangedPaths?: (paths: WatchPath[]) => WatchPath[]
}) {
  return fullRefresh ? queuedPaths : filterChangedPaths?.(queuedPaths) ?? queuedPaths
}

function handleWatcherEvent({
  event,
  roots,
  enqueueChangedPaths,
}: {
  event: { payload: VaultChangedPayload }
  roots: readonly WatchPath[]
  enqueueChangedPaths: (root: WatchPath, paths: WatchPath[]) => void
}) {
  const root = eventRootForPayload(event.payload.vaultPath, roots)
  if (root) enqueueChangedPaths(root, event.payload.paths ?? [])
}

function cleanupNativeWatcherListener(unlisten: UnlistenFn): void {
  void Promise.resolve()
    .then(unlisten)
    .catch(() => {})
}

function usePendingVaultRefresh({
  onVaultChanged,
  filterChangedPaths,
  debounceMs,
}: {
  onVaultChanged: UseVaultWatcherOptions['onVaultChanged']
  filterChangedPaths: UseVaultWatcherOptions['filterChangedPaths']
  debounceMs: number
}) {
  const onVaultChangedRef = useLatestRef(onVaultChanged)
  const filterChangedPathsRef = useLatestRef(filterChangedPaths)
  const queuedPathsRef = useRef<Set<string>>(new Set())
  const fullRefreshPendingRef = useRef(false)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearPendingRefresh = useCallback(() => clearRefreshQueue({
    debounceTimerRef,
    queuedPathsRef,
    fullRefreshPendingRef,
  }), [])

  const flushQueuedRefresh = useCallback(() => {
    const { fullRefresh, queuedPaths } = pendingRefreshPaths({ queuedPathsRef, fullRefreshPendingRef })
    clearPendingRefresh()
    const filteredPaths = filteredRefreshPaths({
      fullRefresh,
      queuedPaths,
      filterChangedPaths: filterChangedPathsRef.current,
    })
    if (!fullRefresh && filteredPaths.length === 0) return
    void Promise.resolve(onVaultChangedRef.current(filteredPaths)).catch((err) => {
      console.warn('Vault watcher refresh failed:', err)
    })
  }, [clearPendingRefresh, filterChangedPathsRef, onVaultChangedRef])

  const enqueueChangedPaths = useCallback((root: WatchPath, paths: WatchPath[]) => {
    if (!root) return
    addQueuedChangedPaths({
      root,
      paths,
      queuedPaths: queuedPathsRef.current,
      fullRefreshPendingRef,
    })
    if (!hasRefreshWork({ queuedPathsRef, fullRefreshPendingRef })) return
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(flushQueuedRefresh, debounceMs)
  }, [debounceMs, flushQueuedRefresh])

  return { clearPendingRefresh, enqueueChangedPaths }
}

function useNativeVaultWatcher({
  watchRoots,
  watchRootsKey,
  enqueueChangedPaths,
  clearPendingRefresh,
}: {
  watchRoots: WatchPath[]
  watchRootsKey: string
  enqueueChangedPaths: (root: WatchPath, paths: WatchPath[]) => void
  clearPendingRefresh: () => void
}) {
  useEffect(() => {
    void watchRootsKey
    if (watchRoots.length === 0 || !isTauri()) return

    let cancelled = false
    let unlisten: UnlistenFn | null = null

    void listen<VaultChangedPayload>(VAULT_CHANGED_EVENT, (event) => {
      handleWatcherEvent({ event, roots: watchRoots, enqueueChangedPaths })
    }).then((nextUnlisten) => {
      if (cancelled) {
        cleanupNativeWatcherListener(nextUnlisten)
      } else {
        unlisten = nextUnlisten
      }
    }).catch((err) => {
      console.warn('Failed to subscribe to vault watcher events:', err)
    })

    for (const root of watchRoots) {
      void invoke('start_vault_watcher', { path: root }).catch((err) => {
        console.warn('Failed to start vault watcher:', err)
      })
    }

    return () => {
      cancelled = true
      clearPendingRefresh()
      if (unlisten) cleanupNativeWatcherListener(unlisten)
      void invoke('stop_vault_watcher').catch(() => {})
    }
  }, [watchRoots, watchRootsKey, enqueueChangedPaths, clearPendingRefresh])
}

export function useVaultWatcher({
  vaultPath = '',
  vaultPaths,
  onVaultChanged,
  debounceMs = VAULT_WATCHER_DEBOUNCE_MS,
  filterChangedPaths,
}: UseVaultWatcherOptions) {
  const watchRoots = useMemo(() => watchRootsFromOptions(vaultPath, vaultPaths), [vaultPath, vaultPaths])
  const watchRootsKey = watchRootsKeyFor(watchRoots)
  const pendingRefresh = usePendingVaultRefresh({
    onVaultChanged,
    filterChangedPaths,
    debounceMs,
  })

  useNativeVaultWatcher({
    watchRoots,
    watchRootsKey,
    enqueueChangedPaths: pendingRefresh.enqueueChangedPaths,
    clearPendingRefresh: pendingRefresh.clearPendingRefresh,
  })
}
