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
    expect(normalizeStoredAiAgent('opencode')).toBe('opencode')
    expect(normalizeStoredAiAgent('pi')).toBe('pi')
    expect(normalizeStoredAiAgent('gemini')).toBe('gemini')
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
      opencode: { installed: true, version: '0.3.1' },
      pi: { installed: true, version: '0.70.2' },
      gemini: { installed: true, version: '0.5.1' },
    })

    expect(statuses.claude_code).toEqual({ status: 'installed', version: '1.0.20' })
    expect(statuses.codex).toEqual({ status: 'missing', version: null })
    expect(statuses.opencode).toEqual({ status: 'installed', version: '0.3.1' })
    expect(statuses.pi).toEqual({ status: 'installed', version: '0.70.2' })
    expect(statuses.gemini).toEqual({ status: 'installed', version: '0.5.1' })
  })

  it('cycles through the supported agents', () => {
    expect(getNextAiAgentId('claude_code')).toBe('codex')
    expect(getNextAiAgentId('codex')).toBe('opencode')
    expect(getNextAiAgentId('opencode')).toBe('pi')
    expect(getNextAiAgentId('pi')).toBe('gemini')
    expect(getNextAiAgentId('gemini')).toBe('claude_code')
  })
})
