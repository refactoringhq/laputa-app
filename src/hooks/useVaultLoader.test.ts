import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { VaultEntry, ModifiedFile, GitCommit } from '../types'
import { useVaultLoader, resolveNoteStatus } from './useVaultLoader'

const mockEntries: VaultEntry[] = [
  {
    path: '/vault/note/hello.md', filename: 'hello.md', title: 'Hello',
    isA: 'Note', aliases: [], belongsTo: [], relatedTo: [],
    status: 'Active',
    archived: false,
    modifiedAt: 1700000000, createdAt: 1700000000, fileSize: 100,
    snippet: '', wordCount: 0, relationships: {}, icon: null, color: null, order: null, template: null, sort: null, outgoingLinks: [],
    sidebarLabel: null, view: null, visible: null, organized: false, favorite: false, favoriteIndex: null,
    listPropertiesDisplay: [], properties: {}, hasH1: false,
  },
]

const mockContent: Record<string, string> = {
  '/vault/note/hello.md': '---\ntitle: Hello\n---\n\n# Hello\n',
}

const mockModifiedFiles: ModifiedFile[] = [
  { path: '/vault/note/hello.md', relativePath: 'note/hello.md', status: 'modified' },
]

const mockGitHistory: GitCommit[] = [
  { hash: 'abc1234567', shortHash: 'abc1234', message: 'initial commit', author: 'luca', date: 1700000000 },
]

type MockCommandHandler = (args?: Record<string, unknown>) => unknown

const defaultMockHandlers: Record<string, MockCommandHandler> = {
  list_vault: () => mockEntries,
  reload_vault: () => mockEntries,
  get_all_content: () => mockContent,
  get_modified_files: () => mockModifiedFiles,
  get_file_history: () => mockGitHistory,
  get_file_diff: () => '--- a/note.md\n+++ b/note.md',
  get_file_diff_at_commit: (args) => `diff for ${(args as Record<string, string>)?.commitHash}`,
  git_commit: () => 'committed',
  git_push: () => ({ status: 'ok', message: 'Pushed to remote' }),
}

function defaultMockInvoke(cmd: string, args?: Record<string, unknown>) {
  const handler = defaultMockHandlers[cmd]
  return Promise.resolve(handler ? handler(args) : null)
}

let mockIsTauri = false
const backendInvokeFn = vi.fn(defaultMockInvoke)

function isVaultLoadCommand(cmd: string) {
  return cmd === 'list_vault' || cmd === 'reload_vault'
}

function buildVaultLoaderMock(options: {
  entries?: VaultEntry[]
  modifiedFiles?: ModifiedFile[]
  pushResult?: { status: string; message: string }
  failHistory?: boolean
} = {}) {
  const {
    entries = mockEntries,
    modifiedFiles = mockModifiedFiles,
    pushResult,
    failHistory = false,
  } = options

  return ((cmd: string, args?: Record<string, unknown>) => {
    if (isVaultLoadCommand(cmd)) return Promise.resolve(entries)
    if (cmd === 'get_modified_files') return Promise.resolve(modifiedFiles)
    if (cmd === 'list_vault_folders') return Promise.resolve([])
    if (cmd === 'list_views') return Promise.resolve([])
    if (cmd === 'get_file_history' && failHistory) return Promise.reject(new Error('fail'))
    if (cmd === 'git_push' && pushResult) return Promise.resolve(pushResult)
    return defaultMockInvoke(cmd, args)
  }) as typeof defaultMockInvoke
}

function buildReloadVaultPathMock(loads: Record<string, Promise<VaultEntry[]>>) {
  return ((cmd: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : undefined
    if (cmd === 'reload_vault' && path) return loads[path] ?? Promise.resolve([])
    if (cmd === 'list_vault_folders') return Promise.resolve([])
    if (cmd === 'list_views') return Promise.resolve([])
    if (cmd === 'get_modified_files') return Promise.resolve([])
    return Promise.resolve(null)
  }) as typeof defaultMockInvoke
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => mockIsTauri,
  mockInvoke: (cmd: string, args?: Record<string, unknown>) => backendInvokeFn(cmd, args),
}))

async function waitForEntries(
  result: ReturnType<typeof renderHook<ReturnType<typeof useVaultLoader>, undefined>>['result'],
  length = 1,
) {
  await waitFor(() => {
    expect(result.current.entries).toHaveLength(length)
  })
}

