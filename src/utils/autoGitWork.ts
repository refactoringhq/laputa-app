import type { GitRemoteStatus, ModifiedFile } from '../types'

interface AutoGitWorkInput {
  activeRemoteStatus?: GitRemoteStatus | null
  activeVaultPath: string
  modifiedFiles: ModifiedFile[]
  repositoryPaths: string[]
  remoteStatusForRepository: (path: string) => GitRemoteStatus | null
}

function hasPushableCommits(status: GitRemoteStatus | null | undefined): boolean {
  return status?.hasRemote === true && status.ahead > 0
}

function modifiedFileSignature(file: ModifiedFile): string {
  return `${file.vaultPath ?? ''}:${file.relativePath}:${file.status}`
}

function pushableRepositorySignature(
  path: string,
  remoteStatusForRepository: (path: string) => GitRemoteStatus | null,
): string | null {
  const status = remoteStatusForRepository(path)
  return hasPushableCommits(status) ? `${path}:${status.ahead}` : null
}

function activeRemoteSignature({
  activeRemoteStatus,
  activeVaultPath,
  repositoryPaths,
}: Pick<AutoGitWorkInput, 'activeRemoteStatus' | 'activeVaultPath' | 'repositoryPaths'>): string | null {
  if (!hasPushableCommits(activeRemoteStatus)) return null
  if (repositoryPaths.includes(activeVaultPath)) return null
  return `${activeVaultPath}:${activeRemoteStatus.ahead}`
}

export function autoGitWorkSignature({
  activeRemoteStatus,
  activeVaultPath,
  modifiedFiles,
  repositoryPaths,
  remoteStatusForRepository,
}: AutoGitWorkInput): string {
  return [
    ...modifiedFiles.map(modifiedFileSignature),
    ...repositoryPaths.map((path) => pushableRepositorySignature(path, remoteStatusForRepository)),
    activeRemoteSignature({ activeRemoteStatus, activeVaultPath, repositoryPaths }),
  ]
    .filter((part): part is string => Boolean(part))
    .sort()
    .join('|')
}

export function hasAutoGitWork(input: AutoGitWorkInput): boolean {
  return autoGitWorkSignature(input).length > 0
}
