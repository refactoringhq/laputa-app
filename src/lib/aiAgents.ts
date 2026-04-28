export type AiAgentId = 'claude_code' | 'codex' | 'opencode' | 'pi'

export type AiAgentStatus = 'checking' | 'installed' | 'missing'
export type AiAgentReadiness = 'checking' | 'ready' | 'missing'

export interface AiAgentAvailability {
  status: AiAgentStatus
  version: string | null
}

export type AiAgentsStatus = Record<AiAgentId, AiAgentAvailability>

export interface AiAgentDefinition {
  id: AiAgentId
  label: string
  shortLabel: string
  installUrl: string
}

export const DEFAULT_AI_AGENT: AiAgentId = 'claude_code'

export const AI_AGENT_DEFINITIONS: readonly AiAgentDefinition[] = [
  {
    id: 'claude_code',
    label: 'Claude Code',
    shortLabel: 'Claude',
    installUrl: 'https://docs.anthropic.com/en/docs/claude-code',
  },
  {
    id: 'codex',
    label: 'Codex',
    shortLabel: 'Codex',
    installUrl: 'https://developers.openai.com/codex/cli',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    shortLabel: 'OpenCode',
    installUrl: 'https://opencode.ai/docs/',
  },
  {
    id: 'pi',
    label: 'Pi',
    shortLabel: 'Pi',
    installUrl: 'https://pi.dev',
  },
] as const

export function createAiAgentAvailability(status: AiAgentStatus = 'checking', version: string | null = null): AiAgentAvailability {
  return { status, version }
}

export function createCheckingAiAgentsStatus(): AiAgentsStatus {
  return {
    claude_code: createAiAgentAvailability(),
    codex: createAiAgentAvailability(),
    opencode: createAiAgentAvailability(),
    pi: createAiAgentAvailability(),
  }
}

export function createMissingAiAgentsStatus(): AiAgentsStatus {
  return {
    claude_code: createAiAgentAvailability('missing'),
    codex: createAiAgentAvailability('missing'),
    opencode: createAiAgentAvailability('missing'),
    pi: createAiAgentAvailability('missing'),
  }
}

export function normalizeStoredAiAgent(value: string | null | undefined): AiAgentId | null {
  if (AI_AGENT_DEFINITIONS.some((definition) => definition.id === value)) return value as AiAgentId
  return null
}

export function resolveDefaultAiAgent(value: string | null | undefined): AiAgentId {
  return normalizeStoredAiAgent(value) ?? DEFAULT_AI_AGENT
}

export function getAiAgentDefinition(agent: AiAgentId): AiAgentDefinition {
  return AI_AGENT_DEFINITIONS.find((definition) => definition.id === agent) ?? AI_AGENT_DEFINITIONS[0]
}

function normalizeAvailability(agent: { installed?: boolean | null; version?: string | null } | null | undefined): AiAgentAvailability {
  if (agent?.installed) {
    return createAiAgentAvailability('installed', agent.version ?? null)
  }

  return createAiAgentAvailability('missing', agent?.version ?? null)
}

export function normalizeAiAgentsStatus(payload: Partial<Record<AiAgentId, { installed?: boolean | null; version?: string | null }>> | null | undefined): AiAgentsStatus {
  return {
    claude_code: normalizeAvailability(payload?.claude_code),
    codex: normalizeAvailability(payload?.codex),
    opencode: normalizeAvailability(payload?.opencode),
    pi: normalizeAvailability(payload?.pi),
  }
}

export function isAiAgentsStatusChecking(statuses: AiAgentsStatus): boolean {
  return AI_AGENT_DEFINITIONS.some((definition) => statuses[definition.id].status === 'checking')
}

export function isAiAgentInstalled(statuses: AiAgentsStatus, agent: AiAgentId): boolean {
  return statuses[agent].status === 'installed'
}

export function hasAnyInstalledAiAgent(statuses: AiAgentsStatus): boolean {
  return AI_AGENT_DEFINITIONS.some((definition) => isAiAgentInstalled(statuses, definition.id))
}

export function getNextAiAgentId(current: AiAgentId): AiAgentId {
  const currentIndex = AI_AGENT_DEFINITIONS.findIndex((definition) => definition.id === current)
  if (currentIndex < 0) return DEFAULT_AI_AGENT
  return AI_AGENT_DEFINITIONS[(currentIndex + 1) % AI_AGENT_DEFINITIONS.length].id
}
