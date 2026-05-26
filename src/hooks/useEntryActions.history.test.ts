import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../types'
import { useEntryActions } from './useEntryActions'
import type { ActionHistoryController, ActionHistoryEntry } from './useActionHistory'

const NOTE_PATH = '/vault/note/test.md'

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: NOTE_PATH,
  filename: 'test.md',
  title: 'Test Note',
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
  sidebarLabel: null,
  template: null,
  sort: null,
  view: null,
  visible: null,
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  outgoingLinks: [],
  properties: {},
  hasH1: false,
  ...overrides,
})

function makeActionHistory(records: ActionHistoryEntry[]) {
  let replaying = false
  const controller: ActionHistoryController = {
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    isReplaying: () => replaying,
    record: (entry) => { records.push(entry) },
    undo: vi.fn().mockResolvedValue(false),
    redo: vi.fn().mockResolvedValue(false),
    withoutRecording: (run) => Promise.resolve(run()),
  }
  const replay = async (entry: ActionHistoryEntry, direction: 'undo' | 'redo') => {
    replaying = true
    try {
      if (direction === 'undo') {
        await entry.undo()
      } else {
        await entry.redo()
      }
    } finally {
      replaying = false
    }
  }
  return { controller, replay }
}

describe('useEntryActions action history', () => {
  const createTypeEntry = vi.fn()
  const handleDeleteProperty = vi.fn().mockResolvedValue(undefined)
  const handleUpdateFrontmatter = vi.fn().mockResolvedValue(undefined)
  const onFrontmatterPersisted = vi.fn()
  const setToastMessage = vi.fn()
  const updateEntry = vi.fn()

  function setup(entries: VaultEntry[], actionHistory: ActionHistoryController) {
    return renderHook(() =>
      useEntryActions({
        entries,
        updateEntry,
        handleUpdateFrontmatter,
        handleDeleteProperty,
        setToastMessage,
        createTypeEntry,
        onFrontmatterPersisted,
        actionHistory,
      })
    )
  }

  async function expectReplayableChange({
    entries = [makeEntry()],
    label,
    run,
    verifyRedo,
    verifyUndo,
  }: {
    entries?: VaultEntry[]
    label: string
    run: (actions: ReturnType<typeof useEntryActions>) => Promise<unknown>
    verifyRedo: () => void
    verifyUndo: () => void
  }) {
    const records: ActionHistoryEntry[] = []
    const history = makeActionHistory(records)
    const { result } = setup(entries, history.controller)

    await act(() => run(result.current))

    const record = records[0]
    expect(record?.label).toBe(label)
    vi.clearAllMocks()
    await act(() => history.replay(record!, 'undo'))
    verifyUndo()

    vi.clearAllMocks()
    await act(() => history.replay(record!, 'redo'))
    verifyRedo()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records replayable archive changes after persistence succeeds', async () => {
    await expectReplayableChange({
      label: 'Archive Note',
      run: (actions) => actions.handleArchiveNote(NOTE_PATH),
      verifyUndo: () => expect(handleDeleteProperty).toHaveBeenCalledWith(NOTE_PATH, '_archived', { silent: true }),
      verifyRedo: () => expect(handleUpdateFrontmatter).toHaveBeenCalledWith(NOTE_PATH, '_archived', true, { silent: true }),
    })
  })

  it('records replayable favorite changes after persistence succeeds', async () => {
    await expectReplayableChange({
      label: 'Favorite',
      run: (actions) => actions.handleToggleFavorite(NOTE_PATH),
      verifyUndo: () => {
        expect(handleDeleteProperty).toHaveBeenCalledWith(NOTE_PATH, '_favorite', { silent: true })
        expect(handleDeleteProperty).toHaveBeenCalledWith(NOTE_PATH, '_favorite_index', { silent: true })
      },
      verifyRedo: () => {
        expect(handleUpdateFrontmatter).toHaveBeenCalledWith(NOTE_PATH, '_favorite', true, { silent: true })
        expect(handleUpdateFrontmatter).toHaveBeenCalledWith(NOTE_PATH, '_favorite_index', 1, { silent: true })
      },
    })
  })

  it('records replayable organized changes after persistence succeeds', async () => {
    await expectReplayableChange({
      label: 'Organized',
      run: (actions) => actions.handleToggleOrganized(NOTE_PATH),
      verifyUndo: () => expect(handleDeleteProperty).toHaveBeenCalledWith(NOTE_PATH, '_organized', { silent: true }),
      verifyRedo: () => expect(handleUpdateFrontmatter).toHaveBeenCalledWith(NOTE_PATH, '_organized', true, { silent: true }),
    })
  })

  it('does not record failed favorite changes', async () => {
    const records: ActionHistoryEntry[] = []
    const history = makeActionHistory(records)
    handleUpdateFrontmatter.mockRejectedValueOnce(new Error('disk full'))
    const { result } = setup([makeEntry()], history.controller)

    await act(() => result.current.handleToggleFavorite(NOTE_PATH))

    expect(records).toEqual([])
  })
})
