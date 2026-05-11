import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { GitPushResult, GitRemoteStatus, ModifiedFile } from '../types'
import { trackEvent } from '../lib/telemetry'
import { isTauri, mockInvoke } from '../mock-tauri'
import { generateAutomaticCommitMessage } from '../utils/automaticCommitMessage'

export type CommitMode = 'push' | 'local'

interface LocalCommitResult {
  status: 'local_only'
  message: string
}

type CommitResult = GitPushResult | LocalCommitResult
type CheckpointAction = 'commit' | 'push_only'

interface AutomaticCheckpointOptions {
  savePendingBeforeCommit?: boolean
}

interface CommitFlowConfig {
  savePending: () => Promise<void | boolean>
  loadModifiedFiles: () => Promise<void>
  resolveRemoteStatus: () => Promise<GitRemoteStatus | null>
  resolveRemoteStatusForVaultPath?: (vaultPath: string) => Promise<GitRemoteStatus | null>
  setToastMessage: (msg: string | null) => void
  onPushRejected?: () => void
  automaticVaultPaths?: string[]
  manualVaultPath?: string
  vaultPath: string
}

interface VaultPathArgs {
  vaultPath: string
}

interface CommitArgs extends VaultPathArgs {
  message: string
}

interface CommitExecutionArgs extends CommitArgs {
  commitMode: CommitMode
}

interface AutomaticCheckpointContext extends VaultPathArgs {
  remoteStatus: GitRemoteStatus | null
}

interface AutomaticCheckpointCommand extends AutomaticCheckpointContext {
  action: CheckpointAction
  message?: string
}

interface ExecutedCheckpoint {
  action: CheckpointAction
  result: CommitResult
}

interface RepositoryCheckpointResult {
  action?: CheckpointAction
  error?: unknown
  remoteStatus: GitRemoteStatus | null
  result?: CommitResult
  status: 'executed' | 'failed' | 'skipped'
  vaultPath: string
}

type AutomaticCheckpointRunConfig = Pick<
  CommitFlowConfig,
  | 'loadModifiedFiles'
  | 'onPushRejected'
  | 'resolveRemoteStatus'
  | 'resolveRemoteStatusForVaultPath'
  | 'setToastMessage'
  | 'vaultPath'
>

function commitModeFromRemoteStatus(remoteStatus: GitRemoteStatus | null): CommitMode {
  return remoteStatus?.hasRemote === false ? 'local' : 'push'
}

async function commitLocally({ vaultPath, message }: CommitArgs): Promise<void> {
  if (!isTauri()) {
    await mockInvoke<string>('git_commit', { vaultPath, message })
    return
  }

  await invoke<string>('git_commit', { vaultPath, message })
}

async function pushCommittedChanges({ vaultPath }: VaultPathArgs): Promise<GitPushResult> {
  if (!isTauri()) {
    return mockInvoke<GitPushResult>('git_push', { vaultPath })
  }

  return invoke<GitPushResult>('git_push', { vaultPath })
}

async function readModifiedFiles({ vaultPath }: VaultPathArgs): Promise<ModifiedFile[]> {
  if (!isTauri()) {
    return mockInvoke<ModifiedFile[]>('get_modified_files', { vaultPath })
  }

  return invoke<ModifiedFile[]>('get_modified_files', { vaultPath })
}

async function readRemoteStatus({ vaultPath }: VaultPathArgs): Promise<GitRemoteStatus> {
  if (!isTauri()) {
    return mockInvoke<GitRemoteStatus>('git_remote_status', { vaultPath })
  }

  return invoke<GitRemoteStatus>('git_remote_status', { vaultPath })
}

async function executeCommitAction({
  vaultPath,
  message,
  commitMode,
}: CommitExecutionArgs): Promise<CommitResult> {
  await commitLocally({ vaultPath, message })
  if (commitMode === 'local') {
    return { status: 'local_only', message: 'Committed locally (no remote configured)' }
  }

  return pushCommittedChanges({ vaultPath })
}

function commitToastMessage(result: CommitResult): string {
  if (result.status === 'ok') return 'Committed and pushed'
  if (result.status === 'local_only') return result.message
  if (result.status === 'rejected') return 'Committed, but push rejected — remote has new commits. Pull first.'
  return result.message
}

