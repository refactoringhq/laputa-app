import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { GitAuthorIdentity, GitPushResult, GitRemoteStatus, ModifiedFile } from '../types'
import { trackEvent } from '../lib/telemetry'
import { isTauri, mockInvoke } from '../mock-tauri'
import { generateAutomaticCommitMessage } from '../utils/automaticCommitMessage'
import { createTranslator, type AppLocale } from '../lib/i18n'

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
  loadModifiedFilesForVaultPath: (vaultPath: string) => Promise<ModifiedFile[]>
  resolveRemoteStatusForVaultPath: (vaultPath: string) => Promise<GitRemoteStatus | null>
  setToastMessage: (msg: string | null) => void
  onPushRejected?: () => void
  automaticVaultPaths?: string[]
  locale?: AppLocale
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

interface AuthorIdentityLoaderConfig {
  authorIdentityCacheRef: MutableRefObject<Map<string, GitAuthorIdentity>>
  authorIdentityInFlightRef: MutableRefObject<Map<string, Promise<GitAuthorIdentity>>>
  authorIdentityVaultPathRef: MutableRefObject<string | null>
  setAuthorIdentity: (identity: GitAuthorIdentity | null) => void
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
  | 'loadModifiedFilesForVaultPath'
  | 'onPushRejected'
  | 'resolveRemoteStatusForVaultPath'
  | 'setToastMessage'
  | 'vaultPath'
>

type FinalizeCheckpointConfig = Pick<
  CommitFlowConfig,
  'loadModifiedFiles' | 'resolveRemoteStatusForVaultPath' | 'setToastMessage' | 'onPushRejected'
>
type Translator = ReturnType<typeof createTranslator>

interface FinalizeCheckpointArgs extends FinalizeCheckpointConfig {
  result: CommitResult
  toastMessage: string
  vaultPaths: string[]
}

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

async function loadGitAuthorIdentity({ vaultPath }: VaultPathArgs): Promise<GitAuthorIdentity> {
  if (!isTauri()) {
    return mockInvoke<GitAuthorIdentity>('git_author_identity', { vaultPath })
  }

  return invoke<GitAuthorIdentity>('git_author_identity', { vaultPath })
}

function cachedGitAuthorIdentity({
  authorIdentityCacheRef,
  authorIdentityInFlightRef,
  vaultPath,
}: Pick<AuthorIdentityLoaderConfig, 'authorIdentityCacheRef' | 'authorIdentityInFlightRef'> & VaultPathArgs) {
  const cachedIdentity = authorIdentityCacheRef.current.get(vaultPath)
  if (cachedIdentity) return Promise.resolve(cachedIdentity)

  const inFlightIdentity = authorIdentityInFlightRef.current.get(vaultPath)
  if (inFlightIdentity) return inFlightIdentity

  const request = loadGitAuthorIdentity({ vaultPath }).then((identity) => {
    authorIdentityCacheRef.current.set(vaultPath, identity)
    return identity
  }).finally(() => {
    authorIdentityInFlightRef.current.delete(vaultPath)
  })
  authorIdentityInFlightRef.current.set(vaultPath, request)
  return request
}

async function pushCommittedChanges({ vaultPath }: VaultPathArgs): Promise<GitPushResult> {
  if (!isTauri()) {
    return mockInvoke<GitPushResult>('git_push', { vaultPath })
  }

  return invoke<GitPushResult>('git_push', { vaultPath })
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissingGitAuthorIdentityError(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('author identity unknown')
    || normalized.includes('please tell me who you are')
    || normalized.includes('unable to auto-detect email address')
    || (normalized.includes('user.email') && normalized.includes('not set'))
    || (normalized.includes('user.name') && normalized.includes('not set'))
}

function formatCommitFailureToast(error: unknown, t: Translator): string {
  const message = errorMessage(error)
  if (isMissingGitAuthorIdentityError(message)) return t('git.toast.missingAuthor')
  return t('git.toast.commitFailed', { error: message })
}

function formatAutoGitFailureToast(error: unknown, t: Translator): string {
  const message = errorMessage(error)
  if (isMissingGitAuthorIdentityError(message)) return t('git.toast.missingAuthor')
  return t('git.toast.autoGitFailed', { error: message })
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

async function checkpointRepository(
  vaultPath: string,
  config: Pick<CommitFlowConfig, 'loadModifiedFilesForVaultPath' | 'resolveRemoteStatusForVaultPath'>,
): Promise<RepositoryCheckpointResult> {
  const remoteStatus = await config.resolveRemoteStatusForVaultPath(vaultPath)
  const modifiedFiles = await config.loadModifiedFilesForVaultPath(vaultPath)
  const message = generateAutomaticCommitMessage(modifiedFiles)
  const command = createAutomaticCheckpointCommand({ remoteStatus, vaultPath, message })

  if (!command) {
    return { remoteStatus, status: 'skipped', vaultPath }
  }

  const { action, result } = await executeAutomaticCheckpoint(command)
  return { action, remoteStatus, result, status: 'executed', vaultPath }
}

function multiRepositoryCheckpointToast(results: RepositoryCheckpointResult[], t: Translator): string {
  const executedCount = results.filter((result) => result.status === 'executed').length
  const failedCount = results.filter((result) => result.status === 'failed').length
  const rejectedCount = results.filter((result) => result.result && isPushRejected(result.result)).length

  if (executedCount === 0) {
    const firstError = results.find((result) => result.status === 'failed')?.error
    return firstError !== undefined
      ? formatAutoGitFailureToast(firstError, t)
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
  resolveRemoteStatusForVaultPath,
  vaultPaths,
}: Pick<CommitFlowConfig, 'loadModifiedFiles' | 'resolveRemoteStatusForVaultPath'> & {
  vaultPaths: string[]
}): Promise<void> {
  await loadModifiedFiles()
  await Promise.all([...new Set(vaultPaths)].map((vaultPath) => resolveRemoteStatusForVaultPath(vaultPath)))
}

async function finalizeCheckpoint(args: FinalizeCheckpointArgs): Promise<void> {
  const {
    result,
    toastMessage,
    loadModifiedFiles,
    resolveRemoteStatusForVaultPath,
    setToastMessage,
    onPushRejected,
    vaultPaths,
  } = args

  setToastMessage(toastMessage)
  if (isPushRejected(result)) {
    onPushRejected?.()
  }

  await runCheckpointRefresh({ loadModifiedFiles, resolveRemoteStatusForVaultPath, vaultPaths })
}

async function runSingleRepositoryCheckpoint(
  targetVaultPath: string,
  config: AutomaticCheckpointRunConfig,
): Promise<boolean> {
  const remoteStatus = await config.resolveRemoteStatusForVaultPath(targetVaultPath)
  const modifiedFiles = await config.loadModifiedFilesForVaultPath(targetVaultPath)
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
    resolveRemoteStatusForVaultPath: config.resolveRemoteStatusForVaultPath,
    setToastMessage: config.setToastMessage,
    onPushRejected: config.onPushRejected,
    vaultPaths: [targetVaultPath],
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
  t: Translator,
): Promise<boolean> {
  const results = await checkpointRepositories(targetVaultPaths, config)

  if (results.some((result) => result.result && isPushRejected(result.result))) {
    config.onPushRejected?.()
  }

  config.setToastMessage(multiRepositoryCheckpointToast(results, t))
  await runCheckpointRefresh({
    loadModifiedFiles: config.loadModifiedFiles,
    resolveRemoteStatusForVaultPath: config.resolveRemoteStatusForVaultPath,
    vaultPaths: targetVaultPaths,
  })
  return results.some((result) => result.status === 'executed' || result.status === 'failed')
}

function useAutomaticCheckpointAction({
  checkpointInFlightRef,
  savePending,
  loadModifiedFiles,
  loadModifiedFilesForVaultPath,
  resolveRemoteStatusForVaultPath,
  setToastMessage,
  onPushRejected,
  automaticVaultPaths,
  vaultPath,
  t,
}: CommitFlowConfig & {
  checkpointInFlightRef: MutableRefObject<boolean>
  t: Translator
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
        loadModifiedFilesForVaultPath,
        onPushRejected,
        resolveRemoteStatusForVaultPath,
        setToastMessage,
        vaultPath,
      }
      return await (targetVaultPaths.length === 1
        ? runSingleRepositoryCheckpoint(targetVaultPaths[0], runConfig)
        : runMultipleRepositoryCheckpoint(targetVaultPaths, runConfig, t))
    } catch (err) {
      console.error('Commit failed:', err)
      setToastMessage(formatCommitFailureToast(err, t))
      return true
    } finally {
      checkpointInFlightRef.current = false
    }
  }, [
    automaticVaultPaths,
    checkpointInFlightRef,
    loadModifiedFiles,
    loadModifiedFilesForVaultPath,
    onPushRejected,
    resolveRemoteStatusForVaultPath,
    savePending,
    setToastMessage,
    t,
    vaultPath,
  ])
}

