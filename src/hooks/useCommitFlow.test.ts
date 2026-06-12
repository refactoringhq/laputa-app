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

function createDeferred<T>() {
  let resolveDeferred: (value: T | PromiseLike<T>) => void = () => {}
  let rejectDeferred: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve
    rejectDeferred = reject
  })
  return { promise, reject: rejectDeferred, resolve: resolveDeferred }
}

const gitAuthorIdentityCallCount = () => (
  mockInvokeFn.mock.calls.filter(([command]) => command === 'git_author_identity').length
)

const testAuthorIdentity = {
  name: 'Test User',
  email: 'test@example.com',
  source: 'global',
  warning: null,
}

describe('useCommitFlow', () => {
  let savePending: vi.Mock
  let loadModifiedFiles: vi.Mock
  let loadModifiedFilesForVaultPath: vi.Mock
  let resolveRemoteStatusForVaultPath: vi.Mock
  let setToastMessage: vi.Mock
  let onPushRejected: vi.Mock

  beforeEach(() => {
    savePending = vi.fn().mockResolvedValue(undefined)
    loadModifiedFiles = vi.fn().mockResolvedValue(undefined)
    loadModifiedFilesForVaultPath = vi.fn().mockResolvedValue([{ path: '/vault/a.md', relativePath: 'a.md', status: 'modified' }])
    resolveRemoteStatusForVaultPath = vi.fn().mockResolvedValue({ branch: 'main', ahead: 0, behind: 0, hasRemote: true })
    setToastMessage = vi.fn()
    onPushRejected = vi.fn()
    mockTrackEvent.mockReset()
    mockInvokeFn.mockReset()
    mockInvokeFn.mockImplementation((command: string) => {
      if (command === 'git_commit') return Promise.resolve('[main abc1234] test commit')
      if (command === 'git_author_identity') return Promise.resolve(testAuthorIdentity)
      if (command === 'git_push') return Promise.resolve({ status: 'ok', message: 'Pushed to remote' })
      throw new Error(`Unexpected command: ${command}`)
    })
  })

  function renderCommitFlow(overrides: Partial<Parameters<typeof useCommitFlow>[0]> = {}) {
    return renderHook(() => useCommitFlow({
      savePending,
      loadModifiedFiles,
      loadModifiedFilesForVaultPath,
      resolveRemoteStatusForVaultPath,
      setToastMessage,
      onPushRejected,
      vaultPath: '/vault',
      ...overrides,
    }))
  }

  it('openCommitDialog saves pending, refreshes files, and sets local mode when no remote exists', async () => {
    resolveRemoteStatusForVaultPath.mockResolvedValueOnce({ branch: 'main', ahead: 0, behind: 0, hasRemote: false })
    const { result } = renderCommitFlow()

    await act(async () => {
      await result.current.openCommitDialog()
    })

    expect(savePending).toHaveBeenCalledTimes(1)
    expect(loadModifiedFiles).toHaveBeenCalledTimes(1)
    expect(resolveRemoteStatusForVaultPath).toHaveBeenCalledWith('/vault')
    expect(result.current.showCommitDialog).toBe(true)
    expect(result.current.commitMode).toBe('local')
    expect(result.current.isOpeningCommitDialog).toBe(false)
  })

  it('shows opening state and ignores duplicate dialog opens while preparing', async () => {
    const pendingSave = createDeferred<void>()
    savePending.mockReturnValueOnce(pendingSave.promise)
    const { result } = renderCommitFlow()
    let openPromise = Promise.resolve()

    act(() => {
      openPromise = result.current.openCommitDialog()
      void result.current.openCommitDialog()
    })

    expect(result.current.isOpeningCommitDialog).toBe(true)
    expect(savePending).toHaveBeenCalledTimes(1)

    await act(async () => {
      pendingSave.resolve(undefined)
      await openPromise
    })

    expect(loadModifiedFiles).toHaveBeenCalledTimes(1)
    expect(result.current.showCommitDialog).toBe(true)
    expect(result.current.isOpeningCommitDialog).toBe(false)
  })

  it('opens the commit dialog before delayed author identity resolves', async () => {
    const pendingIdentity = createDeferred<typeof testAuthorIdentity>()
    mockInvokeFn.mockImplementation((command: string) => {
      if (command === 'git_author_identity') return pendingIdentity.promise
      throw new Error(`Unexpected command: ${command}`)
    })
    const { result } = renderCommitFlow()
    let openPromise = Promise.resolve()

    act(() => {
      openPromise = result.current.openCommitDialog()
    })

    await waitFor(() => expect(result.current.showCommitDialog).toBe(true))
    expect(result.current.isOpeningCommitDialog).toBe(false)
    expect(result.current.authorIdentity).toBeNull()
    expect(gitAuthorIdentityCallCount()).toBe(1)

    await act(async () => {
      pendingIdentity.resolve(testAuthorIdentity)
      await openPromise
    })

    await waitFor(() => expect(result.current.authorIdentity).toEqual(testAuthorIdentity))
  })

  it('reuses the loaded author identity when reopening the same vault dialog', async () => {
    const { result } = renderCommitFlow()

    await act(async () => {
      await result.current.openCommitDialog()
    })
    await waitFor(() => expect(result.current.authorIdentity).toEqual(testAuthorIdentity))

    act(() => {
      result.current.closeCommitDialog()
    })
    await act(async () => {
      await result.current.openCommitDialog()
    })

    expect(result.current.showCommitDialog).toBe(true)
    expect(result.current.authorIdentity).toEqual(testAuthorIdentity)
    expect(gitAuthorIdentityCallCount()).toBe(1)
  })

  it('ignores stale author identity responses after the dialog switches vaults', async () => {
    const vaultAIdentity = {
      ...testAuthorIdentity,
      email: 'a@example.com',
      name: 'Vault A',
    }
    const vaultBIdentity = {
      ...testAuthorIdentity,
      email: 'b@example.com',
      name: 'Vault B',
    }
    const pendingVaultAIdentity = createDeferred<typeof testAuthorIdentity>()
    mockInvokeFn.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command !== 'git_author_identity') throw new Error(`Unexpected command: ${command}`)
      return args?.vaultPath === '/vault-a'
        ? pendingVaultAIdentity.promise
        : Promise.resolve(vaultBIdentity)
    })
    const props = {
      manualVaultPath: '/vault-a',
    }
    const { result, rerender } = renderHook(
      ({ manualVaultPath }) => useCommitFlow({
        savePending,
        loadModifiedFiles,
        loadModifiedFilesForVaultPath,
        resolveRemoteStatusForVaultPath,
        setToastMessage,
        onPushRejected,
        manualVaultPath,
        vaultPath: '/vault',
      }),
      { initialProps: props },
    )

    await act(async () => {
      await result.current.openCommitDialog()
    })
    expect(result.current.showCommitDialog).toBe(true)
    expect(result.current.authorIdentity).toBeNull()

    rerender({ manualVaultPath: '/vault-b' })
    await waitFor(() => expect(result.current.authorIdentity).toEqual(vaultBIdentity))

    await act(async () => {
      pendingVaultAIdentity.resolve(vaultAIdentity)
      await pendingVaultAIdentity.promise
    })

    expect(result.current.authorIdentity).toEqual(vaultBIdentity)
  })

  it('clears opening state and reports recovery when dialog preparation fails', async () => {
    loadModifiedFiles.mockRejectedValueOnce(new Error('status unavailable'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderCommitFlow()

    await act(async () => {
      await result.current.openCommitDialog()
    })

    expect(result.current.showCommitDialog).toBe(false)
    expect(result.current.isOpeningCommitDialog).toBe(false)
    expect(setToastMessage).toHaveBeenCalledWith('Commit dialog failed: status unavailable')
    consoleSpy.mockRestore()
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
    expect(resolveRemoteStatusForVaultPath).toHaveBeenCalledTimes(2)
    expect(mockTrackEvent).toHaveBeenCalledWith('commit_made', undefined)
    expect(result.current.showCommitDialog).toBe(false)
  })

  it('runAutomaticCheckpoint saves pending first and uses the deterministic automatic message', async () => {
    const { result } = renderCommitFlow()

    await act(async () => {
      await result.current.runAutomaticCheckpoint({ savePendingBeforeCommit: true })
    })

    expect(savePending).toHaveBeenCalledTimes(1)
    expect(loadModifiedFilesForVaultPath).toHaveBeenCalledWith('/vault')
    expect(mockInvokeFn).toHaveBeenNthCalledWith(1, 'git_commit', { vaultPath: '/vault', message: 'Updated 1 note' })
    expect(mockInvokeFn).toHaveBeenNthCalledWith(2, 'git_push', { vaultPath: '/vault' })
    expect(setToastMessage).toHaveBeenCalledWith('Committed and pushed')
  })

  it('runAutomaticCheckpoint treats commit failures as handled after showing recovery feedback', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockInvokeFn.mockImplementation((command: string) => {
      if (command === 'git_commit') return Promise.reject(new Error('Author identity unknown'))
      throw new Error(`Unexpected command: ${command}`)
    })
    const { result } = renderCommitFlow()
    let didHandleCheckpoint = false

    await act(async () => {
      didHandleCheckpoint = await result.current.runAutomaticCheckpoint()
    })

    expect(didHandleCheckpoint).toBe(true)
    expect(setToastMessage).toHaveBeenCalledWith(
      'Set a Git author before AutoGit can commit. Run git config --global user.name "Your Name" and git config --global user.email you@example.com.',
    )
    consoleSpy.mockRestore()
  })

  it('runAutomaticCheckpoint commits and pushes all active repositories', async () => {
    const resolveRemoteStatusForVaultPath = vi.fn().mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      hasRemote: true,
    })
    const loadModifiedFilesForVaultPath = vi.fn((vaultPath: string) => Promise.resolve([{
      path: `${vaultPath}/note.md`,
      relativePath: 'note.md',
      status: 'modified',
    }]))
    mockInvokeFn.mockImplementation((command: string) => {
      if (command === 'git_commit') return Promise.resolve('[main abc1234] test commit')
      if (command === 'git_push') return Promise.resolve({ status: 'ok', message: 'Pushed to remote' })
      throw new Error(`Unexpected command: ${command}`)
    })

    const { result } = renderCommitFlow({
      automaticVaultPaths: ['/vault', '/work'],
      loadModifiedFilesForVaultPath,
      resolveRemoteStatusForVaultPath,
    })

    await act(async () => {
      await result.current.runAutomaticCheckpoint()
    })

    expect(mockInvokeFn).toHaveBeenCalledWith('git_commit', { vaultPath: '/vault', message: 'Updated 1 note' })
    expect(mockInvokeFn).toHaveBeenCalledWith('git_push', { vaultPath: '/vault' })
    expect(mockInvokeFn).toHaveBeenCalledWith('git_commit', { vaultPath: '/work', message: 'Updated 1 note' })
    expect(mockInvokeFn).toHaveBeenCalledWith('git_push', { vaultPath: '/work' })
    expect(loadModifiedFilesForVaultPath).toHaveBeenCalledWith('/vault')
    expect(loadModifiedFilesForVaultPath).toHaveBeenCalledWith('/work')
    expect(resolveRemoteStatusForVaultPath).toHaveBeenCalledWith('/vault')
    expect(resolveRemoteStatusForVaultPath).toHaveBeenCalledWith('/work')
    expect(loadModifiedFiles).toHaveBeenCalled()
    expect(setToastMessage).toHaveBeenCalledWith('AutoGit checkpointed 2 repositories')
  })

  it('runAutomaticCheckpoint treats multi-repository commit failures as handled', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const loadModifiedFilesForVaultPath = vi.fn((vaultPath: string) => Promise.resolve([{
      path: `${vaultPath}/note.md`,
      relativePath: 'note.md',
      status: 'modified',
    }]))
    mockInvokeFn.mockImplementation((command: string) => {
      if (command === 'git_commit') return Promise.reject(new Error('Please tell me who you are'))
      throw new Error(`Unexpected command: ${command}`)
    })

    const { result } = renderCommitFlow({
      automaticVaultPaths: ['/vault', '/work'],
      loadModifiedFilesForVaultPath,
    })
    let didHandleCheckpoint = false

    await act(async () => {
      didHandleCheckpoint = await result.current.runAutomaticCheckpoint()
    })

    expect(didHandleCheckpoint).toBe(true)
    expect(loadModifiedFilesForVaultPath).toHaveBeenCalledWith('/vault')
    expect(loadModifiedFilesForVaultPath).toHaveBeenCalledWith('/work')
    expect(setToastMessage).toHaveBeenCalledWith(
      'Set a Git author before AutoGit can commit. Run git config --global user.name "Your Name" and git config --global user.email you@example.com.',
    )
    consoleSpy.mockRestore()
  })

  it('runAutomaticCheckpoint retries push-only when local commits are already ahead', async () => {
    resolveRemoteStatusForVaultPath.mockResolvedValue({ branch: 'main', ahead: 2, behind: 0, hasRemote: true })
    loadModifiedFilesForVaultPath.mockResolvedValue([])
    mockInvokeFn.mockImplementation((command: string) => {
      if (command === 'git_push') return Promise.resolve({ status: 'ok', message: 'Pushed to remote' })
      throw new Error(`Unexpected command: ${command}`)
    })

    const { result } = renderCommitFlow()

    await act(async () => {
      await result.current.runAutomaticCheckpoint()
    })

    expect(loadModifiedFilesForVaultPath).toHaveBeenCalledWith('/vault')
    expect(mockInvokeFn).toHaveBeenCalledTimes(1)
    expect(mockInvokeFn).toHaveBeenNthCalledWith(1, 'git_push', { vaultPath: '/vault' })
    expect(setToastMessage).toHaveBeenCalledWith('Pushed committed changes')
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('runAutomaticCheckpoint reports when there is nothing to commit or push', async () => {
    loadModifiedFilesForVaultPath.mockResolvedValue([])

    const { result } = renderCommitFlow()

    await act(async () => {
      await result.current.runAutomaticCheckpoint()
    })

    expect(setToastMessage).toHaveBeenCalledWith('Nothing to commit or push')
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('handleCommitPush commits locally and skips push when no remote is configured', async () => {
    resolveRemoteStatusForVaultPath.mockResolvedValue({ branch: 'main', ahead: 0, behind: 0, hasRemote: false })
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
        loadModifiedFilesForVaultPath,
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
})