async function waitForModifiedFiles(
  result: ReturnType<typeof renderHook<ReturnType<typeof useVaultLoader>, undefined>>['result'],
  length = 1,
) {
  await waitFor(() => {
    expect(result.current.modifiedFiles).toHaveLength(length)
  })
}

/** Render the vault loader hook and wait for initial data to load. */
async function renderVaultLoader() {
  const hook = renderHook(() => useVaultLoader('/vault'))
  await waitForEntries(hook.result)
  return hook
}

async function enableTauriMode() {
  mockIsTauri = true
  const tauri = await import('@tauri-apps/api/core')
  vi.mocked(tauri.invoke).mockImplementation((command: string, args?: Record<string, unknown>) =>
    backendInvokeFn(command, args),
  )
}

describe('useVaultLoader', () => {
  beforeEach(() => {
    mockIsTauri = false
    backendInvokeFn.mockReset()
    backendInvokeFn.mockImplementation(defaultMockInvoke)
  })

  it('loads entries on mount', async () => {
    const { result } = await renderVaultLoader()

    expect(result.current.entries[0].title).toBe('Hello')
  })

  it('normalizes missing entry and view string metadata from vault load', async () => {
    backendInvokeFn.mockImplementation(((cmd: string) => {
      if (isVaultLoadCommand(cmd)) {
        return Promise.resolve([
          {
            path: '/vault/note/missing-title.md',
            filename: undefined,
            title: undefined,
            aliases: undefined,
            outgoingLinks: undefined,
            relationships: undefined,
            properties: undefined,
          },
        ])
      }
      if (cmd === 'list_views') return Promise.resolve([{ filename: undefined, definition: {} }])
      if (cmd === 'get_modified_files') return Promise.resolve([])
      if (cmd === 'list_vault_folders') return Promise.resolve([])
      return Promise.resolve(null)
    }) as typeof defaultMockInvoke)

    const { result } = renderHook(() => useVaultLoader('/vault'))

    await waitForEntries(result)
    await waitFor(() => {
      expect(result.current.views).toHaveLength(1)
    })

    expect(result.current.entries[0]).toMatchObject({
      path: '/vault/note/missing-title.md',
      filename: 'missing-title.md',
      title: 'missing-title',
      aliases: [],
      outgoingLinks: [],
      relationships: {},
      properties: {},
    })
    expect(result.current.views[0]).toMatchObject({
      filename: 'view-1.yml',
      definition: {
        name: 'View 1',
        icon: null,
        color: null,
        sort: null,
        filters: { all: [] },
      },
    })
  })

  it('reports initial vault loading until the note scan resolves', async () => {
    const entriesLoad = createDeferred<VaultEntry[]>()
    backendInvokeFn.mockImplementation(((cmd: string) => {
      if (isVaultLoadCommand(cmd)) return entriesLoad.promise
      if (cmd === 'get_modified_files') return Promise.resolve([])
      if (cmd === 'list_vault_folders') return Promise.resolve([])
      if (cmd === 'list_views') return Promise.resolve([])
      return Promise.resolve(null)
    }) as typeof defaultMockInvoke)

    const { result } = renderHook(() => useVaultLoader('/vault'))

    expect(result.current.isLoading).toBe(true)

    await act(async () => {
      entriesLoad.resolve(mockEntries)
      await entriesLoad.promise
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
  })

  it('loads modified files on mount', async () => {
    const { result } = renderHook(() => useVaultLoader('/vault'))

    await waitForModifiedFiles(result)

    expect(result.current.modifiedFiles[0].status).toBe('modified')
  })

  it('does nothing until a real vault path exists', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useVaultLoader(''))

    await waitFor(() => {
      expect(result.current.entries).toEqual([])
      expect(result.current.modifiedFiles).toEqual([])
      expect(result.current.modifiedFilesError).toBeNull()
    })

    expect(backendInvokeFn).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('loads initial vault entries from a fresh reload in Tauri mode', async () => {
    await enableTauriMode()
    backendInvokeFn.mockImplementation(((cmd: string) => {
      if (cmd === 'list_vault') {
        return Promise.resolve([
          { ...mockEntries[0], path: '/vault/stale.md', filename: 'stale.md', title: 'Stale', isA: 'Type' },
        ])
      }
      if (cmd === 'reload_vault') {
        return Promise.resolve([
          { ...mockEntries[0], path: '/vault/journal.md', filename: 'journal.md', title: 'Journal', isA: 'Type' },
          { ...mockEntries[0], path: '/vault/2026-03-11.md', filename: '2026-03-11.md', title: 'March 11', isA: 'Journal' },
        ])
      }
      if (cmd === 'get_modified_files') return Promise.resolve([])
      if (cmd === 'list_vault_folders') return Promise.resolve([])
      if (cmd === 'list_views') return Promise.resolve([])
      return Promise.resolve(null)
    }) as typeof defaultMockInvoke)

    const { result } = renderHook(() => useVaultLoader('/vault'))

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.title)).toEqual(['Journal', 'March 11'])
    })
    const issuedCommands = backendInvokeFn.mock.calls.map(([command]) => command)
    expect(issuedCommands).toContain('reload_vault')
    expect(issuedCommands).not.toContain('list_vault')
  })

  it('ignores stale reload_vault results after the vault path changes', async () => {
    await enableTauriMode()
    const firstLoad = createDeferred<VaultEntry[]>()
    const secondLoad = createDeferred<VaultEntry[]>()

    backendInvokeFn.mockImplementation(buildReloadVaultPathMock({
      '/vault-a': firstLoad.promise,
      '/vault-b': secondLoad.promise,
    }))

    const { result, rerender } = renderHook(
      ({ path }) => useVaultLoader(path),
      { initialProps: { path: '/vault-a' } },
    )

    rerender({ path: '/vault-b' })

    await act(async () => {
      firstLoad.resolve([
        { ...mockEntries[0], path: '/vault-a/stale.md', filename: 'stale.md', title: 'Stale', isA: 'Type' },
      ])
      await firstLoad.promise
    })

    expect(result.current.entries).toEqual([])

    await act(async () => {
      secondLoad.resolve([
        { ...mockEntries[0], path: '/vault-b/journal.md', filename: 'journal.md', title: 'Journal', isA: 'Type' },
        { ...mockEntries[0], path: '/vault-b/2026-03-11.md', filename: '2026-03-11.md', title: 'March 11', isA: 'Journal' },
      ])
      await secondLoad.promise
    })

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.title)).toEqual(['Journal', 'March 11'])
    })
  })

  describe('addEntry', () => {
    it('prepends new entry', async () => {
      const { result } = await renderVaultLoader()
      const newEntry: VaultEntry = { ...mockEntries[0], path: '/vault/note/new.md', filename: 'new.md', title: 'New Note' }

      act(() => { result.current.addEntry(newEntry) })

      expect(result.current.entries).toHaveLength(2)
      expect(result.current.entries[0].title).toBe('New Note')
    })

    it('ignores duplicate entry with same path', async () => {
      const { result } = await renderVaultLoader()
      const newEntry: VaultEntry = { ...mockEntries[0], path: '/vault/note/new.md', filename: 'new.md', title: 'New Note' }

      act(() => {
        result.current.addEntry(newEntry)
        result.current.addEntry(newEntry)
      })

      expect(result.current.entries).toHaveLength(2)
    })
  })

  describe('removeEntry', () => {
    it('removes entry by path', async () => {
      const { result } = await renderVaultLoader()

      act(() => { result.current.removeEntry('/vault/note/hello.md') })

      expect(result.current.entries).toHaveLength(0)
    })

    it('is a no-op for non-existent paths', async () => {
      const { result } = await renderVaultLoader()

      act(() => { result.current.removeEntry('/vault/note/nonexistent.md') })

      expect(result.current.entries).toHaveLength(1)
    })
  })

  describe('removeEntries', () => {
    it('removes multiple entries in one state update', async () => {
      const { result } = await renderVaultLoader()
      const secondEntry: VaultEntry = { ...mockEntries[0], path: '/vault/note/second.md', filename: 'second.md', title: 'Second' }

      act(() => {
        result.current.addEntry(secondEntry)
        result.current.removeEntries(['/vault/note/hello.md', '/vault/note/second.md'])
      })

      expect(result.current.entries).toHaveLength(0)
    })
  })

  describe('updateEntry', () => {
    it('patches an existing entry by path', async () => {
      const { result } = await renderVaultLoader()

      act(() => { result.current.updateEntry('/vault/note/hello.md', { archived: true, status: 'Done' }) })

      expect(result.current.entries[0].archived).toBe(true)
      expect(result.current.entries[0].status).toBe('Done')
    })

    it('preserves entries reference when path does not exist (no-op)', async () => {
      const { result } = await renderVaultLoader()
      const entriesBefore = result.current.entries

      act(() => { result.current.updateEntry('/vault/note/nonexistent.md', { archived: true }) })

      expect(result.current.entries).toBe(entriesBefore)
    })

    it('keeps entry metadata safe when a stale reload patch has undefined fields', async () => {
      const { result } = await renderVaultLoader()

      act(() => {
        result.current.updateEntry('/vault/note/hello.md', {
          title: undefined,
          filename: undefined,
          aliases: undefined,
          outgoingLinks: undefined,
          relationships: undefined,
          properties: undefined,
          snippet: undefined,
        } as unknown as Partial<VaultEntry>)
      })

      expect(result.current.entries[0]).toEqual(expect.objectContaining({
        title: 'hello',
        filename: 'hello.md',
        aliases: [],
        outgoingLinks: [],
        relationships: {},
        properties: {},
        snippet: '',
      }))
    })
  })

  describe('getNoteStatus', () => {
    it('returns modified for git-modified files', async () => {
      const { result } = renderHook(() => useVaultLoader('/vault'))

      await waitFor(() => {
        expect(result.current.modifiedFiles).toHaveLength(1)
      })

      expect(result.current.getNoteStatus('/vault/note/hello.md')).toBe('modified')
      expect(result.current.getNoteStatus('/vault/note/other.md')).toBe('clean')
    })

    it('returns new for freshly added entries', async () => {
      const { result } = await renderVaultLoader()
      const newEntry: VaultEntry = { ...mockEntries[0], path: '/vault/note/brand-new.md', filename: 'brand-new.md', title: 'Brand New' }

      act(() => { result.current.addEntry(newEntry) })

      expect(result.current.getNoteStatus('/vault/note/brand-new.md')).toBe('new')
    })

    it.each([
      {
        name: 'returns new for git-untracked files (saved but not committed)',
        path: '/vault/note/brand-new.md',
        relativePath: 'note/brand-new.md',
        status: 'untracked',
      },
      {
        name: 'returns new for git-added files (staged but not committed)',
        path: '/vault/note/staged.md',
        relativePath: 'note/staged.md',
        status: 'added',
      },
      {
        name: 'treats untracked files as new (green dot, not orange)',
        path: '/vault/note/hello.md',
        relativePath: 'note/hello.md',
        status: 'untracked',
      },
    ])('$name', async ({ path, relativePath, status }) => {
      backendInvokeFn.mockImplementation(buildVaultLoaderMock({
        modifiedFiles: [{ path, relativePath, status }],
      }))

      const { result } = renderHook(() => useVaultLoader('/vault'))

      await waitForModifiedFiles(result)

      expect(result.current.getNoteStatus(path)).toBe('new')
    })

    it('new status takes priority over git modified', async () => {
      // If a path is both new and in modifiedFiles, it should show as new
      backendInvokeFn.mockImplementation(buildVaultLoaderMock({
        modifiedFiles: [
          { path: '/vault/note/new.md', relativePath: 'note/new.md', status: 'modified' },
        ],
      }))

      const { result } = renderHook(() => useVaultLoader('/vault'))

      await waitFor(() => {
        expect(result.current.modifiedFiles).toHaveLength(1)
      })

      const newEntry: VaultEntry = {
        ...mockEntries[0],
        path: '/vault/note/new.md',
        filename: 'new.md',
        title: 'New',
      }

      act(() => {
        result.current.addEntry(newEntry)
      })

      expect(result.current.getNoteStatus('/vault/note/new.md')).toBe('new')
    })

    it('returns unsaved for paths in unsavedPaths', async () => {
      const { result } = await renderVaultLoader()
      const newEntry: VaultEntry = { ...mockEntries[0], path: '/vault/note/draft.md', filename: 'draft.md', title: 'Draft' }

      act(() => {
        result.current.addEntry(newEntry)
        result.current.trackUnsaved('/vault/note/draft.md')
      })

      expect(result.current.getNoteStatus('/vault/note/draft.md')).toBe('unsaved')
    })

    it('unsaved has higher priority than new', async () => {
      const { result } = await renderVaultLoader()
      const newEntry: VaultEntry = { ...mockEntries[0], path: '/vault/note/draft.md', filename: 'draft.md', title: 'Draft' }

      act(() => {
        result.current.addEntry(newEntry)
        result.current.trackUnsaved('/vault/note/draft.md')
      })

      // addEntry also calls trackNew, so path is in both newPaths and unsavedPaths
      expect(result.current.getNoteStatus('/vault/note/draft.md')).toBe('unsaved')
    })

    it('clearUnsaved transitions from unsaved to new', async () => {
      const { result } = await renderVaultLoader()
      const newEntry: VaultEntry = { ...mockEntries[0], path: '/vault/note/draft.md', filename: 'draft.md', title: 'Draft' }

      act(() => {
        result.current.addEntry(newEntry)
        result.current.trackUnsaved('/vault/note/draft.md')
      })

      expect(result.current.getNoteStatus('/vault/note/draft.md')).toBe('unsaved')

      act(() => { result.current.clearUnsaved('/vault/note/draft.md') })

      expect(result.current.getNoteStatus('/vault/note/draft.md')).toBe('new')
    })

    it('tracks and clears pendingSave states separately from unsaved/new markers', async () => {
      const { result } = await renderVaultLoader()

      act(() => {
        result.current.addPendingSave('/vault/note/hello.md')
      })
      expect(result.current.getNoteStatus('/vault/note/hello.md')).toBe('pendingSave')

      act(() => {
        result.current.removePendingSave('/vault/note/hello.md')
      })
      expect(result.current.getNoteStatus('/vault/note/hello.md')).toBe('modified')
    })
  })

  describe('loadGitHistory', () => {
    it('returns git commits for a file', async () => {
      const { result } = await renderVaultLoader()

      let history: GitCommit[] = []
      await act(async () => {
        history = await result.current.loadGitHistory('/vault/note/hello.md')
      })

      expect(history).toHaveLength(1)
      expect(history[0].shortHash).toBe('abc1234')
    })

    it('returns empty array on error', async () => {
      backendInvokeFn.mockImplementation(buildVaultLoaderMock({
        entries: [],
        modifiedFiles: [],
        failHistory: true,
      }))

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { result } = renderHook(() => useVaultLoader('/vault'))

      let history: GitCommit[] = []
      await act(async () => {
        history = await result.current.loadGitHistory('/vault/note/hello.md')
      })

      expect(history).toEqual([])
      warnSpy.mockRestore()
    })
  })

  describe('loadDiff', () => {
    it('returns diff string for a file', async () => {
      const { result } = await renderVaultLoader()

      let diff = ''
      await act(async () => {
        diff = await result.current.loadDiff('/vault/note/hello.md')
      })

      expect(diff).toContain('--- a/note.md')
    })
  })

  describe('loadDiffAtCommit', () => {
    it('returns diff for a specific commit', async () => {
      const { result } = await renderVaultLoader()

      let diff = ''
      await act(async () => {
        diff = await result.current.loadDiffAtCommit('/vault/note/hello.md', 'abc1234')
      })

      expect(diff).toBe('diff for abc1234')
    })
  })

  describe('commitAndPush', () => {
    it('commits and pushes in mock mode', async () => {
      const { result } = await renderVaultLoader()

      let response: { status: string; message: string } = { status: '', message: '' }
      await act(async () => {
        response = await result.current.commitAndPush('test commit')
      })

      expect(response.status).toBe('ok')
    })

    it('commits and pushes through the Tauri invoke path', async () => {
      await enableTauriMode()
      const { result } = renderHook(() => useVaultLoader('/vault'))

      await waitForEntries(result)

      let response: { status: string; message: string } = { status: '', message: '' }
      await act(async () => {
        response = await result.current.commitAndPush('tauri commit')
      })

      expect(response.status).toBe('ok')
      expect(backendInvokeFn).toHaveBeenCalledWith('git_commit', {
        vaultPath: '/vault',
        message: 'tauri commit',
      })
      expect(backendInvokeFn).toHaveBeenCalledWith('git_push', {
        vaultPath: '/vault',
      })
    })

    it.each([
      {
        name: 'returns rejected status when push is rejected',
        pushResult: { status: 'rejected', message: 'Push rejected: remote has new commits. Pull first, then push.' },
        expectedStatus: 'rejected',
        expectedMessage: 'Pull first',
      },
      {
        name: 'returns network error status on network failure',
        pushResult: { status: 'network_error', message: 'Push failed: network error. Check your connection and try again.' },
        expectedStatus: 'network_error',
        expectedMessage: 'network error',
      },
    ])('$name', async ({ pushResult, expectedStatus, expectedMessage }) => {
      backendInvokeFn.mockImplementation(buildVaultLoaderMock({
        modifiedFiles: [],
        pushResult,
      }))

      const { result } = await renderVaultLoader()

      let response: { status: string; message: string } = { status: '', message: '' }
      await act(async () => {
        response = await result.current.commitAndPush('test commit')
      })

      expect(response.status).toBe(expectedStatus)
      expect(response.message).toContain(expectedMessage)
    })
  })

  describe('reloadFolders', () => {
    it('refreshes folder tree from backend', async () => {
      const folders = [{ name: 'projects', path: 'projects', children: [] }]
      backendInvokeFn.mockImplementation(((cmd: string) => {
        if (isVaultLoadCommand(cmd)) return Promise.resolve(mockEntries)
        if (cmd === 'get_modified_files') return Promise.resolve([])
        if (cmd === 'list_vault_folders') return Promise.resolve(folders)
        return Promise.resolve(null)
      }) as typeof defaultMockInvoke)

      const { result } = await renderVaultLoader()

      expect(result.current.folders).toEqual(folders)

      const updatedFolders = [...folders, { name: 'journal', path: 'journal', children: [] }]
      backendInvokeFn.mockImplementation(((cmd: string) => {
        if (cmd === 'list_vault_folders') return Promise.resolve(updatedFolders)
        return defaultMockInvoke(cmd)
      }) as typeof defaultMockInvoke)

      await act(async () => { await result.current.reloadFolders() })

      expect(result.current.folders).toEqual(updatedFolders)
    })

    it('returns an empty folder list when the refresh fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      backendInvokeFn.mockImplementation(((cmd: string) => {
        if (isVaultLoadCommand(cmd)) return Promise.resolve(mockEntries)
        if (cmd === 'get_modified_files') return Promise.resolve([])
        if (cmd === 'list_vault_folders') return Promise.reject(new Error('no folders'))
        if (cmd === 'list_views') return Promise.resolve([])
        return Promise.resolve(null)
      }) as typeof defaultMockInvoke)

      const { result } = renderHook(() => useVaultLoader('/vault'))

      let folders: Array<{ name: string; path: string; children: [] }> = []
      await act(async () => {
        folders = await result.current.reloadFolders()
      })

      expect(folders).toEqual([])
      warnSpy.mockRestore()
    })
  })

  describe('loadModifiedFiles', () => {
    it('refreshes modified files list', async () => {
      const { result } = await renderVaultLoader()

      await act(async () => {
        await result.current.loadModifiedFiles()
      })

      expect(result.current.modifiedFiles).toHaveLength(1)
    })

    it('captures backend errors when modified files cannot be loaded', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      backendInvokeFn.mockImplementation(((cmd: string) => {
        if (isVaultLoadCommand(cmd)) return Promise.resolve(mockEntries)
        if (cmd === 'get_modified_files') return Promise.reject('git unavailable')
        if (cmd === 'list_vault_folders') return Promise.resolve([])
        if (cmd === 'list_views') return Promise.resolve([])
        return Promise.resolve(null)
      }) as typeof defaultMockInvoke)

      const { result } = renderHook(() => useVaultLoader('/vault'))

      await waitFor(() => {
        expect(result.current.modifiedFiles).toEqual([])
        expect(result.current.modifiedFilesError).toBe('git unavailable')
      })
      expect(warnSpy).toHaveBeenCalledWith('Failed to load modified files:', 'git unavailable')

      warnSpy.mockRestore()
    })
  })

  describe('replaceEntry', () => {
    it('replaces an entry path and metadata in place', async () => {
      const { result } = await renderVaultLoader()

      act(() => {
        result.current.replaceEntry('/vault/note/hello.md', {
          path: '/vault/note/renamed.md',
          filename: 'renamed.md',
          title: 'Renamed',
        })
      })

      expect(result.current.entries[0]).toEqual(expect.objectContaining({
        path: '/vault/note/renamed.md',
        filename: 'renamed.md',
        title: 'Renamed',
      }))
    })

    it('normalizes stale replacement metadata during reload-heavy note switching', async () => {
      const { result } = await renderVaultLoader()

      act(() => {
        result.current.replaceEntry('/vault/note/hello.md', {
          path: '/vault/note/reloaded.md',
          title: undefined,
          filename: undefined,
          aliases: undefined,
          outgoingLinks: undefined,
          relationships: undefined,
          properties: undefined,
          snippet: undefined,
        } as unknown as Partial<VaultEntry> & { path: string })
      })

      expect(result.current.entries[0]).toEqual(expect.objectContaining({
        path: '/vault/note/reloaded.md',
        filename: 'reloaded.md',
        title: 'reloaded',
        aliases: [],
        outgoingLinks: [],
        relationships: {},
        properties: {},
        snippet: '',
      }))
    })
  })

  describe('reloadVault', () => {
    it('reports reload progress while reload_vault is pending', async () => {
      const reload = createDeferred<VaultEntry[]>()
      backendInvokeFn.mockImplementation(((cmd: string) => {
        if (cmd === 'list_vault') return Promise.resolve(mockEntries)
        if (cmd === 'reload_vault') return reload.promise
        if (cmd === 'get_modified_files') return Promise.resolve([])
        if (cmd === 'list_vault_folders') return Promise.resolve([])
        if (cmd === 'list_views') return Promise.resolve([])
        return Promise.resolve(null)
      }) as typeof defaultMockInvoke)

      const { result } = await renderVaultLoader()

      let pendingReload: Promise<VaultEntry[]> | null = null
      act(() => {
        pendingReload = result.current.reloadVault()
      })

      expect(result.current.isReloading).toBe(true)

      await act(async () => {
        reload.resolve(mockEntries)
        await pendingReload!
      })

      expect(result.current.isReloading).toBe(false)
    })

    it('refreshes entries from reload_vault and reloads modified files', async () => {
      const reloadedEntry = {
        ...mockEntries[0],
        path: '/vault/note/reloaded.md',
        filename: 'reloaded.md',
        title: 'Reloaded',
      }

      backendInvokeFn.mockImplementation(((cmd: string) => {
        if (cmd === 'list_vault') return Promise.resolve(mockEntries)
        if (cmd === 'reload_vault') return Promise.resolve([reloadedEntry])
        if (cmd === 'get_modified_files') return Promise.resolve([])
        if (cmd === 'list_vault_folders') return Promise.resolve([])
        if (cmd === 'list_views') return Promise.resolve([])
        return Promise.resolve(null)
      }) as typeof defaultMockInvoke)

      const { result } = await renderVaultLoader()

      let entries: VaultEntry[] = []
      await act(async () => {
        entries = await result.current.reloadVault()
      })

      expect(entries.map((entry) => entry.title)).toEqual(['Reloaded'])
      expect(result.current.entries.map((entry) => entry.title)).toEqual(['Reloaded'])
      expect(result.current.modifiedFiles).toEqual([])
    })

    it('returns an empty list when reloading the vault fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      backendInvokeFn.mockImplementation(((cmd: string) => {
        if (cmd === 'reload_vault') return Promise.reject(new Error('reload failed'))
        if (isVaultLoadCommand(cmd)) return Promise.resolve(mockEntries)
        if (cmd === 'get_modified_files') return Promise.resolve([])
        if (cmd === 'list_vault_folders') return Promise.resolve([])
        if (cmd === 'list_views') return Promise.resolve([])
        return Promise.resolve(null)
      }) as typeof defaultMockInvoke)

      const { result } = await renderVaultLoader()

      let entries: VaultEntry[] = []
      await act(async () => {
        entries = await result.current.reloadVault()
      })

      expect(entries).toEqual([])
      expect(result.current.entries).toEqual(mockEntries)
      warnSpy.mockRestore()
    })
  })

  describe('reloadViews', () => {
    it('refreshes views and falls back to an empty array when they are unavailable', async () => {
      const initialViews = [{
        filename: 'work.view',
        definition: {
          name: 'Work',
          icon: null,
          color: null,
          sort: null,
          filters: { all: [] },
        },
      }]
      const updatedViews = [{
        filename: 'projects.view',
        definition: {
          name: 'Projects',
          icon: null,
          color: null,
          sort: null,
          filters: { all: [] },
        },
      }]

      backendInvokeFn.mockImplementation(((cmd: string) => {
        if (isVaultLoadCommand(cmd)) return Promise.resolve(mockEntries)
        if (cmd === 'get_modified_files') return Promise.resolve([])
        if (cmd === 'list_vault_folders') return Promise.resolve([])
        if (cmd === 'list_views') return Promise.resolve(initialViews)
        return Promise.resolve(null)
      }) as typeof defaultMockInvoke)

      const { result } = await renderVaultLoader()
      expect(result.current.views).toEqual(initialViews)

      backendInvokeFn.mockImplementation(((cmd: string) => {
        if (cmd === 'list_views') return Promise.resolve(updatedViews)
        return defaultMockInvoke(cmd)
      }) as typeof defaultMockInvoke)

      await act(async () => {
        const views = await result.current.reloadViews()
        expect(views).toEqual(updatedViews)
      })
      expect(result.current.views).toEqual(updatedViews)

      backendInvokeFn.mockImplementation(((cmd: string) => {
        if (cmd === 'list_views') return Promise.reject(new Error('views unavailable'))
        return defaultMockInvoke(cmd)
      }) as typeof defaultMockInvoke)

      await act(async () => {
        const views = await result.current.reloadViews()
        expect(views).toEqual([])
      })
    })
  })
})

