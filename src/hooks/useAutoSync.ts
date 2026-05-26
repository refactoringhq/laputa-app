import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { GitPullResult, GitPushResult, GitRemoteStatus, LastCommitInfo, SyncStatus } from '../types'
import { trackEvent } from '../lib/telemetry'

const DEFAULT_INTERVAL_MS = 5 * 60_000
const AUTO_SYNC_COOLDOWN_MS = 30_000

type MaybePromise = void | Promise<void>

type SyncCallbacks = Pick<UseAutoSyncOptions, 'onVaultUpdated' | 'onSyncUpdated' | 'onConflict' | 'onToast'>

function tauriCall<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(cmd, args) : mockInvoke<T>(cmd, args)
}

interface UseAutoSyncOptions {
  enabled?: boolean
  vaultPath: string
  vaultPaths?: string[]
  intervalMinutes: number | null
  onVaultUpdated: (updatedFiles: string[], vaultPath: string) => MaybePromise
  onSyncUpdated?: () => MaybePromise
  onConflict: (files: string[]) => void
  onToast: (msg: string) => void
}

export interface AutoSyncState {
  syncStatus: SyncStatus
  lastSyncTime: number | null
  conflictFiles: string[]
  conflictVaultPath: string | null
  lastCommitInfo: LastCommitInfo | null
  remoteStatus: GitRemoteStatus | null
  triggerSync: (vaultPath?: string) => void
  /** Pull from remote, then push if there are local commits ahead. */
  pullAndPush: (vaultPath?: string) => void
  /** Pause auto-pull (e.g. while conflict resolver modal is open). */
  pausePull: () => void
  /** Resume auto-pull after pausing. */
  resumePull: () => void
  /** Notify that a push was rejected so the status updates to pull_required. */
  handlePushRejected: () => void
}

type SyncSetState<T> = Dispatch<SetStateAction<T>>

interface PullErrorResolution {
  checkExistingConflicts: () => Promise<boolean>
  notifyError?: string
  callbacksRef: MutableRefObject<SyncCallbacks>
  setSyncStatus: SyncSetState<SyncStatus>
}

interface SyncTaskOptions {
  blockWhenPaused: boolean
  pauseRef: MutableRefObject<boolean>
  syncingRef: MutableRefObject<boolean>
  setLastSyncTime: SyncSetState<number | null>
  setSyncStatus: SyncSetState<SyncStatus>
  task: () => Promise<void>
}

interface PullOutcome {
  result: GitPullResult
  vaultPath: string
}

interface PushOutcome {
  result: GitPushResult
  vaultPath: string
}

interface SyncBudgetOptions {
  force?: boolean
}

interface UpdatedVaultRefreshOptions {
  outcomes: PullOutcome[]
  callbacksRef: MutableRefObject<SyncCallbacks>
  setConflictFiles: SyncSetState<string[]>
  setConflictVaultPath: SyncSetState<string | null>
  setSyncStatus: SyncSetState<SyncStatus>
}

interface ConflictStateOptions {
  callbacksRef: MutableRefObject<SyncCallbacks>
  files: string[]
  setConflictFiles: SyncSetState<string[]>
  setConflictVaultPath: SyncSetState<string | null>
  setSyncStatus: SyncSetState<SyncStatus>
  vaultPath: string
}

function uniqueVaultPaths(paths: string[]): string[] {
  const seen = new Set<string>()
  return paths.filter((path) => {
    const trimmed = path.trim()
    if (!trimmed || seen.has(trimmed)) return false
    seen.add(trimmed)
    return true
  })
}

function aggregateRemoteStatuses(statuses: GitRemoteStatus[]): GitRemoteStatus | null {
  if (statuses.length === 0) return null

  return {
    branch: statuses.length === 1 ? statuses[0].branch : '',
    ahead: statuses.reduce((sum, status) => sum + (status.ahead ?? 0), 0),
    behind: statuses.reduce((sum, status) => sum + (status.behind ?? 0), 0),
    hasRemote: statuses.some((status) => status.hasRemote === true),
  }
}

function updatedPullOutcomes(outcomes: PullOutcome[]): PullOutcome[] {
  return outcomes.filter((outcome) => outcome.result.status === 'updated')
}

