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

function buildPullCommands({
  onPull,
}: Pick<GitCommandsConfig, 'onPull'>): CommandAction[] {
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
    onAddRemote,
    onCommitPush,
    onInitializeGit,
    onPull,
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
    ...buildPullCommands({ onPull }),
    { id: 'resolve-conflicts', label: 'Resolve Conflicts', group: 'Git', keywords: ['conflict', 'merge', 'git', 'sync'], enabled: true, execute: () => onResolveConflicts?.() },
    { id: 'view-changes', label: 'View Pending Changes', group: 'Git', keywords: ['modified', 'diff'], enabled: true, execute: () => onSelect({ kind: 'filter', filter: 'changes' }) },
  ]
}
