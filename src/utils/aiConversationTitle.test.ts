import { beforeEach, describe, expect, it, vi } from 'vitest'

const { streamAiAgentMock, streamAiModelMock } = vi.hoisted(() => ({
  streamAiAgentMock: vi.fn(),
  streamAiModelMock: vi.fn(),
}))

vi.mock('./streamAiAgent', () => ({
  streamAiAgent: streamAiAgentMock,
}))

vi.mock('./streamAiModel', () => ({
  streamAiModel: streamAiModelMock,
}))

import {
  generateAiConversationTitle,
  generateAiConversationTitleForTarget,
  normalizeAiConversationTitle,
} from './aiConversationTitle'

describe('generateAiConversationTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    streamAiAgentMock.mockResolvedValue(undefined)
    streamAiModelMock.mockResolvedValue(undefined)
  })

  it('creates a sentence-case fallback title from the first prompt', () => {
    expect(generateAiConversationTitle('please summarize quarterly sponsor outreach next steps')).toBe(
      'Quarterly sponsor outreach',
    )
  })

  it('strips wikilinks and urls before choosing title words', () => {
    expect(generateAiConversationTitle('help with [[Sponsor Onboarding]] https://example.com plan')).toBe(
      'Sponsor onboarding plan',
    )
  })

  it('turns short questions into noun-phrase fallback titles', () => {
    expect(generateAiConversationTitle("What's my longest essay?")).toBe('Longest essay')
  })

  it('normalizes model title text to sentence case while preserving acronyms', () => {
    expect(normalizeAiConversationTitle('Title: Fix MCP Server Lookup.')).toBe('Fix MCP server lookup')
  })

  it('rejects answer-like title text from the model', () => {
    expect(normalizeAiConversationTitle('There are 460 essay notes. Let me search them.')).toBeNull()
  })

  it('asks the selected agent for a short chat title', async () => {
    streamAiAgentMock.mockImplementation(async ({ callbacks }) => {
      callbacks.onText('Fix MCP Server Lookup')
      callbacks.onDone()
    })

    await expect(generateAiConversationTitleForTarget({
      assistantResponse: 'The lookup now resolves the configured MCP server.',
      permissionMode: 'power_user',
      prompt: 'The MCP server cannot be found anymore',
      target: { kind: 'agent', agent: 'codex', id: 'agent:codex', label: 'Codex', shortLabel: 'Codex' },
      targetReady: true,
      vaultPath: '/vault',
      vaultPaths: ['/vault'],
    })).resolves.toBe('Fix MCP server lookup')

    expect(streamAiAgentMock).toHaveBeenCalledWith(expect.objectContaining({
      agent: 'codex',
      message: expect.stringContaining('Assistant answer:'),
      permissionMode: 'power_user',
      vaultPath: '/vault',
      vaultPaths: ['/vault'],
    }))
  })

  it('asks the selected API model for a short chat title', async () => {
    const provider = {
      id: 'openai',
      name: 'OpenAI',
      kind: 'open_ai' as const,
      api_key_storage: 'env' as const,
      api_key_env_var: 'OPENAI_API_KEY',
      models: [],
    }
    const model = {
      id: 'gpt-4.1',
      display_name: 'GPT-4.1',
      capabilities: { streaming: true, tools: false, vision: false, json_mode: false, reasoning: false },
    }
    streamAiModelMock.mockImplementation(async ({ callbacks }) => {
      callbacks.onText('Review Sidebar Spacing')
      callbacks.onDone()
    })

    await expect(generateAiConversationTitleForTarget({
      assistantResponse: 'The sidebar needs tighter spacing and clearer grouping.',
      permissionMode: 'safe',
      prompt: 'Please review the spacing in the sidebar',
      target: {
        kind: 'api_model',
        provider,
        model,
        id: 'model:openai/gpt-4.1',
        label: 'OpenAI · GPT-4.1',
        shortLabel: 'GPT-4.1',
      },
      targetReady: true,
      vaultPath: '/vault',
    })).resolves.toBe('Review sidebar spacing')

    expect(streamAiModelMock).toHaveBeenCalledWith(expect.objectContaining({
      provider,
      model,
    }))
  })
})
