import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVaultLoader } from './useVaultLoader'
import type { ModifiedFile, VaultEntry, ViewFile } from '../types'
import { loadedWorkspacePathsFromEntries } from './vaultWorkspaceEntries'

const clearPrefetchCache = vi.fn()
const backendInvokeFn = vi.fn()
let mockIsTauri = false

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => backendInvokeFn(...args),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => mockIsTauri,
  mockInvoke: (command: string, args?: Record<string, unknown>) => backendInvokeFn(command, args),
}))

vi.mock('./useTabManagement', () => ({
  clearPrefetchCache: () => clearPrefetchCache(),
}))

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    path: '/vault/note/hello.md',
    filename: 'hello.md',
    title: 'Hello',
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: 'Active',
    archived: false,
    modifiedAt: 1,
    createdAt: 1,
    fileSize: 100,
    snippet: '',
    wordCount: 0,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    sidebarLabel: null,
    template: null,
    sort: null,
    view: null,
    visible: null,
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    outgoingLinks: [],
    properties: {},
    hasH1: true,
    fileKind: 'markdown',
    ...overrides,
  }
}

function makeModifiedFile(overrides: Partial<ModifiedFile> = {}): ModifiedFile {
  return {
    path: '/vault/note/hello.md',
    relativePath: 'note/hello.md',
    status: 'modified',
    ...overrides,
  }
}

function makeView(name: string): ViewFile {
  return {
    path: `/vault/.views/${name.toLowerCase()}.yml`,
    filename: `${name.toLowerCase()}.yml`,
    definition: {
      name,
      icon: 'Folder',
      filters: [],
      sort: null,
      listPropertiesDisplay: [],
    },
  }
}

function configureBackend(overrides: Partial<Record<string, unknown | Error>> = {}) {
  const defaults: Record<string, unknown> = {
    list_vault: [makeEntry()],
    reload_vault: [makeEntry()],
    get_modified_files: [],
    list_vault_folders: [],
    list_views: [],
    git_commit: 'committed',
    git_push: { status: 'ok', message: 'pushed' },
  }

  backendInvokeFn.mockImplementation((command: string) => {
    const value = command in overrides ? overrides[command] : defaults[command]
    if (value instanceof Error) return Promise.reject(value)
    return Promise.resolve(value ?? null)
  })
}

async function waitForEntries(
  result: ReturnType<typeof renderHook<ReturnType<typeof useVaultLoader>, string>>['result'],
) {
  await waitFor(() => {
    expect(result.current.entries.length).toBeGreaterThan(0)
  })
}

