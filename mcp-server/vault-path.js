import { existsSync, readFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { isAbsolute, join } from 'node:path'
import appConfigPolicy from './app-config-policy.json' with { type: 'json' }

const APP_CONFIG_DIR = appConfigPolicy.current_namespace
const APP_CONFIG_FILES = Object.freeze(appConfigPolicy.files)

function parseVaultPathList(rawValue) {
  if (!rawValue?.trim()) return []

  try {
    const parsed = JSON.parse(rawValue)
    if (Array.isArray(parsed)) return parsed.filter(value => typeof value === 'string')
  } catch {
    // Older clients only set VAULT_PATH; keep VAULT_PATHS strict JSON so paths
    // with platform separators are never split incorrectly.
  }

  return []
}

function uniqueVaultPaths(paths) {
  const seen = new Set()
  const unique = []
  for (const path of paths) {
    const trimmed = path.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    unique.push(trimmed)
  }
  return unique
}

function absolutePath(path) {
  return typeof path === 'string' && isAbsolute(path) ? path : null
}

function defaultXdgConfigHome(platformName, homeDir) {
  if (platformName === 'win32') return null
  return absolutePath(homeDir) ? join(homeDir, '.config') : null
}

function platformConfigDir(env, platformName, homeDir) {
  if (platformName === 'darwin') return join(homeDir, 'Library', 'Application Support')
  if (platformName === 'win32') return absolutePath(env.APPDATA) || join(homeDir, 'AppData', 'Roaming')
  return absolutePath(env.XDG_CONFIG_HOME) || defaultXdgConfigHome(platformName, homeDir)
}

export function appConfigBaseDirs({
  env = process.env,
  homeDir = homedir(),
  platformName = platform(),
  platformDir = platformConfigDir(env, platformName, homeDir),
} = {}) {
  const primary = absolutePath(env.XDG_CONFIG_HOME)
    || defaultXdgConfigHome(platformName, homeDir)
    || platformDir
  const dirs = primary ? [primary] : []
  if (platformDir && platformDir !== primary) dirs.push(platformDir)
  return dirs
}

function namespaceDir(namespace) {
  if (namespace === 'current') return APP_CONFIG_DIR
  if (namespace === 'legacy') return appConfigPolicy.legacy_namespace
  throw new Error(`Unknown app config namespace: ${namespace}`)
}

function preferredAppConfigPath(configDir, fileName) {
  return join(configDir, APP_CONFIG_DIR, fileName)
}

function existingOrPreferredAppConfigPath(configDirs, fileName) {
  for (const configDir of configDirs) {
    for (const namespace of appConfigPolicy.namespace_read_order) {
      const candidate = join(configDir, namespaceDir(namespace), fileName)
      if (existsSync(candidate)) return candidate
    }
  }

  return preferredAppConfigPath(configDirs[0], fileName)
}

export function appConfigFilePath(
  fileName,
  { configDir, configDirs = configDir ? [configDir] : appConfigBaseDirs() } = {},
) {
  return existingOrPreferredAppConfigPath(configDirs, fileName)
}

export function vaultsJsonPath({
  configDir,
  configDirs = configDir ? [configDir] : appConfigBaseDirs(),
} = {}) {
  return existingOrPreferredAppConfigPath(configDirs, APP_CONFIG_FILES.vaults)
}

function pushUniquePath(paths, value) {
  const path = typeof value === 'string' ? value.trim() : ''
  if (!path || paths.includes(path)) return
  paths.push(path)
}

function activeVaultPathsFromList(list) {
  const paths = []
  pushUniquePath(paths, list?.active_vault)

  for (const vault of list?.vaults ?? []) {
    if (vault?.mounted === false) continue
    pushUniquePath(paths, vault?.path)
  }

  return paths
}

export function configuredVaultPaths(options = {}) {
  const filePath = vaultsJsonPath(options)
  if (!existsSync(filePath)) return []

  return activeVaultPathsFromList(JSON.parse(readFileSync(filePath, 'utf-8')))
}

export function requireVaultPaths(env = process.env, options = {}) {
  const vaultPaths = uniqueVaultPaths([
    env.VAULT_PATH?.trim() ?? '',
    ...parseVaultPathList(env.VAULT_PATHS),
  ])
  if (vaultPaths.length === 0) {
    const configuredPaths = configuredVaultPaths(options)
    if (configuredPaths.length > 0) return configuredPaths
    throw new Error('VAULT_PATH is required. Open a vault in Tolaria before starting MCP tools.')
  }
  return vaultPaths
}

export function requireVaultPath(env = process.env, options = {}) {
  return requireVaultPaths(env, options)[0]
}
