import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { VaultEntry } from '../types'
import { useEntryActions } from './useEntryActions'

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/vault/note/test.md',
  filename: 'test.md',
  title: 'Test Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: 'Active',
  archived: false,
  modifiedAt: 1700000000,
  createdAt: 1700000000,
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
  outgoingLinks: [],
  properties: {},
  ...overrides,
})

describe('useEntryActions type rename', () => {
  const updateEntry = vi.fn()
  const handleUpdateFrontmatter = vi.fn().mockResolvedValue(undefined)
  const handleDeleteProperty = vi.fn().mockResolvedValue(undefined)
  const setToastMessage = vi.fn()
  const createTypeEntry = vi.fn()
  const renameTypeEntry = vi.fn().mockResolvedValue(undefined)
  const onFrontmatterPersisted = vi.fn()

  function setup(entries: VaultEntry[]) {
    const config = {
      entries,
      updateEntry,
      handleUpdateFrontmatter,
      handleDeleteProperty,
      setToastMessage,
      createTypeEntry,
      renameTypeEntry,
      onFrontmatterPersisted,
    }
    return renderHook(() => useEntryActions(config))
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renames the Type entry and rewrites existing note type metadata', async () => {
    const typeEntry = makeEntry({
      path: '/vault/project.md',
      filename: 'project.md',
      title: 'Project',
      isA: 'Type',
      sidebarLabel: 'Projects',
    })
    const assignedNote = makeEntry({ path: '/vault/alpha.md', title: 'Alpha', isA: 'Project' })
    const otherNote = makeEntry({ path: '/vault/beta.md', title: 'Beta', isA: 'Area' })
    const { result } = setup([typeEntry, assignedNote, otherNote])

    await act(async () => {
      await result.current.handleRenameSection('Project', ' Initiative ')
    })

    expect(handleDeleteProperty).toHaveBeenCalledWith('/vault/project.md', 'sidebar label')
    expect(handleUpdateFrontmatter).toHaveBeenCalledWith('/vault/alpha.md', 'type', 'Initiative')
    expect(handleUpdateFrontmatter).not.toHaveBeenCalledWith('/vault/beta.md', 'type', 'Initiative')
    expect(renameTypeEntry).toHaveBeenCalledWith(typeEntry, 'Initiative')
    expect(onFrontmatterPersisted).toHaveBeenCalledTimes(1)
  })
})
