import { useEffect, useCallback, useSyncExternalStore } from 'react'
import type { VaultConfig } from '../types'
import { initStatusColors } from '../utils/statusStyles'
import { initTagColors } from '../utils/tagStyles'
import { initDisplayModeOverrides } from '../utils/propertyTypes'
import {
  getVaultConfig,
  bindVaultConfigStore,
  resetVaultConfigStore,
  updateVaultConfigField,
  subscribeVaultConfig,
} from '../utils/vaultConfigStore'
import { migrateLocalStorageToVaultConfig } from '../utils/configMigration'
import { DEFAULT_AI_AGENT_PERMISSION_MODE } from '../lib/aiAgentPermissionMode'

const STORAGE_PREFIX = 'laputa:vault-config:'

function storageKey(vaultPath: string): string {
  return `${STORAGE_PREFIX}${vaultPath}`
}

function loadFromStorage(vaultPath: string): VaultConfig {
  const DEFAULT: VaultConfig = {
    zoom: null, view_mode: null, editor_mode: null, note_layout: null,
    ai_agent_permission_mode: DEFAULT_AI_AGENT_PERMISSION_MODE,
    tag_colors: null, status_colors: null, property_display_modes: null,
    inbox: null, allNotes: null,
  }
  try {
    const raw = localStorage.getItem(storageKey(vaultPath))
    if (!raw) return DEFAULT
    return { ...DEFAULT, ...JSON.parse(raw) }
  } catch {
    return DEFAULT
  }
}

function saveToStorage(vaultPath: string, config: VaultConfig): void {
  try {
    localStorage.setItem(storageKey(vaultPath), JSON.stringify(config))
  } catch (err) {
    console.warn('Failed to save vault config:', err)
  }
}

function applyToModules(c: VaultConfig): void {
  initStatusColors(c.status_colors ?? {})
  initTagColors(c.tag_colors ?? {})
  initDisplayModeOverrides(c.property_display_modes ?? {})
}

export function useVaultConfig(vaultPath: string) {
  const config = useSyncExternalStore(subscribeVaultConfig, getVaultConfig)

  useEffect(() => {
    resetVaultConfigStore()

    const loaded = loadFromStorage(vaultPath)
    const migrated = migrateLocalStorageToVaultConfig(loaded)
    const needsSave = migrated !== loaded
    bindVaultConfigStore(migrated, (c) => saveToStorage(vaultPath, c))
    applyToModules(migrated)
    if (needsSave) saveToStorage(vaultPath, migrated)

    return () => resetVaultConfigStore()
  }, [vaultPath])

  const update = useCallback(<K extends keyof VaultConfig>(key: K, value: VaultConfig[K]) => {
    updateVaultConfigField(key, value)
    // Re-apply to modules for color/property changes
    const next = getVaultConfig()
    applyToModules(next)
  }, [])

  return { config, updateConfig: update }
}
