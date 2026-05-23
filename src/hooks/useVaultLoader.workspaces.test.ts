import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { VaultEntry } from '../types'
import { useVaultLoader } from './useVaultLoader'
import { workspaceIdentityFromVault } from '../utils/workspaces'

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

type MockCommandHandler = (args?: Record<string, unknown>) => unknown

const defaultMockHandlers: Record<string, MockCommandHandler> = {
  list_vault: () => mockEntries,
  reload_vault: () => mockEntries,
  get_modified_files: () => [],
  list_vault_folders: () => [],
  list_views: () => [],
}

function defaultMockInvoke(cmd: string, args?: Record<string, unknown>) {
  const handler = Reflect.get(defaultMockHandlers, cmd) as ((args?: Record<string, unknown>) => unknown) | undefined
  return Promise.resolve(handler ? handler(args) : null)
}

let mockIsTauri = false
const backendInvokeFn = vi.fn(defaultMockInvoke)

function isVaultLoadCommand(cmd: string) {
  return cmd === 'list_vault' || cmd === 'reload_vault'
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

async function enableTauriMode() {
  mockIsTauri = true
  const tauri = await import('@tauri-apps/api/core')
  vi.mocked(tauri.invoke).mockImplementation((command: string, args?: Record<string, unknown>) =>
    backendInvokeFn(command, args),
  )
}

type EntryLoad = VaultEntry[] | Promise<VaultEntry[]>

function entryForPath(path: string): VaultEntry {
  return {
    ...mockEntries[0],
    path: `${path}/note/hello.md`,
    title: path === '/team' ? 'Team Hello' : 'Personal Hello',
  }
}

function backendFolder(name: string) {
  return { name, path: 'projects', children: [] }
}

function mountedFolderRoot(label: string, rootPath: string, childName: string) {
  return {
    name: label,
    path: '',
    rootPath,
    children: [{ name: childName, path: 'projects', rootPath, children: [] }],
  }
}

function viewFile(filename: string, name: string) {
  return {
    filename,
    definition: { name, icon: null, color: null, sort: null, filters: { all: [] } },
  }
}

function mockWorkspaceBackend(options: {
  entriesByPath?: Record<string, EntryLoad>
  foldersByPath?: Record<string, ReturnType<typeof backendFolder>[]>
  viewsByVaultPath?: Record<string, ReturnType<typeof viewFile>[]>
} = {}) {
  backendInvokeFn.mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''
    const vaultPath = typeof args?.vaultPath === 'string' ? args.vaultPath : ''

    if (isVaultLoadCommand(cmd)) {
      return Promise.resolve(options.entriesByPath?.[path] ?? [entryForPath(path)])
    }
    if (cmd === 'list_vault_folders') {
      return Promise.resolve(options.foldersByPath?.[path] ?? [])
    }
    if (cmd === 'list_views') {
      return Promise.resolve(options.viewsByVaultPath?.[vaultPath] ?? [])
    }
    if (cmd === 'get_modified_files') {
      return Promise.resolve([])
    }
    return Promise.resolve(null)
  }) as typeof defaultMockInvoke)
}

