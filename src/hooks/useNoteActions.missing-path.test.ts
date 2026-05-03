import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import { useNoteActions, type NoteActionsConfig } from './useNoteActions'

vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  addMockEntry: vi.fn(),
  updateMockContent: vi.fn(),
  trackMockChange: vi.fn(),
  mockInvoke: vi.fn(),
}))

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/test/vault/missing.md',
  filename: 'missing.md',
  title: 'Missing Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
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
})

function makeConfig(overrides: Partial<NoteActionsConfig> = {}): NoteActionsConfig {
  return {
    addEntry: vi.fn(),
    removeEntry: vi.fn(),
    entries: [makeEntry()],
    reloadVault: vi.fn().mockResolvedValue([]),
    setToastMessage: vi.fn(),
    updateEntry: vi.fn(),
    vaultPath: '/test/vault',
    ...overrides,
  }
}

describe('useNoteActions missing-path recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
  })

  it('reloads vault state and shows a toast when the selected note path is gone', async () => {
    vi.mocked(mockInvoke).mockRejectedValueOnce(new Error('File does not exist: /test/vault/missing.md'))
    const config = makeConfig()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useNoteActions(config))

    await act(async () => {
      await result.current.handleSelectNote(makeEntry())
    })

    expect(result.current.tabs).toEqual([])
    expect(result.current.activeTabPath).toBeNull()
    expect(config.reloadVault).toHaveBeenCalledTimes(1)
    expect(config.setToastMessage).toHaveBeenCalledWith(
      '"Missing Note" could not be opened because its file is missing or moved.',
    )
    warnSpy.mockRestore()
  })

  it('recovers from missing stale sidebar entries with incomplete string metadata', async () => {
    vi.mocked(mockInvoke).mockRejectedValueOnce(new Error('File does not exist: /test/vault/reloaded.md'))
    const staleEntry = {
      ...makeEntry({ path: '/test/vault/reloaded.md' }),
      filename: undefined,
      title: undefined,
    } as unknown as VaultEntry
    const config = makeConfig()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useNoteActions(config))

    await act(async () => {
      await result.current.handleSelectNote(staleEntry)
    })

    expect(result.current.tabs).toEqual([])
    expect(result.current.activeTabPath).toBeNull()
    expect(config.reloadVault).toHaveBeenCalledTimes(1)
    expect(config.setToastMessage).toHaveBeenCalledWith(
      '"Note" could not be opened because its file is missing or moved.',
    )
    warnSpy.mockRestore()
  })

  it('shows a toast without reloading the vault when note content is not valid UTF-8 text', async () => {
    vi.mocked(mockInvoke).mockRejectedValueOnce(new Error('File is not valid UTF-8 text: /test/vault/bad.csv'))
    const config = makeConfig({ entries: [makeEntry({ path: '/test/vault/bad.csv', filename: 'bad.csv', title: 'bad.csv', fileKind: 'text' })] })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useNoteActions(config))

    await act(async () => {
      await result.current.handleSelectNote(makeEntry({ path: '/test/vault/bad.csv', filename: 'bad.csv', title: 'bad.csv', fileKind: 'text' }))
    })

    expect(result.current.tabs).toEqual([])
    expect(result.current.activeTabPath).toBeNull()
    expect(config.reloadVault).not.toHaveBeenCalled()
    expect(config.setToastMessage).toHaveBeenCalledWith(
      '"bad.csv" could not be opened because it is not valid UTF-8 text.',
    )
    warnSpy.mockRestore()
  })
})
