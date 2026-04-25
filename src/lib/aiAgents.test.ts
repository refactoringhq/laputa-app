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
    expect(normalizeStoredAiAgent('cursor')).toBeNull()
  })

  it('falls back to Claude Code as the default agent', () => {
    expect(resolveDefaultAiAgent(undefined)).toBe('claude_code')
    expect(resolveDefaultAiAgent(null)).toBe('claude_code')
  })

  it('picks the first installed agent when no preference is set', () => {
    const statuses = {
      claude_code: { status: 'missing' as const, version: null },
      codex: { status: 'missing' as const, version: null },
      opencode: { status: 'installed' as const, version: '0.18.0' },
    }

    expect(resolveDefaultAiAgent(null, statuses)).toBe('opencode')
    expect(resolveDefaultAiAgent(undefined, statuses)).toBe('opencode')
  })

  it('respects definitions order when picking installed agent', () => {
    const statuses = {
      claude_code: { status: 'installed' as const, version: '1.0.0' },
      codex: { status: 'installed' as const, version: '2.0.0' },
      opencode: { status: 'installed' as const, version: '0.18.0' },
    }

    expect(resolveDefaultAiAgent(null, statuses)).toBe('claude_code')
  })

  it('falls back to Claude Code when no agent is installed', () => {
    const statuses = {
      claude_code: { status: 'missing' as const, version: null },
      codex: { status: 'missing' as const, version: null },
      opencode: { status: 'missing' as const, version: null },
    }

    expect(resolveDefaultAiAgent(null, statuses)).toBe('claude_code')
  })

  it('prefers stored value over installed status', () => {
    const statuses = {
      claude_code: { status: 'missing' as const, version: null },
      codex: { status: 'installed' as const, version: '2.0.0' },
      opencode: { status: 'missing' as const, version: null },
    }

    expect(resolveDefaultAiAgent('codex', statuses)).toBe('codex')
  })

  it('falls back to Claude Code during checking phase', () => {
    const statuses = {
      claude_code: { status: 'checking' as const, version: null },
      codex: { status: 'checking' as const, version: null },
      opencode: { status: 'checking' as const, version: null },
    }

    expect(resolveDefaultAiAgent(null, statuses)).toBe('claude_code')
  })

  it('normalizes raw status payloads', () => {
    const statuses = normalizeAiAgentsStatus({
      claude_code: { installed: true, version: '1.0.20' },
      codex: { installed: false, version: null },
      opencode: { installed: true, version: '0.18.0' },
    })

    expect(statuses.claude_code).toEqual({ status: 'installed', version: '1.0.20' })
    expect(statuses.codex).toEqual({ status: 'missing', version: null })
    expect(statuses.opencode).toEqual({ status: 'installed', version: '0.18.0' })
  })

  it('cycles between the supported agents', () => {
    expect(getNextAiAgentId('claude_code')).toBe('codex')
    expect(getNextAiAgentId('codex')).toBe('opencode')
    expect(getNextAiAgentId('opencode')).toBe('claude_code')
  })
})
