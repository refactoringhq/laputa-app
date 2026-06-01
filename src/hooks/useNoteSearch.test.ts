import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNoteSearch } from './useNoteSearch'
import type { VaultEntry } from '../types'

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
  ...overrides,
})

const entries: VaultEntry[] = [
  makeEntry({ path: '/vault/a.md', title: 'Alpha Project', isA: 'Project', modifiedAt: 1700000003 }),
  makeEntry({ path: '/vault/b.md', title: 'Beta Notes', isA: 'Note', modifiedAt: 1700000002 }),
  makeEntry({ path: '/vault/c.md', title: 'Gamma Experiment', isA: 'Experiment', modifiedAt: 1700000001 }),
]

describe('useNoteSearch', () => {
  it('returns entries sorted by modifiedAt when query is empty', () => {
    const { result } = renderHook(() => useNoteSearch(entries, ''))
    expect(result.current.results.map((r) => r.title)).toEqual([
      'Alpha Project',
      'Beta Notes',
      'Gamma Experiment',
    ])
  })

  it('filters entries by fuzzy match', () => {
    const { result } = renderHook(() => useNoteSearch(entries, 'alpha'))
    expect(result.current.results).toHaveLength(1)
    expect(result.current.results[0].title).toBe('Alpha Project')
  })

  it('matches existing notes by normalized filename-shaped queries', () => {
    const alpha = makeEntry({
      path: '/vault/alpha-project.md',
      filename: 'alpha-project.md',
      title: 'Alpha Project',
    })

    const { result: markdownQuery } = renderHook(() => useNoteSearch([alpha], 'alpha-project.md'))
    const { result: punctuationQuery } = renderHook(() => useNoteSearch([alpha], 'Alpha Project!'))

    expect(markdownQuery.current.results[0]?.entry).toBe(alpha)
    expect(punctuationQuery.current.results[0]?.entry).toBe(alpha)
  })

  it('matches existing notes when the query omits title diacritics', () => {
    const cafe = makeEntry({
      path: '/vault/cafe-notes.md',
      filename: 'cafe-notes.md',
      title: 'Café Notes',
    })

    const { result } = renderHook(() => useNoteSearch([cafe], 'Cafe Notes'))

    expect(result.current.results[0]?.entry).toBe(cafe)
  })

  it('does not normalize punctuation-only queries to untitled', () => {
    const untitled = makeEntry({
      path: '/vault/untitled.md',
      filename: 'untitled.md',
      title: 'Untitled',
    })

    const { result } = renderHook(() => useNoteSearch([untitled], '!!!'))

    expect(result.current.results).toHaveLength(0)
  })

  it('returns empty results when query has no matches', () => {
    const { result } = renderHook(() => useNoteSearch(entries, 'zzzzzzz'))
    expect(result.current.results).toHaveLength(0)
  })

  it('respects maxResults', () => {
    const { result } = renderHook(() => useNoteSearch(entries, '', 2))
    expect(result.current.results).toHaveLength(2)
  })

  it('includes noteType and light color for non-Note entries', () => {
    const { result } = renderHook(() => useNoteSearch(entries, ''))
    const project = result.current.results.find((r) => r.title === 'Alpha Project')
    expect(project?.noteType).toBe('Project')
    expect(project?.typeColor).toBeTruthy()
    expect(project?.typeLightColor).toBeTruthy()
  })

  it('includes noteType and colors for Note entries', () => {
    const { result } = renderHook(() => useNoteSearch(entries, ''))
    const note = result.current.results.find((r) => r.title === 'Beta Notes')
    expect(note?.noteType).toBe('Note')
    expect(note?.typeColor).toBeTruthy()
    expect(note?.typeLightColor).toBeTruthy()
  })

  it('includes original VaultEntry in results', () => {
    const { result } = renderHook(() => useNoteSearch(entries, ''))
    expect(result.current.results[0].entry).toBe(entries[0])
  })

  it('keeps the plain title text and exposes the icon separately', () => {
    const withIcon = [makeEntry({ path: '/vault/icon.md', title: 'Icon Note', icon: '🚀' })]
    const { result } = renderHook(() => useNoteSearch(withIcon, ''))

    expect(result.current.results[0].title).toBe('Icon Note')
    expect(result.current.results[0].noteIcon).toBe('🚀')
  })

  it('keeps workspace identity separate from the title when multiple workspaces are searchable', () => {
    const personalWorkspace = {
      id: 'personal',
      label: 'Personal',
      alias: 'personal',
      path: '/personal',
      shortLabel: 'PE',
      color: 'blue',
      icon: null,
      mounted: true,
      available: true,
      defaultForNewNotes: true,
    }
    const teamWorkspace = {
      id: 'team',
      label: 'Team',
      alias: 'team',
      path: '/team',
      shortLabel: 'TE',
      color: 'green',
      icon: null,
      mounted: true,
      available: true,
      defaultForNewNotes: false,
    }
    const { result } = renderHook(() => useNoteSearch([
      makeEntry({ path: '/personal/a.md', title: 'Alpha', workspace: personalWorkspace }),
      makeEntry({ path: '/team/b.md', title: 'Beta', workspace: teamWorkspace }),
    ], ''))

    expect(result.current.results[0].title).toBe('Alpha')
    expect(result.current.results[0].workspace).toBe(personalWorkspace)
  })

  it('starts with selectedIndex 0', () => {
    const { result } = renderHook(() => useNoteSearch(entries, ''))
    expect(result.current.selectedIndex).toBe(0)
  })

  it('resets selectedIndex when query changes', () => {
    let query = ''
    const { result, rerender } = renderHook(() => useNoteSearch(entries, query))

    act(() => {
      result.current.setSelectedIndex(2)
    })
    expect(result.current.selectedIndex).toBe(2)

    query = 'alpha'
    rerender()
    expect(result.current.selectedIndex).toBe(0)
  })

  it('handleKeyDown moves selection down on ArrowDown', () => {
    const { result } = renderHook(() => useNoteSearch(entries, ''))

    act(() => {
      result.current.handleKeyDown(
        new KeyboardEvent('keydown', { key: 'ArrowDown' }),
      )
    })
    expect(result.current.selectedIndex).toBe(1)
  })

  it('handleKeyDown moves selection up on ArrowUp', () => {
    const { result } = renderHook(() => useNoteSearch(entries, ''))

    act(() => {
      result.current.setSelectedIndex(2)
    })
    act(() => {
      result.current.handleKeyDown(
        new KeyboardEvent('keydown', { key: 'ArrowUp' }),
      )
    })
    expect(result.current.selectedIndex).toBe(1)
  })

  it('handleKeyDown clamps selection at boundaries', () => {
    const { result } = renderHook(() => useNoteSearch(entries, ''))

    // Can't go below 0
    act(() => {
      result.current.handleKeyDown(
        new KeyboardEvent('keydown', { key: 'ArrowUp' }),
      )
    })
    expect(result.current.selectedIndex).toBe(0)

    // Can't go above last index
    act(() => {
      result.current.setSelectedIndex(2)
    })
    act(() => {
      result.current.handleKeyDown(
        new KeyboardEvent('keydown', { key: 'ArrowDown' }),
      )
    })
    expect(result.current.selectedIndex).toBe(2)
  })

  it('selectedEntry reflects current selection', () => {
    const { result } = renderHook(() => useNoteSearch(entries, ''))
    expect(result.current.selectedEntry).toBe(entries[0])

    act(() => {
      result.current.setSelectedIndex(1)
    })
    expect(result.current.selectedEntry).toBe(entries[1])
  })

  it('selectedEntry is null when no results', () => {
    const { result } = renderHook(() => useNoteSearch(entries, 'zzzzzzz'))
    expect(result.current.selectedEntry).toBeNull()
  })

  it('does not prevent default for non-arrow keys', () => {
    const { result } = renderHook(() => useNoteSearch(entries, ''))
    const event = new KeyboardEvent('keydown', { key: 'Enter' })
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

    act(() => {
      result.current.handleKeyDown(event)
    })
    expect(preventDefaultSpy).not.toHaveBeenCalled()
  })

  it('ranks exact title match first even with many prefix competitors', () => {
    const ranked: VaultEntry[] = [
      makeEntry({ path: '/vault/ri.md', title: 'Refactoring Ideas', modifiedAt: 1700000010 }),
      makeEntry({ path: '/vault/rk.md', title: 'Refactoring Key Ideas', modifiedAt: 1700000009 }),
      makeEntry({ path: '/vault/rp.md', title: 'Refactoring Patterns', modifiedAt: 1700000008 }),
      makeEntry({ path: '/vault/rs.md', title: 'Refactoring Strategy', modifiedAt: 1700000007 }),
      makeEntry({ path: '/vault/rt.md', title: 'Refactoring Techniques', modifiedAt: 1700000006 }),
      makeEntry({ path: '/vault/rb.md', title: 'Refactoring Best Practices', modifiedAt: 1700000005 }),
      makeEntry({ path: '/vault/rg.md', title: 'Refactoring Guide', modifiedAt: 1700000004 }),
      makeEntry({ path: '/vault/rw.md', title: 'Refactoring Workflows', modifiedAt: 1700000003 }),
      makeEntry({ path: '/vault/rc.md', title: 'Refactoring Checklist', modifiedAt: 1700000002 }),
      makeEntry({ path: '/vault/r.md', title: 'Refactoring', isA: 'Area', modifiedAt: 1700000001 }),
    ]
    const { result } = renderHook(() => useNoteSearch(ranked, 'Refactoring'))
    expect(result.current.results[0].title).toBe('Refactoring')
  })

  it('ranks exact title match above note with alias exact match', () => {
    const ranked: VaultEntry[] = [
      makeEntry({ path: '/vault/ri.md', title: 'Refactoring Ideas', aliases: ['Refactoring'], modifiedAt: 1700000003 }),
      makeEntry({ path: '/vault/rk.md', title: 'Refactoring Key Ideas', modifiedAt: 1700000002 }),
      makeEntry({ path: '/vault/r.md', title: 'Refactoring', modifiedAt: 1700000001 }),
    ]
    const { result } = renderHook(() => useNoteSearch(ranked, 'Refactoring'))
    expect(result.current.results[0].title).toBe('Refactoring')
  })

  it('ranks case-insensitive exact match first', () => {
    const ranked: VaultEntry[] = [
      makeEntry({ path: '/vault/qi.md', title: 'Quarter Ideas', modifiedAt: 1700000002 }),
      makeEntry({ path: '/vault/q.md', title: 'Quarter', modifiedAt: 1700000001 }),
    ]
    const { result } = renderHook(() => useNoteSearch(ranked, 'quarter'))
    expect(result.current.results[0].title).toBe('Quarter')
  })

  it('boosts note whose alias is an exact match', () => {
    const ranked: VaultEntry[] = [
      makeEntry({ path: '/vault/ri.md', title: 'Refactoring Ideas', modifiedAt: 1700000002 }),
      makeEntry({ path: '/vault/rn.md', title: 'Refactoring Notes', aliases: ['ref'], modifiedAt: 1700000001 }),
    ]
    const { result } = renderHook(() => useNoteSearch(ranked, 'ref'))
    expect(result.current.results[0].title).toBe('Refactoring Notes')
  })

  it('does not exclude archived notes from results', () => {
    const withArchived: VaultEntry[] = [
      makeEntry({ path: '/vault/a.md', title: 'Active Note', modifiedAt: 1700000002 }),
      makeEntry({ path: '/vault/ar.md', title: 'Archived Note', archived: true, modifiedAt: 1700000001 }),
    ]
    const { result } = renderHook(() => useNoteSearch(withArchived, ''))
    expect(result.current.results).toHaveLength(2)
  })

  it('resolves custom type color from Type entries', () => {
    const withTypes: VaultEntry[] = [
      makeEntry({ path: '/vault/t/recipe.md', title: 'Recipe', isA: 'Type', color: 'orange', icon: 'cooking-pot' }),
      makeEntry({ path: '/vault/pasta.md', title: 'Pasta', isA: 'Recipe', modifiedAt: 1700000010 }),
      makeEntry({ path: '/vault/proj.md', title: 'My Project', isA: 'Project', modifiedAt: 1700000009 }),
    ]
    const { result } = renderHook(() => useNoteSearch(withTypes, ''))
    const pasta = result.current.results.find(r => r.title === 'Pasta')
    expect(pasta?.noteType).toBe('Recipe')
    expect(pasta?.typeColor).toBe('var(--accent-orange)')
    expect(pasta?.typeLightColor).toBe('var(--accent-orange-light)')
    expect(pasta?.TypeIcon).toBeDefined()
    // Built-in type still works
    const project = result.current.results.find(r => r.title === 'My Project')
    expect(project?.typeColor).toBe('var(--accent-red)')
    expect(project?.typeLightColor).toBe('var(--accent-red-light)')
    expect(project?.TypeIcon).toBeDefined()
  })
})
