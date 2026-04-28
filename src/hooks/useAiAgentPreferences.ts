import { useCallback, useMemo } from 'react'
import { isTauri } from '../mock-tauri'
import {
  getAiAgentDefinition,
  getNextAiAgentId,
  resolveDefaultAiAgent,
  type AiAgentReadiness,
  type AiAgentId,
  type AiAgentsStatus,
} from '../lib/aiAgents'
import type { Settings } from '../types'

interface UseAiAgentPreferencesArgs {
  settings: Settings
  settingsLoaded: boolean
  saveSettings: (settings: Settings) => void
  aiAgentsStatus: AiAgentsStatus
  onToast?: (message: string) => void
}

function getDefaultAiAgentReadiness(
  settingsLoaded: boolean,
  aiAgentsStatus: AiAgentsStatus,
  defaultAiAgent: AiAgentId,
): AiAgentReadiness {
  if (!settingsLoaded) return 'checking'
  if (!isTauri()) return 'ready'

  const status = aiAgentsStatus[defaultAiAgent].status
  if (status === 'checking') return 'checking'
  return status === 'installed' ? 'ready' : 'missing'
}

export function useAiAgentPreferences({
  settings,
  settingsLoaded,
  saveSettings,
  aiAgentsStatus,
  onToast,
}: UseAiAgentPreferencesArgs) {
  const defaultAiAgent = useMemo(
    () => resolveDefaultAiAgent(settings.default_ai_agent),
    [settings.default_ai_agent],
  )

  const defaultAiAgentLabel = getAiAgentDefinition(defaultAiAgent).label
  const defaultAiAgentReadiness = getDefaultAiAgentReadiness(
    settingsLoaded,
    aiAgentsStatus,
    defaultAiAgent,
  )
  const defaultAiAgentReady = defaultAiAgentReadiness === 'ready'

  const setDefaultAiAgent = useCallback((agent: AiAgentId) => {
    saveSettings({
      ...settings,
      default_ai_agent: agent,
    })
    onToast?.(`Default AI agent: ${getAiAgentDefinition(agent).label}`)
  }, [onToast, saveSettings, settings])

  const cycleDefaultAiAgent = useCallback(() => {
    setDefaultAiAgent(getNextAiAgentId(defaultAiAgent))
  }, [defaultAiAgent, setDefaultAiAgent])

  return {
    defaultAiAgent,
    defaultAiAgentLabel,
    defaultAiAgentReadiness,
    defaultAiAgentReady,
    setDefaultAiAgent,
    cycleDefaultAiAgent,
  }
}
