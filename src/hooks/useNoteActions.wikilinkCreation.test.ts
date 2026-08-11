import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry, WorkspaceIdentity } from '../types'
import type { VaultOption } from '../components/status-bar/types'
import { clearNoteContentCache } from './noteContentCache'
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
  updateMockFrontmatter: vi.fn(),
  deleteMockFrontmatterProperty: vi.fn(),
}))

function workspace(path: string, alias: string): WorkspaceIdentity {
  return {
    id: alias,
    label: alias,
    alias,
    path,
    shortLabel: alias.slice(0, 2).toUpperCase(),
    color: null,
    icon: null,
    mounted: true,
    available: true,
    defaultForNewNotes: false,
  }
}

function entry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    path: '/personal/projects/source.md',
    filename: 'source.md',
    title: 'Source',
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    modifiedAt: 1,
    createdAt: 1,
    fileSize: 0,
    snippet: '',
    wordCount: 0,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    outgoingLinks: [],
    sidebarLabel: null,
    template: null,
    sort: null,
    view: null,
    visible: null,
    properties: {},
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    hasH1: false,
    workspace: workspace('/personal', 'personal'),
    ...overrides,
  }
}

function config(entries: VaultEntry[], vaults: VaultOption[]): NoteActionsConfig {
  return {
    addEntry: vi.fn(),
    removeEntry: vi.fn(),
    entries,
    setToastMessage: vi.fn(),
    updateEntry: vi.fn(),
    vaultPath: '/personal',
    defaultWorkspacePath: '/personal',
    vaults,
  }
}

async function openSourceAndFollow(target: string, options?: { entries?: VaultEntry[] }) {
  const source = entry()
  const entries = options?.entries ?? [source]
  const vaults: VaultOption[] = [
    { label: 'Personal', alias: 'personal', path: '/personal', mounted: true, available: true },
    { label: 'Team', alias: 'team', path: '/team', mounted: true, available: true },
  ]
  const noteConfig = config(entries, vaults)
  const hook = renderHook(() => useNoteActions(noteConfig))

  await act(async () => hook.result.current.handleSelectNote(source))
  await act(async () => hook.result.current.handleNavigateWikilink(target))

  return { ...hook, noteConfig }
}

describe('unresolved wikilink creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
    vi.mocked(mockInvoke).mockResolvedValue('')
    clearNoteContentCache()
  })

  it('creates an unqualified target beside the source note and opens it', async () => {
    const { result, noteConfig } = await openSourceAndFollow('new-note-topic')

    expect(noteConfig.addEntry).toHaveBeenCalledWith(expect.objectContaining({
      path: '/personal/projects/new-note-topic.md',
      title: 'New Note Topic',
    }))
    expect(result.current.activeTabPath).toBe('/personal/projects/new-note-topic.md')
    expect(mockInvoke).toHaveBeenCalledWith('save_note_content', expect.objectContaining({
      path: '/personal/projects/new-note-topic.md',
      vaultPath: '/personal',
    }))
  })

  it('honors a mounted workspace alias and path while preserving the display alias', async () => {
    const { result, noteConfig } = await openSourceAndFollow('team/roadmap/new-topic|Visible Label')

    expect(noteConfig.addEntry).toHaveBeenCalledWith(expect.objectContaining({
      path: '/team/roadmap/new-topic.md',
      title: 'New Topic',
    }))
    expect(result.current.activeTabPath).toBe('/team/roadmap/new-topic.md')
  })

  it('navigates to an existing match without creating a duplicate', async () => {
    const target = entry({
      path: '/personal/projects/new-note-topic.md',
      filename: 'new-note-topic.md',
      title: 'New Note Topic',
    })
    const { result, noteConfig } = await openSourceAndFollow('new-note-topic', {
      entries: [entry(), target],
    })

    expect(result.current.activeTabPath).toBe(target.path)
    expect(noteConfig.addEntry).not.toHaveBeenCalled()
    expect(mockInvoke).not.toHaveBeenCalledWith('save_note_content', expect.anything())
  })
})
