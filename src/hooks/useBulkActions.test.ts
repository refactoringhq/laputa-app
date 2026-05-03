import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBulkActions } from './useBulkActions'
import { makeEntry } from '../test-utils/noteListTestUtils'

describe('useBulkActions', () => {
  const paths = {
    a: '/vault/a.md',
    b: '/vault/b.md',
    c: '/vault/c.md',
  } as const

  let handleArchiveNote: ReturnType<typeof vi.fn>
  let handleToggleOrganized: ReturnType<typeof vi.fn>
  let setToastMessage: ReturnType<typeof vi.fn>

  beforeEach(() => {
    handleArchiveNote = vi.fn().mockResolvedValue(undefined)
    handleToggleOrganized = vi.fn().mockResolvedValue(true)
    setToastMessage = vi.fn()
  })

  function renderBulkActions(organizedPaths: string[] = []) {
    const entries = [
      makeEntry({ path: paths.a, organized: organizedPaths.includes(paths.a) }),
      makeEntry({ path: paths.b, organized: organizedPaths.includes(paths.b) }),
      makeEntry({ path: paths.c, organized: organizedPaths.includes(paths.c) }),
    ]

    return renderHook(() =>
      useBulkActions(
        { handleArchiveNote, handleToggleOrganized },
        entries,
        setToastMessage,
      ),
    )
  }

  async function runAction(
    action: 'handleBulkArchive' | 'handleBulkOrganize',
    selectedPaths: string[],
    organizedPaths: string[] = [],
  ) {
    const { result } = renderBulkActions(organizedPaths)

    await act(async () => {
      switch (action) {
        case 'handleBulkArchive':
          await result.current.handleBulkArchive(selectedPaths)
          return
        case 'handleBulkOrganize':
          await result.current.handleBulkOrganize(selectedPaths)
      }
    })
  }

  function expectSuccessfulCalls(handler: ReturnType<typeof vi.fn>, successfulPaths: string[]) {
    expect(handler).toHaveBeenCalledTimes(successfulPaths.length)
    for (const path of successfulPaths) {
      expect(handler).toHaveBeenCalledWith(path)
    }
  }

  // --- handleBulkArchive ---

  describe('handleBulkArchive', () => {
    it('archives each path and shows plural toast for multiple notes', async () => {
      await runAction('handleBulkArchive', [paths.a, paths.b])

      expectSuccessfulCalls(handleArchiveNote, [paths.a, paths.b])
      expect(setToastMessage).toHaveBeenCalledWith('2 notes archived')
    })

    it('shows singular toast when one note archived', async () => {
      await runAction('handleBulkArchive', [paths.a])

      expect(setToastMessage).toHaveBeenCalledWith('1 note archived')
    })

    it('does not show toast when empty array given', async () => {
      await runAction('handleBulkArchive', [])

      expect(handleArchiveNote).not.toHaveBeenCalled()
      expect(setToastMessage).not.toHaveBeenCalled()
    })

    it('skips failed paths and only counts successes in toast', async () => {
      handleArchiveNote
        .mockResolvedValueOnce(undefined) // /vault/a.md succeeds
        .mockRejectedValueOnce(new Error('fail')) // /vault/b.md fails
        .mockResolvedValueOnce(undefined) // /vault/c.md succeeds

      await runAction('handleBulkArchive', [paths.a, paths.b, paths.c])

      expect(handleArchiveNote).toHaveBeenCalledTimes(3)
      expect(setToastMessage).toHaveBeenCalledWith('2 notes archived')
    })

    it('shows no toast when all paths fail', async () => {
      handleArchiveNote.mockRejectedValue(new Error('fail'))

      await runAction('handleBulkArchive', [paths.a, paths.b])

      expect(setToastMessage).not.toHaveBeenCalled()
    })
  })

  describe('handleBulkOrganize', () => {
    it('organizes only notes that are not already organized', async () => {
      await runAction('handleBulkOrganize', [paths.a, paths.b, paths.c], [paths.b])

      expectSuccessfulCalls(handleToggleOrganized, [paths.a, paths.c])
      expect(setToastMessage).toHaveBeenCalledWith('2 notes organized')
    })

    it('shows no toast when all selected notes are already organized', async () => {
      await runAction('handleBulkOrganize', [paths.a, paths.b], [paths.a, paths.b])

      expect(handleToggleOrganized).not.toHaveBeenCalled()
      expect(setToastMessage).not.toHaveBeenCalled()
    })

    it('skips failed organize actions and reports only successes', async () => {
      handleToggleOrganized
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('fail'))

      await runAction('handleBulkOrganize', [paths.a, paths.b])

      expect(handleToggleOrganized).toHaveBeenCalledTimes(2)
      expect(setToastMessage).toHaveBeenCalledWith('1 note organized')
    })

    it('does not count organize rollbacks as successes', async () => {
      handleToggleOrganized
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)

      await runAction('handleBulkOrganize', [paths.a, paths.b])

      expect(handleToggleOrganized).toHaveBeenCalledTimes(2)
      expect(setToastMessage).toHaveBeenCalledWith('1 note organized')
    })
  })
})