function firstConflictOutcome(outcomes: PullOutcome[]): PullOutcome | null {
  return outcomes.find((outcome) => outcome.result.status === 'conflict') ?? null
}

function hasPullError(outcomes: PullOutcome[]): boolean {
  return outcomes.some((outcome) => outcome.result.status === 'error')
}

function firstPullError(outcomes: PullOutcome[]): PullOutcome | null {
  return outcomes.find((outcome) => outcome.result.status === 'error') ?? null
}

function pulledUpdateToast(outcomes: PullOutcome[]): string {
  const updateCount = outcomes.reduce((sum, outcome) => sum + outcome.result.updatedFiles.length, 0)
  return `Pulled ${updateCount} update(s) from remote`
}

function pushSuccessToast(): string {
  return 'Pulled and pushed successfully'
}

function rejectedPushCount(outcomes: PushOutcome[]): number {
  return outcomes.filter((outcome) => outcome.result.status === 'rejected').length
}

function firstFailedPush(outcomes: PushOutcome[]): PushOutcome | null {
  return outcomes.find((outcome) => outcome.result.status !== 'ok' && outcome.result.status !== 'rejected') ?? null
}

function clearConflictState(
  setSyncStatus: SyncSetState<SyncStatus>,
  setConflictFiles: SyncSetState<string[]>,
  setConflictVaultPath: SyncSetState<string | null>,
): void {
  setSyncStatus('idle')
  setConflictFiles([])
  setConflictVaultPath(null)
}

function setConflictState({
  callbacksRef,
  files,
  setConflictFiles,
  setConflictVaultPath,
  setSyncStatus,
  vaultPath,
}: ConflictStateOptions): void {
  setSyncStatus('conflict')
  setConflictFiles(files)
  setConflictVaultPath(vaultPath)
  void callbacksRef.current.onConflict(files)
}

function markPullTimestamp(
  setLastSyncTime: SyncSetState<number | null>,
  refreshCommitInfo: (vaultPath?: string) => void,
  vaultPath?: string,
): void {
  setLastSyncTime(Date.now())
  refreshCommitInfo(vaultPath)
}

function useRemoteStatusRefresher(setRemoteStatus: SyncSetState<GitRemoteStatus | null>) {
  return useCallback(async (targetVaultPaths: string[]) => {
    const statuses = await Promise.all(targetVaultPaths.map(async (targetVaultPath) => {
      try {
        return await tauriCall<GitRemoteStatus>('git_remote_status', { vaultPath: targetVaultPath })
      } catch {
        return null
      }
    }))
    const aggregate = aggregateRemoteStatuses(statuses.filter((status): status is GitRemoteStatus => status !== null))
    setRemoteStatus(aggregate)
    return aggregate
  }, [setRemoteStatus])
}

function useConflictChecker(
  setSyncStatus: SyncSetState<SyncStatus>,
  setConflictFiles: SyncSetState<string[]>,
  setConflictVaultPath: SyncSetState<string | null>,
  callbacksRef: MutableRefObject<SyncCallbacks>,
) {
  return useCallback(async (targetVaultPaths: string[]): Promise<boolean> => {
    const conflictChecks = await Promise.all(targetVaultPaths.map(async (targetVaultPath) => {
      try {
        return {
          files: await tauriCall<string[]>('get_conflict_files', { vaultPath: targetVaultPath }),
          vaultPath: targetVaultPath,
        }
      } catch {
        return { files: [], vaultPath: targetVaultPath }
      }
    }))
    const conflict = conflictChecks.find(({ files }) => Array.isArray(files) && files.length > 0)
    if (!conflict) return false

    setConflictState({
      callbacksRef,
      files: conflict.files,
      setSyncStatus,
      setConflictFiles,
      setConflictVaultPath,
      vaultPath: conflict.vaultPath,
    })
    return true
  }, [setSyncStatus, setConflictFiles, setConflictVaultPath, callbacksRef])
}

function useCommitInfoRefresher(
  vaultPath: string,
  setLastCommitInfo: SyncSetState<LastCommitInfo | null>,
) {
  return useCallback((targetVaultPath = vaultPath) => {
    tauriCall<LastCommitInfo | null>('get_last_commit_info', { vaultPath: targetVaultPath })
      .then(info => setLastCommitInfo(info))
      .catch((err) => console.warn('[sync] Failed to refresh last commit info:', err))
  }, [vaultPath, setLastCommitInfo])
}

