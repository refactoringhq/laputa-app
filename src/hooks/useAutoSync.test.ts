import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAutoSync } from './useAutoSync'
import type { GitPullResult } from '../types'

const mockInvokeFn = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvokeFn(...args),
}))
vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (...args: unknown[]) => mockInvokeFn(...args),
}))

const MOCK_COMMIT_INFO = { shortHash: 'a1b2c3d', commitUrl: 'https://github.com/owner/repo/commit/abc' }

function upToDate(): GitPullResult {
  return { status: 'up_to_date', message: 'Already up to date', updatedFiles: [], conflictFiles: [] }
}

function updated(files: string[]): GitPullResult {
  return { status: 'updated', message: `${files.length} file(s) updated`, updatedFiles: files, conflictFiles: [] }
}

function conflict(files: string[]): GitPullResult {
  return { status: 'conflict', message: `Merge conflict in ${files.length} file(s)`, updatedFiles: [], conflictFiles: files }
}

describe('useAutoSync', () => {
  const onVaultUpdated = vi.fn()
  const onConflict = vi.fn()
  const onToast = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockInvokeFn.mockImplementation((cmd: string) => {
      if (cmd === 'get_last_commit_info') return Promise.resolve(MOCK_COMMIT_INFO)
      if (cmd === 'get_conflict_files') return Promise.resolve([])
      return Promise.resolve(upToDate())
    })
  })

  function renderSync(intervalMinutes: number | null = 5, enabled = true) {
    return renderHook(() =>
      useAutoSync({
        enabled,
        vaultPath: '/Users/luca/Laputa',
        intervalMinutes,
        onVaultUpdated,
        onConflict,
        onToast,
      }),
    )
  }

  it('pulls on mount (app launch)', async () => {
    renderSync()
    await waitFor(() => {
      expect(mockInvokeFn).toHaveBeenCalledWith('git_pull', { vaultPath: '/Users/luca/Laputa' })
    })
  })

  it('does not call git operations when disabled', async () => {
    const { result } = renderSync(5, false)

    await waitFor(() => {
      expect(result.current.syncStatus).toBe('idle')
    })

    expect(mockInvokeFn).not.toHaveBeenCalledWith('git_pull', { vaultPath: '/Users/luca/Laputa' })
    expect(mockInvokeFn).not.toHaveBeenCalledWith('git_remote_status', { vaultPath: '/Users/luca/Laputa' })

    act(() => {
      result.current.triggerSync()
      result.current.pullAndPush()
      window.dispatchEvent(new Event('focus'))
    })

    expect(mockInvokeFn).not.toHaveBeenCalledWith('git_pull', { vaultPath: '/Users/luca/Laputa' })
    expect(mockInvokeFn).not.toHaveBeenCalledWith('git_push', { vaultPath: '/Users/luca/Laputa' })
  })

  it('sets syncStatus to idle after up_to_date pull', async () => {
    const { result } = renderSync()
    await waitFor(() => {
      expect(result.current.syncStatus).toBe('idle')
      expect(result.current.lastSyncTime).not.toBeNull()
    })
  })

  it('calls onVaultUpdated and onToast when pull has updates', async () => {
    mockInvokeFn.mockImplementation((cmd: string) => {
      if (cmd === 'get_last_commit_info') return Promise.resolve(MOCK_COMMIT_INFO)
      return Promise.resolve(updated(['note.md', 'project/plan.md']))
    })
    const { result } = renderSync()

    await waitFor(() => {
      expect(onVaultUpdated).toHaveBeenCalledWith(['note.md', 'project/plan.md'])
      expect(onToast).toHaveBeenCalledWith('Pulled 2 update(s) from remote')
      expect(result.current.syncStatus).toBe('idle')
    })
  })

  it('waits for vault refresh before showing the updated toast', async () => {
    let releaseVaultRefresh: (() => void) | null = null
    const asyncVaultRefresh = vi.fn(() => new Promise<void>((resolve) => {
      releaseVaultRefresh = resolve
    }))

    mockInvokeFn.mockImplementation((cmd: string) => {
      if (cmd === 'get_last_commit_info') return Promise.resolve(MOCK_COMMIT_INFO)
      return Promise.resolve(updated(['note.md']))
    })

    renderHook(() =>
      useAutoSync({
        vaultPath: '/Users/luca/Laputa',
        intervalMinutes: 5,
        onVaultUpdated: asyncVaultRefresh,
        onConflict,
        onToast,
      }),
    )

    await waitFor(() => {
      expect(asyncVaultRefresh).toHaveBeenCalledWith(['note.md'])
    })
    expect(onToast).not.toHaveBeenCalledWith('Pulled 1 update(s) from remote')

    await act(async () => {
      releaseVaultRefresh?.()
    })

    await waitFor(() => {
      expect(onToast).toHaveBeenCalledWith('Pulled 1 update(s) from remote')
    })
  })

  it('calls onConflict and sets conflict status when pull has conflicts', async () => {
    mockInvokeFn.mockImplementation((cmd: string) => {
      if (cmd === 'get_last_commit_info') return Promise.resolve(MOCK_COMMIT_INFO)
      return Promise.resolve(conflict(['note.md']))
    })
    const { result } = renderSync()

    await waitFor(() => {
      expect(onConflict).toHaveBeenCalledWith(['note.md'])
      expect(result.current.syncStatus).toBe('conflict')
      expect(result.current.conflictFiles).toEqual(['note.md'])
    })
  })

  it('sets error status when pull fails', async () => {
    mockInvokeFn.mockImplementation((cmd: string) => {
      if (cmd === 'get_last_commit_info') return Promise.resolve(null)
      return Promise.reject(new Error('Network error'))
    })
    const { result } = renderSync()

    await waitFor(() => {
      expect(result.current.syncStatus).toBe('error')
    })
  })

  it('pulls on window focus after cooldown expires', async () => {
    const now = vi.spyOn(Date, 'now')
    let clock = 1000
    now.mockImplementation(() => clock)

    renderSync()
    await waitFor(() => {
      expect(mockInvokeFn).toHaveBeenCalledWith('git_pull', { vaultPath: '/Users/luca/Laputa' })
    })

    // Focus within cooldown — should NOT trigger pull
    mockInvokeFn.mockClear()
    clock += 5_000 // only 5s later
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    const pullCalls = mockInvokeFn.mock.calls.filter((c: unknown[]) => c[0] === 'git_pull')
    expect(pullCalls).toHaveLength(0)

    // Focus after cooldown — should trigger pull
    clock += 30_000 // 30s later
    await act(async () => { window.dispatchEvent(new Event('focus')) })

    await waitFor(() => {
      expect(mockInvokeFn).toHaveBeenCalledWith('git_pull', { vaultPath: '/Users/luca/Laputa' })
    })

    now.mockRestore()
  })

  it('triggerSync allows manual pull', async () => {
    const { result } = renderSync()
    await waitFor(() => {
      expect(result.current.syncStatus).toBe('idle')
    })

    mockInvokeFn.mockClear()
    mockInvokeFn.mockImplementation((cmd: string) => {
      if (cmd === 'get_last_commit_info') return Promise.resolve(MOCK_COMMIT_INFO)
      return Promise.resolve(updated(['note.md']))
    })

    await act(async () => {
      result.current.triggerSync()
    })

    await waitFor(() => {
      expect(mockInvokeFn).toHaveBeenCalledWith('git_pull', { vaultPath: '/Users/luca/Laputa' })
      expect(onToast).toHaveBeenCalledWith('Pulled 1 update(s) from remote')
    })
  })

  it('handles no_remote status silently', async () => {
    mockInvokeFn.mockImplementation((cmd: string) => {
      if (cmd === 'get_last_commit_info') return Promise.resolve(null)
      return Promise.resolve({
        status: 'no_remote', message: 'No remote configured', updatedFiles: [], conflictFiles: [],
      })
    })
    const { result } = renderSync()

    await waitFor(() => {
      expect(result.current.syncStatus).toBe('idle')
      expect(onVaultUpdated).not.toHaveBeenCalled()
      expect(onToast).not.toHaveBeenCalled()
    })
  })

  it('does not fire concurrent pulls', async () => {
    let resolveFirst: ((v: GitPullResult) => void) | null = null
    mockInvokeFn.mockImplementation((cmd: string) => {
      if (cmd === 'get_last_commit_info') return Promise.resolve(MOCK_COMMIT_INFO)
      if (cmd === 'get_conflict_files') return Promise.resolve([])
      return new Promise<GitPullResult>((r) => { resolveFirst = r })
    })

    const { result } = renderSync()

    // Wait for startup conflict check to complete and pull to start
    await waitFor(() => {
      const pullCalls = mockInvokeFn.mock.calls.filter((c: unknown[]) => c[0] === 'git_pull').length
      expect(pullCalls).toBe(1)
    })

    // Trigger a manual sync while first is still running
    act(() => {
      result.current.triggerSync()
    })

    // Should NOT have fired a second git_pull call
    const pullCalls = () => mockInvokeFn.mock.calls.filter((c: unknown[]) => c[0] === 'git_pull').length
    expect(pullCalls()).toBe(1)

    // Resolve the first
    await act(async () => {
      resolveFirst?.(upToDate())
    })
  })

  it('exposes lastCommitInfo after sync', async () => {
    const { result } = renderSync()
    await waitFor(() => {
      expect(result.current.lastCommitInfo).toEqual(MOCK_COMMIT_INFO)
    })
  })

  it('skips pull when paused via pausePull', async () => {
    const { result } = renderSync()

    await waitFor(() => {
      expect(result.current.syncStatus).toBe('idle')
    })

    // Pause and clear mocks
    act(() => { result.current.pausePull() })
    mockInvokeFn.mockClear()

    // Trigger sync while paused
    act(() => { result.current.triggerSync() })

    // Should not have called git_pull
    const pullCalls = mockInvokeFn.mock.calls.filter((c: unknown[]) => c[0] === 'git_pull').length
    expect(pullCalls).toBe(0)

    // Resume
    act(() => { result.current.resumePull() })
  })

  it('handles error status from git_pull result', async () => {
    mockInvokeFn.mockImplementation((cmd: string) => {
      if (cmd === 'get_last_commit_info') return Promise.resolve(null)
      if (cmd === 'get_conflict_files') return Promise.resolve([])
      return Promise.resolve({
        status: 'error', message: 'remote: Not Found', updatedFiles: [], conflictFiles: [],
      })
    })
    const { result } = renderSync()

    await waitFor(() => {
      expect(result.current.syncStatus).toBe('error')
    })
  })

  it('detects pre-existing conflicts on startup before pulling', async () => {
    mockInvokeFn.mockImplementation((cmd: string) => {
      if (cmd === 'get_conflict_files') return Promise.resolve(['note.md', 'plan.md'])
      if (cmd === 'get_last_commit_info') return Promise.resolve(MOCK_COMMIT_INFO)
      return Promise.resolve(upToDate())
    })
    const { result } = renderSync()

    await waitFor(() => {
      expect(result.current.syncStatus).toBe('conflict')
      expect(result.current.conflictFiles).toEqual(['note.md', 'plan.md'])
      expect(onConflict).toHaveBeenCalledWith(['note.md', 'plan.md'])
    })

    // Should NOT have called git_pull since conflicts were found on startup
    const pullCalls = mockInvokeFn.mock.calls.filter((c: unknown[]) => c[0] === 'git_pull')
    expect(pullCalls).toHaveLength(0)
  })

  it('calls onSyncUpdated when pull has updates', async () => {
    const onSyncUpdated = vi.fn()
    mockInvokeFn.mockImplementation((cmd: string) => {
      if (cmd === 'get_last_commit_info') return Promise.resolve(MOCK_COMMIT_INFO)
      return Promise.resolve(updated(['note.md']))
    })
    renderHook(() =>
      useAutoSync({
        vaultPath: '/Users/luca/Laputa',
        intervalMinutes: 5,
        onVaultUpdated,
        onSyncUpdated,
        onConflict,
        onToast,
      }),
    )

    await waitFor(() => {
      expect(onSyncUpdated).toHaveBeenCalledOnce()
    })
  })

  it('does not call onSyncUpdated when pull is up_to_date', async () => {
    const onSyncUpdated = vi.fn()
    renderHook(() =>
      useAutoSync({
        vaultPath: '/Users/luca/Laputa',
        intervalMinutes: 5,
        onVaultUpdated,
        onSyncUpdated,
        onConflict,
        onToast,
      }),
    )

    await waitFor(() => {
      expect(onVaultUpdated).not.toHaveBeenCalled()
    })
    expect(onSyncUpdated).not.toHaveBeenCalled()
  })

  it('detects conflicts when git_pull returns error with unresolved conflicts', async () => {
    mockInvokeFn.mockImplementation((cmd: string) => {
      if (cmd === 'get_conflict_files') return Promise.resolve(['conflict.md'])
      if (cmd === 'get_last_commit_info') return Promise.resolve(null)
      return Promise.resolve({
        status: 'error', message: 'Pull failed', updatedFiles: [], conflictFiles: [],
      })
    })
    const { result } = renderSync()

    // Startup check finds conflicts, so pull is skipped
    await waitFor(() => {
      expect(result.current.syncStatus).toBe('conflict')
      expect(result.current.conflictFiles).toEqual(['conflict.md'])
    })
  })

  it('pulls, pushes, and emits a success toast when recovery succeeds', async () => {
    const onSyncUpdated = vi.fn()
    let pullCount = 0

    mockInvokeFn.mockImplementation((cmd: string) => {
      if (cmd === 'get_conflict_files') return Promise.resolve([])
      if (cmd === 'get_last_commit_info') return Promise.resolve(MOCK_COMMIT_INFO)
      if (cmd === 'git_remote_status') return Promise.resolve(null)
      if (cmd === 'git_pull') {
        pullCount += 1
        return Promise.resolve(pullCount === 1 ? upToDate() : updated(['note.md']))
      }
      if (cmd === 'git_push') return Promise.resolve({ status: 'ok', message: 'Pushed successfully' })
      return Promise.resolve(upToDate())
    })

    const { result } = renderHook(() =>
      useAutoSync({
        vaultPath: '/Users/luca/Laputa',
        intervalMinutes: 5,
        onVaultUpdated,
        onSyncUpdated,
        onConflict,
        onToast,
      }),
    )

    await waitFor(() => {
      expect(result.current.syncStatus).toBe('idle')
    })

    await act(async () => {
      result.current.pullAndPush()
    })

    await waitFor(() => {
      expect(onVaultUpdated).toHaveBeenCalledWith(['note.md'])
      expect(onSyncUpdated).toHaveBeenCalled()
      expect(onToast).toHaveBeenCalledWith('Pulled and pushed successfully')
      expect(result.current.syncStatus).toBe('idle')
    })
  })

  it('marks pull_required when the recovery push is still rejected', async () => {
    let pullCount = 0

    mockInvokeFn.mockImplementation((cmd: string) => {
      if (cmd === 'get_conflict_files') return Promise.resolve([])
      if (cmd === 'get_last_commit_info') return Promise.resolve(MOCK_COMMIT_INFO)
      if (cmd === 'git_remote_status') return Promise.resolve(null)
      if (cmd === 'git_pull') {
        pullCount += 1
        return Promise.resolve(pullCount === 1 ? upToDate() : upToDate())
      }
      if (cmd === 'git_push') {
        return Promise.resolve({
          status: 'rejected',
          message: 'Push rejected: remote has new commits. Pull first, then push.',
        })
      }
      return Promise.resolve(upToDate())
    })

    const { result } = renderSync()
    await waitFor(() => {
      expect(result.current.syncStatus).toBe('idle')
    })

    await act(async () => {
      result.current.pullAndPush()
    })

    await waitFor(() => {
      expect(result.current.syncStatus).toBe('pull_required')
      expect(onToast).toHaveBeenCalledWith('Push still rejected after pull — try again')
    })
  })

  it('surfaces pull conflicts and pull errors during recovery pushes', async () => {
    let mode: 'conflict' | 'error' = 'conflict'

    mockInvokeFn.mockImplementation((cmd: string) => {
      if (cmd === 'get_conflict_files') return Promise.resolve([])
      if (cmd === 'get_last_commit_info') return Promise.resolve(MOCK_COMMIT_INFO)
      if (cmd === 'git_remote_status') return Promise.resolve(null)
      if (cmd === 'git_pull') {
        return Promise.resolve(
          mode === 'conflict'
            ? conflict(['note.md'])
            : { status: 'error', message: 'fetch failed', updatedFiles: [], conflictFiles: [] },
        )
      }
      if (cmd === 'git_push') return Promise.resolve({ status: 'ok', message: 'Pushed successfully' })
      return Promise.resolve(upToDate())
    })

    const { result } = renderSync()
    await waitFor(() => {
      expect(result.current.syncStatus).toBe('idle')
    })

    await act(async () => {
      result.current.pullAndPush()
    })
    await waitFor(() => {
      expect(result.current.syncStatus).toBe('conflict')
      expect(result.current.conflictFiles).toEqual(['note.md'])
    })

    mode = 'error'
    await act(async () => {
      result.current.pullAndPush()
    })
    await waitFor(() => {
      expect(result.current.syncStatus).toBe('error')
      expect(onToast).toHaveBeenCalledWith('Pull failed: fetch failed')
    })
  })

  it('exposes a direct push-rejected handler for external workflows', async () => {
    const { result } = renderSync()

    await waitFor(() => {
      expect(result.current.syncStatus).toBe('idle')
    })

    act(() => {
      result.current.handlePushRejected()
    })

    expect(result.current.syncStatus).toBe('pull_required')
  })
})
