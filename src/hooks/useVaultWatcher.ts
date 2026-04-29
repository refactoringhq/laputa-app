import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauri } from '../mock-tauri'

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
  vaultPath: WatchPath
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
  const normalizedPath = normalizeWatchPath(path)
  const normalizedParent = normalizeWatchPath(parent)
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`)
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
  vaultPath,
  now = Date.now,
}: {
  vaultPath: WatchPath
  now?: TimestampProvider
}) {
  const recentWritesRef = useRef<Map<string, number>>(new Map())
  const vaultPathRef = useVaultPathRef(vaultPath)

  useEffect(() => {
    recentWritesRef.current.clear()
  }, [vaultPath])

  const markInternalWrite = useCallback((path: WatchPath) => {
    const root = vaultPathRef.current
    if (!root) return
    const resolvedPath = resolveChangedPath({ path, vaultPath: root })
    if (isSamePathOrChild({ path: resolvedPath, parent: root })) {
      recentWritesRef.current.set(resolvedPath, now())
    }
  }, [now, vaultPathRef])

  const filterExternalPaths = useCallback((paths: WatchPath[]) => {
    const root = vaultPathRef.current
    if (!root || paths.length === 0) return paths
    const currentTime = now()
    pruneRecentWrites(recentWritesRef.current, currentTime)
    return paths.filter((path) => !recentWritesRef.current.has(resolveChangedPath({ path, vaultPath: root })))
  }, [now, vaultPathRef])

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
  root,
  enqueueChangedPaths,
}: {
  event: { payload: VaultChangedPayload }
  root: WatchPath
  enqueueChangedPaths: (paths: WatchPath[]) => void
}) {
  if (normalizeWatchPath(event.payload.vaultPath) === root) {
    enqueueChangedPaths(event.payload.paths ?? [])
  }
}

function cleanupNativeWatcherListener(unlisten: UnlistenFn): void {
  void Promise.resolve()
    .then(unlisten)
    .catch(() => {})
}

function usePendingVaultRefresh({
  vaultPathRef,
  onVaultChanged,
  filterChangedPaths,
  debounceMs,
}: {
  vaultPathRef: RefObject<WatchPath>
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

  const enqueueChangedPaths = useCallback((paths: WatchPath[]) => {
    const root = vaultPathRef.current
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
  }, [debounceMs, flushQueuedRefresh, vaultPathRef])

  return { clearPendingRefresh, enqueueChangedPaths }
}

function useNativeVaultWatcher({
  vaultPath,
  enqueueChangedPaths,
  clearPendingRefresh,
}: {
  vaultPath: WatchPath
  enqueueChangedPaths: (paths: WatchPath[]) => void
  clearPendingRefresh: () => void
}) {
  useEffect(() => {
    const root = normalizeWatchPath(vaultPath)
    if (!root || !isTauri()) return

    let cancelled = false
    let unlisten: UnlistenFn | null = null

    void listen<VaultChangedPayload>(VAULT_CHANGED_EVENT, (event) => {
      handleWatcherEvent({ event, root, enqueueChangedPaths })
    }).then((nextUnlisten) => {
      if (cancelled) {
        cleanupNativeWatcherListener(nextUnlisten)
      } else {
        unlisten = nextUnlisten
      }
    }).catch((err) => {
      console.warn('Failed to subscribe to vault watcher events:', err)
    })

    void invoke('start_vault_watcher', { path: vaultPath }).catch((err) => {
      console.warn('Failed to start vault watcher:', err)
    })

    return () => {
      cancelled = true
      clearPendingRefresh()
      if (unlisten) cleanupNativeWatcherListener(unlisten)
      void invoke('stop_vault_watcher').catch(() => {})
    }
  }, [vaultPath, enqueueChangedPaths, clearPendingRefresh])
}

export function useVaultWatcher({
  vaultPath,
  onVaultChanged,
  debounceMs = VAULT_WATCHER_DEBOUNCE_MS,
  filterChangedPaths,
}: UseVaultWatcherOptions) {
  const vaultPathRef = useVaultPathRef(vaultPath)
  const pendingRefresh = usePendingVaultRefresh({
    vaultPathRef,
    onVaultChanged,
    filterChangedPaths,
    debounceMs,
  })

  useNativeVaultWatcher({
    vaultPath,
    enqueueChangedPaths: pendingRefresh.enqueueChangedPaths,
    clearPendingRefresh: pendingRefresh.clearPendingRefresh,
  })
}
