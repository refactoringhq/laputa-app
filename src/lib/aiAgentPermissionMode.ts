export type AiAgentPermissionMode = 'safe' | 'power_user'

export const DEFAULT_AI_AGENT_PERMISSION_MODE: AiAgentPermissionMode = 'safe'

export const AI_AGENT_PERMISSION_MODE_LABELS: Record<
  AiAgentPermissionMode,
  { short: string; control: string }
> = {
  safe: {
    short: 'Safe',
    control: 'Vault Safe',
  },
  power_user: {
    short: 'Power User',
    control: 'Power User',
  },
}

export function normalizeAiAgentPermissionMode(value: unknown): AiAgentPermissionMode {
  return value === 'power_user' ? 'power_user' : DEFAULT_AI_AGENT_PERMISSION_MODE
}

export function aiAgentPermissionModeMarker(mode: AiAgentPermissionMode): string {
  const label = AI_AGENT_PERMISSION_MODE_LABELS[mode].short
  return `AI permission mode changed to ${label}. It will apply to the next message.`
}
