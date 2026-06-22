import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useConflictResolver } from './useConflictResolver'

const mockInvokeFn = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvokeFn(...args),
}))
vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (...args: unknown[]) => mockInvokeFn(...args),
}))

describe('useConflictResolver', () => {
  const onResolved = vi.fn()
  const onToast = vi.fn()
  const onOpenFile = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockInvokeFn.mockResolvedValue(undefined)
  })

  function renderResolver(files: string[] = ['note.md', 'plan.md']) {
    const hook = renderHook(() =>
      useConflictResolver({
        vaultPath: '/vault',
        onResolved,
        onToast,
        onOpenFile,
      }),
    )
    // Initialize files
    act(() => { hook.result.current.initFiles(files) })
    return hook
  }

  it('initializes file states from conflict files', () => {
    const { result } = renderResolver()
    expect(result.current.fileStates).toHaveLength(2)
    expect(result.current.fileStates[0]).toEqual({ file: 'note.md', resolution: null, resolving: false })
    expect(result.current.fileStates[1]).toEqual({ file: 'plan.md', resolution: null, resolving: false })
    expect(result.current.allResolved).toBe(false)
  })

  it.each([
    { file: 'note.md', index: 0, strategy: 'ours' as const },
    { file: 'plan.md', index: 1, strategy: 'theirs' as const },
  ])('resolves a file with $strategy strategy', async ({ file, index, strategy }) => {
    const { result } = renderResolver()

    await act(async () => {
      await result.current.resolveFile(file, strategy)
    })

    expect(mockInvokeFn).toHaveBeenCalledWith('git_resolve_conflict', {
      vaultPath: '/vault', file, strategy,
    })
    expect(result.current.fileStates[index].resolution).toBe(strategy)
  })

  it('marks allResolved when all files are resolved', async () => {
    const { result } = renderResolver()

    await act(async () => {
      await result.current.resolveFile('note.md', 'ours')
    })
    expect(result.current.allResolved).toBe(false)

    await act(async () => {
      await result.current.resolveFile('plan.md', 'theirs')
    })
    expect(result.current.allResolved).toBe(true)
  })

  it('sets manual resolution when opening in editor', () => {
    const { result } = renderResolver()

    act(() => { result.current.openInEditor('note.md') })

    expect(onOpenFile).toHaveBeenCalledWith('note.md')
    expect(result.current.fileStates[0].resolution).toBe('manual')
  })

  it('commits resolution and calls onResolved', async () => {
    mockInvokeFn.mockImplementation((cmd: string) => {
      if (cmd === 'git_commit_conflict_resolution') return Promise.resolve('Committed')
      return Promise.resolve(undefined)
    })

    const { result } = renderResolver(['note.md'])

    await act(async () => {
      await result.current.resolveFile('note.md', 'ours')
    })

    await act(async () => {
      await result.current.commitResolution()
    })

    expect(mockInvokeFn).toHaveBeenCalledWith('git_commit_conflict_resolution', { vaultPath: '/vault' })
    expect(onResolved).toHaveBeenCalled()
    expect(onToast).toHaveBeenCalledWith('Conflicts resolved — sync resumed')
  })

  it('does not commit when not all files are resolved', async () => {
    const { result } = renderResolver()

    await act(async () => {
      await result.current.commitResolution()
    })

    expect(mockInvokeFn).not.toHaveBeenCalledWith('git_commit_conflict_resolution', expect.anything())
  })

  it('shows error when resolve fails', async () => {
    mockInvokeFn.mockRejectedValueOnce(new Error('git checkout failed'))

    const { result } = renderResolver()

    await act(async () => {
      await result.current.resolveFile('note.md', 'ours')
    })

    expect(result.current.error).toContain('Failed to resolve note.md')
    expect(result.current.fileStates[0].resolution).toBeNull()
  })

  it('shows error when commit fails', async () => {
    mockInvokeFn.mockImplementation((cmd: string) => {
      if (cmd === 'git_commit_conflict_resolution') return Promise.reject(new Error('user.email not set'))
      return Promise.resolve(undefined)
    })

    const { result } = renderResolver(['note.md'])

    await act(async () => {
      await result.current.resolveFile('note.md', 'ours')
    })
    await act(async () => {
      await result.current.commitResolution()
    })

    expect(result.current.error).toContain('Commit failed')
    expect(onResolved).not.toHaveBeenCalled()
  })

  it('resets state on initFiles', async () => {
    const { result } = renderResolver(['note.md'])

    await act(async () => {
      await result.current.resolveFile('note.md', 'ours')
    })
    expect(result.current.fileStates[0].resolution).toBe('ours')

    act(() => { result.current.initFiles(['other.md']) })

    expect(result.current.fileStates).toHaveLength(1)
    expect(result.current.fileStates[0]).toEqual({ file: 'other.md', resolution: null, resolving: false })
    expect(result.current.error).toBeNull()
  })
})
