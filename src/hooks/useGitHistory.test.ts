import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitCommit } from '../types'
import { useGitHistory } from './useGitHistory'

const mockHistory: GitCommit[] = [
  { hash: 'abc', shortHash: 'abc', author: 'luca', date: 1_700_000_000, message: 'Initial commit' },
]

describe('useGitHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits briefly before loading note history', async () => {
    const loadGitHistory = vi.fn().mockResolvedValue(mockHistory)

    const { result } = renderHook(() => useGitHistory('/vault/a.md', loadGitHistory, true))

    expect(result.current).toEqual([])
    expect(loadGitHistory).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(199)
    })

    expect(loadGitHistory).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(loadGitHistory).toHaveBeenCalledWith('/vault/a.md')
    expect(result.current).toEqual(mockHistory)
  })

  it('skips loading when history is disabled', () => {
    const loadGitHistory = vi.fn().mockResolvedValue(mockHistory)

    const { result } = renderHook(() => useGitHistory('/vault/a.md', loadGitHistory, false))

    act(() => {
      vi.advanceTimersByTime(1_000)
    })

    expect(loadGitHistory).not.toHaveBeenCalled()
    expect(result.current).toEqual([])
  })

  it('cancels stale pending loads when the active note changes quickly', async () => {
    const loadGitHistory = vi.fn((path: string) => Promise.resolve([
      { ...mockHistory[0], hash: path, shortHash: path, message: path },
    ]))

    const { result, rerender } = renderHook(
      ({ path }) => useGitHistory(path, loadGitHistory, true),
      { initialProps: { path: '/vault/a.md' as string | null } },
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    rerender({ path: '/vault/b.md' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(199)
    })

    expect(loadGitHistory).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(loadGitHistory).toHaveBeenCalledTimes(1)
    expect(loadGitHistory).toHaveBeenCalledWith('/vault/b.md')
    expect(result.current).toEqual([
      expect.objectContaining({ hash: '/vault/b.md', message: '/vault/b.md' }),
    ])
  })

  it('clears previously loaded history when the inspector is hidden', async () => {
    const loadGitHistory = vi.fn().mockResolvedValue(mockHistory)

    const { result, rerender } = renderHook(
      ({ enabled }) => useGitHistory('/vault/a.md', loadGitHistory, enabled),
      { initialProps: { enabled: true } },
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(result.current).toEqual(mockHistory)

    rerender({ enabled: false })

    expect(result.current).toEqual([])
  })

  it('reloads history when the refresh key changes', async () => {
    const loadGitHistory = vi.fn((path: string) => Promise.resolve([
      { ...mockHistory[0], hash: `${path}-${loadGitHistory.mock.calls.length}` },
    ]))

    const { result, rerender } = renderHook(
      ({ refreshKey }) => useGitHistory('/vault/a.md', loadGitHistory, true, refreshKey),
      { initialProps: { refreshKey: 0 } },
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(result.current[0]?.hash).toBe('/vault/a.md-1')

    rerender({ refreshKey: 1 })
    expect(result.current).toEqual([])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(loadGitHistory).toHaveBeenCalledTimes(2)
    expect(result.current[0]?.hash).toBe('/vault/a.md-2')
  })
})
