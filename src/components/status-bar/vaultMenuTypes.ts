import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import type { AppLocale, TranslationKey } from '../../lib/i18n'
import type { VaultOption } from './types'

export interface VaultMenuProps {
  vaults: VaultOption[]
  vaultPath: string
  defaultWorkspacePath?: string | null
  onSwitchVault: (path: string) => void
  onSetDefaultWorkspace?: (path: string) => void
  onOpenVaultSettings?: () => void
  onOpenLocalFolder?: () => void
  onCreateEmptyVault?: () => void
  onCloneVault?: () => void
  onCloneGettingStarted?: () => void
  onRemoveVault?: (path: string) => void
  onReorderVaults?: (orderedPaths: string[]) => void
  multiWorkspaceEnabled?: boolean
  onUpdateWorkspaceIdentity?: (path: string, patch: Partial<VaultOption>) => void
  compact?: boolean
  locale?: AppLocale
}

export interface VaultMenuActionProps {
  Icon: PhosphorIcon
  labelKey: TranslationKey
  testId: string
  accent?: boolean
  onClick: () => void
}

export interface VaultAction {
  key: string
  Icon: PhosphorIcon
  labelKey: TranslationKey
  testId: string
  accent?: boolean
  onClick: () => void
}

export interface VaultMenuInteractionOptions {
  defaultPath: string
  includedVaults: VaultOption[]
  multiWorkspaceEnabled: boolean
  onSetDefaultWorkspace?: (path: string) => void
  onSwitchVault: (path: string) => void
  onUpdateWorkspaceIdentity?: (path: string, patch: Partial<VaultOption>) => void
  setOpen: (open: boolean) => void
  vaultPath: string
}

export interface MountToggleRequest {
  canSetDefaultWorkspace: boolean
  defaultPath: string
  includedVaultCount: number
  isMounted: boolean
  path: string
}

export interface VaultPathSelection extends VaultMenuInteractionOptions {
  path: string
}

export type BuildVaultActionOptions = Pick<
  VaultMenuProps,
  'multiWorkspaceEnabled' | 'onCreateEmptyVault' | 'onCloneGettingStarted' | 'onCloneVault' | 'onOpenLocalFolder'
>
