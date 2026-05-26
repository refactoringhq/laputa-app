import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultOption } from '../components/StatusBar'

export interface PersistedVaultList {
  vaults: Array<{
    label: string
    path: string
    alias?: string | null
    shortLabel?: string | null
    color?: string | null
    icon?: string | null
    mounted?: boolean | null
  }>
  active_vault: string | null
  default_workspace_path?: string | null
  hidden_defaults: string[]
}

function persistedVaultOption(v: PersistedVaultList['vaults'][number]): VaultOption {
  return {
    label: v.label,
    path: v.path,
    alias: v.alias ?? undefined,
    ...(v.shortLabel ? { shortLabel: v.shortLabel } : {}),
    color: v.color ?? null,
    icon: v.icon ?? null,
    mounted: v.mounted !== false,
  }
}

function tauriCall<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

async function checkAvailability(v: PersistedVaultList['vaults'][number]): Promise<VaultOption> {
  try {
    const exists = await tauriCall<boolean>('check_vault_exists', { path: v.path })
    return { ...persistedVaultOption(v), available: exists }
  } catch (error) {
    void error
    return { ...persistedVaultOption(v), available: false }
  }
}

export async function loadVaultList(): Promise<{
  vaults: VaultOption[]
  activeVault: string | null
  defaultWorkspacePath: string | null
  hiddenDefaults: string[]
}> {
  const data = await tauriCall<PersistedVaultList>('load_vault_list', {})
  const persisted = data.vaults
  const checked = await Promise.all(persisted.map(checkAvailability))
  return {
    vaults: checked,
    activeVault: data.active_vault,
    defaultWorkspacePath: data.default_workspace_path ?? data.active_vault,
    hiddenDefaults: data.hidden_defaults,
  }
}

export function saveVaultList(
  vaults: VaultOption[],
  activeVault: string | null,
  hiddenDefaults: string[] = [],
  defaultWorkspacePath: string | null = activeVault,
): Promise<void> {
  const list: PersistedVaultList = {
    vaults: vaults.map(v => ({
      label: v.label,
      path: v.path,
      alias: v.alias ?? null,
      ...(v.shortLabel ? { shortLabel: v.shortLabel } : {}),
      color: v.color ?? null,
      icon: v.icon ?? null,
      mounted: v.mounted !== false,
    })),
    active_vault: activeVault,
    default_workspace_path: defaultWorkspacePath,
    hidden_defaults: hiddenDefaults,
  }
  return tauriCall('save_vault_list', { list })
}
