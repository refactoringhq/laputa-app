import { describe, expect, it } from 'vitest'
import {
  getNextAiAgentId,
  normalizeAiAgentsStatus,
  normalizeStoredAiAgent,
  resolveDefaultAiAgent,
} from './aiAgents'

describe('aiAgents helpers', () => {
  it('normalizes stored agent ids', () => {
    expect(normalizeStoredAiAgent('claude_code')).toBe('claude_code')
    expect(normalizeStoredAiAgent('codex')).toBe('codex')
    expect(normalizeStoredAiAgent('copilot')).toBe('copilot')
    expect(normalizeStoredAiAgent('opencode')).toBe('opencode')
    expect(normalizeStoredAiAgent('pi')).toBe('pi')
    expect(normalizeStoredAiAgent('antigravity')).toBe('antigravity')
    expect(normalizeStoredAiAgent('gemini')).toBe('antigravity')
    expect(normalizeStoredAiAgent('kiro')).toBe('kiro')
    expect(normalizeStoredAiAgent('hermes')).toBe('hermes')
    expect(normalizeStoredAiAgent('cursor')).toBeNull()
  })

  it('falls back to Claude Code as the default agent', () => {
    expect(resolveDefaultAiAgent(undefined)).toBe('claude_code')
    expect(resolveDefaultAiAgent(null)).toBe('claude_code')
  })

  it('normalizes raw status payloads', () => {
    const statuses = normalizeAiAgentsStatus({
      claude_code: { installed: true, version: '1.0.20' },
      codex: { installed: false, version: null },
      copilot: { installed: true, version: '1.0.58' },
      opencode: { installed: true, version: '0.3.1' },
      pi: { installed: true, version: '0.70.2' },
      antigravity: { installed: true, version: 'Antigravity CLI 1.0.0' },
      kiro: { installed: true, version: '0.12.0' },
      hermes: { installed: true, version: 'Hermes Agent 0.16.0' },
    })

    expect(statuses.claude_code).toEqual({ status: 'installed', version: '1.0.20' })
    expect(statuses.codex).toEqual({ status: 'missing', version: null })
    expect(statuses.copilot).toEqual({ status: 'installed', version: '1.0.58' })
    expect(statuses.opencode).toEqual({ status: 'installed', version: '0.3.1' })
    expect(statuses.pi).toEqual({ status: 'installed', version: '0.70.2' })
    expect(statuses.antigravity).toEqual({ status: 'installed', version: 'Antigravity CLI 1.0.0' })
    expect(statuses.kiro).toEqual({ status: 'installed', version: '0.12.0' })
    expect(statuses.hermes).toEqual({ status: 'installed', version: 'Hermes Agent 0.16.0' })
  })

  it('normalizes legacy Gemini status payloads to Antigravity', () => {
    const statuses = normalizeAiAgentsStatus({
      gemini: { installed: true, version: '0.5.1' },
    })

    expect(statuses.antigravity).toEqual({ status: 'installed', version: '0.5.1' })
  })

  it('cycles through the supported agents', () => {
    expect(getNextAiAgentId('claude_code')).toBe('codex')
    expect(getNextAiAgentId('codex')).toBe('copilot')
    expect(getNextAiAgentId('copilot')).toBe('opencode')
    expect(getNextAiAgentId('opencode')).toBe('pi')
    expect(getNextAiAgentId('pi')).toBe('antigravity')
    expect(getNextAiAgentId('antigravity')).toBe('kiro')
    expect(getNextAiAgentId('kiro')).toBe('hermes')
    expect(getNextAiAgentId('hermes')).toBe('claude_code')
  })
})
