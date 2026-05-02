import { describe, expect, it } from 'vitest'
import {
  normalizePersistedVaultEntry,
  normalizeValidatedVaultProviderSelection,
  normalizeVaultProviderType,
} from './vaultProviders'

describe('vaultProviders', () => {
  it('defaults legacy entries to local-folder and path-based providerRoot', () => {
    expect(normalizePersistedVaultEntry({ label: 'Work', path: '/work' })).toEqual({
      label: 'Work',
      path: '/work',
      providerType: 'local-folder',
      providerRoot: '/work',
    })
  })

  it('preserves valid provider metadata', () => {
    expect(normalizePersistedVaultEntry({
      label: 'iCloud',
      path: '/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Vault',
      providerType: 'icloud-drive',
      providerRoot: '/resolved/icloud/vault',
    })).toEqual({
      label: 'iCloud',
      path: '/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Vault',
      providerType: 'icloud-drive',
      providerRoot: '/resolved/icloud/vault',
    })
  })

  it('falls back safely for malformed provider values', () => {
    expect(normalizePersistedVaultEntry({
      label: 'Broken',
      path: '/broken',
      providerType: 'something-else',
      providerRoot: '',
    })).toEqual({
      label: 'Broken',
      path: '/broken',
      providerType: 'local-folder',
      providerRoot: '/broken',
    })
    expect(normalizeVaultProviderType(undefined)).toBe('local-folder')
  })

  it('normalizes validated provider selections', () => {
    expect(normalizeValidatedVaultProviderSelection({
      validationResult: 'valid',
      providerType: 'unexpected',
      providerRoot: '/vault',
      message: null,
    })).toEqual({
      validationResult: 'valid',
      providerType: 'local-folder',
      providerRoot: '/vault',
      message: null,
    })
  })
})
