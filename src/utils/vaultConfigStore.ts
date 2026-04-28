import type { VaultConfig } from '../types'
import {
  DEFAULT_AI_AGENT_PERMISSION_MODE,
  normalizeAiAgentPermissionMode,
} from '../lib/aiAgentPermissionMode'

type SaveFn = (config: VaultConfig) => void
type Listener = () => void

const DEFAULT_CONFIG: VaultConfig = {
  zoom: null, view_mode: null, editor_mode: null, note_layout: null,
  ai_agent_permission_mode: DEFAULT_AI_AGENT_PERMISSION_MODE,
  tag_colors: null, status_colors: null, property_display_modes: null,
  inbox: null, allNotes: null,
}

let config: VaultConfig = DEFAULT_CONFIG
let saveFn: SaveFn | null = null
const listeners: Set<Listener> = new Set()

export function getVaultConfig(): VaultConfig {
  return config
}

export function bindVaultConfigStore(initial: VaultConfig, save: SaveFn): void {
  config = normalizeVaultConfig(initial)
  saveFn = save
  notify()
}

export function resetVaultConfigStore(): void {
  config = DEFAULT_CONFIG
  saveFn = null
}

export function updateVaultConfigField<K extends keyof VaultConfig>(key: K, value: VaultConfig[K]): void {
  config = normalizeVaultConfig({ ...config, [key]: value })
  saveFn?.(config)
  notify()
}

export function subscribeVaultConfig(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function notify(): void {
  for (const fn of listeners) fn()
}

function normalizeVaultConfig(next: VaultConfig): VaultConfig {
  return {
    ...DEFAULT_CONFIG,
    ...next,
    ai_agent_permission_mode: normalizeAiAgentPermissionMode(next.ai_agent_permission_mode),
  }
}
