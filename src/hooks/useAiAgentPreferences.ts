import { useCallback, useMemo } from 'react'
import { isTauri } from '../mock-tauri'
import {
  getAiAgentDefinition,
  getNextAiAgentId,
  type AiAgentReadiness,
  type AiAgentId,
  type AiAgentsStatus,
} from '../lib/aiAgents'
import {
  agentTargetId,
  aiTargetReady,
  resolveAiTarget,
  targetAgent,
  type AiTarget,
} from '../lib/aiTargets'
import type { Settings } from '../types'

interface UseAiAgentPreferencesArgs {
  settings: Settings
  settingsLoaded: boolean
  saveSettings: (settings: Settings) => void
  aiAgentsStatus: AiAgentsStatus
  onToast?: (message: string) => void
}

function getDefaultAiTargetReadiness(
  settingsLoaded: boolean,
  aiAgentsStatus: AiAgentsStatus,
  defaultTarget: AiTarget,
): AiAgentReadiness {
  if (!settingsLoaded) return 'checking'
  if (defaultTarget.kind === 'api_model') return 'ready'
  if (!isTauri()) return 'ready'

  const status = aiAgentsStatus[defaultTarget.agent].status
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
  const defaultAiTarget = useMemo(() => resolveAiTarget(settings), [settings])
  const targetAgentId = targetAgent(defaultAiTarget)

  const defaultAiAgentLabel = defaultAiTarget.label
  const defaultAiAgentReadiness = getDefaultAiTargetReadiness(
    settingsLoaded,
    aiAgentsStatus,
    defaultAiTarget,
  )
  const defaultAiAgentReady = defaultAiAgentReadiness === 'ready'

  const setDefaultAiAgent = useCallback((agent: AiAgentId) => {
    saveSettings({
      ...settings,
      default_ai_agent: agent,
      default_ai_target: agentTargetId(agent),
    })
    onToast?.(`Default AI agent: ${getAiAgentDefinition(agent).label}`)
  }, [onToast, saveSettings, settings])

  const setDefaultAiTarget = useCallback((targetId: string) => {
    const nextSettings = { ...settings, default_ai_target: targetId }
    saveSettings(nextSettings)
    onToast?.(`Default AI target: ${resolveAiTarget(nextSettings).label}`)
  }, [onToast, saveSettings, settings])

  const cycleDefaultAiAgent = useCallback(() => {
    setDefaultAiAgent(getNextAiAgentId(targetAgentId))
  }, [setDefaultAiAgent, targetAgentId])

  return {
    defaultAiAgent: targetAgentId,
    defaultAiTarget,
    defaultAiAgentLabel,
    defaultAiAgentReadiness,
    defaultAiAgentReady,
    defaultAiTargetReady: aiTargetReady(defaultAiTarget, aiAgentsStatus),
    setDefaultAiAgent,
    setDefaultAiTarget,
    cycleDefaultAiAgent,
  }
}
