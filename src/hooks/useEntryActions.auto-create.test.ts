import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { VaultEntry } from '../types'
import { useEntryActions } from './useEntryActions'

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/vault/test.md',
  filename: 'test.md',
  title: 'Test',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
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

describe('useEntryActions auto-created type failures', () => {
  const updateEntry = vi.fn()
  const handleUpdateFrontmatter = vi.fn().mockResolvedValue(undefined)
  const handleDeleteProperty = vi.fn().mockResolvedValue(undefined)
  const setToastMessage = vi.fn()
  const onFrontmatterPersisted = vi.fn()
  const createTypeEntry = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    createTypeEntry.mockResolvedValue(makeEntry({
      isA: 'Type',
      title: 'Person',
      path: '/vault/person.md',
      filename: 'person.md',
    }))
  })

  function setup(entries: VaultEntry[] = []) {
    return renderHook(() => useEntryActions({
      entries,
      updateEntry,
      handleUpdateFrontmatter,
      handleDeleteProperty,
      setToastMessage,
      createTypeEntry,
      onFrontmatterPersisted,
    }))
  }

  it('keeps sidebar customization from throwing when auto-created type path collides', async () => {
    createTypeEntry.mockRejectedValueOnce(new Error('Cannot create type "Person" because person.md already exists'))
    const { result } = setup()

    await act(async () => {
      await result.current.handleCustomizeType('Person', 'user', 'green')
    })

    expect(createTypeEntry).toHaveBeenCalledWith('Person')
    expect(handleUpdateFrontmatter).not.toHaveBeenCalled()
    expect(updateEntry).not.toHaveBeenCalled()
    expect(onFrontmatterPersisted).not.toHaveBeenCalled()
  })
})
