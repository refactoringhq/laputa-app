import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import type { Settings } from '../types'
import {
  GITIGNORED_VISIBILITY_CHANGED_EVENT,
  TOGGLE_GITIGNORED_VISIBILITY_EVENT,
} from '../lib/gitignoredVisibilityEvents'
import { useSettings } from './useSettings'

const defaultSettings: Settings = {
  auto_pull_interval_minutes: null,
  autogit_enabled: null,
  autogit_idle_threshold_seconds: null,
  autogit_inactive_threshold_seconds: null,
  auto_advance_inbox_after_organize: null,
  telemetry_consent: null,
  crash_reporting_enabled: null,
  analytics_enabled: null,
  anonymous_id: null,
  release_channel: null,
  theme_mode: null,
  ui_language: null,
  note_width_mode: null,
  default_ai_agent: null,
  hide_gitignored_files: null,
}

const savedSettings: Settings = {
  auto_pull_interval_minutes: 15,
  autogit_enabled: true,
  autogit_idle_threshold_seconds: 90,
  autogit_inactive_threshold_seconds: 30,
  auto_advance_inbox_after_organize: true,
  telemetry_consent: null,
  crash_reporting_enabled: null,
  analytics_enabled: null,
  anonymous_id: null,
  release_channel: null,
  theme_mode: null,
  ui_language: null,
  note_width_mode: null,
  default_ai_agent: null,
  hide_gitignored_files: null,
}

let mockSettingsStore: Settings = { ...defaultSettings }

const mockInvokeFn = vi.fn((cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
  if (cmd === 'get_settings') return Promise.resolve({ ...mockSettingsStore })
  if (cmd === 'save_settings') {
    mockSettingsStore = { ...(args as { settings: Settings }).settings }
    return Promise.resolve(null)
  }
  return Promise.resolve(null)
})

const nativeInvoke = vi.mocked(invoke)

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvokeFn(cmd, args),
}))

async function renderLoadedSettings(): Promise<Settings> {
  const { result } = renderHook(() => useSettings())

  await waitFor(() => {
    expect(result.current.loaded).toBe(true)
  })

  return result.current.settings
}

function changedSettings(): Settings {
  return {
    auto_pull_interval_minutes: null,
    autogit_enabled: false,
    autogit_idle_threshold_seconds: 120,
    autogit_inactive_threshold_seconds: 45,
    auto_advance_inbox_after_organize: false,
    telemetry_consent: null,
    crash_reporting_enabled: null,
    analytics_enabled: null,
    anonymous_id: null,
    release_channel: null,
    theme_mode: null,
    ui_language: 'zh-CN',
    note_width_mode: 'wide',
    default_ai_agent: null,
    hide_gitignored_files: false,
  }
}

describe('useSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettingsStore = { ...defaultSettings }
    nativeInvoke.mockResolvedValue(undefined)
  })

  it('returns empty settings initially', () => {
    mockInvokeFn.mockImplementationOnce(() => new Promise(() => {}))

    const { result, unmount } = renderHook(() => useSettings())
    expect(result.current.settings).toEqual(defaultSettings)
    expect(result.current.loaded).toBe(false)
    unmount()
  })

  it('loads settings from backend on mount', async () => {
    mockSettingsStore = { ...savedSettings }
    const { result } = renderHook(() => useSettings())

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    expect(result.current.settings.auto_pull_interval_minutes).toBe(15)
    expect(mockInvokeFn).toHaveBeenCalledWith('get_settings', {})
  })

  it('loads settings from native invoke when Tauri globals are not detectable', async () => {
    nativeInvoke.mockResolvedValueOnce({ ...savedSettings, ui_language: 'zh-Hans' })

    const settings = await renderLoadedSettings()

    expect(settings.ui_language).toBe('zh-CN')
    expect(mockInvokeFn).not.toHaveBeenCalledWith('get_settings', {})
  })

  it('normalizes a legacy beta release channel back to stable on load', async () => {
    mockSettingsStore = {
      ...savedSettings,
      release_channel: 'beta',
    }

    const settings = await renderLoadedSettings()
    expect(settings.release_channel).toBeNull()
  })

  it('normalizes unsupported language preferences on load', async () => {
    mockSettingsStore = {
      ...savedSettings,
      ui_language: 'xx-ZZ' as Settings['ui_language'],
    }

    const settings = await renderLoadedSettings()
    expect(settings.ui_language).toBeNull()
  })

  it('normalizes unsupported note width modes on load', async () => {
    mockSettingsStore = {
      ...savedSettings,
      note_width_mode: 'expanded' as Settings['note_width_mode'],
    }

    const settings = await renderLoadedSettings()
    expect(settings.note_width_mode).toBeNull()
  })

  it('saves settings via backend', async () => {
    const { result } = renderHook(() => useSettings())

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    const newSettings = changedSettings()

    await act(async () => {
      await result.current.saveSettings(newSettings)
    })

    expect(mockInvokeFn).toHaveBeenCalledWith('save_settings', { settings: newSettings })
    expect(result.current.settings).toEqual(newSettings)
  })

  it('preserves the Gitignored files visibility preference', async () => {
    mockSettingsStore = {
      ...savedSettings,
      hide_gitignored_files: false,
    }

    const settings = await renderLoadedSettings()

    expect(settings.hide_gitignored_files).toBe(false)
  })

  it('toggles Gitignored file visibility from the command event', async () => {
    const listener = vi.fn()
    window.addEventListener(GITIGNORED_VISIBILITY_CHANGED_EVENT, listener)
    const { result } = renderHook(() => useSettings())

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    await act(async () => {
      window.dispatchEvent(new CustomEvent(TOGGLE_GITIGNORED_VISIBILITY_EVENT))
    })

    await waitFor(() => {
      expect(result.current.settings.hide_gitignored_files).toBe(false)
    })
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(GITIGNORED_VISIBILITY_CHANGED_EVENT, listener)
  })

  it('saves settings through native invoke when Tauri globals are not detectable', async () => {
    const { result } = renderHook(() => useSettings())

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    const newSettings = changedSettings()

    vi.clearAllMocks()
    nativeInvoke.mockResolvedValueOnce(null)

    await act(async () => {
      await result.current.saveSettings(newSettings)
    })

    expect(nativeInvoke).toHaveBeenCalledWith('save_settings', { settings: newSettings })
    expect(mockInvokeFn).not.toHaveBeenCalled()
    expect(result.current.settings).toEqual(newSettings)
  })

  it('handles load error gracefully', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockInvokeFn.mockImplementationOnce(() => Promise.reject(new Error('no config')))

    const { result } = renderHook(() => useSettings())

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    // Should fall back to empty settings
    expect(result.current.settings).toEqual(defaultSettings)
    warnSpy.mockRestore()
  })

  it('handles save error gracefully', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useSettings())

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    mockInvokeFn.mockImplementationOnce(() => Promise.reject(new Error('write failed')))

    await act(async () => {
      await result.current.saveSettings(savedSettings)
    })

    // Settings should not have changed on error
    expect(result.current.settings).toEqual(defaultSettings)
    errorSpy.mockRestore()
  })
})
