import { describe, expect, it } from 'vitest'
import {
  LOCAL_AI_PROVIDER_KINDS,
  agentTargetId,
  agentTargets,
  aiTargetCanQueuePrompt,
  aiTargetReady,
  resolveAiTargetReadiness,
  aiModelProviderCatalog,
  aiModelProviderCatalogEntry,
  isLocalAiProvider,
  normalizeAiModelProviders,
  resolveAiTarget,
  type AiModelProvider,
} from './aiTargets'
import {
  AI_AGENT_DEFINITIONS,
  createCheckingAiAgentsStatus,
  createMissingAiAgentsStatus,
  normalizeAiAgentsStatus,
} from './aiAgents'
import type { Settings } from '../types'

function provider(kind: AiModelProvider['kind']): AiModelProvider {
  return {
    id: ' Demo ',
    name: ' Demo Provider ',
    kind,
    base_url: ' https://example.com/v1 ',
    api_key_storage: null,
    api_key_env_var: ' DEMO_API_KEY ',
    headers: null,
    models: [{
      id: ' demo-model ',
      display_name: ' Demo Model ',
      context_window: null,
      max_output_tokens: null,
      capabilities: {
        streaming: true,
        tools: false,
        vision: false,
        json_mode: true,
        reasoning: false,
      },
    }],
  }
}

function resolveTarget(settings: Partial<Settings>): ReturnType<typeof resolveAiTarget> {
  return resolveAiTarget(settings as Settings)
}

describe('ai target provider contract', () => {
  it('builds selectable targets for every supported coding agent', () => {
    expect(agentTargets().map((target) => target.id)).toEqual(
      AI_AGENT_DEFINITIONS.map((definition) => agentTargetId(definition.id)),
    )
  })

  it('resolves Copilot as a persisted default agent target', () => {
    const target = resolveTarget({
      default_ai_agent: 'claude_code',
      default_ai_target: 'agent:copilot',
    })

    expect(target).toMatchObject({
      kind: 'agent',
      agent: 'copilot',
      id: 'agent:copilot',
      label: 'GitHub Copilot',
    })
  })

  it('lets quick prompts queue while a local agent probe is still checking', () => {
    const target = resolveTarget({
      default_ai_target: 'agent:claude_code',
    })
    const checking = resolveAiTargetReadiness(target, createCheckingAiAgentsStatus())

    expect(aiTargetReady(target, createCheckingAiAgentsStatus())).toBe(false)
    expect(aiTargetCanQueuePrompt(target, createCheckingAiAgentsStatus())).toBe(true)
    expect(checking).toEqual({
      readiness: 'checking',
      ready: false,
      canQueuePrompt: true,
    })
    expect(aiTargetCanQueuePrompt(target, normalizeAiAgentsStatus({
      claude_code: { installed: true, version: 'mock' },
    }))).toBe(true)
    expect(aiTargetCanQueuePrompt(target, createMissingAiAgentsStatus())).toBe(false)
  })

  it('centralizes browser mock and default-target fallback readiness', () => {
    const target = resolveTarget({
      default_ai_target: 'agent:claude_code',
    })

    expect(resolveAiTargetReadiness(target, createMissingAiAgentsStatus(), { tauri: false })).toEqual({
      readiness: 'ready',
      ready: true,
      canQueuePrompt: true,
    })
    expect(resolveAiTargetReadiness(target, createMissingAiAgentsStatus(), {
      readyFallbackTargetId: target.id,
      readyFallbackTargetReady: true,
    })).toEqual({
      readiness: 'ready',
      ready: true,
      canQueuePrompt: true,
    })
    expect(resolveAiTargetReadiness(target, createMissingAiAgentsStatus(), {
      readyFallbackTargetId: 'agent:codex',
      readyFallbackTargetReady: true,
    })).toEqual({
      readiness: 'missing',
      ready: false,
      canQueuePrompt: false,
    })
  })

  it('resolves legacy and stale agent settings to the intended agent target', () => {
    const cases: Partial<Settings>[] = [
      { default_ai_agent: 'claude_code', default_ai_target: 'kiro' },
      { default_ai_agent: 'kiro', default_ai_target: 'agent:claude_code' },
    ]

    for (const settings of cases) {
      expect(resolveTarget(settings)).toMatchObject({
        kind: 'agent',
        agent: 'kiro',
        id: 'agent:kiro',
      })
    }
  })

  it('keeps provider defaults in one catalog with stable grouping metadata', () => {
    const entries = aiModelProviderCatalog()
    const kinds = entries.map((entry) => entry.kind)

    expect(kinds).toEqual([
      'ollama',
      'lm_studio',
      'open_ai',
      'anthropic',
      'gemini',
      'open_router',
      'open_ai_compatible',
    ])
    expect(new Set(kinds).size).toBe(kinds.length)
    expect(LOCAL_AI_PROVIDER_KINDS).toEqual(['ollama', 'lm_studio'])
    expect(aiModelProviderCatalogEntry('anthropic')).toMatchObject({
      name: 'Anthropic',
      base_url: 'https://api.anthropic.com/v1',
      api_key_storage: 'local_file',
      api_key_env_var: 'ANTHROPIC_API_KEY',
      default_model_id: 'claude-3-5-sonnet-latest',
      local: false,
    })
    expect(aiModelProviderCatalogEntry('open_ai_compatible')).toMatchObject({
      base_url: 'https://api.example.com/v1',
      api_key_env_var: 'OPENAI_API_KEY',
      local: false,
    })
  })

  it('normalizes saved providers while using the catalog for local/provider classification', () => {
    const normalized = normalizeAiModelProviders([
      provider('open_ai_compatible'),
      { ...provider('ollama'), id: ' ', name: 'Missing ID' },
    ])

    expect(normalized).toHaveLength(1)
    expect(normalized[0]).toMatchObject({
      id: 'demo',
      name: 'Demo Provider',
      base_url: 'https://example.com/v1',
      api_key_env_var: 'DEMO_API_KEY',
      api_key_storage: 'env',
    })
    expect(normalized[0].models[0]).toMatchObject({
      id: 'demo-model',
      display_name: 'Demo Model',
    })
    expect(isLocalAiProvider(provider('lm_studio'))).toBe(true)
    expect(isLocalAiProvider(provider('open_router'))).toBe(false)
  })
})
