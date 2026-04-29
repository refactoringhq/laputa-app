import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import { normalizeStoredAiAgent } from '../lib/aiAgents'
import { shouldHideGitignoredFiles } from '../lib/gitignoredVisibility'
import {
  notifyGitignoredVisibilityChanged,
  TOGGLE_GITIGNORED_VISIBILITY_EVENT,
} from '../lib/gitignoredVisibilityEvents'
import { serializeUiLanguagePreference } from '../lib/i18n'
import { normalizeReleaseChannel, serializeReleaseChannel } from '../lib/releaseChannel'
import { normalizeThemeMode } from '../lib/themeMode'
import type { Settings } from '../types'
import { normalizeNoteWidthMode } from '../utils/noteWidth'

async function invokeNativeIfAvailable<T>(command: string, tauriArgs: Record<string, unknown>): Promise<T | undefined> {
  try {
    return await invoke<T>(command, tauriArgs)
  } catch (err) {
    if (isTauri()) throw err
    return undefined
  }
}

async function tauriCall<T>(command: string, tauriArgs: Record<string, unknown>, mockArgs?: Record<string, unknown>): Promise<T> {
  if (isTauri()) return invoke<T>(command, tauriArgs)

  const nativeResult = await invokeNativeIfAvailable<T>(command, tauriArgs)
  if (nativeResult !== undefined) return nativeResult

  return mockInvoke<T>(command, mockArgs ?? tauriArgs)
}

const EMPTY_SETTINGS: Settings = {
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

function normalizeSettings(settings: Settings): Settings {
  return {
    ...settings,
    release_channel: serializeReleaseChannel(
      normalizeReleaseChannel(settings.release_channel),
    ),
    theme_mode: normalizeThemeMode(settings.theme_mode),
    ui_language: serializeUiLanguagePreference(settings.ui_language),
    note_width_mode: normalizeNoteWidthMode(settings.note_width_mode),
    default_ai_agent: normalizeStoredAiAgent(settings.default_ai_agent),
    hide_gitignored_files: settings.hide_gitignored_files ?? null,
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  const loadSettings = useCallback(async () => {
    try {
      const s = await tauriCall<Settings>('get_settings', {})
      setSettings(normalizeSettings(s))
    } catch (err) {
      console.warn('Failed to load settings:', err)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const saveSettings = useCallback(async (newSettings: Settings) => {
    const previousHideGitignored = shouldHideGitignoredFiles(settings)
    const normalizedSettings = normalizeSettings(newSettings)
    try {
      await tauriCall<null>('save_settings', { settings: normalizedSettings })
      setSettings(normalizedSettings)
      const nextHideGitignored = shouldHideGitignoredFiles(normalizedSettings)
      if (previousHideGitignored !== nextHideGitignored) {
        notifyGitignoredVisibilityChanged(nextHideGitignored)
      }
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
  }, [settings])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleToggleGitignoredVisibility = () => {
      void saveSettings({
        ...settings,
        hide_gitignored_files: !shouldHideGitignoredFiles(settings),
      })
    }

    window.addEventListener(TOGGLE_GITIGNORED_VISIBILITY_EVENT, handleToggleGitignoredVisibility)
    return () => {
      window.removeEventListener(TOGGLE_GITIGNORED_VISIBILITY_EVENT, handleToggleGitignoredVisibility)
    }
  }, [saveSettings, settings])

  return { settings, loaded, saveSettings }
}
