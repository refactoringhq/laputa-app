import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoSync } from './useAutoSync'
import type { GitPullResult, GitRemoteStatus } from '../types'

const mockInvokeFn = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvokeFn(...args),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (...args: unknown[]) => mockInvokeFn(...args),
}))

const LAST_COMMIT_INFO = {
  shortHash: 'a1b2c3d',
  commitUrl: 'https://github.com/owner/repo/commit/abc123',
}

const REMOTE_STATUS: GitRemoteStatus = {
  branch: 'main',
  ahead: 0,
  behind: 0,
  hasRemote: true,
}

function upToDate(): GitPullResult {
  return {
    status: 'up_to_date',
    message: 'Already up to date',
    updatedFiles: [],
    conflictFiles: [],
  }
}

function updated(files: string[]): GitPullResult {
  return {
    status: 'updated',
    message: `${files.length} files updated`,
    updatedFiles: files,
    conflictFiles: [],
  }
}

function conflict(files: string[]): GitPullResult {
  return {
    status: 'conflict',
    message: 'Merge conflicts detected',
    updatedFiles: [],
    conflictFiles: files,
  }
}

function defaultMockImplementation(command: string) {
  if (command === 'get_last_commit_info') return Promise.resolve(LAST_COMMIT_INFO)
  if (command === 'get_conflict_files') return Promise.resolve([])
  if (command === 'git_remote_status') return Promise.resolve(REMOTE_STATUS)
  return Promise.resolve(upToDate())
}

function renderSync(overrides: Partial<Parameters<typeof useAutoSync>[0]> = {}) {
  const onVaultUpdated = vi.fn()
  const onSyncUpdated = vi.fn()
  const onConflict = vi.fn()
  const onToast = vi.fn()

  const hook = renderHook(() =>
    useAutoSync({
      vaultPath: '/Users/luca/Laputa',
      intervalMinutes: 5,
      onVaultUpdated,
      onSyncUpdated,
      onConflict,
      onToast,
      ...overrides,
    }),
  )

  return {
    ...hook,
    onVaultUpdated,
    onSyncUpdated,
    onConflict,
    onToast,
  }
}

async function waitForInitialIdle(
  result: ReturnType<typeof renderSync>['result'],
) {
  await waitFor(() => {
    expect(result.current.syncStatus).toBe('idle')
    expect(result.current.remoteStatus).toEqual(REMOTE_STATUS)
  })
  mockInvokeFn.mockClear()
}

describe('useAutoSync extra', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvokeFn.mockImplementation(defaultMockImplementation)
  })

  it('pulls, pushes, and refreshes remote status after a recovery sync', async () => {
    const hook = renderSync()
    await waitForInitialIdle(hook.result)

    mockInvokeFn.mockImplementation((command: string) => {
      if (command === 'get_last_commit_info') return Promise.resolve(LAST_COMMIT_INFO)
      if (command === 'get_conflict_files') return Promise.resolve([])
      if (command === 'git_remote_status') return Promise.resolve({ ...REMOTE_STATUS, behind: 1 })
      if (command === 'git_push') return Promise.resolve({ status: 'ok', message: 'Pushed successfully' })
      return Promise.resolve(updated(['notes/today.md']))
    })

    await act(async () => {
      await hook.result.current.pullAndPush()
    })

    await waitFor(() => {
      expect(hook.onVaultUpdated).toHaveBeenCalledWith(['notes/today.md'], '/Users/luca/Laputa')
      expect(hook.onSyncUpdated).toHaveBeenCalledOnce()
      expect(hook.onToast).toHaveBeenCalledWith('Pulled and pushed successfully')
      expect(hook.result.current.syncStatus).toBe('idle')
      expect(hook.result.current.remoteStatus).toEqual({ ...REMOTE_STATUS, behind: 1 })
    })
  })

  it('surfaces conflicts from pullAndPush without attempting a push', async () => {
    const hook = renderSync()
    await waitForInitialIdle(hook.result)

    mockInvokeFn.mockImplementation((command: string) => {
      if (command === 'get_last_commit_info') return Promise.resolve(LAST_COMMIT_INFO)
      if (command === 'get_conflict_files') return Promise.resolve([])
      if (command === 'git_remote_status') return Promise.resolve(REMOTE_STATUS)
      return Promise.resolve(conflict(['plans/weekly.md']))
    })

    await act(async () => {
      await hook.result.current.pullAndPush()
    })

    await waitFor(() => {
      expect(hook.onConflict).toHaveBeenCalledWith(['plans/weekly.md'])
      expect(hook.result.current.syncStatus).toBe('conflict')
      expect(hook.result.current.conflictFiles).toEqual(['plans/weekly.md'])
    })
    expect(
      mockInvokeFn.mock.calls.some(([command]) => command === 'git_push'),
    ).toBe(false)
  })

  it.each([
    {
      name: 'marks pull_required when the follow-up push is rejected',
      pushResult: { status: 'rejected', message: 'Remote advanced again' },
      expectedStatus: 'pull_required',
      expectedToast: 'Push still rejected after pull — try again',
    },
    {
      name: 'surfaces follow-up push errors',
      pushResult: { status: 'network_error', message: 'Push failed: offline' },
      expectedStatus: 'error',
      expectedToast: 'Push failed: offline',
    },
  ])('$name', async ({ pushResult, expectedStatus, expectedToast }) => {
    const hook = renderSync()
    await waitForInitialIdle(hook.result)

    mockInvokeFn.mockImplementation((command: string) => {
      if (command === 'get_last_commit_info') return Promise.resolve(LAST_COMMIT_INFO)
      if (command === 'get_conflict_files') return Promise.resolve([])
      if (command === 'git_remote_status') return Promise.resolve(REMOTE_STATUS)
      if (command === 'git_push') return Promise.resolve(pushResult)
      return Promise.resolve(upToDate())
    })

    await act(async () => {
      await hook.result.current.pullAndPush()
    })

    await waitFor(() => {
      expect(hook.result.current.syncStatus).toBe(expectedStatus)
      expect(hook.onToast).toHaveBeenCalledWith(expectedToast)
    })
  })

  it('exposes a manual pull-required state for rejected save flows', async () => {
    const hook = renderSync()
    await waitForInitialIdle(hook.result)

    act(() => {
      hook.result.current.handlePushRejected()
    })

    expect(hook.result.current.syncStatus).toBe('pull_required')
  })
})
