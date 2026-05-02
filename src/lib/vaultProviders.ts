export type VaultProviderType = 'local-folder' | 'icloud-drive'

export type VaultProviderValidationResult = 'valid' | 'warning' | 'invalid'

export interface PersistedVaultEntry {
  label: string
  path: string
  providerType?: string | null
  providerRoot?: string | null
}

export interface VaultProviderRef {
  providerType: VaultProviderType
  providerRoot: string
}

export interface ValidatedVaultProviderSelection extends VaultProviderRef {
  validationResult: VaultProviderValidationResult
  message: string | null
}

const DEFAULT_PROVIDER_TYPE: VaultProviderType = 'local-folder'

export function normalizeVaultProviderType(providerType: string | null | undefined): VaultProviderType {
  return providerType === 'icloud-drive' ? 'icloud-drive' : DEFAULT_PROVIDER_TYPE
}

export function normalizePersistedVaultEntry(entry: PersistedVaultEntry): PersistedVaultEntry & VaultProviderRef {
  const providerType = normalizeVaultProviderType(entry.providerType)
  const providerRoot = entry.providerRoot?.trim() || entry.path
  return {
    ...entry,
    providerType,
    providerRoot,
  }
}

export function normalizeValidatedVaultProviderSelection(
  selection: Omit<ValidatedVaultProviderSelection, 'providerType'> & { providerType?: string | null },
): ValidatedVaultProviderSelection {
  return {
    ...selection,
    providerType: normalizeVaultProviderType(selection.providerType),
  }
}
