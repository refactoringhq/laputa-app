import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteList } from './NoteList'
import { makeEntry, makeIndexedEntry, mockEntries, renderNoteList } from '../test-utils/noteListTestUtils'
import type { NoteStatus } from '../types'

describe('NoteList status indicators', () => {
  it('shows a modified indicator for modified notes', () => {
    const getNoteStatus = (path: string) => path === mockEntries[0].path ? 'modified' as const : 'clean' as const
    renderNoteList({ getNoteStatus })

    const indicators = screen.getAllByTestId('modified-indicator')
    expect(indicators).toHaveLength(1)
    const noteRow = indicators[0].closest('[data-testid="modified-indicator"]')!.parentElement!.parentElement!
    expect(noteRow.textContent).toContain('Build Laputa App')
  })

  it('does not show indicators when everything is clean', () => {
    renderNoteList({ getNoteStatus: () => 'clean' as const })
    expect(screen.queryByTestId('modified-indicator')).not.toBeInTheDocument()
    expect(screen.queryByTestId('new-indicator')).not.toBeInTheDocument()
  })

  it('shows multiple modified indicators when multiple notes are dirty', () => {
    const modifiedPaths = new Set([mockEntries[0].path, mockEntries[1].path])
    const getNoteStatus = (path: string) => modifiedPaths.has(path) ? 'modified' as const : 'clean' as const

    renderNoteList({ getNoteStatus })
    expect(screen.getAllByTestId('modified-indicator')).toHaveLength(2)
  })

  it('does not show indicators when getNoteStatus is undefined', () => {
    renderNoteList()
    expect(screen.queryByTestId('modified-indicator')).not.toBeInTheDocument()
    expect(screen.queryByTestId('new-indicator')).not.toBeInTheDocument()
  })

  it('shows the green new indicator for new notes', () => {
    const getNoteStatus = (path: string) => path === mockEntries[0].path ? 'new' as const : 'clean' as const
    renderNoteList({ getNoteStatus })
    expect(screen.getAllByTestId('new-indicator')).toHaveLength(1)
    expect(screen.queryByTestId('modified-indicator')).not.toBeInTheDocument()
  })

  it('keeps the green indicator steady while a new note is edited and saved', () => {
    const targetPath = mockEntries[0].path
    const getNoteStatus = (noteStatus: NoteStatus) => (path: string) => path === targetPath ? noteStatus : 'clean'
    const { props, rerender } = renderNoteList({ getNoteStatus: getNoteStatus('new') })
    const rerenderWithStatus = (nextStatus: NoteStatus) => {
      rerender(<NoteList {...props} getNoteStatus={getNoteStatus(nextStatus)} />)
    }
    const expectSteadyIndicator = (testId: string) => {
      const indicator = screen.getByTestId(testId)
      expect(indicator).not.toHaveClass('tab-status-pulse')
    }

    expectSteadyIndicator('new-indicator')
    rerenderWithStatus('unsaved')
    expectSteadyIndicator('unsaved-indicator')
    rerenderWithStatus('pendingSave')
    expectSteadyIndicator('pending-save-indicator')
    rerenderWithStatus('new')
    expectSteadyIndicator('new-indicator')
  })
})

