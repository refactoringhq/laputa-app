import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultConfig } from '../types'
import {
  bindVaultConfigStore,
  getVaultConfig,
  resetVaultConfigStore,
  updateVaultConfigField,
} from './vaultConfigStore'

function vaultConfig(overrides: Partial<VaultConfig> = {}): VaultConfig {
  return {
    zoom: null,
    view_mode: null,
    editor_mode: null,
    note_layout: null,
    tag_colors: null,
    status_colors: null,
    property_display_modes: null,
    inbox: null,
    allNotes: null,
    ...overrides,
  }
}

describe('vaultConfigStore', () => {
  beforeEach(() => {
    resetVaultConfigStore()
  })

  it('normalizes missing, null, and unknown AI agent permission modes to safe', () => {
    bindVaultConfigStore(vaultConfig(), vi.fn())
    expect(getVaultConfig().ai_agent_permission_mode).toBe('safe')

    bindVaultConfigStore(vaultConfig({ ai_agent_permission_mode: null }), vi.fn())
    expect(getVaultConfig().ai_agent_permission_mode).toBe('safe')

    bindVaultConfigStore({
      ...vaultConfig(),
      ai_agent_permission_mode: 'danger' as VaultConfig['ai_agent_permission_mode'],
    }, vi.fn())
    expect(getVaultConfig().ai_agent_permission_mode).toBe('safe')
  })

  it('persists normalized AI agent permission mode updates', () => {
    const save = vi.fn()
    bindVaultConfigStore(vaultConfig(), save)

    updateVaultConfigField('ai_agent_permission_mode', 'power_user')
    expect(getVaultConfig().ai_agent_permission_mode).toBe('power_user')
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({
      ai_agent_permission_mode: 'power_user',
    }))

    updateVaultConfigField('ai_agent_permission_mode', null)
    expect(getVaultConfig().ai_agent_permission_mode).toBe('safe')
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({
      ai_agent_permission_mode: 'safe',
    }))
  })
})
