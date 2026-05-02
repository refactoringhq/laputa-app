import type { VaultProviderType } from '../../lib/vaultProviders'

export interface VaultOption {
  label: string
  path: string
  providerType?: VaultProviderType
  providerRoot?: string
  available?: boolean
}