describe('NoteList virtualized datasets', () => {
  it('renders 9000 entries without crashing', { timeout: 30000 }, () => {
    const largeDataset = Array.from({ length: 9000 }, (_, index) => makeIndexedEntry(index))
    const { container } = renderNoteList({ entries: largeDataset })
    expect(container.querySelector('[data-testid="virtuoso-mock"]')).toBeInTheDocument()
  })

  it('renders both ends of a large dataset through the Virtuoso mock', () => {
    const largeDataset = Array.from({ length: 500 }, (_, index) => makeIndexedEntry(index))
    renderNoteList({ entries: largeDataset })
    expect(screen.getByText('Note 0')).toBeInTheDocument()
    expect(screen.getByText('Note 499')).toBeInTheDocument()
  })

  it('filters large datasets by search query', { timeout: 15000 }, async () => {
    vi.useFakeTimers()
    try {
      const entries = [
        makeIndexedEntry(0, { title: 'Alpha Strategy' }),
        ...Array.from({ length: 298 }, (_, index) => makeIndexedEntry(index + 1, { title: `Filler Note ${index + 1}` })),
        makeIndexedEntry(299, { title: 'Beta Strategy' }),
      ]

      renderNoteList({ entries })
      fireEvent.click(screen.getByTitle('Search notes'))
      fireEvent.change(screen.getByPlaceholderText('Search notes...'), { target: { value: 'Strategy' } })

      await act(async () => {
        vi.advanceTimersByTime(200)
      })

      vi.useRealTimers()

      await waitFor(() => {
        expect(screen.getByText('Alpha Strategy')).toBeInTheDocument()
        expect(screen.getByText('Beta Strategy')).toBeInTheDocument()
        expect(screen.queryByText('Filler Note 1')).not.toBeInTheDocument()
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('sorts large datasets correctly', () => {
    const entries = [
      makeIndexedEntry(0, { title: 'Zebra', modifiedAt: 1000 }),
      makeIndexedEntry(1, { title: 'Alpha', modifiedAt: 3000 }),
      ...Array.from({ length: 100 }, (_, index) => makeIndexedEntry(index + 2, { title: `Mid ${index}`, modifiedAt: 2000 - index })),
    ]

    renderNoteList({ entries })
    expect(screen.getAllByText(/^Alpha$|^Zebra$/)[0].textContent).toBe('Alpha')
  })

  it('re-sorts when an entry modifiedAt changes', () => {
    const entries = [
      makeEntry({ path: '/a.md', title: 'Alpha', modifiedAt: 1000 }),
      makeEntry({ path: '/b.md', title: 'Beta', modifiedAt: 3000 }),
    ]

    const { rerender, props } = renderNoteList({ entries })
    expect(screen.getAllByText(/^Alpha$|^Beta$/)[0].textContent).toBe('Beta')

    rerender(
      <NoteList
        {...props}
        entries={[
          { ...entries[0], modifiedAt: 4000 },
          entries[1],
        ]}
      />,
    )

    expect(screen.getAllByText(/^Alpha$|^Beta$/)[0].textContent).toBe('Alpha')
  })

  it('filters section groups inside large mixed datasets', () => {
    const entries = [
      ...Array.from({ length: 100 }, (_, index) => makeIndexedEntry(index, { isA: 'Project', title: `Project ${index}` })),
      ...Array.from({ length: 200 }, (_, index) => makeIndexedEntry(100 + index, { isA: 'Note', title: `Note ${index}` })),
    ]

    renderNoteList({ entries, selection: { kind: 'sectionGroup', type: 'Project' } })
    expect(screen.getByText('Project 0')).toBeInTheDocument()
    expect(screen.queryByText('Note 0')).not.toBeInTheDocument()
  })

  it('keeps selection highlighting in virtualized lists', () => {
    const entries = Array.from({ length: 100 }, (_, index) => makeIndexedEntry(index))
    renderNoteList({ entries, selectedNote: entries[5] })
    expect(screen.getByText('Note 5')).toBeInTheDocument()
  })

  it('keeps click behavior working on virtualized items', () => {
    const entries = Array.from({ length: 100 }, (_, index) => makeIndexedEntry(index))
    const { onReplaceActiveTab } = renderNoteList({ entries })
    fireEvent.click(screen.getByText('Note 50'))
    expect(onReplaceActiveTab).toHaveBeenCalledWith(entries[50])
  })
})

describe('NoteList multi-select', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function selectTwoNotes(extraProps: Record<string, unknown> = {}) {
    renderNoteList(extraProps)
    fireEvent.click(screen.getByText('Build Laputa App'))
    fireEvent.click(screen.getByText('Facebook Ads Strategy'), { shiftKey: true })
  }

  it('selects a range on Shift+Click', () => {
    selectTwoNotes()
    expect(screen.getAllByTestId('multi-selected-item').length).toBeGreaterThanOrEqual(2)
  })

  it('clears multi-select and opens the note on regular click', () => {
    const { onReplaceActiveTab } = renderNoteList()
    fireEvent.click(screen.getByText('Build Laputa App'))
    fireEvent.click(screen.getByText('Facebook Ads Strategy'), { shiftKey: true })
    fireEvent.click(screen.getByText('Matteo Cellini'))

    expect(screen.queryByTestId('multi-selected-item')).not.toBeInTheDocument()
    expect(onReplaceActiveTab).toHaveBeenCalledWith(mockEntries[2])
  })

  it('clears multi-select and enters Neighborhood on Cmd+Click', async () => {
    const { onEnterNeighborhood, onReplaceActiveTab } = renderNoteList()
    fireEvent.click(screen.getByText('Build Laputa App'))
    fireEvent.click(screen.getByText('Facebook Ads Strategy'), { shiftKey: true })
    fireEvent.click(screen.getByText('Matteo Cellini'), { metaKey: true })

    expect(screen.queryByTestId('multi-selected-item')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(onReplaceActiveTab).toHaveBeenCalledWith(mockEntries[2])
      expect(onEnterNeighborhood).toHaveBeenCalledWith(mockEntries[2])
    })
  })

  it('shows the bulk action bar with the selected count', () => {
    selectTwoNotes()
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument()
    expect(screen.getByText('2 selected')).toBeInTheDocument()
  })

  it.each([
    { label: 'organizes via button', prop: 'onBulkOrganize', trigger: () => fireEvent.click(screen.getByTestId('bulk-organize-btn')) },
    { label: 'archives via button', prop: 'onBulkArchive', trigger: () => fireEvent.click(screen.getByTestId('bulk-archive-btn')) },
    { label: 'deletes via button', prop: 'onBulkDeletePermanently', trigger: () => fireEvent.click(screen.getByTestId('bulk-delete-btn')) },
    { label: 'organizes via Cmd+E', prop: 'onBulkOrganize', trigger: () => fireEvent.keyDown(window, { key: 'e', metaKey: true }) },
    { label: 'deletes via Cmd+Backspace', prop: 'onBulkDeletePermanently', trigger: () => fireEvent.keyDown(window, { key: 'Backspace', metaKey: true }) },
    { label: 'deletes via Cmd+Delete', prop: 'onBulkDeletePermanently', trigger: () => fireEvent.keyDown(window, { key: 'Delete', metaKey: true }) },
  ])('bulk-select $label and clears the selection', ({ prop, trigger }) => {
    const handler = vi.fn()
    selectTwoNotes({ [prop]: handler })
    trigger()
    expect(handler).toHaveBeenCalledWith([mockEntries[0].path, mockEntries[1].path])
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument()
  })

  it('clears the selection from the bulk action bar', () => {
    selectTwoNotes()
    fireEvent.click(screen.getByTestId('bulk-clear-btn'))
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('multi-selected-item')).not.toBeInTheDocument()
  })

  it('does not show a bulk action bar when nothing is selected', () => {
    renderNoteList()
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument()
  })
})

describe('NoteList filter pills', () => {
  const projectEntries = [
    makeEntry({ path: '/p1.md', title: 'Open Project 1', isA: 'Project' }),
    makeEntry({ path: '/p2.md', title: 'Open Project 2', isA: 'Project' }),
    makeEntry({ path: '/p3.md', title: 'Archived Project', isA: 'Project', archived: true }),
    makeEntry({ path: '/n1.md', title: 'Some Note', isA: 'Note' }),
  ]

  it('shows filter pills for type sections', () => {
    renderNoteList({ entries: projectEntries, selection: { kind: 'sectionGroup', type: 'Project' } })
    expect(screen.getByTestId('filter-pills')).toBeInTheDocument()
    expect(screen.getByTestId('filter-pill-open')).toBeInTheDocument()
    expect(screen.getByTestId('filter-pill-archived')).toBeInTheDocument()
  })

  it('does not show filter pills in all-notes view', () => {
    renderNoteList({ entries: projectEntries })
    expect(screen.queryByTestId('filter-pills')).not.toBeInTheDocument()
  })

  it('ignores the archived sub-filter in all-notes view', () => {
    renderNoteList({ entries: projectEntries, noteListFilter: 'archived' })
    expect(screen.queryByTestId('filter-pills')).not.toBeInTheDocument()
    expect(screen.getByText('Open Project 1')).toBeInTheDocument()
    expect(screen.getByText('Some Note')).toBeInTheDocument()
    expect(screen.queryByText('Archived Project')).not.toBeInTheDocument()
  })

  it('shows the correct counts for a type filter', () => {
    renderNoteList({ entries: projectEntries, selection: { kind: 'sectionGroup', type: 'Project' } })
    const openPill = screen.getByTestId('filter-pill-open')
    const archivedPill = screen.getByTestId('filter-pill-archived')

    expect(openPill).toHaveTextContent('Open')
    expect(openPill).toHaveTextContent('2')
    expect(archivedPill).toHaveTextContent('Archived')
    expect(archivedPill).toHaveTextContent('1')
  })

  it('calls onNoteListFilterChange when a filter pill is clicked', () => {
    const onNoteListFilterChange = vi.fn()
    renderNoteList({
      entries: projectEntries,
      selection: { kind: 'sectionGroup', type: 'Project' },
      onNoteListFilterChange,
    })

    fireEvent.click(screen.getByTestId('filter-pill-archived'))
    expect(onNoteListFilterChange).toHaveBeenCalledWith('archived')
  })

  it('shows archived notes when the type filter switches to archived', () => {
    renderNoteList({
      entries: projectEntries,
      selection: { kind: 'sectionGroup', type: 'Project' },
      noteListFilter: 'archived',
    })

    expect(screen.getByText('Archived Project')).toBeInTheDocument()
    expect(screen.queryByText('Open Project 1')).not.toBeInTheDocument()
  })

  it('shows only explicit Note entries for the Notes type filter', () => {
    const noteEntries = [
      makeEntry({ title: 'Note Type', isA: 'Type', path: '/types/note.md', filename: 'note.md' }),
      makeEntry({ title: 'Explicit Note', isA: 'Note', path: '/explicit-note.md', filename: 'explicit-note.md' }),
      makeEntry({ title: 'Untyped Note', isA: null, path: '/untyped-note.md', filename: 'untyped-note.md' }),
      makeEntry({ title: 'Archived Explicit Note', isA: 'Note', archived: true, path: '/archived-note.md', filename: 'archived-note.md' }),
    ]

    renderNoteList({ entries: noteEntries, selection: { kind: 'sectionGroup', type: 'Note' } })

    expect(screen.getByText('Explicit Note')).toBeInTheDocument()
    expect(screen.queryByText('Untyped Note')).not.toBeInTheDocument()
    expect(screen.queryByText('Archived Explicit Note')).not.toBeInTheDocument()
    expect(screen.getByTestId('filter-pill-open')).toHaveTextContent('1')
    expect(screen.getByTestId('filter-pill-archived')).toHaveTextContent('1')
  })

  it('shows the archived empty state when a section has no archived notes', () => {
    renderNoteList({
      entries: projectEntries.filter((entry) => !entry.archived),
      selection: { kind: 'sectionGroup', type: 'Project' },
      noteListFilter: 'archived',
    })

    expect(screen.getByText('No archived notes')).toBeInTheDocument()
  })
})
