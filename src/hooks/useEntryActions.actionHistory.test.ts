import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../types'
import type { ActionHistoryController } from './useActionHistory'
import { useEntryActions } from './useEntryActions'

const notePath = '/vault/note/test.md'

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: notePath,
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
  outgoingLinks: [],
  properties: {},
  ...overrides,
})

describe('useEntryActions action history', () => {
  const updateEntry = vi.fn()
  const handleUpdateFrontmatter = vi.fn().mockResolvedValue(undefined)
  const handleDeleteProperty = vi.fn().mockResolvedValue(undefined)
  const setToastMessage = vi.fn()
  const createTypeEntry = vi.fn()
  const onFrontmatterPersisted = vi.fn()
  const actionHistory: ActionHistoryController = {
    canRedo: false,
    canUndo: false,
    redoLabel: null,
    undoLabel: null,
    record: vi.fn(),
    recordAction: vi.fn(),
    isReplaying: vi.fn(() => false),
    undo: vi.fn(async () => false),
    redo: vi.fn(async () => false),
    withoutRecording: vi.fn(async (run) => await run()),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function setup(entries: VaultEntry[]) {
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
      }),
    )
  }

  async function recordedActionAfter(run: () => Promise<unknown>) {
    await act(run)
    expect(actionHistory.record).toHaveBeenCalledTimes(1)
    return actionHistory.record.mock.calls[0][0]
  }

  it('records favorite replay only after persistence succeeds', async () => {
    const { result } = setup([makeEntry({ favorite: false, favoriteIndex: null })])
    const action = await recordedActionAfter(() => result.current.handleToggleFavorite(notePath))

    expect(action).toMatchObject({ label: 'Add to Favorites', path: notePath })
    vi.clearAllMocks()
    await action.undo()
    expect(handleDeleteProperty).toHaveBeenCalledWith(notePath, '_favorite', { silent: true })
    expect(updateEntry).toHaveBeenCalledWith(notePath, { favorite: false, favoriteIndex: null })
  })

  it('records organized replay only after persistence succeeds', async () => {
    const { result } = setup([makeEntry({ organized: false })])
    const action = await recordedActionAfter(() => result.current.handleToggleOrganized(notePath))

    expect(action).toMatchObject({ label: 'Mark as Organized', path: notePath })
    vi.clearAllMocks()
    await action.redo()
    expect(handleUpdateFrontmatter).toHaveBeenCalledWith(notePath, '_organized', true, { silent: true })
    expect(updateEntry).toHaveBeenCalledWith(notePath, { organized: true })
  })

  it('skips history when persistence fails', async () => {
    const cleanupHistory = vi.fn()
    actionHistory.record.mockReturnValueOnce(cleanupHistory)
    handleUpdateFrontmatter.mockRejectedValueOnce(new Error('disk full'))
    const { result } = setup([makeEntry({ organized: false })])

    await act(() => result.current.handleToggleOrganized(notePath))

    expect(cleanupHistory).toHaveBeenCalledTimes(1)
    expect(setToastMessage).toHaveBeenCalledWith('Failed to organize — rolled back')
  })
})
