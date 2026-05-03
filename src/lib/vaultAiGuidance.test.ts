import { describe, expect, it } from 'vitest'
import {
  buildVaultAiGuidanceRefreshKey,
  createCheckingVaultAiGuidanceStatus,
  getVaultAiGuidanceSummary,
  normalizeVaultAiGuidanceStatus,
  vaultAiGuidanceNeedsRestore,
  vaultAiGuidanceUsesCustomFiles,
} from './vaultAiGuidance'
import type { VaultEntry } from '../types'

function makeEntry(filename: string, overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    path: `/vault/${filename}`,
    filename,
    title: filename.replace(/\.md$/, ''),
    isA: null,
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    modifiedAt: 10,
    createdAt: 5,
    fileSize: 20,
    snippet: '',
    wordCount: 0,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    sidebarLabel: null,
    template: null,
    sort: null,
    view: null,
    visible: true,
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    outgoingLinks: [],
    properties: {},
    hasH1: true,
    fileKind: 'markdown',
    ...overrides,
  }
}

describe('vaultAiGuidance helpers', () => {
  it('starts in checking state', () => {
    expect(createCheckingVaultAiGuidanceStatus()).toEqual({
      agentsState: 'checking',
      claudeState: 'checking',
      geminiState: 'checking',
      canRestore: false,
    })
  })

  it('normalizes raw backend payloads', () => {
    expect(normalizeVaultAiGuidanceStatus({
      agents_state: 'managed',
      claude_state: 'broken',
      gemini_state: 'missing',
      can_restore: true,
    })).toEqual({
      agentsState: 'managed',
      claudeState: 'broken',
      geminiState: 'missing',
      canRestore: true,
    })
  })

  it('detects restoreable and custom states', () => {
    const restoreable = normalizeVaultAiGuidanceStatus({
      agents_state: 'missing',
      claude_state: 'managed',
      gemini_state: 'managed',
      can_restore: true,
    })
    const custom = normalizeVaultAiGuidanceStatus({
      agents_state: 'custom',
      claude_state: 'managed',
      gemini_state: 'managed',
      can_restore: false,
    })

    expect(vaultAiGuidanceNeedsRestore(restoreable)).toBe(true)
    expect(getVaultAiGuidanceSummary(restoreable)).toBe('Tolaria guidance missing or broken')
    expect(vaultAiGuidanceUsesCustomFiles(custom)).toBe(true)
    expect(getVaultAiGuidanceSummary(custom)).toBe('Using custom AGENTS.md')
  })

  it('summarizes optional Gemini guidance states', () => {
    const missing = normalizeVaultAiGuidanceStatus({
      agents_state: 'managed',
      claude_state: 'managed',
      gemini_state: 'missing',
      can_restore: true,
    })
    const custom = normalizeVaultAiGuidanceStatus({
      agents_state: 'managed',
      claude_state: 'managed',
      gemini_state: 'custom',
      can_restore: false,
    })

    expect(vaultAiGuidanceNeedsRestore(missing)).toBe(true)
    expect(getVaultAiGuidanceSummary(missing)).toBe('Gemini guidance can be created')
    expect(vaultAiGuidanceUsesCustomFiles(custom)).toBe(true)
    expect(getVaultAiGuidanceSummary(custom)).toBe('Using custom GEMINI.md')
  })

  it('builds a refresh key from AGENTS and CLAUDE entries only', () => {
    const key = buildVaultAiGuidanceRefreshKey([
      makeEntry('alpha.md'),
      makeEntry('CLAUDE.md', { modifiedAt: 20, fileSize: 30 }),
      makeEntry('GEMINI.md', { modifiedAt: 25, fileSize: 35 }),
      makeEntry('AGENTS.md', { modifiedAt: 15, fileSize: 40 }),
    ])

    expect(key).toBe('/vault/AGENTS.md:15:40|/vault/CLAUDE.md:20:30|/vault/GEMINI.md:25:35')
  })
})
