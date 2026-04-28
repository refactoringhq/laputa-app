import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAiAgentPreferences } from './useAiAgentPreferences'

const settings = {
  auto_pull_interval_minutes: 5,
  telemetry_consent: true,
  crash_reporting_enabled: false,
  analytics_enabled: false,
  anonymous_id: null,
  release_channel: 'stable',
  default_ai_agent: 'claude_code' as const,
}

const aiAgentsStatus = {
  claude_code: { status: 'installed' as const, version: '1.0.20' },
  codex: { status: 'missing' as const, version: null },
  opencode: { status: 'missing' as const, version: null },
  pi: { status: 'missing' as const, version: null },
}

describe('useAiAgentPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the selected label and readiness', () => {
    const { result } = renderHook(() => useAiAgentPreferences({
      settings,
      settingsLoaded: true,
      saveSettings: vi.fn(),
      aiAgentsStatus,
    }))

    expect(result.current.defaultAiAgent).toBe('claude_code')
    expect(result.current.defaultAiAgentLabel).toBe('Claude Code')
    expect(result.current.defaultAiAgentReadiness).toBe('ready')
    expect(result.current.defaultAiAgentReady).toBe(true)
  })

  it('keeps the selected agent unavailable while settings are loading', () => {
    const { result } = renderHook(() => useAiAgentPreferences({
      settings,
      settingsLoaded: false,
      saveSettings: vi.fn(),
      aiAgentsStatus,
    }))

    expect(result.current.defaultAiAgentReadiness).toBe('checking')
    expect(result.current.defaultAiAgentReady).toBe(false)
  })

  it('cycles to the next agent and persists the selection', () => {
    const saveSettings = vi.fn()
    const onToast = vi.fn()

    const { result } = renderHook(() => useAiAgentPreferences({
      settings,
      settingsLoaded: true,
      saveSettings,
      aiAgentsStatus,
      onToast,
    }))

    act(() => {
      result.current.cycleDefaultAiAgent()
    })

    expect(saveSettings).toHaveBeenCalledWith({
      ...settings,
      default_ai_agent: 'codex',
    })
    expect(onToast).toHaveBeenCalledWith('Default AI agent: Codex')
  })

  it('keeps the browser mock agent composer enabled when no CLI is installed', () => {
    const { result } = renderHook(() => useAiAgentPreferences({
      settings,
      settingsLoaded: true,
      saveSettings: vi.fn(),
      aiAgentsStatus: {
        claude_code: { status: 'missing', version: null },
        codex: { status: 'missing', version: null },
        opencode: { status: 'missing', version: null },
        pi: { status: 'missing', version: null },
      },
    }))

    expect(result.current.defaultAiAgentReady).toBe(true)
  })
})