function useManualCommitPushAction({
  checkpointInFlightRef,
  savePending,
  loadModifiedFiles,
  resolveRemoteStatusForVaultPath,
  setToastMessage,
  onPushRejected,
  manualVaultPath,
  vaultPath,
  setShowCommitDialog,
  t,
}: Pick<
  CommitFlowConfig,
  | 'savePending'
  | 'loadModifiedFiles'
  | 'resolveRemoteStatusForVaultPath'
  | 'setToastMessage'
  | 'onPushRejected'
  | 'manualVaultPath'
  | 'vaultPath'
> & {
  checkpointInFlightRef: MutableRefObject<boolean>
  setShowCommitDialog: (open: boolean) => void
  t: Translator
}) {
  return useCallback(async (message: string) => {
    setShowCommitDialog(false)
    if (checkpointInFlightRef.current) return
    checkpointInFlightRef.current = true

    try {
      await savePending()
      const targetVaultPath = manualVaultPath || vaultPath
      const remoteStatus = await resolveRemoteStatusForVaultPath(targetVaultPath)
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
        resolveRemoteStatusForVaultPath,
        setToastMessage,
        onPushRejected,
        vaultPaths: [targetVaultPath],
      })
    } catch (err) {
      console.error('Commit failed:', err)
      setToastMessage(formatCommitFailureToast(err, t))
    } finally {
      checkpointInFlightRef.current = false
    }
  }, [
    checkpointInFlightRef,
    loadModifiedFiles,
    manualVaultPath,
    onPushRejected,
    resolveRemoteStatusForVaultPath,
    savePending,
    setShowCommitDialog,
    setToastMessage,
    t,
    vaultPath,
  ])
}

