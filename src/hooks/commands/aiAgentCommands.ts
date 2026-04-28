import {
  AI_AGENT_DEFINITIONS,
  isAiAgentInstalled,
  type AiAgentId,
  type AiAgentsStatus,
} from '../../lib/aiAgents'
import {
  isVaultAiGuidanceStatusChecking,
  vaultAiGuidanceNeedsRestore,
  type VaultAiGuidanceStatus,
} from '../../lib/vaultAiGuidance'
import type { CommandAction } from './types'

const AI_AGENT_KEYWORDS = Array.from(new Set(
  AI_AGENT_DEFINITIONS.flatMap((definition) => [
    definition.id,
    definition.shortLabel.toLowerCase(),
    definition.label.toLowerCase(),
  ]),
))

function aiAgentKeywords(...keywords: string[]): string[] {
  return [...keywords, ...AI_AGENT_KEYWORDS]
}

interface AiAgentCommandsConfig {
  aiAgentsStatus?: AiAgentsStatus
  vaultAiGuidanceStatus?: VaultAiGuidanceStatus
  selectedAiAgent?: AiAgentId
  selectedAiAgentLabel?: string
  onOpenAiAgents?: () => void
  onRestoreVaultAiGuidance?: () => void
  onCycleDefaultAiAgent?: () => void
  onSetDefaultAiAgent?: (agent: AiAgentId) => void
}

function explicitSwitchCommands({
  aiAgentsStatus,
  selectedAiAgent,
  onSetDefaultAiAgent,
}: Pick<AiAgentCommandsConfig, 'aiAgentsStatus' | 'selectedAiAgent' | 'onSetDefaultAiAgent'>): CommandAction[] {
  if (!aiAgentsStatus || !selectedAiAgent || !onSetDefaultAiAgent) return []

  return AI_AGENT_DEFINITIONS
    .filter((definition) => definition.id !== selectedAiAgent)
    .filter((definition) => isAiAgentInstalled(aiAgentsStatus, definition.id))
    .map((definition) => ({
      id: `switch-ai-agent-${definition.id}`,
      label: `Switch AI Agent to ${definition.label}`,
      group: 'Settings' as const,
      keywords: aiAgentKeywords('ai', 'agent', 'default', 'switch'),
      enabled: true,
      execute: () => onSetDefaultAiAgent(definition.id),
    }))
}

function restoreGuidanceCommands({
  vaultAiGuidanceStatus,
  onRestoreVaultAiGuidance,
}: Pick<AiAgentCommandsConfig, 'vaultAiGuidanceStatus' | 'onRestoreVaultAiGuidance'>): CommandAction[] {
  if (!vaultAiGuidanceStatus || !onRestoreVaultAiGuidance) return []
  if (isVaultAiGuidanceStatusChecking(vaultAiGuidanceStatus)) return []
  if (!vaultAiGuidanceNeedsRestore(vaultAiGuidanceStatus)) return []

  return [
    {
      id: 'restore-vault-ai-guidance',
      label: 'Restore Tolaria AI Guidance',
      group: 'Settings',
      keywords: aiAgentKeywords('ai', 'agent', 'guidance', 'restore', 'repair', 'agents'),
      enabled: true,
      execute: () => onRestoreVaultAiGuidance(),
    },
  ]
}

export function buildAiAgentCommands({
  aiAgentsStatus,
  vaultAiGuidanceStatus,
  selectedAiAgent,
  selectedAiAgentLabel,
  onOpenAiAgents,
  onRestoreVaultAiGuidance,
  onCycleDefaultAiAgent,
  onSetDefaultAiAgent,
}: AiAgentCommandsConfig): CommandAction[] {
  const commands: CommandAction[] = [
    {
      id: 'open-ai-agents',
      label: 'Open AI Agents',
      group: 'Settings',
      keywords: aiAgentKeywords('ai', 'agent', 'agents', 'assistant', 'settings'),
      enabled: !!onOpenAiAgents,
      execute: () => onOpenAiAgents?.(),
    },
  ]

  commands.push(...restoreGuidanceCommands({
    vaultAiGuidanceStatus,
    onRestoreVaultAiGuidance,
  }))

  const switchCommands = explicitSwitchCommands({
    aiAgentsStatus,
    selectedAiAgent,
    onSetDefaultAiAgent,
  })
  if (aiAgentsStatus && selectedAiAgent) {
    return [...commands, ...switchCommands]
  }

  commands.push({
    id: 'switch-default-ai-agent',
    label: selectedAiAgentLabel ? `Switch Default AI Agent (${selectedAiAgentLabel})` : 'Switch Default AI Agent',
    group: 'Settings',
    keywords: aiAgentKeywords('ai', 'agent', 'default', 'switch'),
    enabled: !!onCycleDefaultAiAgent,
    execute: () => onCycleDefaultAiAgent?.(),
  })

  return commands
}