describe('resolveNoteStatus', () => {
  const mf = (path: string, status: string): ModifiedFile => ({ path, relativePath: path.replace('/vault/', ''), status })
  const status = (
    path: string,
    newPaths: Set<string>,
    modifiedFiles: ModifiedFile[],
    pendingSavePaths?: Set<string>,
    unsavedPaths?: Set<string>,
  ) => resolveNoteStatus({ path, newPaths, modifiedFiles, pendingSavePaths, unsavedPaths })

  it('returns new when path is in newPaths (not yet on disk)', () => {
    expect(status('/vault/x.md', new Set(['/vault/x.md']), [])).toBe('new')
  })

  it('returns new for untracked files in git', () => {
    expect(status('/vault/x.md', new Set(), [mf('/vault/x.md', 'untracked')])).toBe('new')
  })

  it('returns new for added files in git', () => {
    expect(status('/vault/x.md', new Set(), [mf('/vault/x.md', 'added')])).toBe('new')
  })

  it('returns modified for git-modified files', () => {
    expect(status('/vault/x.md', new Set(), [mf('/vault/x.md', 'modified')])).toBe('modified')
  })

  it('returns clean for files not in git status', () => {
    expect(status('/vault/x.md', new Set(), [])).toBe('clean')
  })

  it('returns modified for deleted files so deleted previews keep diff affordances', () => {
    expect(status('/vault/x.md', new Set(), [mf('/vault/x.md', 'deleted')])).toBe('modified')
  })

  it('returns clean for unsupported git statuses', () => {
    expect(status('/vault/x.md', new Set(), [mf('/vault/x.md', 'renamed')])).toBe('clean')
  })

  it('newPaths takes priority over git modified', () => {
    expect(status('/vault/x.md', new Set(['/vault/x.md']), [mf('/vault/x.md', 'modified')])).toBe('new')
  })

  it('pendingSave takes priority over new status', () => {
    const pendingSave = new Set(['/vault/x.md'])
    expect(status('/vault/x.md', new Set(['/vault/x.md']), [], pendingSave)).toBe('pendingSave')
  })

  it('pendingSave takes priority over modified status', () => {
    const pendingSave = new Set(['/vault/x.md'])
    expect(status('/vault/x.md', new Set(), [mf('/vault/x.md', 'modified')], pendingSave)).toBe('pendingSave')
  })

  it('pendingSave takes priority over clean status', () => {
    const pendingSave = new Set(['/vault/x.md'])
    expect(status('/vault/x.md', new Set(), [], pendingSave)).toBe('pendingSave')
  })

  it('without pendingSavePaths parameter, behavior is unchanged', () => {
    // Omitting the optional parameter should produce the same results as before
    expect(status('/vault/x.md', new Set(['/vault/x.md']), [])).toBe('new')
    expect(status('/vault/x.md', new Set(), [mf('/vault/x.md', 'modified')])).toBe('modified')
    expect(status('/vault/x.md', new Set(), [])).toBe('clean')
  })

  it('empty pendingSavePaths set does not affect other statuses', () => {
    const emptyPending = new Set<string>()
    expect(status('/vault/x.md', new Set(['/vault/x.md']), [], emptyPending)).toBe('new')
    expect(status('/vault/x.md', new Set(), [mf('/vault/x.md', 'modified')], emptyPending)).toBe('modified')
    expect(status('/vault/x.md', new Set(), [], emptyPending)).toBe('clean')
  })

  it('unsaved takes priority over all other statuses', () => {
    const unsaved = new Set(['/vault/x.md'])
    expect(status('/vault/x.md', new Set(['/vault/x.md']), [], undefined, unsaved)).toBe('unsaved')
    expect(status('/vault/x.md', new Set(), [mf('/vault/x.md', 'modified')], undefined, unsaved)).toBe('unsaved')
    expect(status('/vault/x.md', new Set(['/vault/x.md']), [], new Set(['/vault/x.md']), unsaved)).toBe('unsaved')
  })

  it('without unsavedPaths parameter, behavior is unchanged', () => {
    expect(status('/vault/x.md', new Set(['/vault/x.md']), [])).toBe('new')
    expect(status('/vault/x.md', new Set(), [mf('/vault/x.md', 'modified')])).toBe('modified')
  })
})
