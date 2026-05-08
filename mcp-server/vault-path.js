import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'

const APP_CONFIG_DIR = 'com.tolaria.app'
const LEGACY_APP_CONFIG_DIR = 'com.laputa.app'

function platformConfigDir(env = process.env) {
  switch (platform()) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support')
    case 'win32':
      return env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    default:
      return env.XDG_CONFIG_HOME || join(homedir(), '.config')
  }
}

export function vaultsJsonPath({ configDir = platformConfigDir() } = {}) {
  const preferred = join(configDir, APP_CONFIG_DIR, 'vaults.json')
  if (existsSync(preferred)) return preferred

  const legacy = join(configDir, LEGACY_APP_CONFIG_DIR, 'vaults.json')
  if (existsSync(legacy)) return legacy

  return preferred
}

export function loadVaultList({ configDir } = {}) {
  const filePath = vaultsJsonPath({ configDir })
  if (!existsSync(filePath)) return null

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    return {
      vaults: (data.vaults || []).map(v => ({
        label: v.label,
        path: v.path,
        alias: v.alias || null,
      })),
      activeVault: data.active_vault || null,
    }
  } catch {
    return null
  }
}

export function resolveVaultPath(
  sessionOverride,
  { env = process.env, loadVaultListFn = () => loadVaultList() } = {},
) {
  if (sessionOverride) return sessionOverride
  const envPath = env.VAULT_PATH?.trim()
  if (envPath) return envPath

  const list = loadVaultListFn()
  if (list) {
    if (list.activeVault) return list.activeVault
    if (list.vaults.length === 1) return list.vaults[0].path
    if (list.vaults.length > 1) {
      throw new Error(
        'Multiple vaults configured but none is active. '
        + 'Use the list_vaults tool to see available vaults, '
        + 'then switch_vault to select one.',
      )
    }
  }

  throw new Error('No vault configured. Open a vault in Tolaria first.')
}

export function requireVaultPath(env = process.env) {
  const vaultPath = env.VAULT_PATH?.trim()
  if (!vaultPath) {
    throw new Error('VAULT_PATH is required. Open a vault in Tolaria before starting MCP tools.')
  }
  return vaultPath
}