function useCommitModeRefresh({
  commitModeVaultPathRef,
  loadAuthorIdentityForVaultPath,
  manualVaultPath,
  resolveRemoteStatusForVaultPath,
  setCommitMode,
  showCommitDialog,
  vaultPath,
}: Pick<
  CommitFlowConfig,
  'manualVaultPath' | 'resolveRemoteStatusForVaultPath' | 'vaultPath'
> & {
  commitModeVaultPathRef: MutableRefObject<string | null>
  loadAuthorIdentityForVaultPath: (vaultPath: string) => void
  setCommitMode: (mode: CommitMode) => void
  showCommitDialog: boolean
}) {
  useEffect(() => {
    if (!showCommitDialog) return

    let cancelled = false
    const targetVaultPath = manualVaultPath || vaultPath
    loadAuthorIdentityForVaultPath(targetVaultPath)
    if (commitModeVaultPathRef.current === targetVaultPath) return

    void resolveRemoteStatusForVaultPath(targetVaultPath).then((remoteStatus) => {
      if (cancelled) return
      commitModeVaultPathRef.current = targetVaultPath
      setCommitMode(commitModeFromRemoteStatus(remoteStatus))
    })

    return () => {
      cancelled = true
    }
  }, [
    commitModeVaultPathRef,
    loadAuthorIdentityForVaultPath,
    manualVaultPath,
    resolveRemoteStatusForVaultPath,
    setCommitMode,
    showCommitDialog,
    vaultPath,
  ])
}

function useOpenCommitDialog({
  dialogOpeningRef,
  commitModeVaultPathRef,
  loadAuthorIdentityForVaultPath,
  loadModifiedFiles,
  manualVaultPath,
  resolveRemoteStatusForVaultPath,
  savePending,
  setCommitMode,
  setDialogOpening,
  setShowCommitDialog,
  setToastMessage,
  vaultPath,
}: Pick<
  CommitFlowConfig,
  | 'loadModifiedFiles'
  | 'manualVaultPath'
  | 'resolveRemoteStatusForVaultPath'
  | 'savePending'
  | 'setToastMessage'
  | 'vaultPath'
> & {
  dialogOpeningRef: MutableRefObject<boolean>
  commitModeVaultPathRef: MutableRefObject<string | null>
  loadAuthorIdentityForVaultPath: (vaultPath: string) => void
  setCommitMode: (mode: CommitMode) => void
  setDialogOpening: (opening: boolean) => void
  setShowCommitDialog: (open: boolean) => void
}) {
  return useCallback(async () => {
    if (dialogOpeningRef.current) return
    dialogOpeningRef.current = true
    setDialogOpening(true)

    try {
      await savePending()
      await loadModifiedFiles()
      const targetVaultPath = manualVaultPath || vaultPath
      const remoteStatus = await resolveRemoteStatusForVaultPath(targetVaultPath)
      commitModeVaultPathRef.current = targetVaultPath
      setCommitMode(commitModeFromRemoteStatus(remoteStatus))
      setShowCommitDialog(true)
      loadAuthorIdentityForVaultPath(targetVaultPath)
    } catch (err) {
      console.error('Commit dialog failed:', err)
      setToastMessage(`Commit dialog failed: ${errorMessage(err)}`)
    } finally {
      dialogOpeningRef.current = false
      setDialogOpening(false)
    }
  }, [
    commitModeVaultPathRef,
    dialogOpeningRef,
    loadAuthorIdentityForVaultPath,
    loadModifiedFiles,
    manualVaultPath,
    resolveRemoteStatusForVaultPath,
    savePending,
    setCommitMode,
    setDialogOpening,
    setShowCommitDialog,
    setToastMessage,
    vaultPath,
  ])
}

