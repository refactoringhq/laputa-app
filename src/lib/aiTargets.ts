import {
  AI_AGENT_DEFINITIONS,
  DEFAULT_AI_AGENT,
  getAiAgentAvailability,
  normalizeStoredAiAgent,
  type AiAgentId,
  type AiAgentReadiness,
  type AiAgentsStatus,
} from './aiAgents'
import providerCatalog from '../shared/aiModelProviderCatalog.json' with { type: 'json' }
import type { Settings } from '../types'
import type { TranslationKey } from './i18n'

export type AiModelProviderKind = 'open_ai' | 'anthropic' | 'open_ai_compatible' | 'ollama' | 'lm_studio' | 'open_router' | 'gemini'
export type AiTargetKind = 'agent' | 'api_model'
export type AiModelApiKeyStorage = 'none' | 'env' | 'local_file'

export interface AiModelCapabilities {
  streaming: boolean
  tools: boolean
  vision: boolean
  json_mode: boolean
  reasoning: boolean
}

export interface AiModelDefinition {
  id: string
  display_name?: string | null
  context_window?: number | null
  max_output_tokens?: number | null
  capabilities: AiModelCapabilities
}

export interface AiModelProvider {
  id: string
  name: string
  kind: AiModelProviderKind
  base_url?: string | null
  api_key_storage?: AiModelApiKeyStorage | null
  api_key_env_var?: string | null
  headers?: Record<string, string> | null
  models: AiModelDefinition[]
}

export interface AiModelProviderCatalogEntry {
  kind: AiModelProviderKind
  name: string
  label_key: TranslationKey
  base_url: string
  runtime_base_url: string | null
  default_model_id: string
  api_key_storage: AiModelApiKeyStorage
  api_key_env_var: string | null
  local: boolean
}

export type AiTarget =
  | { kind: 'agent'; agent: AiAgentId; id: string; label: string; shortLabel: string }
  | { kind: 'api_model'; provider: AiModelProvider; model: AiModelDefinition; id: string; label: string; shortLabel: string }
export type AiModelTarget = Extract<AiTarget, { kind: 'api_model' }>

export const AI_TARGET_PREFIX_AGENT = 'agent:'
export const AI_TARGET_PREFIX_MODEL = 'model:'

const AI_MODEL_PROVIDER_CATALOG = providerCatalog as readonly AiModelProviderCatalogEntry[]
const AI_MODEL_PROVIDER_CATALOG_BY_KIND = new Map<AiModelProviderKind, AiModelProviderCatalogEntry>(
  AI_MODEL_PROVIDER_CATALOG.map((entry) => [entry.kind, entry]),
)

export const LOCAL_AI_PROVIDER_KINDS: readonly AiModelProviderKind[] = AI_MODEL_PROVIDER_CATALOG
  .filter((entry) => entry.local)
  .map((entry) => entry.kind)

export const DEFAULT_MODEL_CAPABILITIES: AiModelCapabilities = {
  streaming: false,
  tools: false,
  vision: false,
  json_mode: false,
  reasoning: false,
}

export function aiModelProviderCatalog(): readonly AiModelProviderCatalogEntry[] {
  return AI_MODEL_PROVIDER_CATALOG
}

export function aiModelProviderCatalogEntry(kind: AiModelProviderKind): AiModelProviderCatalogEntry {
  const entry = AI_MODEL_PROVIDER_CATALOG_BY_KIND.get(kind)
  if (!entry) throw new Error(`Unknown AI model provider kind: ${kind}`)
  return entry
}

export function agentTargetId(agent: AiAgentId): string {
  return `${AI_TARGET_PREFIX_AGENT}${agent}`
}

export function modelTargetId(providerId: string, modelId: string): string {
  return `${AI_TARGET_PREFIX_MODEL}${providerId}/${modelId}`
}

export function configuredModelTargets(providers: AiModelProvider[] | null | undefined): AiModelTarget[] {
  return (providers ?? []).flatMap((provider) => provider.models.map((model) => {
    const displayName = model.display_name || model.id
    return {
      kind: 'api_model' as const,
      provider,
      model,
      id: modelTargetId(provider.id, model.id),
      label: `${provider.name} · ${displayName}`,
      shortLabel: displayName,
    }
  }))
}

export function agentTargets(): AiTarget[] {
  return AI_AGENT_DEFINITIONS.map((definition) => {
    return {
      kind: 'agent' as const,
      agent: definition.id,
      id: agentTargetId(definition.id),
      label: definition.label,
      shortLabel: definition.shortLabel,
    }
  })
}

export function resolveAiTarget(settings: Settings): AiTarget {
  const providers = normalizeAiModelProviders(settings.ai_model_providers)
  const agents = agentTargets()
  const targets = [...agents, ...configuredModelTargets(providers)]
  const storedLegacyAgent = normalizeStoredAiAgent(settings.default_ai_agent)
  const legacyAgent = storedLegacyAgent ?? DEFAULT_AI_AGENT
  const target = resolveStoredAiTarget(settings.default_ai_target, targets)
  if (target) {
    if (shouldPreferLegacyAgent(target, storedLegacyAgent)) return agentTargetFor(agents, legacyAgent) ?? target
    return target
  }

  return agentTargetFor(agents, legacyAgent) ?? agents[0]
}

