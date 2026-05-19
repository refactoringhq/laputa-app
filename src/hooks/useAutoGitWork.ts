import { useMemo } from 'react'
import type { GitRemoteStatus, ModifiedFile } from '../types'
import { autoGitWorkSignature, hasAutoGitWork } from '../utils/autoGitWork'

interface UseAutoGitWorkOptions {
  activeRemoteStatus: GitRemoteStatus | null
  activeVaultPath: string
  modifiedFiles: ModifiedFile[]
  repositoryPaths: string[]
  remoteStatusForRepository: (path: string) => GitRemoteStatus | null
}

interface AutoGitWorkState {
  activitySignature: string
  hasPendingWork: boolean
}

export function useAutoGitWork({
  activeRemoteStatus,
  activeVaultPath,
  modifiedFiles,
  repositoryPaths,
  remoteStatusForRepository,
}: UseAutoGitWorkOptions): AutoGitWorkState {
  const input = useMemo(() => ({
    activeRemoteStatus,
    activeVaultPath,
    modifiedFiles,
    repositoryPaths,
    remoteStatusForRepository,
  }), [
    activeRemoteStatus,
    activeVaultPath,
    modifiedFiles,
    repositoryPaths,
    remoteStatusForRepository,
  ])

  return useMemo(() => ({
    activitySignature: autoGitWorkSignature(input),
    hasPendingWork: hasAutoGitWork(input),
  }), [input])
}