function isPushRejected(result: CommitResult): boolean {
  return result.status === 'rejected'
}

function formatCommitError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function shouldRetryPush(remoteStatus: GitRemoteStatus | null): boolean {
  return remoteStatus?.hasRemote === true && remoteStatus.ahead > 0
}

function nothingToCommitToast(remoteStatus: GitRemoteStatus | null): string {
  return remoteStatus?.hasRemote === false ? 'Nothing to commit' : 'Nothing to commit or push'
}

function checkpointToastMessage(result: CommitResult, action: CheckpointAction): string {
  if (action === 'push_only') {
    if (result.status === 'ok') return 'Pushed committed changes'
    if (result.status === 'rejected') return 'Push rejected — remote has new commits. Pull first.'
    return result.message
  }

  return commitToastMessage(result)
}

function createAutomaticCheckpointCommand({
  remoteStatus,
  vaultPath,
  message,
}: AutomaticCheckpointContext & { message: string }): AutomaticCheckpointCommand | null {
  if (message.length > 0) {
    return { action: 'commit', remoteStatus, vaultPath, message }
  }

  if (shouldRetryPush(remoteStatus)) {
    return { action: 'push_only', remoteStatus, vaultPath }
  }

  return null
}

async function executeAutomaticCheckpoint(
  command: AutomaticCheckpointCommand,
): Promise<ExecutedCheckpoint> {
  if (command.action === 'push_only') {
    return {
      action: 'push_only',
      result: await pushCommittedChanges({ vaultPath: command.vaultPath }),
    }
  }

  const result = await executeCommitAction({
    vaultPath: command.vaultPath,
    message: command.message ?? '',
    commitMode: commitModeFromRemoteStatus(command.remoteStatus),
  })
  trackEvent('commit_made')
  return { action: 'commit', result }
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

function checkpointVaultPaths({
  automaticVaultPaths,
  vaultPath,
}: Pick<CommitFlowConfig, 'automaticVaultPaths' | 'vaultPath'>): string[] {
  const configuredPaths = automaticVaultPaths && automaticVaultPaths.length > 0
    ? automaticVaultPaths
    : [vaultPath]
  const paths = uniqueVaultPaths(configuredPaths)
  return paths.length > 0 ? paths : [vaultPath]
}

async function resolveRemoteStatusForPath(
  vaultPath: string,
  config: Pick<CommitFlowConfig, 'resolveRemoteStatus' | 'resolveRemoteStatusForVaultPath' | 'vaultPath'>,
): Promise<GitRemoteStatus | null> {
  if (vaultPath === config.vaultPath) {
    return config.resolveRemoteStatus()
  }

  if (config.resolveRemoteStatusForVaultPath) {
    return config.resolveRemoteStatusForVaultPath(vaultPath)
  }

  try {
    return await readRemoteStatus({ vaultPath })
  } catch {
    return null
  }
}

async function checkpointRepository(
  vaultPath: string,
  config: Pick<CommitFlowConfig, 'resolveRemoteStatus' | 'resolveRemoteStatusForVaultPath' | 'vaultPath'>,
): Promise<RepositoryCheckpointResult> {
  const remoteStatus = await resolveRemoteStatusForPath(vaultPath, config)
  const modifiedFiles = await readModifiedFiles({ vaultPath })
  const message = generateAutomaticCommitMessage(modifiedFiles)
  const command = createAutomaticCheckpointCommand({ remoteStatus, vaultPath, message })

  if (!command) {
    return { remoteStatus, status: 'skipped', vaultPath }
  }

  const { action, result } = await executeAutomaticCheckpoint(command)
  return { action, remoteStatus, result, status: 'executed', vaultPath }
}

function multiRepositoryCheckpointToast(results: RepositoryCheckpointResult[]): string {
  const executedCount = results.filter((result) => result.status === 'executed').length
  const failedCount = results.filter((result) => result.status === 'failed').length
  const rejectedCount = results.filter((result) => result.result && isPushRejected(result.result)).length

  if (executedCount === 0) {
    const firstError = results.find((result) => result.status === 'failed')?.error
    return firstError
      ? `AutoGit failed: ${formatCommitError(firstError)}`
      : 'Nothing to commit or push'
  }

  const suffixes = []
  if (rejectedCount > 0) suffixes.push(`${rejectedCount} push rejected`)
  if (failedCount > 0) suffixes.push(`${failedCount} failed`)

  const summary = `AutoGit checkpointed ${executedCount} ${executedCount === 1 ? 'repository' : 'repositories'}`
  return suffixes.length > 0 ? `${summary}; ${suffixes.join(', ')}` : summary
}

async function runCheckpointRefresh({
  loadModifiedFiles,
  resolveRemoteStatus,
}: Pick<CommitFlowConfig, 'loadModifiedFiles' | 'resolveRemoteStatus'>): Promise<void> {
  await loadModifiedFiles()
  await resolveRemoteStatus()
}

async function finalizeCheckpoint({
  result,
  toastMessage,
  loadModifiedFiles,
  resolveRemoteStatus,
  setToastMessage,
  onPushRejected,
}: Pick<CommitFlowConfig, 'loadModifiedFiles' | 'resolveRemoteStatus' | 'setToastMessage' | 'onPushRejected'> & {
  result: CommitResult
  toastMessage: string
}): Promise<void> {
  setToastMessage(toastMessage)
  if (isPushRejected(result)) {
    onPushRejected?.()
  }

  await runCheckpointRefresh({ loadModifiedFiles, resolveRemoteStatus })
}

async function runSingleRepositoryCheckpoint(
  targetVaultPath: string,
  config: AutomaticCheckpointRunConfig,
): Promise<boolean> {
  const remoteStatus = await resolveRemoteStatusForPath(targetVaultPath, config)
  const modifiedFiles = await readModifiedFiles({ vaultPath: targetVaultPath })
  const message = generateAutomaticCommitMessage(modifiedFiles)
  const command = createAutomaticCheckpointCommand({
    remoteStatus,
    vaultPath: targetVaultPath,
    message,
  })

  if (!command) {
    config.setToastMessage(nothingToCommitToast(remoteStatus))
    return false
  }

  const { action, result } = await executeAutomaticCheckpoint(command)
  await finalizeCheckpoint({
    result,
    toastMessage: checkpointToastMessage(result, action),
    loadModifiedFiles: config.loadModifiedFiles,
    resolveRemoteStatus: config.resolveRemoteStatus,
    setToastMessage: config.setToastMessage,
    onPushRejected: config.onPushRejected,
  })
  return true
}

async function checkpointRepositories(
  vaultPaths: string[],
  config: AutomaticCheckpointRunConfig,
): Promise<RepositoryCheckpointResult[]> {
  const results: RepositoryCheckpointResult[] = []
  for (const targetVaultPath of vaultPaths) {
    try {
      results.push(await checkpointRepository(targetVaultPath, config))
    } catch (error) {
      results.push({
        error,
        remoteStatus: null,
        status: 'failed',
        vaultPath: targetVaultPath,
      })
    }
  }
  return results
}

async function runMultipleRepositoryCheckpoint(
  targetVaultPaths: string[],
  config: AutomaticCheckpointRunConfig,
): Promise<boolean> {
  const results = await checkpointRepositories(targetVaultPaths, config)

  if (results.some((result) => result.result && isPushRejected(result.result))) {
    config.onPushRejected?.()
  }

  config.setToastMessage(multiRepositoryCheckpointToast(results))
  await runCheckpointRefresh({
    loadModifiedFiles: config.loadModifiedFiles,
    resolveRemoteStatus: config.resolveRemoteStatus,
  })
  return results.some((result) => result.status === 'executed')
}

function useAutomaticCheckpointAction({
  checkpointInFlightRef,
  savePending,
  loadModifiedFiles,
  resolveRemoteStatus,
  resolveRemoteStatusForVaultPath,
  setToastMessage,
  onPushRejected,
  automaticVaultPaths,
  vaultPath,
}: CommitFlowConfig & {
  checkpointInFlightRef: MutableRefObject<boolean>
}) {
  return useCallback(async ({
    savePendingBeforeCommit = false,
  }: AutomaticCheckpointOptions = {}): Promise<boolean> => {
    if (checkpointInFlightRef.current) return false
    checkpointInFlightRef.current = true

    try {
      if (savePendingBeforeCommit) {
        await savePending()
      }

      const targetVaultPaths = checkpointVaultPaths({ automaticVaultPaths, vaultPath })
      const runConfig = {
        loadModifiedFiles,
        onPushRejected,
        resolveRemoteStatus,
        resolveRemoteStatusForVaultPath,
        setToastMessage,
        vaultPath,
      }
      return targetVaultPaths.length === 1
        ? runSingleRepositoryCheckpoint(targetVaultPaths[0], runConfig)
        : runMultipleRepositoryCheckpoint(targetVaultPaths, runConfig)
    } catch (err) {
      console.error('Commit failed:', err)
      setToastMessage(`Commit failed: ${formatCommitError(err)}`)
      return false
    } finally {
      checkpointInFlightRef.current = false
    }
  }, [
    automaticVaultPaths,
    checkpointInFlightRef,
    loadModifiedFiles,
    onPushRejected,
    resolveRemoteStatus,
    resolveRemoteStatusForVaultPath,
    savePending,
    setToastMessage,
    vaultPath,
  ])
}

function useManualCommitPushAction({
  checkpointInFlightRef,
  savePending,
  loadModifiedFiles,
  resolveRemoteStatus,
  resolveRemoteStatusForVaultPath,
  setToastMessage,
  onPushRejected,
  manualVaultPath,
  vaultPath,
  setShowCommitDialog,
}: CommitFlowConfig & {
  checkpointInFlightRef: MutableRefObject<boolean>
  setShowCommitDialog: (open: boolean) => void
}) {
  return useCallback(async (message: string) => {
    setShowCommitDialog(false)
    if (checkpointInFlightRef.current) return
    checkpointInFlightRef.current = true

    try {
      await savePending()
      const targetVaultPath = manualVaultPath || vaultPath
      const remoteStatus = await resolveRemoteStatusForPath(targetVaultPath, {
        resolveRemoteStatus,
        resolveRemoteStatusForVaultPath,
        vaultPath,
      })
      const result = await executeCommitAction({
        vaultPath: targetVaultPath,
        message,
        commitMode: commitModeFromRemoteStatus(remoteStatus),
      })

      trackEvent('commit_made')
      await finalizeCheckpoint({
        result,
        toastMessage: commitToastMessage(result),
        loadModifiedFiles,
        resolveRemoteStatus,
        setToastMessage,
        onPushRejected,
      })
    } catch (err) {
      console.error('Commit failed:', err)
      setToastMessage(`Commit failed: ${formatCommitError(err)}`)
    } finally {
      checkpointInFlightRef.current = false
    }
  }, [
    checkpointInFlightRef,
    loadModifiedFiles,
    manualVaultPath,
    onPushRejected,
    resolveRemoteStatus,
    resolveRemoteStatusForVaultPath,
    savePending,
    setShowCommitDialog,
    setToastMessage,
    vaultPath,
  ])
}

function useCommitModeRefresh({
  commitModeVaultPathRef,
  manualVaultPath,
  resolveRemoteStatus,
  resolveRemoteStatusForVaultPath,
  setCommitMode,
  showCommitDialog,
  vaultPath,
}: Pick<
  CommitFlowConfig,
  'manualVaultPath' | 'resolveRemoteStatus' | 'resolveRemoteStatusForVaultPath' | 'vaultPath'
> & {
  commitModeVaultPathRef: MutableRefObject<string | null>
  setCommitMode: (mode: CommitMode) => void
  showCommitDialog: boolean
}) {
  useEffect(() => {
    if (!showCommitDialog) return

    let cancelled = false
    const targetVaultPath = manualVaultPath || vaultPath
    if (commitModeVaultPathRef.current === targetVaultPath) return

    void resolveRemoteStatusForPath(targetVaultPath, {
      resolveRemoteStatus,
      resolveRemoteStatusForVaultPath,
      vaultPath,
    }).then((remoteStatus) => {
      if (cancelled) return
      commitModeVaultPathRef.current = targetVaultPath
      setCommitMode(commitModeFromRemoteStatus(remoteStatus))
    })

    return () => {
      cancelled = true
    }
  }, [
    commitModeVaultPathRef,
    manualVaultPath,
    resolveRemoteStatus,
    resolveRemoteStatusForVaultPath,
    setCommitMode,
    showCommitDialog,
    vaultPath,
  ])
}

function useOpenCommitDialog({
  commitModeVaultPathRef,
  loadModifiedFiles,
  manualVaultPath,
  resolveRemoteStatus,
  resolveRemoteStatusForVaultPath,
  savePending,
  setCommitMode,
  setShowCommitDialog,
  setIsPreparingCommit,
  vaultPath,
}: Pick<
  CommitFlowConfig,
  | 'loadModifiedFiles'
  | 'manualVaultPath'
  | 'resolveRemoteStatus'
  | 'resolveRemoteStatusForVaultPath'
  | 'savePending'
  | 'vaultPath'
> & {
  commitModeVaultPathRef: MutableRefObject<string | null>
  setCommitMode: (mode: CommitMode) => void
  setShowCommitDialog: (open: boolean) => void
  setIsPreparingCommit: (value: boolean) => void
}) {
  return useCallback(async () => {
    setIsPreparingCommit(true)
    try {
      await savePending()
      await loadModifiedFiles()
      const targetVaultPath = manualVaultPath || vaultPath
      const remoteStatus = await resolveRemoteStatusForPath(targetVaultPath, {
        resolveRemoteStatus,
        resolveRemoteStatusForVaultPath,
        vaultPath,
      })
      commitModeVaultPathRef.current = targetVaultPath
      setCommitMode(commitModeFromRemoteStatus(remoteStatus))
      setShowCommitDialog(true)
    } finally {
      setIsPreparingCommit(false)
    }
  }, [
    commitModeVaultPathRef,
    loadModifiedFiles,
    manualVaultPath,
    resolveRemoteStatus,
    resolveRemoteStatusForVaultPath,
    savePending,
    setCommitMode,
    setIsPreparingCommit,
    setShowCommitDialog,
    vaultPath,
  ])
}

/** Manages the commit dialog state and the save→commit→push/local flow. */
export function useCommitFlow({
  savePending,
  loadModifiedFiles,
  resolveRemoteStatus,
  resolveRemoteStatusForVaultPath,
  setToastMessage,
  onPushRejected,
  automaticVaultPaths,
  manualVaultPath,
  vaultPath,
}: CommitFlowConfig) {
  const [showCommitDialog, setShowCommitDialog] = useState(false)
  const [commitMode, setCommitMode] = useState<CommitMode>('push')
  const [isPreparingCommit, setIsPreparingCommit] = useState(false)
  const checkpointInFlightRef = useRef(false)
  const commitModeVaultPathRef = useRef<string | null>(null)

  const openCommitDialog = useOpenCommitDialog({
    commitModeVaultPathRef,
    loadModifiedFiles,
    manualVaultPath,
    resolveRemoteStatus,
    resolveRemoteStatusForVaultPath,
    savePending,
    setCommitMode,
    setShowCommitDialog,
    setIsPreparingCommit,
    vaultPath,
  })

  const runAutomaticCheckpoint = useAutomaticCheckpointAction({
    checkpointInFlightRef,
    savePending,
    loadModifiedFiles,
    resolveRemoteStatus,
    resolveRemoteStatusForVaultPath,
    setToastMessage,
    onPushRejected,
    automaticVaultPaths,
    vaultPath,
  })

  const handleCommitPush = useManualCommitPushAction({
    checkpointInFlightRef,
    savePending,
    loadModifiedFiles,
    resolveRemoteStatus,
    resolveRemoteStatusForVaultPath,
    setToastMessage,
    onPushRejected,
    manualVaultPath,
    vaultPath,
    setShowCommitDialog,
  })
  useCommitModeRefresh({
    commitModeVaultPathRef,
    manualVaultPath,
    resolveRemoteStatus,
    resolveRemoteStatusForVaultPath,
    setCommitMode,
    showCommitDialog,
    vaultPath,
  })

  const closeCommitDialog = useCallback(() => setShowCommitDialog(false), [])

  return { showCommitDialog, commitMode, isPreparingCommit, openCommitDialog, handleCommitPush, closeCommitDialog, runAutomaticCheckpoint }
}
