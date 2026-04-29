import { createTranslator, type AppLocale } from './i18n'

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

export function aiAgentPermissionModeLabels(
  mode: AiAgentPermissionMode,
  locale: AppLocale = 'en',
): { short: string; control: string } {
  const t = createTranslator(locale)
  return mode === 'power_user'
    ? {
      short: t('ai.permission.powerUser.short'),
      control: t('ai.permission.powerUser.control'),
    }
    : {
      short: t('ai.permission.safe.short'),
      control: t('ai.permission.safe.control'),
    }
}

export function aiAgentPermissionModeMarker(
  mode: AiAgentPermissionMode,
  locale: AppLocale = 'en',
): string {
  const t = createTranslator(locale)
  const label = aiAgentPermissionModeLabels(mode, locale).short
  return t('ai.permission.changed', { label })
}