describe('useVaultLoader extra', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsTauri = false
    configureBackend()
  })

  it('uses native commit and push commands when Tauri mode is active', async () => {
    mockIsTauri = true
    configureBackend({
      reload_vault: [makeEntry()],
      get_modified_files: [],
    })

    const { result } = renderHook(() => useVaultLoader('/vault'))
    await waitForEntries(result)

    let response = { status: '', message: '' }
    await act(async () => {
      response = await result.current.commitAndPush('save current note')
    })

    expect(response.status).toBe('ok')
    expect(backendInvokeFn).toHaveBeenCalledWith('git_commit', {
      vaultPath: '/vault',
      message: 'save current note',
    })
    expect(backendInvokeFn).toHaveBeenCalledWith('git_push', { vaultPath: '/vault' })
  })

  it('tracks pending saves and replaces entries in place', async () => {
    const initialEntry = makeEntry()
    configureBackend({
      list_vault: [initialEntry],
      get_modified_files: [],
    })

    const { result } = renderHook(() => useVaultLoader('/vault'))
    await waitForEntries(result)

    act(() => {
      result.current.addPendingSave(initialEntry.path)
    })
    expect(result.current.getNoteStatus(initialEntry.path)).toBe('pendingSave')

    act(() => {
      result.current.removePendingSave(initialEntry.path)
      result.current.replaceEntry(initialEntry.path, {
        path: '/vault/note/renamed.md',
        title: 'Renamed',
      })
    })

    expect(result.current.getNoteStatus(initialEntry.path)).toBe('clean')
    expect(result.current.entries[0]?.path).toBe('/vault/note/renamed.md')
    expect(result.current.entries[0]?.title).toBe('Renamed')
  })

  it('surfaces modified-file refresh failures with an empty fallback list', async () => {
    configureBackend({
      list_vault: [makeEntry()],
      get_modified_files: new Error('backend offline'),
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useVaultLoader('/vault'))

    await waitFor(() => {
      expect(result.current.modifiedFilesError).toBe('Failed to load changes')
      expect(result.current.modifiedFiles).toEqual([])
    })

    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('reloads the vault, refreshes modified files, and clears the prefetch cache', async () => {
    configureBackend({
      list_vault: [makeEntry()],
      get_modified_files: [],
      reload_vault: [makeEntry({ path: '/vault/note/fresh.md', filename: 'fresh.md', title: 'Fresh' })],
    })

    const { result } = renderHook(() => useVaultLoader('/vault'))
    await waitForEntries(result)
    vi.mocked(clearPrefetchCache).mockClear()

    backendInvokeFn.mockImplementation((command: string) => {
      if (command === 'reload_vault') {
        return Promise.resolve([
          makeEntry({ path: '/vault/note/fresh.md', filename: 'fresh.md', title: 'Fresh' }),
        ])
      }
      if (command === 'get_modified_files') {
        return Promise.resolve([
          makeModifiedFile({ path: '/vault/note/fresh.md', relativePath: 'note/fresh.md' }),
        ])
      }
      if (command === 'list_vault_folders' || command === 'list_views') return Promise.resolve([])
      return Promise.resolve([makeEntry()])
    })

    let reloaded: VaultEntry[] = []
    await act(async () => {
      reloaded = await result.current.reloadVault()
    })

    expect(clearPrefetchCache).toHaveBeenCalledOnce()
    expect(reloaded.map((entry) => entry.title)).toEqual(['Fresh'])

    await waitFor(() => {
      expect(result.current.entries[0]?.title).toBe('Fresh')
      expect(result.current.modifiedFiles[0]?.path).toBe('/vault/note/fresh.md')
    })
  })

  it('returns an empty list when vault reload fails', async () => {
    configureBackend({
      list_vault: [makeEntry()],
      get_modified_files: [],
      reload_vault: new Error('reload failed'),
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useVaultLoader('/vault'))
    await waitForEntries(result)

    let reloaded: VaultEntry[] = [makeEntry({ title: 'sentinel' })]
    await act(async () => {
      reloaded = await result.current.reloadVault()
    })

    expect(reloaded).toEqual([])
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('reloads views when the backend succeeds', async () => {
    const views = [makeView('Projects')]
    configureBackend({
      list_vault: [makeEntry()],
      list_views: [],
    })

    const { result } = renderHook(() => useVaultLoader('/vault'))
    await waitForEntries(result)

    backendInvokeFn.mockImplementation((command: string) => {
      if (command === 'list_views') return Promise.resolve(views)
      if (command === 'get_modified_files' || command === 'list_vault_folders') return Promise.resolve([])
      return Promise.resolve([makeEntry()])
    })

    let reloaded: ViewFile[] = []
    await act(async () => {
      reloaded = await result.current.reloadViews()
    })

    expect(reloaded.map((view) => view.definition.name)).toEqual(['Projects'])
    expect(result.current.views[0]?.definition.name).toBe('Projects')
  })

  it('returns empty arrays when folder or view reloads fail', async () => {
    configureBackend({
      list_vault: [makeEntry()],
      list_vault_folders: [{ name: 'projects', path: 'projects', children: [] }],
      list_views: [makeView('Inbox')],
    })

    const { result } = renderHook(() => useVaultLoader('/vault'))
    await waitForEntries(result)

    backendInvokeFn.mockImplementation((command: string) => {
      if (command === 'list_vault_folders' || command === 'list_views') {
        return Promise.reject(new Error('unavailable'))
      }
      if (command === 'get_modified_files') return Promise.resolve([])
      return Promise.resolve([makeEntry()])
    })

    let folders: unknown[] = []
    let views: ViewFile[] = []
    await act(async () => {
      folders = await result.current.reloadFolders()
      views = await result.current.reloadViews()
    })

    expect(folders).toEqual([])
    expect(views).toEqual([])
  })

  it('does not infer the fallback workspace from untagged entries when explicit workspace metadata is required', () => {
    expect(loadedWorkspacePathsFromEntries([
      makeEntry({ path: '/research/research-beacon.md' }),
    ], '/field', { inferFallbackWorkspacePath: false })).toEqual([])
  })

  it('uses explicit workspace metadata when fallback inference is disabled', () => {
    expect(loadedWorkspacePathsFromEntries([
      makeEntry({
        path: '/research/research-beacon.md',
        workspace: {
          id: 'workspace',
          label: 'Workspace',
          alias: 'workspace',
          path: '/research',
          shortLabel: 'WS',
          color: null,
          icon: null,
          mounted: true,
          available: true,
          defaultForNewNotes: false,
        },
      }),
    ], '/field', { inferFallbackWorkspacePath: false })).toEqual(['/research'])
  })
})