describe('useVaultLoader workspaces', () => {
  beforeEach(() => {
    mockIsTauri = false
    backendInvokeFn.mockReset()
    backendInvokeFn.mockImplementation(defaultMockInvoke)
  })

  it('loads entries from every mounted workspace and annotates provenance', async () => {
    mockWorkspaceBackend()

    const vaults = [
      { label: 'Personal', path: '/personal', alias: 'personal', available: true, mounted: true },
      { label: 'Team', path: '/team', alias: 'team', available: true, mounted: true },
    ]
    const { result } = renderHook(() => useVaultLoader('/personal', vaults, '/personal'))

    await waitForEntries(result, 2)

    expect(result.current.entries.map((entry) => entry.workspace?.alias).sort()).toEqual(['personal', 'team'])
    expect(result.current.entries.find((entry) => entry.workspace?.alias === 'team')?.workspace?.defaultForNewNotes).toBe(false)
  })

  it('loads one folder root per mounted workspace when folder vaults are provided', async () => {
    const vaults = [
      { label: 'Personal', path: '/personal', alias: 'personal', available: true, mounted: true },
      { label: 'Team', path: '/team', alias: 'team', available: true, mounted: true },
    ]
    mockWorkspaceBackend({
      foldersByPath: {
        '/personal': [backendFolder('personal-projects')],
        '/team': [backendFolder('team-projects')],
      },
    })

    const { result } = renderHook(() => useVaultLoader('/personal', vaults, '/personal', vaults))

    await waitForEntries(result, 2)
    await waitFor(() => {
      expect(result.current.folders).toEqual([
        mountedFolderRoot('Personal', '/personal', 'personal-projects'),
        mountedFolderRoot('Team', '/team', 'team-projects'),
      ])
    })
  })

  it('keeps the active vault folder root visible when it is absent from mounted folder vaults', async () => {
    const entryVaults = [
      { label: 'Brian', path: '/brian', alias: 'brian', available: true, mounted: false },
      { label: 'Laputa', path: '/laputa', alias: 'laputa', available: true, mounted: true },
    ]
    const folderVaults = [entryVaults[1]]
    mockWorkspaceBackend({
      foldersByPath: {
        '/brian': [backendFolder('brian-projects')],
        '/laputa': [backendFolder('laputa-projects')],
      },
    })

    const { result } = renderHook(() => useVaultLoader('/brian', entryVaults, '/laputa', folderVaults))

    await waitForEntries(result, 2)
    await waitFor(() => {
      expect(result.current.folders).toEqual([
        mountedFolderRoot('Laputa', '/laputa', 'laputa-projects'),
        mountedFolderRoot('brian', '/brian', 'brian-projects'),
      ])
    })
  })

  it('updates workspace default metadata without reloading vault contents', async () => {
    mockWorkspaceBackend()
    const vaults = [
      { label: 'Personal', path: '/personal', alias: 'personal', available: true, mounted: true },
      { label: 'Team', path: '/team', alias: 'team', available: true, mounted: true },
    ]
    const { result, rerender } = renderHook(
      ({ defaultPath }) => useVaultLoader('/personal', vaults, defaultPath, vaults),
      { initialProps: { defaultPath: '/personal' } },
    )

    await waitForEntries(result, 2)
    const vaultLoadCalls = backendInvokeFn.mock.calls.filter(([command]) => isVaultLoadCommand(command)).length
    const folderLoadCalls = backendInvokeFn.mock.calls.filter(([command]) => command === 'list_vault_folders').length

    rerender({ defaultPath: '/team' })

    await waitFor(() => {
      expect(result.current.entries.find((entry) => entry.workspace?.path === '/team')?.workspace?.defaultForNewNotes).toBe(true)
    })
    expect(backendInvokeFn.mock.calls.filter(([command]) => isVaultLoadCommand(command))).toHaveLength(vaultLoadCalls)
    expect(backendInvokeFn.mock.calls.filter(([command]) => command === 'list_vault_folders')).toHaveLength(folderLoadCalls)
  })

  it('loads a newly added workspace incrementally without clearing existing entries', async () => {
    mockWorkspaceBackend()
    const personal = { label: 'Personal', path: '/personal', alias: 'personal', available: true, mounted: true }
    const team = { label: 'Team', path: '/team', alias: 'team', available: true, mounted: true }
    const { result, rerender } = renderHook(
      ({ vaults }) => useVaultLoader('/personal', vaults, '/personal', vaults),
      { initialProps: { vaults: [personal] } },
    )

    await waitForEntries(result, 1)
    expect(result.current.entries.map((entry) => entry.workspace?.path)).toEqual(['/personal'])

    rerender({ vaults: [personal, team] })

    expect(result.current.entries.map((entry) => entry.workspace?.path)).toContain('/personal')
    await waitForEntries(result, 2)
    expect(result.current.entries.map((entry) => entry.workspace?.path).sort()).toEqual(['/personal', '/team'])
  })

  it('keeps preloaded workspace entries mounted when switching the visible vault', async () => {
    mockWorkspaceBackend()
    const personal = { label: 'Personal', path: '/personal', alias: 'personal', available: true, mounted: true }
    const team = { label: 'Team', path: '/team', alias: 'team', available: true, mounted: true }
    const vaults = [personal, team]
    const { result, rerender } = renderHook(
      ({ path }) => useVaultLoader(path, vaults, path),
      { initialProps: { path: '/personal' } },
    )

    await waitForEntries(result, 2)
    const vaultLoadCalls = backendInvokeFn.mock.calls.filter(([command]) => isVaultLoadCommand(command)).length

    rerender({ path: '/team' })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.entries.map((entry) => entry.workspace?.path).sort()).toEqual(['/personal', '/team'])
    await waitFor(() => {
      expect(backendInvokeFn.mock.calls.filter(([command]) => isVaultLoadCommand(command))).toHaveLength(vaultLoadCalls)
    })
  })

  it('reloads scoped folder roots when another mounted workspace is added', async () => {
    const brian = { label: 'Brian', path: '/brian', alias: 'brian', available: true, mounted: true }
    const laputa = { label: 'Laputa', path: '/laputa', alias: 'laputa', available: true, mounted: true }
    const third = { label: 'Third', path: '/third', alias: 'third', available: true, mounted: true }
    mockWorkspaceBackend({
      foldersByPath: {
        '/brian': [backendFolder('brian-root')],
        '/laputa': [backendFolder('laputa-root')],
        '/third': [backendFolder('third-root')],
      },
    })
    const { result, rerender } = renderHook(
      ({ folderVaults }) => useVaultLoader('/brian', [brian, laputa, third], '/brian', folderVaults),
      { initialProps: { folderVaults: [brian] } },
    )

    await waitForEntries(result, 3)
    await waitFor(() => {
      expect(result.current.folders.map((folder) => folder.name)).toEqual(['brian-root'])
    })

    rerender({ folderVaults: [brian, laputa] })

    await waitFor(() => {
      expect(result.current.folders.map((folder) => folder.rootPath)).toEqual(['/brian', '/laputa'])
    })

    rerender({ folderVaults: [brian, laputa, third] })

    await waitFor(() => {
      expect(result.current.folders.map((folder) => folder.rootPath)).toEqual(['/brian', '/laputa', '/third'])
    })
  })

  it('adds each mounted workspace as soon as that workspace finishes loading', async () => {
    const laputaLoad = createDeferred<VaultEntry[]>()
    const brian = { label: 'Brian', path: '/brian', alias: 'brian', available: true, mounted: true }
    const laputa = { label: 'Laputa', path: '/laputa', alias: 'laputa', available: true, mounted: true }
    const team = { label: 'Team', path: '/team', alias: 'team', available: true, mounted: true }
    const vaults = [brian, laputa, team]

    mockWorkspaceBackend({
      entriesByPath: { '/laputa': laputaLoad.promise },
    })

    const { result } = renderHook(() => useVaultLoader('/brian', vaults, '/brian', vaults))

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.workspace?.path).sort()).toEqual(['/brian', '/team'])
    })

    await act(async () => {
      laputaLoad.resolve([{ ...mockEntries[0], path: '/laputa/note/hello.md' }])
    })

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.workspace?.path).sort()).toEqual(['/brian', '/laputa', '/team'])
    })
  })

  it('preserves mounted workspace entries that arrive while the active vault scan is pending', async () => {
    const field = { label: 'Field Notes', path: '/field', alias: 'field', available: true, mounted: true }
    const research = { label: 'Research Lab', path: '/research', alias: 'research', available: true, mounted: true }
    const vaults = [field, research]
    const fieldLoad = createDeferred<VaultEntry[]>()
    mockWorkspaceBackend({
      entriesByPath: { '/field': fieldLoad.promise },
    })

    const { result } = renderHook(() => useVaultLoader('/field', vaults, '/field', vaults))

    act(() => {
      result.current.addEntry({
        ...mockEntries[0],
        path: '/research/note/hello.md',
        title: 'Research Hello',
        workspace: workspaceIdentityFromVault(research, { defaultWorkspacePath: '/field' }),
      })
    })

    act(() => {
      fieldLoad.resolve([{ ...mockEntries[0], path: '/field/note/hello.md', title: 'Field Hello' }])
    })

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.workspace?.path).sort()).toEqual(['/field', '/research'])
    })
  })

  it('uses cached vault listing for background workspace loads in Tauri mode', async () => {
    await enableTauriMode()
    const brian = { label: 'Brian', path: '/brian', alias: 'brian', available: true, mounted: true }
    const laputa = { label: 'Laputa', path: '/laputa', alias: 'laputa', available: true, mounted: true }
    const vaults = [brian, laputa]
    mockWorkspaceBackend()

    const { result } = renderHook(() => useVaultLoader('/brian', vaults, '/brian', vaults))

    await waitForEntries(result, 2)

    const laputaLoadCommands = backendInvokeFn.mock.calls
      .filter(([, args]) => args?.path === '/laputa')
      .map(([command]) => command)
    expect(laputaLoadCommands).toContain('list_vault')
    expect(laputaLoadCommands).not.toContain('reload_vault')
  })

  it('clears stale views immediately when switching to another preloaded workspace', async () => {
    mockWorkspaceBackend({
      viewsByVaultPath: {
        '/brian': [viewFile('brian.yml', 'Brian View')],
      },
    })
    const brian = { label: 'Brian', path: '/brian', alias: 'brian', available: true, mounted: true }
    const laputa = { label: 'Laputa', path: '/laputa', alias: 'laputa', available: true, mounted: true }
    const vaults = [brian, laputa]
    const { result, rerender } = renderHook(
      ({ path }) => useVaultLoader(path, vaults, path),
      { initialProps: { path: '/brian' } },
    )

    await waitFor(() => {
      expect(result.current.views.map((view) => view.filename)).toEqual(['brian.yml'])
    })

    rerender({ path: '/laputa' })

    expect(result.current.views).toEqual([])
    await waitFor(() => {
      expect(result.current.views).toEqual([])
    })
  })
})
