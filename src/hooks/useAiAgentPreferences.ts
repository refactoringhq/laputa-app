import { useCallback, useMemo } from 'react'
import { isTauri } from '../mock-tauri'
import {
  getAiAgentDefinition,
  getNextAiAgentId,
  type AiAgentId,
  type AiAgentsStatus,
} from '../lib/aiAgents'
import {
  agentTargetId,
  resolveAiTargetReadiness,
  resolveAiTarget,
  targetAgent,
} from '../lib/aiTargets'
import type { Settings } from '../types'

interface UseAiAgentPreferencesArgs {
  settings: Settings
  settingsLoaded: boolean
  saveSettings: (settings: Settings) => void
  aiAgentsStatus: AiAgentsStatus
  onToast?: (message: string) => void
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
  const defaultAiTargetReadiness = resolveAiTargetReadiness(defaultAiTarget, aiAgentsStatus, {
    settingsLoaded,
    tauri: isTauri(),
  })

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
    defaultAiAgentReadiness: defaultAiTargetReadiness.readiness,
    defaultAiAgentReady: defaultAiTargetReadiness.ready,
    defaultAiTargetReady: defaultAiTargetReadiness.ready,
    setDefaultAiAgent,
    setDefaultAiTarget,
    cycleDefaultAiAgent,
  }
}
