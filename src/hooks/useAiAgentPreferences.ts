import { useCallback, useMemo } from 'react'
import { isTauri } from '../mock-tauri'
import {
  getAiAgentDefinition,
  getNextAiAgentId,
  isAiAgentInstalled,
  resolveDefaultAiAgent,
  type AiAgentId,
  type AiAgentsStatus,
} from '../lib/aiAgents'
import type { Settings } from '../types'

interface UseAiAgentPreferencesArgs {
  settings: Settings
  saveSettings: (settings: Settings) => void
  aiAgentsStatus: AiAgentsStatus
  onToast?: (message: string) => void
}

export function useAiAgentPreferences({
  settings,
  saveSettings,
  aiAgentsStatus,
  onToast,
}: UseAiAgentPreferencesArgs) {
  const defaultAiAgent = useMemo(
    () => resolveDefaultAiAgent(settings.default_ai_agent, aiAgentsStatus),
    [settings.default_ai_agent, aiAgentsStatus],
  )

  const defaultAiAgentLabel = getAiAgentDefinition(defaultAiAgent).label
  const defaultAiAgentReady = !isTauri() || isAiAgentInstalled(aiAgentsStatus, defaultAiAgent)

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
    defaultAiAgentReady,
    setDefaultAiAgent,
    cycleDefaultAiAgent,
  }
}
