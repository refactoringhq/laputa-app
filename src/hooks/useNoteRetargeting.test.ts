import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderNode, SidebarSelection, VaultEntry } from '../types'
import { trackNoteRetargeted } from '../lib/productAnalytics'
import { useNoteRetargeting } from './useNoteRetargeting'

vi.mock('../lib/productAnalytics', () => ({
  trackNoteRetargeted: vi.fn(),
}))

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/vault/notes/alpha.md',
  filename: 'alpha.md',
  title: 'Alpha',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: 'Active',
  archived: false,
  modifiedAt: 1700000000,
  createdAt: 1700000000,
  fileSize: 10,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  outgoingLinks: [],
  template: null,
  sort: null,
  sidebarLabel: null,
  view: null,
  visible: null,
  properties: {},
  ...overrides,
})

const folders: FolderNode[] = [
  { name: 'notes', path: 'notes', children: [] },
  { name: 'projects', path: 'projects', children: [] },
]

describe('useNoteRetargeting', () => {
  const setSelection = vi.fn()
  const setToastMessage = vi.fn()
  const updateFrontmatter = vi.fn()
  const moveNoteToFolder = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderUseNoteRetargeting(
    selection: SidebarSelection,
    entries: VaultEntry[] = [
      makeEntry(),
      makeEntry({ path: '/vault/type/project.md', filename: 'project.md', title: 'Project', isA: 'Type' }),
    ],
    vaultPath = '/vault',
  ) {
    return renderHook(() => useNoteRetargeting({
      entries,
      folders,
      selection,
      setSelection,
      setToastMessage,
      vaultPath,
      updateFrontmatter,
      moveNoteToFolder,
    }))
  }

  it('rejects dropping a note onto its current type and allows other types', () => {
    const { result } = renderUseNoteRetargeting({ kind: 'filter', filter: 'all' })

    expect(result.current.canDropNoteOnType('/vault/notes/alpha.md', 'Note')).toBe(false)
    expect(result.current.canDropNoteOnType('/vault/notes/alpha.md', 'Type')).toBe(true)
  })

  it('changes the note type, updates entity selection, and shows a toast', async () => {
    updateFrontmatter.mockResolvedValue(undefined)
    const selection: SidebarSelection = { kind: 'entity', entry: makeEntry() }
    const { result } = renderUseNoteRetargeting(selection)

    await act(async () => {
      await result.current.changeNoteType('/vault/notes/alpha.md', 'Type')
    })

    expect(updateFrontmatter).toHaveBeenCalledWith(
      '/vault/notes/alpha.md',
      'type',
      'Type',
      { silent: true },
    )
    expect(setSelection).toHaveBeenCalledWith({
      kind: 'entity',
      entry: expect.objectContaining({
        path: '/vault/notes/alpha.md',
        isA: 'Type',
      }),
    })
    expect(setToastMessage).toHaveBeenCalledWith('Type set to "Type"')
    expect(trackNoteRetargeted).toHaveBeenCalledWith({ targetKind: 'type' })
  })

  it('moves the note into another folder and updates the selected entity path', async () => {
    const selection: SidebarSelection = { kind: 'entity', entry: makeEntry() }
    moveNoteToFolder.mockImplementation(async (
      path: string,
      _folderPath: string,
      _vaultPath: string,
      onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }) => void,
    ) => {
      onEntryRenamed(path, { path: '/vault/projects/alpha.md', filename: 'alpha.md' })
      return { new_path: '/vault/projects/alpha.md' }
    })
    const { result } = renderUseNoteRetargeting(selection)

    await act(async () => {
      await result.current.moveIntoFolder('/vault/notes/alpha.md', 'projects')
    })

    expect(moveNoteToFolder).toHaveBeenCalledWith(
      '/vault/notes/alpha.md',
      'projects',
      '/vault',
      expect.any(Function),
    )
    expect(setSelection).toHaveBeenCalledWith({
      kind: 'entity',
      entry: expect.objectContaining({
        path: '/vault/projects/alpha.md',
        filename: 'alpha.md',
      }),
    })
    expect(trackNoteRetargeted).toHaveBeenCalledWith({
      targetKind: 'folder',
      folderDestination: 'folder',
    })
  })

  it('moves a nested note back to the vault root', async () => {
    const nestedEntry = makeEntry({ path: '/vault/notes/alpha.md' })
    moveNoteToFolder.mockResolvedValue({ new_path: '/vault/alpha.md' })
    const { result } = renderUseNoteRetargeting(
      { kind: 'filter', filter: 'all' },
      [nestedEntry],
    )

    expect(result.current.canDropNoteOnFolder('/vault/notes/alpha.md', '')).toBe(true)

    await act(async () => {
      await result.current.moveIntoFolder('/vault/notes/alpha.md', '')
    })

    expect(moveNoteToFolder).toHaveBeenCalledWith(
      '/vault/notes/alpha.md',
      '',
      '/vault',
      expect.any(Function),
    )
    expect(trackNoteRetargeted).toHaveBeenCalledWith({
      targetKind: 'folder',
      folderDestination: 'root',
    })
  })

  it('uses normalized paths when checking a Windows folder destination', async () => {
    const windowsEntry = makeEntry({
      path: 'C:\\vault\\projects\\alpha.md',
      filename: 'alpha.md',
    })
    moveNoteToFolder.mockResolvedValue({ new_path: 'C:\\vault\\projects\\alpha.md' })
    const { result } = renderUseNoteRetargeting(
      { kind: 'filter', filter: 'all' },
      [windowsEntry],
      'C:\\vault',
    )

    expect(result.current.canDropNoteOnFolder('C:\\vault\\projects\\alpha.md', 'projects')).toBe(false)
    expect(result.current.canDropNoteOnFolder('C:\\vault\\projects\\alpha.md', '\\archive\\')).toBe(true)

    await act(async () => {
      await result.current.moveIntoFolder('C:\\vault\\projects\\alpha.md', '\\archive\\')
    })

    expect(moveNoteToFolder).toHaveBeenCalledWith(
      'C:\\vault\\projects\\alpha.md',
      'archive',
      'C:\\vault',
      expect.any(Function),
    )
  })
})
