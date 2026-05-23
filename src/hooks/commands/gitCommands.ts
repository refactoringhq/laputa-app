import type { CommandAction } from './types'
import type { SidebarSelection } from '../../types'
import type { GitRepositoryOption } from '../../utils/gitRepositories'

interface GitCommandsConfig {
  modifiedCount: number
  canAddRemote: boolean
  gitFeaturesEnabled?: boolean
  isGitVault?: boolean
  repositories?: GitRepositoryOption[]
  onAddRemote?: () => void
  onCommitPush: () => void
  onInitializeGit?: () => void
  onPull?: () => void
  onPullRepository?: (path: string) => void
  onResolveConflicts?: () => void
  onSelect: (sel: SidebarSelection) => void
}

type PullableRepositoryList = [GitRepositoryOption, GitRepositoryOption, ...GitRepositoryOption[]]

function hasRepositoryPullTargets(
  repositories: GitRepositoryOption[] | undefined,
): repositories is PullableRepositoryList {
  if (!repositories) return false
  return repositories.length > 1
}

function buildPullCommands({
  onPull,
  onPullRepository,
  repositories,
}: Pick<GitCommandsConfig, 'onPull' | 'onPullRepository' | 'repositories'>): CommandAction[] {
  if (onPullRepository && hasRepositoryPullTargets(repositories)) {
    const pullRepository = onPullRepository
    return repositories.map((repository, index) => ({
      id: `git-pull-${index}`,
      label: `Pull from Remote: ${repository.label}`,
      group: 'Git',
      keywords: ['git', 'pull', 'fetch', 'download', 'sync', 'remote', repository.label, repository.path],
      enabled: true,
      execute: () => pullRepository(repository.path),
    }))
  }

  return [
    { id: 'git-pull', label: 'Pull from Remote', group: 'Git', keywords: ['git', 'pull', 'fetch', 'download', 'sync', 'remote'], enabled: true, execute: () => onPull?.() },
  ]
}

export function buildGitCommands(config: GitCommandsConfig): CommandAction[] {
  const {
    modifiedCount,
    canAddRemote,
    gitFeaturesEnabled = true,
    isGitVault = true,
    repositories,
    onAddRemote,
    onCommitPush,
    onInitializeGit,
    onPull,
    onPullRepository,
    onResolveConflicts,
    onSelect,
  } = config

  if (!gitFeaturesEnabled) return []

  if (!isGitVault) {
    return [
      {
        id: 'initialize-git',
        label: 'Initialize Git for Current Vault',
        group: 'Git',
        keywords: ['git', 'initialize', 'enable', 'history', 'sync'],
        enabled: Boolean(onInitializeGit),
        execute: () => onInitializeGit?.(),
      },
    ]
  }

  return [
    { id: 'commit-push', label: 'Commit & Push', group: 'Git', keywords: ['git', 'save', 'sync'], enabled: modifiedCount > 0, execute: onCommitPush },
    { id: 'add-remote', label: 'Add Remote to Current Vault', group: 'Git', keywords: ['git', 'remote', 'connect', 'origin', 'no remote'], enabled: canAddRemote && !!onAddRemote, execute: () => onAddRemote?.() },
    ...buildPullCommands({ onPull, onPullRepository, repositories }),
    { id: 'resolve-conflicts', label: 'Resolve Conflicts', group: 'Git', keywords: ['conflict', 'merge', 'git', 'sync'], enabled: true, execute: () => onResolveConflicts?.() },
    { id: 'view-changes', label: 'View Pending Changes', group: 'Git', keywords: ['modified', 'diff'], enabled: true, execute: () => onSelect({ kind: 'filter', filter: 'changes' }) },
  ]
}
