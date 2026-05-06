import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDiffMode } from './useDiffMode'

describe('useDiffMode', () => {
  let onLoadDiff: ReturnType<typeof vi.fn>
  let onLoadDiffAtCommit: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onLoadDiff = vi.fn()
    onLoadDiffAtCommit = vi.fn()
  })

  function renderDiffHook(activeTabPath: string | null = '/note.md') {
    return renderHook(
      ({ path }) => useDiffMode({ activeTabPath: path, onLoadDiff, onLoadDiffAtCommit }),
      { initialProps: { path: activeTabPath } },
    )
  }

  async function expectLoadError(action: 'toggle' | 'commit') {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderDiffHook()

    if (action === 'toggle') {
      onLoadDiff.mockRejectedValue(new Error('network'))
      await act(async () => { await result.current.handleToggleDiff() })
    } else {
      onLoadDiffAtCommit.mockRejectedValue(new Error('fail'))
      await act(async () => { await result.current.handleViewCommitDiff('abc123') })
    }

    expect(result.current.diffMode).toBe(false)
    expect(result.current.diffLoading).toBe(false)
    warn.mockRestore()
  }

  async function expectPendingDiffRequestLoaded(options: {
    diffContent: string
    requestId: number
    commitHash?: string
  }) {
    const { diffContent, requestId, commitHash = '' } = options
    const onPendingCommitDiffHandled = vi.fn()

    if (commitHash) {
      onLoadDiffAtCommit.mockResolvedValue(diffContent)
    } else {
      onLoadDiff.mockResolvedValue(diffContent)
    }

    const { result } = renderHook(() => useDiffMode({
      activeTabPath: '/note.md',
      onLoadDiff,
      onLoadDiffAtCommit,
      pendingCommitDiffRequest: { requestId, path: '/note.md', commitHash },
      onPendingCommitDiffHandled,
    }))

    await waitFor(() => {
      if (commitHash) {
        expect(onLoadDiffAtCommit).toHaveBeenCalledWith('/note.md', commitHash)
      } else {
        expect(onLoadDiff).toHaveBeenCalledWith('/note.md')
        expect(onLoadDiffAtCommit).not.toHaveBeenCalled()
      }
    })
    await waitFor(() => {
      expect(result.current.diffMode).toBe(true)
      expect(result.current.diffContent).toBe(diffContent)
      expect(onPendingCommitDiffHandled).toHaveBeenCalledWith(requestId)
    })
  }

  it('starts with diff mode off', () => {
    const { result } = renderDiffHook()
    expect(result.current.diffMode).toBe(false)
    expect(result.current.diffContent).toBeNull()
    expect(result.current.diffLoading).toBe(false)
  })

  it('toggles diff mode on and loads content', async () => {
    onLoadDiff.mockResolvedValue('diff content here')
    const { result } = renderDiffHook()

    await act(async () => { await result.current.handleToggleDiff() })

    expect(onLoadDiff).toHaveBeenCalledWith('/note.md')
    expect(result.current.diffMode).toBe(true)
    expect(result.current.diffContent).toBe('diff content here')
    expect(result.current.diffLoading).toBe(false)
  })

  it('toggles diff mode off when already on', async () => {
    onLoadDiff.mockResolvedValue('diff')
    const { result } = renderDiffHook()

    await act(async () => { await result.current.handleToggleDiff() })
    expect(result.current.diffMode).toBe(true)

    await act(async () => { await result.current.handleToggleDiff() })
    expect(result.current.diffMode).toBe(false)
    expect(result.current.diffContent).toBeNull()
  })

  it('does nothing when activeTabPath is null', async () => {
    const { result } = renderDiffHook(null)

    await act(async () => { await result.current.handleToggleDiff() })

    expect(onLoadDiff).not.toHaveBeenCalled()
    expect(result.current.diffMode).toBe(false)
  })

  it('does nothing when onLoadDiff is not provided', async () => {
    const { result } = renderHook(() => useDiffMode({ activeTabPath: '/note.md' }))

    await act(async () => { await result.current.handleToggleDiff() })
    expect(result.current.diffMode).toBe(false)
  })

  it('resets diff state when activeTabPath changes', async () => {
    onLoadDiff.mockResolvedValue('diff')
    const { result, rerender } = renderDiffHook('/note-a.md')

    await act(async () => { await result.current.handleToggleDiff() })
    expect(result.current.diffMode).toBe(true)

    rerender({ path: '/note-b.md' })
    expect(result.current.diffMode).toBe(false)
    expect(result.current.diffContent).toBeNull()
  })

  it('handles load error gracefully', async () => {
    await expectLoadError('toggle')
  })

  it('loads diff at specific commit', async () => {
    onLoadDiffAtCommit.mockResolvedValue('commit diff')
    const { result } = renderDiffHook()

    await act(async () => { await result.current.handleViewCommitDiff('abc123') })

    expect(onLoadDiffAtCommit).toHaveBeenCalledWith('/note.md', 'abc123')
    expect(result.current.diffMode).toBe(true)
    expect(result.current.diffContent).toBe('commit diff')
  })

  it('does not reopen diff mode when a later history diff resolves after returning to the note', async () => {
    let resolveSecondDiff: (value: string) => void = () => {}
    onLoadDiffAtCommit
      .mockResolvedValueOnce('first diff')
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolveSecondDiff = resolve
      }))
    const { result } = renderDiffHook()

    await act(async () => { await result.current.handleViewCommitDiff('first') })
    expect(result.current.diffMode).toBe(true)
    expect(result.current.diffContent).toBe('first diff')

    await act(async () => { void result.current.handleViewCommitDiff('second') })
    expect(onLoadDiffAtCommit).toHaveBeenCalledWith('/note.md', 'second')

    await act(async () => { await result.current.handleToggleDiff() })
    expect(result.current.diffMode).toBe(false)

    await act(async () => {
      resolveSecondDiff('second diff')
      await Promise.resolve()
    })

    expect(result.current.diffMode).toBe(false)
    expect(result.current.diffContent).toBeNull()
  })

  it('skips commit diff when no callback', async () => {
    const { result } = renderHook(() => useDiffMode({ activeTabPath: '/note.md' }))

    await act(async () => { await result.current.handleViewCommitDiff('abc123') })
    expect(result.current.diffMode).toBe(false)
  })

  it('handles commit diff error gracefully', async () => {
    await expectLoadError('commit')
  })

  it('loads a pending commit diff request when the matching tab is active', async () => {
    await expectPendingDiffRequestLoaded({
      diffContent: 'pulse diff',
      requestId: 7,
      commitHash: 'abc123',
    })
  })

  it('loads a pending working-tree diff request when the matching tab is active', async () => {
    await expectPendingDiffRequestLoaded({
      diffContent: 'working tree diff',
      requestId: 9,
    })
  })

  it('ignores pending commit diff requests for a different path', async () => {
    const onPendingCommitDiffHandled = vi.fn()

    renderHook(() => useDiffMode({
      activeTabPath: '/note.md',
      onLoadDiffAtCommit,
      pendingCommitDiffRequest: { requestId: 8, path: '/other.md', commitHash: 'abc123' },
      onPendingCommitDiffHandled,
    }))

    await act(async () => { await Promise.resolve() })

    expect(onLoadDiffAtCommit).not.toHaveBeenCalled()
    expect(onPendingCommitDiffHandled).not.toHaveBeenCalled()
  })
})
