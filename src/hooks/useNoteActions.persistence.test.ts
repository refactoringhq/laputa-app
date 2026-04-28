import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
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
  updateMockFrontmatter: vi.fn().mockReturnValue('---\nupdated: true\n---\n'),
  deleteMockFrontmatterProperty: vi.fn().mockReturnValue('---\n---\n'),
}))

function makeConfig(onFrontmatterPersisted: () => void): NoteActionsConfig {
  return {
    addEntry: vi.fn(),
    removeEntry: vi.fn(),
    entries: [],
    setToastMessage: vi.fn(),
    updateEntry: vi.fn(),
    vaultPath: '/test/vault',
    onFrontmatterPersisted,
  }
}

describe('useNoteActions frontmatter persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    {
      label: 'update',
      run: async (result: ReturnType<typeof renderHook<typeof useNoteActions>>['result']) => {
        await result.current.handleUpdateFrontmatter('/vault/note.md', '_list_properties_display', ['Owner', 'Status'])
      },
    },
    {
      label: 'delete',
      run: async (result: ReturnType<typeof renderHook<typeof useNoteActions>>['result']) => {
        await result.current.handleDeleteProperty('/vault/note.md', 'status')
      },
    },
  ])('notifies after a frontmatter $label completes', async ({ run }) => {
    const onFrontmatterPersisted = vi.fn()
    const { result } = renderHook(() => useNoteActions(makeConfig(onFrontmatterPersisted)))

    await act(async () => {
      await run(result)
    })

    expect(onFrontmatterPersisted).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      label: 'update',
      run: async (result: ReturnType<typeof renderHook<typeof useNoteActions>>['result']) => {
        await result.current.handleUpdateFrontmatter('/vault/note.md', 'status', 'Done')
      },
    },
    {
      label: 'delete',
      run: async (result: ReturnType<typeof renderHook<typeof useNoteActions>>['result']) => {
        await result.current.handleDeleteProperty('/vault/note.md', 'status')
      },
    },
  ])('flushes pending raw content before a frontmatter $label', async ({ run }) => {
    const flushBeforeNoteMutation = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useNoteActions({
      ...makeConfig(vi.fn()),
      flushBeforeNoteMutation,
    }))

    await act(async () => {
      await run(result)
    })

    expect(flushBeforeNoteMutation).toHaveBeenCalledWith('/vault/note.md')
  })
})