/** Manages the commit dialog state and the save→commit→push/local flow. */
export function useCommitFlow({
  savePending,
  loadModifiedFiles,
  loadModifiedFilesForVaultPath,
  resolveRemoteStatusForVaultPath,
  setToastMessage,
  onPushRejected,
  automaticVaultPaths,
  locale,
  manualVaultPath,
  vaultPath,
}: CommitFlowConfig) {
  const [showCommitDialog, setShowCommitDialog] = useState(false)
  const [commitMode, setCommitMode] = useState<CommitMode>('push')
  const [authorIdentity, setAuthorIdentity] = useState<GitAuthorIdentity | null>(null)
  const [isOpeningCommitDialog, setOpeningCommitDialog] = useState(false)
  const checkpointInFlightRef = useRef(false)
  const dialogOpeningRef = useRef(false)
  const commitModeVaultPathRef = useRef<string | null>(null)
  const authorIdentityCacheRef = useRef(new Map<string, GitAuthorIdentity>())
  const authorIdentityInFlightRef = useRef(new Map<string, Promise<GitAuthorIdentity>>())
  const authorIdentityVaultPathRef = useRef<string | null>(null)
  const t = useMemo(() => createTranslator(locale), [locale])
  const loadAuthorIdentityForVaultPath = useCallback((targetVaultPath: string) => {
    authorIdentityVaultPathRef.current = targetVaultPath

    const cachedIdentity = authorIdentityCacheRef.current.get(targetVaultPath)
    setAuthorIdentity(cachedIdentity ?? null)
    if (cachedIdentity) return

    void cachedGitAuthorIdentity({
      authorIdentityCacheRef,
      authorIdentityInFlightRef,
      vaultPath: targetVaultPath,
    }).then((identity) => {
      if (authorIdentityVaultPathRef.current === targetVaultPath) setAuthorIdentity(identity)
    }).catch((err) => {
      console.error('Git author identity failed:', err)
      if (authorIdentityVaultPathRef.current === targetVaultPath) setAuthorIdentity(null)
    })
  }, [])

  const openCommitDialog = useOpenCommitDialog({
    dialogOpeningRef,
    commitModeVaultPathRef,
    loadAuthorIdentityForVaultPath,
    loadModifiedFiles,
    manualVaultPath,
    resolveRemoteStatusForVaultPath,
    savePending,
    setCommitMode,
    setDialogOpening: setOpeningCommitDialog,
    setShowCommitDialog,
    setToastMessage,
    vaultPath,
  })

  const runAutomaticCheckpoint = useAutomaticCheckpointAction({
    checkpointInFlightRef,
    savePending,
    loadModifiedFiles,
    loadModifiedFilesForVaultPath,
    resolveRemoteStatusForVaultPath,
    setToastMessage,
    onPushRejected,
    automaticVaultPaths,
    vaultPath,
    t,
  })

  const handleCommitPush = useManualCommitPushAction({
    checkpointInFlightRef,
    savePending,
    loadModifiedFiles,
    resolveRemoteStatusForVaultPath,
    setToastMessage,
    onPushRejected,
    manualVaultPath,
    vaultPath,
    setShowCommitDialog,
    t,
  })
  useCommitModeRefresh({
    commitModeVaultPathRef,
    loadAuthorIdentityForVaultPath,
    manualVaultPath,
    resolveRemoteStatusForVaultPath,
    setCommitMode,
    showCommitDialog,
    vaultPath,
  })

  const closeCommitDialog = useCallback(() => setShowCommitDialog(false), [])

  return {
    showCommitDialog,
    commitMode,
    authorIdentity,
    isOpeningCommitDialog,
    openCommitDialog,
    handleCommitPush,
    closeCommitDialog,
    runAutomaticCheckpoint,
  }
}
