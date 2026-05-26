import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppPreferencesProvider, useAppPreferences } from '../hooks/useAppPreferences'
import { useAiAgentsStatus } from '../hooks/useAiAgentsStatus'
import { useSettings } from '../hooks/useSettings'
import { useVaultAiGuidanceStatus } from '../hooks/useVaultAiGuidanceStatus'
import { areAiFeaturesEnabled } from '../lib/aiFeatures'
import type { AiWorkspaceConversationSetting, Settings } from '../types'
import {
  closeCurrentAiWorkspaceWindow,
  dockCurrentAiWorkspaceWindow,
  readAiWorkspaceWindowContext,
} from '../utils/openAiWorkspaceWindow'
import { AppAiWorkspaceSurface } from './AppAiWorkspaceSurface'
import { Toast } from './Toast'

function useAiWorkspaceWindowContext() {
  return useMemo(() => readAiWorkspaceWindowContext(), [])
}

function useTransparentWindowBackground() {
  useEffect(() => {
    const previousBodyBackground = document.body.style.background
    const previousRootBackground = document.documentElement.style.background
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'
    return () => {
      document.body.style.background = previousBodyBackground
      document.documentElement.style.background = previousRootBackground
    }
  }, [])
}

function useAiWorkspaceSettingsSaver(
  enabled: boolean,
  settings: Settings,
  saveSettings: (settings: Settings) => void | Promise<void>,
) {
  return useCallback((conversations: AiWorkspaceConversationSetting[]) => {
    if (!enabled) return
    void saveSettings({ ...settings, ai_workspace_conversations: conversations })
  }, [enabled, saveSettings, settings])
}

export function AiWorkspaceWindowApp() {
  useTransparentWindowBackground()
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const context = useAiWorkspaceWindowContext()
  const { settings, loaded: settingsLoaded, saveSettings } = useSettings()
  const aiAgentsStatus = useAiAgentsStatus()
  const aiFeaturesEnabled = areAiFeaturesEnabled(settings)
  const preferences = useAppPreferences({
    aiAgentsStatus,
    onToast: setToastMessage,
    saveSettings,
    settings,
    settingsLoaded,
  })
  const vaultPath = context.vaultPath ?? ''
  const vaultPaths = context.vaultPaths ?? (vaultPath ? [vaultPath] : [])
  const { status: vaultAiGuidanceStatus } = useVaultAiGuidanceStatus(
    aiFeaturesEnabled && vaultPath ? vaultPath : null,
    vaultPath,
  )
  const handleConversationSettingsChange = useAiWorkspaceSettingsSaver(settingsLoaded, settings, saveSettings)
  const handleDock = useCallback(() => {
    void dockCurrentAiWorkspaceWindow().catch((err) => {
      console.warn('[ai] Failed to dock workspace window:', err)
    })
  }, [])
  const handleClose = useCallback(() => {
    void closeCurrentAiWorkspaceWindow().catch((err) => {
      console.warn('[ai] Failed to close workspace window:', err)
    })
  }, [])

  return (
    <AppPreferencesProvider dateDisplayFormat={preferences.dateDisplayFormat}>
      {settingsLoaded ? (
        <AppAiWorkspaceSurface
          mode="window"
          open
          aiAgentsStatus={aiAgentsStatus}
          aiModelProviders={settings.ai_model_providers ?? []}
          conversationSettings={settings.ai_workspace_conversations ?? null}
          conversationSettingsReady={settingsLoaded}
          defaultAiAgent={preferences.aiAgentPreferences.defaultAiAgent}
          defaultAiTarget={preferences.aiAgentPreferences.defaultAiTarget}
          defaultAiAgentReadiness={preferences.aiAgentPreferences.defaultAiAgentReadiness}
          defaultAiAgentReady={preferences.aiAgentPreferences.defaultAiAgentReady}
          entries={[]}
          openTabs={[]}
          noteList={[]}
          noteListFilter={{ type: null, query: '' }}
          onClose={handleClose}
          onConversationSettingsChange={handleConversationSettingsChange}
          onDock={handleDock}
          onUnsupportedAiPaste={setToastMessage}
          vaultAiGuidanceStatus={vaultAiGuidanceStatus}
          vaultPath={vaultPath}
          vaultPaths={vaultPaths}
          locale={preferences.appLocale}
        />
      ) : (
        <div className="fixed inset-0 bg-background" aria-hidden />
      )}
      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </AppPreferencesProvider>
  )
}