async function refreshUpdatedVaults(options: UpdatedVaultRefreshOptions): Promise<void> {
  const {
    outcomes,
    callbacksRef,
    setConflictFiles,
    setConflictVaultPath,
    setSyncStatus,
  } = options
  clearConflictState(setSyncStatus, setConflictFiles, setConflictVaultPath)
  await Promise.all(outcomes.map((outcome) => (
    callbacksRef.current.onVaultUpdated(outcome.result.updatedFiles, outcome.vaultPath)
  )))
  await callbacksRef.current.onSyncUpdated?.()
}

async function handleUpdatedPull(options: UpdatedVaultRefreshOptions): Promise<void> {
  const { outcomes, callbacksRef } = options
  await refreshUpdatedVaults(options)
  await callbacksRef.current.onToast(pulledUpdateToast(outcomes))
}

async function resolvePullError(options: PullErrorResolution): Promise<void> {
  const {
    checkExistingConflicts,
    notifyError,
    callbacksRef,
    setSyncStatus,
  } = options
  const hasConflicts = await checkExistingConflicts()
  if (hasConflicts) return
  setSyncStatus('error')
  if (notifyError) await callbacksRef.current.onToast(notifyError)
}

function handlePushResult(options: {
  outcomes: PushOutcome[]
  callbacksRef: MutableRefObject<SyncCallbacks>
  setConflictFiles: SyncSetState<string[]>
  setConflictVaultPath: SyncSetState<string | null>
  setSyncStatus: SyncSetState<SyncStatus>
}): void {
  const {
    outcomes,
    callbacksRef,
    setConflictFiles,
    setConflictVaultPath,
    setSyncStatus,
  } = options
  const rejectedCount = rejectedPushCount(outcomes)
  if (rejectedCount > 0) {
    setSyncStatus('pull_required')
    void callbacksRef.current.onToast('Push still rejected after pull — try again')
    return
  }

  const failedPush = firstFailedPush(outcomes)
  if (failedPush) {
    setSyncStatus('error')
    void callbacksRef.current.onToast(failedPush.result.message)
    return
  }

  clearConflictState(setSyncStatus, setConflictFiles, setConflictVaultPath)
  void callbacksRef.current.onToast(pushSuccessToast())
}

async function runSyncTask(options: SyncTaskOptions): Promise<void> {
  const {
    blockWhenPaused,
    pauseRef,
    syncingRef,
    setLastSyncTime,
    setSyncStatus,
    task,
  } = options
  if (syncingRef.current || (blockWhenPaused && pauseRef.current)) return
  syncingRef.current = true
  setSyncStatus('syncing')

  try {
    await task()
  } catch {
    setSyncStatus('error')
    setLastSyncTime(Date.now())
  } finally {
    syncingRef.current = false
  }
}

