import type { AppLocale } from '../../lib/i18n'
import type { VaultOption } from './types'
import type { VaultMenuListProps } from './VaultMenuList'
import type { VaultAction, VaultMenuActionProps } from './vaultMenuTypes'

export interface VaultMenuHeaderProps {
  locale: AppLocale
  onOpenVaultSettings?: () => void
}

export interface VaultMenuWorkspaceSectionProps extends VaultMenuHeaderProps {
  setOpen: (open: boolean) => void
}

export type VaultMenuActionComponentProps = VaultMenuActionProps & {
  locale?: AppLocale
}

export interface VaultMenuRemoveConfirmDialogProps {
  locale: AppLocale
  onRemoveVault?: (path: string) => void
  setOpen: (open: boolean) => void
  setVaultPendingRemoval: (vault: VaultOption | null) => void
  vaultPendingRemoval: VaultOption | null
}

export type VaultMenuPopoverProps = VaultMenuListProps & {
  actions: VaultAction[]
  menuMinWidth: number
  onOpenVaultSettings?: () => void
  setOpen: (open: boolean) => void
}
