import { FolderOpen, GitBranch, Plus, Rocket } from '@phosphor-icons/react'
import type { BuildVaultActionOptions, VaultAction } from './vaultMenuTypes'

export function buildVaultActions(options: BuildVaultActionOptions): VaultAction[] {
  const { multiWorkspaceEnabled, onCreateEmptyVault, onCloneGettingStarted, onCloneVault, onOpenLocalFolder } = options
  const items: VaultAction[] = []

  if (onCreateEmptyVault) {
    items.push({
      key: 'create-empty',
      Icon: Plus,
      labelKey: 'status.vault.createEmpty',
      testId: 'vault-menu-create-empty',
      accent: !multiWorkspaceEnabled,
      onClick: onCreateEmptyVault,
    })
  }

  if (onOpenLocalFolder) {
    items.push({
      key: 'open-local',
      Icon: FolderOpen,
      labelKey: 'status.vault.openLocal',
      testId: 'vault-menu-open-local',
      onClick: onOpenLocalFolder,
    })
  }

  if (onCloneVault) {
    items.push({
      key: 'clone-git',
      Icon: GitBranch,
      labelKey: 'status.vault.cloneGit',
      testId: 'vault-menu-clone-git',
      onClick: onCloneVault,
    })
  }

  if (onCloneGettingStarted) {
    items.push({
      key: 'clone-getting-started',
      Icon: Rocket,
      labelKey: 'status.vault.cloneGettingStarted',
      testId: 'vault-menu-clone-getting-started',
      accent: true,
      onClick: onCloneGettingStarted,
    })
  }

  return items
}
