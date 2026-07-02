import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mockInvoke } from '../mock-tauri'
import type { GitRemoteStatus, ModifiedFile } from '../types'
import { useGitRepositories } from './useGitRepositories'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  mockInvoke: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function modifiedFile(relativePath: string): ModifiedFile {
  return {
    path: `/default/${relativePath}`,
    relativePath,
    status: 'modified',
  }
}

function remoteStatus(hasRemote: boolean): GitRemoteStatus {
  return {
    branch: 'main',
    ahead: 0,
    behind: 0,
    hasRemote,
  }
}

describe('useGitRepositories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the newest modified-files refresh when older loads finish later', async () => {
    const firstLoad = deferred<ModifiedFile[]>()
    const secondLoad = deferred<ModifiedFile[]>()
    vi.mocked(mockInvoke)
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise)
    const repositories = [{ path: '/default', label: 'Default', defaultForNewNotes: true }]

    const { result } = renderHook(() => useGitRepositories({
      defaultVaultPath: '/default',
      repositories,
    }))

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1))

    await act(async () => {
      void result.current.loadModifiedFilesForRepository('/default')
    })
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2))

    await act(async () => {
      secondLoad.resolve([modifiedFile('new.md')])
      await secondLoad.promise
    })
    expect(result.current.changesModifiedFiles.map((file) => file.relativePath)).toEqual(['new.md'])

    await act(async () => {
      firstLoad.resolve([modifiedFile('old.md')])
      await firstLoad.promise
    })
    expect(result.current.changesModifiedFiles.map((file) => file.relativePath)).toEqual(['new.md'])
  })

  it('refreshes remote status through the repository state owner', async () => {
    const repositories = [
      { path: '/default', label: 'Default', defaultForNewNotes: true },
      { path: '/work', label: 'Work', defaultForNewNotes: false },
    ]
    vi.mocked(mockInvoke).mockImplementation((command, args) => {
      if (command === 'get_modified_files') return Promise.resolve([])
      if (command === 'git_remote_status') {
        return Promise.resolve(remoteStatus(args.vaultPath === '/default'))
      }
      throw new Error(`Unexpected command: ${command}`)
    })

    const { result } = renderHook(() => useGitRepositories({
      defaultVaultPath: '/default',
      repositories,
    }))

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('get_modified_files', { vaultPath: '/default', includeStats: false }))

    await act(async () => {
      await result.current.refreshRemoteStatusForRepository('/work')
    })

    expect(mockInvoke).toHaveBeenCalledWith('git_remote_status', { vaultPath: '/work' })
    expect(result.current.remoteStatusForRepository('/work')).toEqual(remoteStatus(false))
  })

  it('requests line stats only when explicitly requested', async () => {
    const repositories = [{ path: '/default', label: 'Default', defaultForNewNotes: true }]
    vi.mocked(mockInvoke).mockResolvedValue([])

    const { result } = renderHook(() => useGitRepositories({
      defaultVaultPath: '/default',
      repositories,
    }))

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('get_modified_files', { vaultPath: '/default', includeStats: false }))

    await act(async () => {
      await result.current.loadModifiedFilesForRepository('/default', { includeStats: true })
    })

    expect(mockInvoke).toHaveBeenCalledWith('get_modified_files', { vaultPath: '/default', includeStats: true })
  })

  it('does not repeat the automatic refresh when repository props keep the same paths', async () => {
    const buildRepositories = () => [
      { path: '/default', label: 'Default', defaultForNewNotes: true },
      { path: '/work', label: 'Work', defaultForNewNotes: false },
    ]
    vi.mocked(mockInvoke).mockResolvedValue([])

    const { rerender } = renderHook(
      ({ repositories }) => useGitRepositories({
        defaultVaultPath: '/default',
        repositories,
      }),
      { initialProps: { repositories: buildRepositories() } },
    )

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2))

    rerender({ repositories: buildRepositories() })
    await act(async () => {
      await Promise.resolve()
    })

    expect(mockInvoke).toHaveBeenCalledTimes(2)
  })

  it('keeps an explicit sync repository selection separate from other Git surfaces', async () => {
    const repositories = [
      { path: '/default', label: 'Default', defaultForNewNotes: true },
      { path: '/work', label: 'Work', defaultForNewNotes: false },
    ]
    vi.mocked(mockInvoke).mockResolvedValue([])

    const { result } = renderHook(() => useGitRepositories({
      defaultVaultPath: '/default',
      repositories,
    }))

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('get_modified_files', { vaultPath: '/default', includeStats: false }))

    act(() => {
      result.current.setSyncRepositoryPath('/work')
    })

    expect(result.current.syncRepositoryPath).toBe('/work')
    expect(result.current.commitRepositoryPath).toBe('/default')
    expect(result.current.changesRepositoryPath).toBe('/default')
  })
})
