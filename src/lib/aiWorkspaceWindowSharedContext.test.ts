import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../types'

const STORAGE_KEY = 'tolaria:ai-workspace-window-context:v1'

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/vault/note.md',
  filename: 'note.md',
  title: 'Note',
  isA: 'Project',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  archived: false,
  modifiedAt: 1700000000,
  createdAt: 1700000000,
  fileSize: 100,
  snippet: 'Snippet',
  wordCount: 42,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  sidebarLabel: null,
  template: null,
  sort: null,
  view: null,
  visible: true,
  organized: true,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  outgoingLinks: [],
  properties: {},
  hasH1: true,
  ...overrides,
})

describe('aiWorkspaceWindowSharedContext', () => {
  let store: Record<string, string>

  beforeEach(() => {
    vi.resetModules()
    store = {}
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    })
    vi.stubGlobal('BroadcastChannel', class {
      onmessage: (() => void) | null = null
      postMessage = vi.fn()
    })
  })

  it('preserves note metadata needed by the AI context builder', async () => {
    const {
      aiWorkspaceWindowSharedContextSnapshot,
      publishAiWorkspaceWindowSharedContext,
    } = await import('./aiWorkspaceWindowSharedContext')
    const activeEntry = makeEntry({
      path: '/vault/active.md',
      title: 'Active',
      aliases: ['A'],
      belongsTo: ['[[Parent]]'],
      relatedTo: ['[[Sibling]]'],
      outgoingLinks: ['Linked'],
      properties: { Owner: 'Alice' },
      relationships: { People: ['[[Alice]]'] },
      wordCount: 128,
    })

    publishAiWorkspaceWindowSharedContext({
      activeEntry,
      activeNoteContent: '# Active',
      entries: [activeEntry],
      openTabs: [activeEntry],
      vaultPath: '/vault',
      vaultPaths: ['/vault'],
    })

    const snapshot = aiWorkspaceWindowSharedContextSnapshot()
    expect(snapshot.activeEntry?.outgoingLinks).toEqual(['Linked'])
    expect(snapshot.activeEntry?.belongsTo).toEqual(['[[Parent]]'])
    expect(snapshot.activeEntry?.relatedTo).toEqual(['[[Sibling]]'])
    expect(snapshot.activeEntry?.relationships).toEqual({ People: ['[[Alice]]'] })
    expect(snapshot.activeEntry?.properties).toEqual({ Owner: 'Alice' })
    expect(snapshot.activeEntry?.wordCount).toBe(128)

    const stored = JSON.parse(store[STORAGE_KEY])
    expect(stored.activeEntry.outgoingLinks).toEqual(['Linked'])
    expect(stored.activeEntry.relationships).toEqual({ People: ['[[Alice]]'] })
  })
})
