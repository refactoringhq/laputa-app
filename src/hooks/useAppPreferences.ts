import { createContext, createElement, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react'
import type { Settings } from '../types'
import type { ThemeMode } from '../lib/themeMode'
import {
  SYSTEM_UI_LANGUAGE,
  getBrowserLanguagePreferences,
  resolveEffectiveLocale,
  serializeUiLanguagePreference,
  type UiLanguagePreference,
} from '../lib/i18n'
import { DEFAULT_DATE_DISPLAY_FORMAT, normalizeDateDisplayFormat, type DateDisplayFormat } from '../utils/dateDisplay'
import { resolveAllNotesFileVisibility } from '../utils/allNotesFileVisibility'
import { useAiAgentPreferences } from './useAiAgentPreferences'
import type { AiAgentsStatus } from '../lib/aiAgents'
import { useDocumentThemeMode } from './useDocumentThemeMode'
import { useTelemetry } from './useTelemetry'
import { useThemeMode } from './useThemeMode'

interface AppPreferencesConfig {
  aiAgentsStatus: AiAgentsStatus
  onToast: (message: string | null) => void
  saveSettings: (settings: Settings) => void | Promise<void>
  settings: Settings
  settingsLoaded: boolean
}

interface AppPreferenceValues {
  dateDisplayFormat: DateDisplayFormat
}

const DEFAULT_APP_PREFERENCES: AppPreferenceValues = {
  dateDisplayFormat: DEFAULT_DATE_DISPLAY_FORMAT,
}

const AppPreferencesContext = createContext<AppPreferenceValues>(DEFAULT_APP_PREFERENCES)

export function AppPreferencesProvider({
  children,
  dateDisplayFormat = DEFAULT_DATE_DISPLAY_FORMAT,
}: {
  children: ReactNode
  dateDisplayFormat?: DateDisplayFormat
}) {
  const value = useMemo(() => ({ dateDisplayFormat }), [dateDisplayFormat])
  return createElement(AppPreferencesContext.Provider, { value }, children)
}

export function useDateDisplayFormat(): DateDisplayFormat {
  return useContext(AppPreferencesContext).dateDisplayFormat
}

export function useAppPreferences({
  aiAgentsStatus,
  onToast,
  saveSettings,
  settings,
  settingsLoaded,
}: AppPreferencesConfig) {
  const systemLocale = useMemo(
    () => resolveEffectiveLocale(SYSTEM_UI_LANGUAGE, getBrowserLanguagePreferences()),
    [],
  )
  const appLocale = useMemo(
    () => resolveEffectiveLocale(settings.ui_language, [systemLocale]),
    [settings.ui_language, systemLocale],
  )
  const dateDisplayFormat = useMemo(
    () => normalizeDateDisplayFormat(settings.date_display_format) ?? DEFAULT_DATE_DISPLAY_FORMAT,
    [settings.date_display_format],
  )
  const allNotesFileVisibility = useMemo(
    () => resolveAllNotesFileVisibility(settings),
    [settings],
  )
  const selectedUiLanguage: UiLanguagePreference = settings.ui_language ?? SYSTEM_UI_LANGUAGE

  useEffect(() => {
    document.documentElement.lang = appLocale
  }, [appLocale])

  useThemeMode(settings.theme_mode, settingsLoaded)
  const documentThemeMode = useDocumentThemeMode()
  const handleToggleThemeMode = useCallback(() => {
    const theme_mode = documentThemeMode === 'dark' ? 'light' : 'dark'
    void saveSettings({ ...settings, theme_mode })
  }, [documentThemeMode, saveSettings, settings])
  const handleSetThemeMode = useCallback((theme_mode: ThemeMode) => {
    if (!settingsLoaded) return
    void saveSettings({ ...settings, theme_mode })
  }, [saveSettings, settings, settingsLoaded])
  const handleSetUiLanguage = useCallback((uiLanguage: UiLanguagePreference) => {
    void saveSettings({ ...settings, ui_language: serializeUiLanguagePreference(uiLanguage) })
  }, [saveSettings, settings])
  const aiAgentPreferences = useAiAgentPreferences({
    settings,
    settingsLoaded,
    saveSettings,
    aiAgentsStatus,
    onToast,
  })

  useTelemetry(settings, settingsLoaded)

  return {
    aiAgentPreferences,
    allNotesFileVisibility,
    appLocale,
    dateDisplayFormat,
    documentThemeMode,
    handleSetThemeMode,
    handleSetUiLanguage,
    handleToggleThemeMode,
    selectedUiLanguage,
    systemLocale,
  }
}
