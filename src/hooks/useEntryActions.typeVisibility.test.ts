import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../types'
import { useEntryActions } from './useEntryActions'
import { makeEntry } from '../test-utils/noteListTestUtils'

function setup(entries: VaultEntry[]) {
  const updateEntry = vi.fn()
  const handleUpdateFrontmatter = vi.fn().mockResolvedValue(undefined)
  const handleDeleteProperty = vi.fn().mockResolvedValue(undefined)
  const createTypeEntry = vi.fn()
  const result = renderHook(() =>
    useEntryActions({
      entries,
      updateEntry,
      handleUpdateFrontmatter,
      handleDeleteProperty,
      setToastMessage: vi.fn(),
      createTypeEntry,
    })
  )
  return { ...result, createTypeEntry, handleUpdateFrontmatter, updateEntry }
}

describe('useEntryActions type visibility', () => {
  it('targets an existing Type entry using normalized Type identity', async () => {
    const typeEntry = makeEntry({ isA: 'Type', title: 'Journal', path: '/vault/journal.md', visible: null })
    const { result, createTypeEntry, handleUpdateFrontmatter, updateEntry } = setup([typeEntry])

    await act(async () => {
      await result.current.handleToggleTypeVisibility(' journal ')
    })

    expect(createTypeEntry).not.toHaveBeenCalled()
    expect(handleUpdateFrontmatter).toHaveBeenCalledWith('/vault/journal.md', 'visible', false)
    expect(updateEntry).toHaveBeenCalledWith('/vault/journal.md', { visible: false })
  })

  it('targets the provided Type entry path when duplicate type names exist', async () => {
    const hiddenTypeEntry = makeEntry({ isA: 'Type', title: 'Journal', path: '/vault/main/journal.md', visible: false })
    const visibleTypeEntry = makeEntry({ isA: 'Type', title: 'Journal', path: '/vault/work/journal.md', visible: null })
    const { result, handleUpdateFrontmatter, updateEntry } = setup([hiddenTypeEntry, visibleTypeEntry])

    await act(async () => {
      await result.current.handleToggleTypeVisibility('Journal', '/vault/work/journal.md')
    })

    expect(handleUpdateFrontmatter).toHaveBeenCalledWith('/vault/work/journal.md', 'visible', false)
    expect(updateEntry).toHaveBeenCalledWith('/vault/work/journal.md', { visible: false })
  })
})