export function targetAgent(target: AiTarget): AiAgentId {
  return target.kind === 'agent' ? target.agent : DEFAULT_AI_AGENT
}

function shouldPreferLegacyAgent(target: AiTarget, storedLegacyAgent: AiAgentId | null): boolean {
  if (target.kind !== 'agent') return false
  if (!storedLegacyAgent) return false
  if (target.agent !== DEFAULT_AI_AGENT) return false
  return target.agent !== storedLegacyAgent
}

function agentTargetFor(agents: AiTarget[], agent: AiAgentId): AiTarget | undefined {
  return agents.find((candidate) => candidate.kind === 'agent' && candidate.agent === agent)
}

function resolveStoredAiTarget(storedTarget: string | null | undefined, targets: AiTarget[]): AiTarget | null {
  const target = storedTarget?.trim()
  if (!target) return null

  const exactTarget = targets.find((candidate) => candidate.id === target)
  if (exactTarget) return exactTarget

  const legacyAgent = normalizeStoredAiAgent(target)
  if (!legacyAgent) return null
  return targets.find((candidate) => candidate.kind === 'agent' && candidate.agent === legacyAgent) ?? null
}

export function normalizeAiModelProviders(providers: AiModelProvider[] | null | undefined): AiModelProvider[] {
  return (providers ?? []).map(normalizeAiModelProvider).filter((provider): provider is AiModelProvider => provider !== null)
}

export function normalizeAiModelProvider(provider: AiModelProvider): AiModelProvider | null {
  const id = provider.id.trim().toLowerCase()
  const name = provider.name.trim()
  const models = provider.models.map(normalizeAiModelDefinition).filter((model): model is AiModelDefinition => model !== null)
  if (!id || !name || models.length === 0) return null
  return {
    ...provider,
    id,
    name,
    base_url: emptyToNull(provider.base_url),
    api_key_storage: normalizeApiKeyStorage(provider),
    api_key_env_var: emptyToNull(provider.api_key_env_var),
    models,
  }
}

function normalizeApiKeyStorage(provider: AiModelProvider): 'none' | 'env' | 'local_file' {
  if (provider.api_key_storage === 'local_file') return 'local_file'
  if (provider.api_key_storage === 'env' || emptyToNull(provider.api_key_env_var)) return 'env'
  return 'none'
}

function normalizeAiModelDefinition(model: AiModelDefinition): AiModelDefinition | null {
  const id = model.id.trim()
  if (!id) return null
  return {
    ...model,
    id,
    display_name: emptyToNull(model.display_name),
    capabilities: model.capabilities ?? DEFAULT_MODEL_CAPABILITIES,
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function isLocalAiProvider(provider: AiModelProvider): boolean {
  return aiModelProviderCatalogEntry(provider.kind).local
}

export interface AiTargetReadinessOptions {
  settingsLoaded?: boolean
  tauri?: boolean
  readyFallbackTargetId?: string | null
  readyFallbackTargetReady?: boolean
}

export interface AiTargetReadinessResult {
  readiness: AiAgentReadiness
  ready: boolean
  canQueuePrompt: boolean
}

function aiTargetReadinessResult(readiness: AiAgentReadiness): AiTargetReadinessResult {
  return {
    readiness,
    ready: readiness === 'ready',
    canQueuePrompt: readiness !== 'missing',
  }
}

function aiTargetUsesReadyFallback(target: AiTarget, options: AiTargetReadinessOptions): boolean {
  return options.readyFallbackTargetReady === true && options.readyFallbackTargetId === target.id
}

export function resolveAiTargetReadiness(
  target: AiTarget,
  statuses: AiAgentsStatus,
  options: AiTargetReadinessOptions = {},
): AiTargetReadinessResult {
  if (options.settingsLoaded === false) return aiTargetReadinessResult('checking')
  if (target.kind === 'api_model' || options.tauri === false) return aiTargetReadinessResult('ready')

  const status = getAiAgentAvailability(statuses, target.agent).status
  if (status === 'checking') return aiTargetReadinessResult('checking')
  if (status === 'installed' || aiTargetUsesReadyFallback(target, options)) return aiTargetReadinessResult('ready')
  return aiTargetReadinessResult('missing')
}

export function aiTargetReady(
  target: AiTarget,
  statuses: AiAgentsStatus,
  options?: AiTargetReadinessOptions,
): boolean {
  return resolveAiTargetReadiness(target, statuses, options).ready
}

export function aiTargetCanQueuePrompt(
  target: AiTarget,
  statuses: AiAgentsStatus,
  options?: AiTargetReadinessOptions,
): boolean {
  return resolveAiTargetReadiness(target, statuses, options).canQueuePrompt
}
