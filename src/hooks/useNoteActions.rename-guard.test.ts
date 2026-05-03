import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { isTauri, mockInvoke } from '../mock-tauri'
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
  updateMockFrontmatter: vi.fn().mockReturnValue('---\ntitle: New Name\n---\n# New Name\n'),
  deleteMockFrontmatterProperty: vi.fn().mockReturnValue('---\n---\n'),
}))

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    path: '/vault/old-name.md',
    filename: 'old-name.md',
    title: 'Old Name',
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: 'Active',
    archived: false,
    modifiedAt: 1700000000,
    createdAt: 1700000000,
    fileSize: 100,
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
    ...overrides,
  }
}

function makeConfig(
  entry: VaultEntry,
  overrides: Partial<NoteActionsConfig> = {},
): NoteActionsConfig {
  return {
    addEntry: vi.fn(),
    removeEntry: vi.fn(),
    entries: [entry],
    setToastMessage: vi.fn(),
    updateEntry: vi.fn(),
    vaultPath: '/vault',
    ...overrides,
  }
}

describe('useNoteActions title rename guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
  })

  it('flushes pending editor work before renaming through the title property', async () => {
    const entry = makeEntry()
    const events: string[] = []
    const flushBeforeNoteMutation = vi.fn(async (path: string) => {
      events.push(`flush:${path}`)
    })

    vi.mocked(mockInvoke).mockImplementation(async (command: string) => {
      if (command === 'rename_note') {
        events.push('rename')
        return { new_path: '/vault/new-name.md', updated_files: 0 }
      }
      if (command === 'get_note_content') return '---\ntitle: New Name\n---\n# New Name\n'
      return ''
    })

    const { result } = renderHook(() => useNoteActions(makeConfig(entry, { flushBeforeNoteMutation })))

    await act(async () => {
      result.current.handleSelectNote(entry)
    })

    await act(async () => {
      await result.current.handleUpdateFrontmatter(entry.path, 'title', 'New Name')
    })

    expect(flushBeforeNoteMutation).toHaveBeenCalledTimes(1)
    expect(flushBeforeNoteMutation).toHaveBeenCalledWith(entry.path)
    expect(events).toEqual([`flush:${entry.path}`, 'rename'])
  })

  it('stops the title rename flow when pending editor work fails to flush', async () => {
    const entry = makeEntry()
    const flushBeforeNoteMutation = vi.fn().mockRejectedValue(new Error('disk full'))
    const updateEntry = vi.fn()

    const { result } = renderHook(() => useNoteActions(makeConfig(entry, {
      flushBeforeNoteMutation,
      updateEntry,
    })))

    await act(async () => {
      await result.current.handleUpdateFrontmatter(entry.path, 'title', 'New Name')
    })

    expect(mockInvoke).not.toHaveBeenCalledWith('rename_note', expect.anything())
    expect(updateEntry).not.toHaveBeenCalledWith(entry.path, expect.objectContaining({ title: 'New Name' }))
  })
})