function useAutoSyncLifecycle(options: {
  enabled: boolean
  checkExistingConflicts: () => Promise<boolean>
  intervalMinutes: number | null
  performPull: () => Promise<void>
  refreshRemoteStatus: () => Promise<GitRemoteStatus | null>
}) {
  const {
    enabled,
    checkExistingConflicts,
    intervalMinutes,
    performPull,
    refreshRemoteStatus,
  } = options

  useEffect(() => {
    if (!enabled) return

    void checkExistingConflicts().then(hasConflicts => {
      if (hasConflicts) {
        void refreshRemoteStatus()
        return
      }
      void performPull()
    })
  }, [checkExistingConflicts, enabled, performPull, refreshRemoteStatus])

  useEffect(() => {
    if (!enabled) return

    const handleFocus = () => {
      void performPull()
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [enabled, performPull])

  useEffect(() => {
    if (!enabled) return

    const ms = (intervalMinutes ?? 5) * 60_000 || DEFAULT_INTERVAL_MS
    const id = setInterval(() => { void performPull() }, ms)
    return () => clearInterval(id)
  }, [enabled, performPull, intervalMinutes])
}

export function useAutoSync({
  enabled = true,
  vaultPath,
  vaultPaths,
  intervalMinutes,
  onVaultUpdated,
  onSyncUpdated,
  onConflict,
  onToast,
}: UseAutoSyncOptions): AutoSyncState {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null)
  const [conflictFiles, setConflictFiles] = useState<string[]>([])
  const [conflictVaultPath, setConflictVaultPath] = useState<string | null>(null)
  const [lastCommitInfo, setLastCommitInfo] = useState<LastCommitInfo | null>(null)
  const [remoteStatus, setRemoteStatus] = useState<GitRemoteStatus | null>(null)
  const syncingRef = useRef(false)
  const pauseRef = useRef(false)
  const callbacksRef = useRef<SyncCallbacks>({ onVaultUpdated, onSyncUpdated, onConflict, onToast })
  useEffect(() => {
    callbacksRef.current = { onVaultUpdated, onSyncUpdated, onConflict, onToast }
  }, [onVaultUpdated, onSyncUpdated, onConflict, onToast])

  const targetVaultPaths = useMemo(() => {
    const configuredPaths = vaultPaths && vaultPaths.length > 0 ? vaultPaths : [vaultPath]
    return uniqueVaultPaths(configuredPaths)
  }, [vaultPath, vaultPaths])
  const resolveTargetVaultPaths = useCallback((targetVaultPath?: string) => (
    targetVaultPath ? uniqueVaultPaths([targetVaultPath]) : targetVaultPaths
  ), [targetVaultPaths])
  const lastAutoSyncStartedAtRef = useRef<Map<string, number>>(new Map())
  const resolveBudgetedTargetVaultPaths = useCallback((
    targetVaultPath?: string,
    options: SyncBudgetOptions = {},
  ) => {
    const resolvedPaths = resolveTargetVaultPaths(targetVaultPath)
    const now = Date.now()
    const duePaths = options.force
      ? resolvedPaths
      : resolvedPaths.filter((path) => {
        const lastStartedAt = lastAutoSyncStartedAtRef.current.get(path)
        return lastStartedAt === undefined || now - lastStartedAt >= AUTO_SYNC_COOLDOWN_MS
      })
    for (const path of duePaths) {
      lastAutoSyncStartedAtRef.current.set(path, now)
    }
    return duePaths
  }, [resolveTargetVaultPaths])
  const refreshRemoteStatus = useRemoteStatusRefresher(setRemoteStatus)
  const checkExistingConflicts = useConflictChecker(setSyncStatus, setConflictFiles, setConflictVaultPath, callbacksRef)
  const refreshCommitInfo = useCommitInfoRefresher(vaultPath, setLastCommitInfo)
  const checkActiveConflicts = useCallback(
    () => checkExistingConflicts(targetVaultPaths),
    [checkExistingConflicts, targetVaultPaths],
  )
  const refreshActiveRemoteStatus = useCallback(
    () => refreshRemoteStatus(targetVaultPaths),
    [refreshRemoteStatus, targetVaultPaths],
  )

  const performPull = useCallback(async (targetVaultPath?: string, options: SyncBudgetOptions = {}) => {
    if (!enabled) return
    const pullVaultPaths = resolveBudgetedTargetVaultPaths(targetVaultPath, options)
    if (pullVaultPaths.length === 0) return

    await runSyncTask({
      blockWhenPaused: true,
      pauseRef,
      syncingRef,
      setLastSyncTime,
      setSyncStatus,
      task: async () => {
        const outcomes = await Promise.all(pullVaultPaths.map(async (path) => ({
          result: await tauriCall<GitPullResult>('git_pull', { vaultPath: path }),
          vaultPath: path,
        })))
        markPullTimestamp(setLastSyncTime, refreshCommitInfo, pullVaultPaths[0])

        const conflictOutcome = firstConflictOutcome(outcomes)
        if (conflictOutcome) {
          setConflictState({
            callbacksRef,
            files: conflictOutcome.result.conflictFiles,
            setSyncStatus,
            setConflictFiles,
            setConflictVaultPath,
            vaultPath: conflictOutcome.vaultPath,
          })
        } else if (hasPullError(outcomes)) {
          await resolvePullError({
            checkExistingConflicts: () => checkExistingConflicts(pullVaultPaths),
            callbacksRef,
            setSyncStatus,
          })
        } else {
          const updatedOutcomes = updatedPullOutcomes(outcomes)
          if (updatedOutcomes.length > 0) {
            await handleUpdatedPull({
              outcomes: updatedOutcomes,
              callbacksRef,
              setConflictFiles,
              setConflictVaultPath,
              setSyncStatus,
            })
          } else {
            clearConflictState(setSyncStatus, setConflictFiles, setConflictVaultPath)
          }
        }

        void refreshRemoteStatus(pullVaultPaths)
      },
    })
  }, [enabled, resolveBudgetedTargetVaultPaths, refreshCommitInfo, checkExistingConflicts, refreshRemoteStatus])

  /** Pull from remote, then auto-push if successful. Used for divergence recovery. */
  const pullAndPush = useCallback(async (targetVaultPath?: string) => {
    if (!enabled) return
    const pullVaultPaths = resolveBudgetedTargetVaultPaths(targetVaultPath, { force: true })
    if (pullVaultPaths.length === 0) return

    await runSyncTask({
      blockWhenPaused: false,
      pauseRef,
      syncingRef,
      setLastSyncTime,
      setSyncStatus,
      task: async () => {
        const pullOutcomes = await Promise.all(pullVaultPaths.map(async (path) => ({
          result: await tauriCall<GitPullResult>('git_pull', { vaultPath: path }),
          vaultPath: path,
        })))
        markPullTimestamp(setLastSyncTime, refreshCommitInfo, pullVaultPaths[0])

        const conflictOutcome = firstConflictOutcome(pullOutcomes)
        if (conflictOutcome) {
          setConflictState({
            callbacksRef,
            files: conflictOutcome.result.conflictFiles,
            setSyncStatus,
            setConflictFiles,
            setConflictVaultPath,
            vaultPath: conflictOutcome.vaultPath,
          })
          return
        }

        const pullError = firstPullError(pullOutcomes)
        if (pullError) {
          await resolvePullError({
            checkExistingConflicts: () => checkExistingConflicts(pullVaultPaths),
            notifyError: `Pull failed: ${pullError.result.message}`,
            callbacksRef,
            setSyncStatus,
          })
          return
        }

        const updatedOutcomes = updatedPullOutcomes(pullOutcomes)
        if (updatedOutcomes.length > 0) {
          await refreshUpdatedVaults({
            outcomes: updatedOutcomes,
            callbacksRef,
            setConflictFiles,
            setConflictVaultPath,
            setSyncStatus,
          })
        }

        const pushVaultPaths = pullOutcomes
          .filter((outcome) => outcome.result.status !== 'no_remote')
          .map((outcome) => outcome.vaultPath)

        if (pushVaultPaths.length === 0) {
          clearConflictState(setSyncStatus, setConflictFiles, setConflictVaultPath)
          void refreshRemoteStatus(pullVaultPaths)
          return
        }

        const pushOutcomes = await Promise.all(pushVaultPaths.map(async (path) => ({
          result: await tauriCall<GitPushResult>('git_push', { vaultPath: path }),
          vaultPath: path,
        })))
        handlePushResult({
          outcomes: pushOutcomes,
          callbacksRef,
          setConflictFiles,
          setConflictVaultPath,
          setSyncStatus,
        })

        void refreshRemoteStatus(pullVaultPaths)
      },
    })
  }, [enabled, resolveBudgetedTargetVaultPaths, refreshCommitInfo, checkExistingConflicts, refreshRemoteStatus])

  const handlePushRejected = useCallback(() => {
    setSyncStatus('pull_required')
  }, [])

  useAutoSyncLifecycle({
    enabled,
    checkExistingConflicts: checkActiveConflicts,
    intervalMinutes,
    performPull,
    refreshRemoteStatus: refreshActiveRemoteStatus,
  })

  const pausePull = useCallback(() => { pauseRef.current = true }, [])
  const resumePull = useCallback(() => { pauseRef.current = false }, [])

  const triggerSync = useCallback((targetVaultPath?: string) => {
    if (!enabled) return

    trackEvent('sync_triggered')
    void performPull(targetVaultPath, { force: true })
  }, [enabled, performPull])

  return { syncStatus, lastSyncTime, conflictFiles, conflictVaultPath, lastCommitInfo, remoteStatus, triggerSync, pullAndPush, pausePull, resumePull, handlePushRejected }
}
