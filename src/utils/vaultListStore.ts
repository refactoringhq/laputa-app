import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultOption } from '../components/StatusBar'
import { normalizePersistedVaultEntry } from '../lib/vaultProviders'

export interface PersistedVaultList {
  vaults: Array<{ label: string; path: string; providerType?: string | null; providerRoot?: string | null }>
  active_vault: string | null
  hidden_defaults: string[]
}

function tauriCall<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

async function checkAvailability(v: PersistedVaultList['vaults'][number]): Promise<VaultOption> {
  const normalized = normalizePersistedVaultEntry(v)
  try {
    const exists = await tauriCall<boolean>('check_vault_exists', { path: normalized.path })
    return { ...normalized, available: exists }
  } catch {
    return { ...normalized, available: false }
  }
}

export async function loadVaultList(): Promise<{ vaults: VaultOption[]; activeVault: string | null; hiddenDefaults: string[] }> {
  const data = await tauriCall<PersistedVaultList>('load_vault_list', {})
  const persisted = data?.vaults ?? []
  const checked = await Promise.all(persisted.map(checkAvailability))
  return { vaults: checked, activeVault: data?.active_vault ?? null, hiddenDefaults: data?.hidden_defaults ?? [] }
}

export function saveVaultList(vaults: VaultOption[], activeVault: string | null, hiddenDefaults: string[] = []): Promise<void> {
  const list: PersistedVaultList = {
    vaults: vaults.map(v => ({
      label: v.label,
      path: v.path,
      providerType: v.providerType,
      providerRoot: v.providerRoot,
    })),
    active_vault: activeVault,
    hidden_defaults: hiddenDefaults,
  }
  return tauriCall('save_vault_list', { list })
}
