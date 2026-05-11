import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useCommitFlow } from './useCommitFlow'

const mockInvokeFn = vi.fn()
const mockTrackEvent = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args: Record<string, unknown>) => mockInvokeFn(command, args),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (command: string, args: Record<string, unknown>) => mockInvokeFn(command, args),
}))

vi.mock('../lib/telemetry', () => ({
  trackEvent: (event: string, properties?: Record<string, unknown>) => mockTrackEvent(event, properties),
}))

describe('useCommitFlow', () => {
  let savePending: vi.Mock
  let loadModifiedFiles: vi.Mock
  let resolveRemoteStatus: vi.Mock
  let setToastMessage: vi.Mock
  let onPushRejected: vi.Mock

  beforeEach(() => {
    savePending = vi.fn().mockResolvedValue(undefined)
    loadModifiedFiles = vi.fn().mockResolvedValue(undefined)
    resolveRemoteStatus = vi.fn().mockResolvedValue({ branch: 'main', ahead: 0, behind: 0, hasRemote: true })
    setToastMessage = vi.fn()
    onPushRejected = vi.fn()
    mockTrackEvent.mockReset()
    mockInvokeFn.mockReset()
    mockInvokeFn.mockImplementation((command: string) => {
      if (command === 'git_commit') return Promise.resolve('[main abc1234] test commit')
      if (command === 'git_push') return Promise.resolve({ status: 'ok', message: 'Pushed to remote' })
      if (command === 'get_modified_files') return Promise.resolve([{ path: '/vault/a.md', relativePath: 'a.md', status: 'modified' }])
      throw new Error(`Unexpected command: ${command}`)
    })
  })

  function renderCommitFlow(overrides: Partial<Parameters<typeof useCommitFlow>[0]> = {}) {
    return renderHook(() => useCommitFlow({
      savePending,
      loadModifiedFiles,
      resolveRemoteStatus,
      setToastMessage,
      onPushRejected,
      vaultPath: '/vault',
      ...overrides,
    }))
  }

  it('openCommitDialog saves pending, refreshes files, and sets local mode when no remote exists', async () => {
    resolveRemoteStatus.mockResolvedValueOnce({ branch: 'main', ahead: 0, behind: 0, hasRemote: false })
    const { result } = renderCommitFlow()

    await act(async () => {
      await result.current.openCommitDialog()
    })

    expect(savePending).toHaveBeenCalledTimes(1)
    expect(loadModifiedFiles).toHaveBeenCalledTimes(1)
    expect(resolveRemoteStatus).toHaveBeenCalledTimes(1)
    expect(result.current.showCommitDialog).toBe(true)
    expect(result.current.commitMode).toBe('local')
  })

  it('handleCommitPush commits and pushes when a remote is configured', async () => {
    const { result } = renderCommitFlow()

    await act(async () => {
      await result.current.handleCommitPush('test message')
    })

    expect(savePending).toHaveBeenCalled()
    expect(mockInvokeFn).toHaveBeenNthCalledWith(1, 'git_commit', { vaultPath: '/vault', message: 'test message' })
    expect(mockInvokeFn).toHaveBeenNthCalledWith(2, 'git_push', { vaultPath: '/vault' })
    expect(setToastMessage).toHaveBeenCalledWith('Committed and pushed')
    expect(loadModifiedFiles).toHaveBeenCalled()
    expect(resolveRemoteStatus).toHaveBeenCalledTimes(2)
    expect(mockTrackEvent).toHaveBeenCalledWith('commit_made', undefined)
    expect(result.current.showCommitDialog).toBe(false)
  })

  it('runAutomaticCheckpoint saves pending first and uses the deterministic automatic message', async () => {
    const { result } = renderCommitFlow()

    await act(async () => {
      await result.current.runAutomaticCheckpoint({ savePendingBeforeCommit: true })
    })

    expect(savePending).toHaveBeenCalledTimes(1)
    expect(mockInvokeFn).toHaveBeenNthCalledWith(1, 'get_modified_files', { vaultPath: '/vault' })
    expect(mockInvokeFn).toHaveBeenNthCalledWith(2, 'git_commit', { vaultPath: '/vault', message: 'Updated 1 note' })
    expect(mockInvokeFn).toHaveBeenNthCalledWith(3, 'git_push', { vaultPath: '/vault' })
    expect(setToastMessage).toHaveBeenCalledWith('Committed and pushed')
  })

  it('runAutomaticCheckpoint commits and pushes all active repositories', async () => {
    const resolveRemoteStatusForVaultPath = vi.fn().mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      hasRemote: true,
    })
    mockInvokeFn.mockImplementation((command: string, args: { vaultPath?: string }) => {
      if (command === 'get_modified_files') {
        return Promise.resolve([{
          path: `${args.vaultPath}/note.md`,
          relativePath: 'note.md',
          status: 'modified',
        }])
      }
      if (command === 'git_commit') return Promise.resolve('[main abc1234] test commit')
      if (command === 'git_push') return Promise.resolve({ status: 'ok', message: 'Pushed to remote' })
      throw new Error(`Unexpected command: ${command}`)
    })

    const { result } = renderCommitFlow({
      automaticVaultPaths: ['/vault', '/work'],
      resolveRemoteStatusForVaultPath,
    })

    await act(async () => {
      await result.current.runAutomaticCheckpoint()
    })

    expect(mockInvokeFn).toHaveBeenCalledWith('git_commit', { vaultPath: '/vault', message: 'Updated 1 note' })
    expect(mockInvokeFn).toHaveBeenCalledWith('git_push', { vaultPath: '/vault' })
    expect(mockInvokeFn).toHaveBeenCalledWith('git_commit', { vaultPath: '/work', message: 'Updated 1 note' })
    expect(mockInvokeFn).toHaveBeenCalledWith('git_push', { vaultPath: '/work' })
    expect(resolveRemoteStatusForVaultPath).toHaveBeenCalledWith('/work')
    expect(loadModifiedFiles).toHaveBeenCalled()
    expect(setToastMessage).toHaveBeenCalledWith('AutoGit checkpointed 2 repositories')
  })

  it('runAutomaticCheckpoint retries push-only when local commits are already ahead', async () => {
    resolveRemoteStatus.mockResolvedValue({ branch: 'main', ahead: 2, behind: 0, hasRemote: true })
    mockInvokeFn.mockImplementation((command: string) => {
      if (command === 'get_modified_files') return Promise.resolve([])
      if (command === 'git_push') return Promise.resolve({ status: 'ok', message: 'Pushed to remote' })
      throw new Error(`Unexpected command: ${command}`)
    })

    const { result } = renderCommitFlow()

    await act(async () => {
      await result.current.runAutomaticCheckpoint()
    })

    expect(mockInvokeFn).toHaveBeenCalledTimes(2)
    expect(mockInvokeFn).toHaveBeenNthCalledWith(1, 'get_modified_files', { vaultPath: '/vault' })
    expect(mockInvokeFn).toHaveBeenNthCalledWith(2, 'git_push', { vaultPath: '/vault' })
    expect(setToastMessage).toHaveBeenCalledWith('Pushed committed changes')
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('runAutomaticCheckpoint reports when there is nothing to commit or push', async () => {
    mockInvokeFn.mockImplementation((command: string) => {
      if (command === 'get_modified_files') return Promise.resolve([])
      throw new Error(`Unexpected command: ${command}`)
    })

    const { result } = renderCommitFlow()

    await act(async () => {
      await result.current.runAutomaticCheckpoint()
    })

    expect(setToastMessage).toHaveBeenCalledWith('Nothing to commit or push')
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('handleCommitPush commits locally and skips push when no remote is configured', async () => {
    resolveRemoteStatus.mockResolvedValue({ branch: 'main', ahead: 0, behind: 0, hasRemote: false })
    mockInvokeFn.mockImplementation((command: string) => {
      if (command === 'git_commit') return Promise.resolve('[main abc1234] test message')
      throw new Error(`Unexpected command: ${command}`)
    })
    const { result } = renderCommitFlow()

    await act(async () => {
      await result.current.handleCommitPush('test message')
    })

    expect(mockInvokeFn).toHaveBeenCalledTimes(1)
    expect(mockInvokeFn).toHaveBeenCalledWith('git_commit', { vaultPath: '/vault', message: 'test message' })
    expect(setToastMessage).toHaveBeenCalledWith('Committed locally (no remote configured)')
    expect(onPushRejected).not.toHaveBeenCalled()
  })

  it('handleCommitPush uses the selected manual repository', async () => {
    const resolveRemoteStatusForVaultPath = vi.fn().mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      hasRemote: true,
    })
    const { result } = renderCommitFlow({
      manualVaultPath: '/work',
      resolveRemoteStatusForVaultPath,
    })

    await act(async () => {
      await result.current.handleCommitPush('test message')
    })

    expect(mockInvokeFn).toHaveBeenCalledWith('git_commit', { vaultPath: '/work', message: 'test message' })
    expect(mockInvokeFn).toHaveBeenCalledWith('git_push', { vaultPath: '/work' })
    expect(resolveRemoteStatusForVaultPath).toHaveBeenCalledWith('/work')
  })

  it('refreshes dialog mode when the selected manual repository changes', async () => {
    const resolveRemoteStatusForVaultPath = vi.fn((vaultPath: string) => Promise.resolve({
      branch: 'main',
      ahead: 0,
      behind: 0,
      hasRemote: vaultPath !== '/local',
    }))
    const { result, rerender } = renderHook(
      ({ manualVaultPath }) => useCommitFlow({
        savePending,
        loadModifiedFiles,
        resolveRemoteStatus,
        resolveRemoteStatusForVaultPath,
        setToastMessage,
        onPushRejected,
        vaultPath: '/vault',
        manualVaultPath,
      }),
      { initialProps: { manualVaultPath: '/work' } },
    )

    await act(async () => {
      await result.current.openCommitDialog()
    })
    expect(result.current.commitMode).toBe('push')

    rerender({ manualVaultPath: '/local' })
    await waitFor(() => expect(result.current.commitMode).toBe('local'))
  })

  it('handleCommitPush calls onPushRejected when push is rejected', async () => {
    mockInvokeFn.mockImplementation((command: string) => {
      if (command === 'git_commit') return Promise.resolve('[main abc1234] test message')
      if (command === 'git_push') return Promise.resolve({ status: 'rejected', message: 'Push rejected' })
      throw new Error(`Unexpected command: ${command}`)
    })
    const { result } = renderCommitFlow()

    await act(async () => {
      await result.current.handleCommitPush('test message')
    })

    expect(onPushRejected).toHaveBeenCalledTimes(1)
    expect(setToastMessage).toHaveBeenCalledWith(expect.stringContaining('push rejected'))
  })

  it('handleCommitPush shows error toast on failure', async () => {
    mockInvokeFn.mockImplementation(() => Promise.reject(new Error('push failed')))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderCommitFlow()

    await act(async () => {
      await result.current.handleCommitPush('test')
    })

    expect(setToastMessage).toHaveBeenCalledWith('Commit failed: push failed')
    consoleSpy.mockRestore()
  })

  it('closeCommitDialog closes the dialog', async () => {
    const { result } = renderCommitFlow()

    await act(async () => {
      await result.current.openCommitDialog()
    })
    expect(result.current.showCommitDialog).toBe(true)

    act(() => {
      result.current.closeCommitDialog()
    })
    expect(result.current.showCommitDialog).toBe(false)
  })

  it('isPreparingCommit is false initially', () => {
    const { result } = renderCommitFlow()
    expect(result.current.isPreparingCommit).toBe(false)
  })

  it('isPreparingCommit resets to false after openCommitDialog completes', async () => {
    const { result } = renderCommitFlow()

    await act(async () => {
      await result.current.openCommitDialog()
    })

    expect(result.current.showCommitDialog).toBe(true)
    expect(result.current.isPreparingCommit).toBe(false)
  })
})
