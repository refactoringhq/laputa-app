import { describe, expect, it } from 'vitest'
import {
  LOCAL_AI_PROVIDER_KINDS,
  aiModelProviderCatalog,
  aiModelProviderCatalogEntry,
  isLocalAiProvider,
  normalizeAiModelProviders,
  type AiModelProvider,
} from './aiTargets'

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

describe('ai target provider contract', () => {
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
