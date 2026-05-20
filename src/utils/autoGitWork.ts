import type { GitRemoteStatus, ModifiedFile } from '../types'

interface AutoGitWorkInput {
  activeRemoteStatus?: GitRemoteStatus | null
  activeVaultPath: string
  modifiedFiles: ModifiedFile[]
  repositoryPaths: string[]
  remoteStatusForRepository: (path: string) => GitRemoteStatus | null
}

function pushableAhead(status: GitRemoteStatus | null | undefined): number | null {
  return status?.hasRemote === true && status.ahead > 0 ? status.ahead : null
}

function modifiedFileSignature(file: ModifiedFile): string {
  return `${file.vaultPath ?? ''}:${file.relativePath}:${file.status}`
}

function pushableRepositorySignature(
  path: string,
  remoteStatusForRepository: (path: string) => GitRemoteStatus | null,
): string | null {
  const status = remoteStatusForRepository(path)
  const ahead = pushableAhead(status)
  return ahead === null ? null : `${path}:${ahead}`
}

function activeRemoteSignature({
  activeRemoteStatus,
  activeVaultPath,
  repositoryPaths,
}: Pick<AutoGitWorkInput, 'activeRemoteStatus' | 'activeVaultPath' | 'repositoryPaths'>): string | null {
  const ahead = pushableAhead(activeRemoteStatus)
  if (ahead === null) return null
  if (repositoryPaths.includes(activeVaultPath)) return null
  return `${activeVaultPath}:${ahead}`
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
