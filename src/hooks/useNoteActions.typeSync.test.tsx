import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { VaultEntry } from '../types'
import { useNoteActions, type NoteActionsConfig } from './useNoteActions'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  addMockEntry: vi.fn(),
  updateMockContent: vi.fn(),
  trackMockChange: vi.fn(),
  mockInvoke: vi.fn().mockResolvedValue(''),
}))
vi.mock('./mockFrontmatterHelpers', () => ({
  updateMockFrontmatter: vi.fn().mockReturnValue('---\ntype: Hotel\n---\n'),
  deleteMockFrontmatterProperty: vi.fn().mockReturnValue('---\n---\n'),
}))

const baseEntry: VaultEntry = {
  path: '/vault/note.md',
  filename: 'note.md',
  title: 'Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  archived: false,
  modifiedAt: 1700000000,
  createdAt: 1700000000,
  fileSize: 10,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  outgoingLinks: [],
  template: null,
  sort: null,
  sidebarLabel: null,
  view: null,
  visible: null,
  properties: {},
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  hasH1: false,
}

function renderActions(overrides: Partial<NoteActionsConfig> = {}) {
  const config: NoteActionsConfig = {
    addEntry: vi.fn(),
    removeEntry: vi.fn(),
    entries: [baseEntry],
    setToastMessage: vi.fn(),
    updateEntry: vi.fn(),
    vaultPath: '/vault',
    ...overrides,
  }
  return {
    ...renderHook(() => useNoteActions(config)),
    config,
  }
}

describe('useNoteActions type state sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refreshes type state after assigning a note type', async () => {
    const onTypeStateChanged = vi.fn().mockResolvedValue(undefined)
    const { result } = renderActions({ onTypeStateChanged })

    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'type', 'Hotel')
    })

    expect(onTypeStateChanged).toHaveBeenCalledOnce()
  })

  it('does not refresh type state for unrelated frontmatter edits', async () => {
    const onTypeStateChanged = vi.fn()
    const { result } = renderActions({ onTypeStateChanged })

    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'status', 'Active')
    })

    expect(onTypeStateChanged).not.toHaveBeenCalled()
  })

  it('refreshes type state after creating a type file', async () => {
    const onTypeStateChanged = vi.fn().mockResolvedValue(undefined)
    const { result } = renderActions({ onTypeStateChanged })

    await act(async () => {
      await result.current.handleCreateType('Hotel')
    })

    expect(onTypeStateChanged).toHaveBeenCalledOnce()
  })
})
