import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NoteList } from './NoteList'
import { openNoteListPropertiesPicker } from './note-list/noteListPropertiesEvents'
import { AppPreferencesProvider } from '../hooks/useAppPreferences'
import {
  allSelection,
  buildNoteListProps,
  makeEntry,
  makeTypeDefinition,
  mockEntries,
  renderNoteList,
} from '../test-utils/noteListTestUtils'
import type { ViewFile } from '../types'

function makeBookTypeEntries(
  displayProps: string[] = [],
  entryOverrides: Parameters<typeof makeEntry>[0] = {},
) {
  return [
    makeTypeDefinition('Book', displayProps),
    makeEntry({
      path: '/vault/book.md',
      filename: 'book.md',
      title: 'Book Note',
      isA: 'Book',
      createdAt: 1700000000,
      ...entryOverrides,
    }),
  ]
}

const noop = () => undefined

function makeViewDefinition(overrides: Partial<ViewFile> = {}): ViewFile {
  return {
    filename: 'active-books.yml',
    definition: {
      name: 'Active Books',
      icon: null,
      color: null,
      sort: null,
      filters: { all: [{ field: 'type', op: 'equals', value: 'Book' }] },
      ...overrides.definition,
    },
    ...overrides,
  }
}

function renderManagedViewNoteList({
  entries,
  view = makeViewDefinition(),
}: {
  entries: Parameters<typeof renderNoteList>[0]['entries']
  view?: ViewFile
}) {
  const built = buildNoteListProps({
    entries,
    selection: { kind: 'view', filename: view.filename },
    views: [view],
  })

  function ManagedViewNoteList() {
    const [views, setViews] = useState([view])

    return (
      <NoteList
        {...built.props}
        views={views}
        onUpdateViewDefinition={(filename, patch) => {
          setViews((currentViews) => currentViews.map((currentView) => (
            currentView.filename === filename
              ? { ...currentView, definition: { ...currentView.definition, ...patch } }
              : currentView
          )))
        }}
      />
    )
  }

  return {
    ...render(<ManagedViewNoteList />),
    ...built,
  }
}

async function searchNoteList(query: string) {
  const searchInput = screen.queryByPlaceholderText('Search notes...')
  if (!searchInput) fireEvent.click(screen.getByTitle('Search notes'))
  fireEvent.change(screen.getByPlaceholderText('Search notes...'), { target: { value: query } })
  await waitFor(() => {
    expect(screen.getByTestId('note-list-search-loading')).toBeInTheDocument()
  })
  await waitFor(() => {
    expect(screen.queryByTestId('note-list-search-loading')).not.toBeInTheDocument()
  })
}

function renderBookNoteList({
  displayProps = ['Priority'],
  entryOverrides = {},
  selection = allSelection,
  allNotesNoteListProperties,
  onUpdateAllNotesNoteListProperties = noop,
  inboxNoteListProperties,
  onUpdateInboxNoteListProperties = noop,
}: {
  displayProps?: string[]
  entryOverrides?: Parameters<typeof makeEntry>[0]
  selection?: Parameters<typeof renderNoteList>[0]['selection']
  allNotesNoteListProperties?: string[] | null
  onUpdateAllNotesNoteListProperties?: () => void
  inboxNoteListProperties?: string[] | null
  onUpdateInboxNoteListProperties?: () => void
} = {}) {
  return renderNoteList({
    entries: makeBookTypeEntries(displayProps, entryOverrides),
    selection,
    allNotesNoteListProperties,
    onUpdateAllNotesNoteListProperties,
    inboxNoteListProperties,
    onUpdateInboxNoteListProperties,
  })
}

async function expectOnlySearchMatch(title: string, matchingQuery: string, hiddenQuery: string) {
  await searchNoteList(matchingQuery)
  expect(screen.getByText(title)).toBeInTheDocument()

  await searchNoteList(hiddenQuery)
  expect(screen.queryByText(title)).not.toBeInTheDocument()
  expect(screen.getByText('No matching notes')).toBeInTheDocument()
}

describe('NoteList rendering', () => {
  it('shows an empty state when there are no entries', () => {
    renderNoteList({ entries: [] })
    expect(screen.getByText('No notes found')).toBeInTheDocument()
  })

  it('renders all entries in the all-notes view', () => {
    renderNoteList()
    expect(screen.getByText('Build Laputa App')).toBeInTheDocument()
    expect(screen.getByText('Facebook Ads Strategy')).toBeInTheDocument()
    expect(screen.getByText('Matteo Cellini')).toBeInTheDocument()
  })

  it('filters section groups by type', () => {
    renderNoteList({ selection: { kind: 'sectionGroup', type: 'Person' } })
    expect(screen.getByText('Matteo Cellini')).toBeInTheDocument()
    expect(screen.queryByText('Build Laputa App')).not.toBeInTheDocument()
  })

  it('supports event sections', () => {
    renderNoteList({ selection: { kind: 'sectionGroup', type: 'Event' } })
    expect(screen.getByText('Kickoff Meeting')).toBeInTheDocument()
    expect(screen.queryByText('Build Laputa App')).not.toBeInTheDocument()
  })

  it('supports project sections', () => {
    renderNoteList({ selection: { kind: 'sectionGroup', type: 'Project' } })
    expect(screen.getByText('Build Laputa App')).toBeInTheDocument()
    expect(screen.queryByText('Matteo Cellini')).not.toBeInTheDocument()
  })

  it('passes the selected type when creating a note from a type section', () => {
    const { onCreateNote } = renderNoteList({ selection: { kind: 'sectionGroup', type: 'Project' } })
    fireEvent.click(screen.getByTitle('Create new note'))
    expect(onCreateNote).toHaveBeenCalledWith('Project')
  })

  it('creates an untyped note from all notes', () => {
    const { onCreateNote } = renderNoteList()
    fireEvent.click(screen.getByTitle('Create new note'))
    expect(onCreateNote).toHaveBeenCalledWith(undefined)
  })

  it('pins the current entity and shows grouped children', () => {
    renderNoteList({ selection: { kind: 'entity', entry: mockEntries[0] } })
    expect(screen.getAllByText('Build Laputa App').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Facebook Ads Strategy')).toBeInTheDocument()
    expect(screen.queryByText('Matteo Cellini')).not.toBeInTheDocument()
    expect(screen.getByText('Children')).toBeInTheDocument()
    expect(screen.getByText('Related to')).toBeInTheDocument()
  })

  it('shows referenced-by groups for topic entities', () => {
    renderNoteList({ selection: { kind: 'entity', entry: mockEntries[4] } })
    expect(screen.getByText('Build Laputa App')).toBeInTheDocument()
    expect(screen.getByText('Referenced by')).toBeInTheDocument()
  })

  it('toggles the search input from the header action', () => {
    renderNoteList()
    expect(screen.queryByPlaceholderText('Search notes...')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Search notes'))
    expect(screen.getByPlaceholderText('Search notes...')).toBeInTheDocument()
  })

  it('filters by a case-insensitive search query', async () => {
    renderNoteList()
    await searchNoteList('facebook')
    expect(screen.getByText('Facebook Ads Strategy')).toBeInTheDocument()
    expect(screen.queryByText('Build Laputa App')).not.toBeInTheDocument()
  })

  it('filters by snippet text when the title does not match', async () => {
    renderNoteList({
      entries: [
        makeEntry({ path: '/vault/a.md', filename: 'a.md', title: 'Alpha Note', snippet: 'Routine body copy.' }),
        makeEntry({ path: '/vault/b.md', filename: 'b.md', title: 'Beta Note', snippet: 'Nebula-only snippet token.' }),
      ],
    })

    await searchNoteList('nebula-only')

    expect(screen.getByText('Beta Note')).toBeInTheDocument()
    expect(screen.queryByText('Alpha Note')).not.toBeInTheDocument()
  })

  it('filters by visible property values and ignores hidden properties', async () => {
    renderBookNoteList({
      entryOverrides: {
        title: 'Property Search Note',
        properties: { Priority: 'Boarding Window', Owner: 'Hidden Owner Value' },
      },
      allNotesNoteListProperties: null,
    })

    await expectOnlySearchMatch('Property Search Note', 'boarding window', 'hidden owner value')
  })

  it('uses the active all-notes columns when filtering by visible property values', async () => {
    renderBookNoteList({
      entryOverrides: {
        title: 'Override Search Note',
        properties: { Priority: 'Hidden Priority', Owner: 'Visible Owner Value' },
      },
      allNotesNoteListProperties: ['Owner'],
    })

    await expectOnlySearchMatch('Override Search Note', 'visible owner value', 'hidden priority')
  })

  it('sorts entries by last modified descending by default', () => {
    renderNoteList({
      entries: [
        { ...mockEntries[0], modifiedAt: 1000, title: 'Oldest' },
        { ...mockEntries[1], modifiedAt: 3000, title: 'Newest', path: '/p2' },
        { ...mockEntries[2], modifiedAt: 2000, title: 'Middle', path: '/p3' },
      ],
    })

    const titles = screen.getAllByText(/Oldest|Newest|Middle/).map((element) => element.textContent)
    expect(titles).toEqual(['Newest', 'Middle', 'Oldest'])
  })

  it('hides standalone status badges inside note rows', () => {
    renderNoteList()
    expect(screen.queryByText('Active')).not.toBeInTheDocument()
  })

  it('shows search and create actions in the header instead of a count badge', () => {
    renderNoteList()
    expect(screen.getByTitle('Search notes')).toBeInTheDocument()
    expect(screen.getByTitle('Create new note')).toBeInTheDocument()
  })

  it('uses breadcrumbs-like button styling for note-list header actions', () => {
    renderBookNoteList({
      entryOverrides: { properties: { Priority: 'High' } },
      selection: { kind: 'filter', filter: 'inbox' },
      inboxNoteListProperties: null,
    })

    const buttons = [
      screen.getByTitle('Search notes'),
      screen.getByTitle('Customize Inbox columns'),
      screen.getByTitle('Create new note'),
    ]

    for (const button of buttons) {
      expect(button).toHaveAttribute('data-variant', 'ghost')
      expect(button).toHaveClass(
        '!h-auto',
        '!w-auto',
        '!min-w-0',
        '!rounded-none',
        '!p-0',
        '!text-muted-foreground',
        'hover:!bg-transparent',
        'hover:!text-foreground',
      )
      expect(button).not.toHaveAttribute('tabindex', '-1')
    }
  })

  it('keeps the note-list search input full width and shows only an inline spinner while loading', () => {
    vi.useFakeTimers()
    try {
      renderNoteList({
        entries: [
          makeEntry({ path: '/vault/a.md', filename: 'a.md', title: 'Alpha Strategy' }),
          makeEntry({ path: '/vault/b.md', filename: 'b.md', title: 'Beta Note' }),
        ],
      })

      fireEvent.click(screen.getByTitle('Search notes'))
      fireEvent.change(screen.getByPlaceholderText('Search notes...'), { target: { value: 'strategy' } })

      const searchInput = screen.getByPlaceholderText('Search notes...')
      expect(searchInput).toHaveClass('pr-8')
      expect(searchInput.parentElement).toHaveClass('relative', 'flex-1')
      expect(screen.getByTestId('note-list-search-loading')).toBeInTheDocument()
      expect(screen.queryByText('Searching...')).not.toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(180)
      })

      expect(screen.queryByTestId('note-list-search-loading')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows backlinks from outgoing links in entity view', () => {
    const entriesWithBacklink = mockEntries.map((entry) =>
      entry.path === mockEntries[2].path ? { ...entry, outgoingLinks: ['Build Laputa App'] } : entry,
    )

    renderNoteList({
      entries: entriesWithBacklink,
      selection: { kind: 'entity', entry: mockEntries[0] },
    })

    expect(screen.getByText('Backlinks')).toBeInTheDocument()
    expect(screen.getByText('Matteo Cellini')).toBeInTheDocument()
  })

  it('shows no placeholder neighborhood groups when none exist', () => {
    const standalone = makeEntry({
      path: '/vault/solo.md',
      filename: 'solo.md',
      title: 'Standalone',
      isA: 'Note',
    })

    renderNoteList({
      entries: [standalone],
      selection: { kind: 'entity', entry: standalone },
    })

    expect(screen.queryByRole('button', { name: /Children/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Events/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Referenced by/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Backlinks/i })).not.toBeInTheDocument()
  })

  it('keeps existing neighborhood groups visible at zero after search filters them out', async () => {
    const parent = makeEntry({
      path: '/vault/parent.md',
      filename: 'parent.md',
      title: 'Parent',
      isA: 'Project',
    })
    const child = makeEntry({
      path: '/vault/child.md',
      filename: 'child.md',
      title: 'Child Note',
      isA: 'Note',
      belongsTo: ['[[parent]]'],
    })

    renderNoteList({
      entries: [parent, child],
      selection: { kind: 'entity', entry: parent },
    })

    expect(screen.getByRole('button', { name: /Children\s*1/i })).toBeInTheDocument()

    await searchNoteList('missing-neighborhood-match')

    expect(screen.getByRole('button', { name: /Children\s*0/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Events/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Referenced by/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Backlinks/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Child Note')).not.toBeInTheDocument()
  })

  it('shows the same note in multiple neighborhood groups when relationships overlap', () => {
    const parent = makeEntry({
      path: '/vault/parent.md',
      filename: 'parent.md',
      title: 'Parent',
      isA: 'Project',
      relationships: { 'Related to': ['[[shared-note]]'] },
    })
    const shared = makeEntry({
      path: '/vault/shared-note.md',
      filename: 'shared-note.md',
      title: 'Shared Note',
      isA: 'Note',
      relatedTo: ['[[parent]]'],
    })

    renderNoteList({
      entries: [parent, shared],
      selection: { kind: 'entity', entry: parent },
    })

    expect(screen.getByText('Related to')).toBeInTheDocument()
    expect(screen.getByText('Referenced by')).toBeInTheDocument()
    expect(screen.getAllByText('Shared Note')).toHaveLength(2)
  })

  it('shows all real inverse relationship groups for custom relationship keys', () => {
    const parent = makeEntry({
      path: '/vault/parent.md',
      filename: 'parent.md',
      title: 'Parent',
      isA: 'Project',
    })
    const topicNote = makeEntry({
      path: '/vault/topic-note.md',
      filename: 'topic-note.md',
      title: 'Topic Note',
      isA: 'Note',
      relationships: { Topics: ['[[parent]]'] },
    })
    const mentorNote = makeEntry({
      path: '/vault/mentor-note.md',
      filename: 'mentor-note.md',
      title: 'Mentor Note',
      isA: 'Note',
      relationships: { Mentors: ['[[parent]]'] },
    })
    const hostEvent = makeEntry({
      path: '/vault/host-event.md',
      filename: 'host-event.md',
      title: 'Host Event',
      isA: 'Event',
      relationships: { Hosts: ['[[parent]]'] },
    })

    renderNoteList({
      entries: [parent, topicNote, mentorNote, hostEvent],
      selection: { kind: 'entity', entry: parent },
    })

    expect(screen.getByText('← Topics')).toBeInTheDocument()
    expect(screen.getByText('← Mentors')).toBeInTheDocument()
    expect(screen.getByText('← Hosts')).toBeInTheDocument()
    expect(screen.getByText('Topic Note')).toBeInTheDocument()
    expect(screen.getByText('Mentor Note')).toBeInTheDocument()
    expect(screen.getByText('Host Event')).toBeInTheDocument()
  })

  it('collapses and expands entity groups', () => {
    renderNoteList({ selection: { kind: 'entity', entry: mockEntries[0] } })
    expect(screen.getByText('Facebook Ads Strategy')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Children'))
    expect(screen.queryByText('Facebook Ads Strategy')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Children'))
    expect(screen.getByText('Facebook Ads Strategy')).toBeInTheDocument()
  })

  it('shows the pinned neighborhood note using the standard row content', () => {
    renderNoteList({ selection: { kind: 'entity', entry: mockEntries[0] } })
    expect(screen.getByText('Build a personal knowledge management app.')).toBeInTheDocument()
  })

  it('shows the inbox customize-columns action and falls back to type-defined chips', () => {
    renderBookNoteList({
      entryOverrides: { properties: { Priority: 'High', Owner: 'Luca' } },
      selection: { kind: 'filter', filter: 'inbox' },
      inboxNoteListProperties: null,
    })

    expect(screen.getByTitle('Customize Inbox columns')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.queryByText('Luca')).not.toBeInTheDocument()
  })

  it('shows the all-notes customize-columns action and falls back to type-defined chips', () => {
    renderBookNoteList({
      entryOverrides: { properties: { Priority: 'High', Owner: 'Luca' } },
      allNotesNoteListProperties: null,
    })

    expect(screen.getByTitle('Customize All Notes columns')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.queryByText('Luca')).not.toBeInTheDocument()
  })

  it('opens the all-notes column picker as a searchable combobox and saves new columns', async () => {
    const onUpdateAllNotesNoteListProperties = vi.fn()
    const archivedOwnerEntry = makeEntry({
      path: '/vault/book-archive.md',
      filename: 'book-archive.md',
      title: 'Archived Book',
      isA: 'Book',
      archived: true,
      properties: { Owner: 'Luca' },
    })

    renderNoteList({
      entries: [
        ...makeBookTypeEntries(['Priority'], { properties: { Priority: 'High' } }),
        archivedOwnerEntry,
      ],
      selection: allSelection,
      allNotesNoteListProperties: null,
      onUpdateAllNotesNoteListProperties,
    })

    act(() => {
      openNoteListPropertiesPicker('all')
    })

    expect(screen.getByTestId('list-properties-popover')).toBeInTheDocument()
    expect(screen.getByTestId('list-properties-popover')).toHaveClass('overflow-hidden')
    expect(screen.getByTestId('list-properties-scroll-area')).toBeInTheDocument()
    expect(screen.getByTestId('list-properties-scroll-area')).toHaveClass('overflow-y-auto')
    expect(screen.getByRole('checkbox', { name: 'Priority' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Owner' })).toBeInTheDocument()

    const combobox = screen.getByRole('combobox', { name: 'Search note-list properties' })
    await waitFor(() => expect(combobox).toHaveFocus())

    fireEvent.change(combobox, { target: { value: 'Owner' } })
    expect(screen.getByRole('checkbox', { name: 'Owner' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Priority' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Owner' }))
    expect(onUpdateAllNotesNoteListProperties).toHaveBeenCalledWith(['Priority', 'Owner'])

    fireEvent.keyDown(combobox, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('list-properties-popover')).not.toBeInTheDocument())
  })

  it('opens the inbox column picker from the global event and saves new columns', () => {
    const onUpdateInboxNoteListProperties = vi.fn()

    renderNoteList({
      entries: makeBookTypeEntries(['Priority'], { properties: { Priority: 'High', Owner: 'Luca' } }),
      selection: { kind: 'filter', filter: 'inbox' },
      inboxNoteListProperties: null,
      onUpdateInboxNoteListProperties,
    })

    act(() => {
      openNoteListPropertiesPicker('inbox')
    })

    expect(screen.getByTestId('list-properties-popover')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Search note-list properties' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Priority' })).toBeChecked()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Owner' }))
    expect(onUpdateInboxNoteListProperties).toHaveBeenCalledWith(['Priority', 'Owner'])
  })

  it('opens the view column picker from the global event and applies the saved columns', () => {
    renderManagedViewNoteList({
      entries: makeBookTypeEntries(['Priority'], { properties: { Priority: 'High', Owner: 'Luca' } }),
    })

    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.queryByText('Luca')).not.toBeInTheDocument()

    act(() => {
      openNoteListPropertiesPicker('view')
    })

    expect(screen.getByTestId('list-properties-popover')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Owner' }))

    expect(screen.getByText('Luca')).toBeInTheDocument()
  })

  it('shows an empty-state picker for views with no matching properties', () => {
    renderManagedViewNoteList({
      entries: makeBookTypeEntries(),
      view: makeViewDefinition({
        filename: 'empty-view.yml',
        definition: {
          name: 'Empty View',
          filters: { all: [{ field: 'type', op: 'equals', value: 'Project' }] },
        },
      }),
    })

    act(() => {
      openNoteListPropertiesPicker('view')
    })

    expect(screen.getByTestId('list-properties-popover')).toBeInTheDocument()
    expect(screen.getByText('No properties match this search.')).toBeInTheDocument()
  })

  it('shows status in the type column picker when at least one note has it set', () => {
    renderNoteList({
      entries: makeBookTypeEntries([], { status: 'Active' }),
      selection: { kind: 'sectionGroup', type: 'Book' },
      onUpdateTypeSort: () => undefined,
    })

    act(() => {
      openNoteListPropertiesPicker('type')
    })

    expect(screen.getByTestId('list-properties-popover')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Search note-list properties' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'status' })).toBeInTheDocument()
  })

  it('keeps blank statuses out of the type column picker', () => {
    renderNoteList({
      entries: makeBookTypeEntries([], { status: '', properties: { Owner: 'Luca' } }),
      selection: { kind: 'sectionGroup', type: 'Book' },
      onUpdateTypeSort: () => undefined,
    })

    act(() => {
      openNoteListPropertiesPicker('type')
    })

    expect(screen.getByTestId('list-properties-popover')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Owner' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'status' })).not.toBeInTheDocument()
  })

  it('renders status as a note-list chip when a type displays it', () => {
    renderNoteList({
      entries: makeBookTypeEntries(['status'], { status: 'Active' }),
      selection: { kind: 'sectionGroup', type: 'Book' },
    })

    const chip = screen.getByTestId('property-chip-status-0')
    expect(chip).toHaveTextContent('• Active')
    expect(chip).toHaveStyle({ backgroundColor: 'var(--accent-green-light)', color: 'var(--accent-green)' })
  })

  it('auto-detects status-like property values in note-list chips', () => {
    renderNoteList({
      entries: makeBookTypeEntries(['Phase'], { properties: { Phase: 'Draft' } }),
      selection: { kind: 'sectionGroup', type: 'Book' },
    })

    const chip = screen.getByTestId('property-chip-phase-0')
    expect(chip).toHaveTextContent('• Draft')
    expect(chip).toHaveStyle({ backgroundColor: 'var(--accent-yellow-light)', color: 'var(--accent-yellow)' })
  })

  it('formats date properties in note-list chips with the selected display format', async () => {
    const built = buildNoteListProps({
      entries: makeBookTypeEntries(['Due'], { properties: { Due: '2026-05-11' } }),
      selection: { kind: 'sectionGroup', type: 'Book' },
    })
    render(
      <AppPreferencesProvider dateDisplayFormat="european">
        <NoteList {...built.props} />
      </AppPreferencesProvider>,
    )

    expect(screen.getByTestId('property-chip-due-0')).toHaveTextContent('11/5/2026')

    await searchNoteList('11/5/2026')
    expect(screen.getByText('Book Note')).toBeInTheDocument()
  })

  it('keeps unknown status values on neutral note-list chip styling', () => {
    renderNoteList({
      entries: makeBookTypeEntries(['status'], { status: 'Needs Review' }),
      selection: { kind: 'sectionGroup', type: 'Book' },
    })

    const chip = screen.getByTestId('property-chip-status-0')
    expect(chip).toHaveTextContent('• Needs Review')
    expect(chip.getAttribute('style')).toBeNull()
  })

  it('uses inbox overrides when configured', () => {
    renderNoteList({
      entries: makeBookTypeEntries(['Priority'], { properties: { Priority: 'High', Owner: 'Luca' } }),
      selection: { kind: 'filter', filter: 'inbox' },
      inboxNoteListProperties: ['Owner'],
      onUpdateInboxNoteListProperties: () => undefined,
    })

    expect(screen.getByText('Luca')).toBeInTheDocument()
    expect(screen.queryByText('High')).not.toBeInTheDocument()
  })

  it('Cmd+clicks relationship chips through the note list without triggering the row click', async () => {
    const projectType = makeTypeDefinition('Project')
    const taskType = makeTypeDefinition('Task', ['Belongs to'])
    const projectEntry = makeEntry({
      path: '/vault/project/build-app.md',
      filename: 'build-app.md',
      title: 'Build App',
      isA: 'Project',
      createdAt: 1700000000,
    })
    const taskEntry = makeEntry({
      path: '/vault/task/write-tests.md',
      filename: 'write-tests.md',
      title: 'Write tests',
      isA: 'Task',
      relationships: { 'Belongs to': ['[[project/build-app]]'] },
      createdAt: 1700000001,
    })

    const { onReplaceActiveTab, onEnterNeighborhood } = renderNoteList({
      entries: [projectType, taskType, projectEntry, taskEntry],
      selection: { kind: 'sectionGroup', type: 'Task' },
    })

    const chip = screen.getByTestId('property-chip-belongs-to-0')

    fireEvent.click(chip)
    expect(onReplaceActiveTab).not.toHaveBeenCalled()
    expect(onEnterNeighborhood).not.toHaveBeenCalled()

    fireEvent.click(chip, { metaKey: true })
    await waitFor(() => {
      expect(onReplaceActiveTab).toHaveBeenCalledWith(projectEntry)
      expect(onEnterNeighborhood).toHaveBeenCalledWith(projectEntry)
    })
  })
})

describe('NoteList click behavior', () => {
  it('opens the current tab on a regular click', () => {
    const { onReplaceActiveTab, onEnterNeighborhood } = renderNoteList()
    fireEvent.click(screen.getByText('Build Laputa App'))
    expect(onReplaceActiveTab).toHaveBeenCalledWith(mockEntries[0])
    expect(onEnterNeighborhood).not.toHaveBeenCalled()
  })

  it('enters Neighborhood on Cmd+Click', async () => {
    const { onReplaceActiveTab, onEnterNeighborhood } = renderNoteList()
    fireEvent.click(screen.getByText('Build Laputa App'), { metaKey: true })
    await waitFor(() => {
      expect(onReplaceActiveTab).toHaveBeenCalledWith(mockEntries[0])
      expect(onEnterNeighborhood).toHaveBeenCalledWith(mockEntries[0])
    })
  })

  it('enters Neighborhood on Ctrl+Click', async () => {
    const { onReplaceActiveTab, onEnterNeighborhood } = renderNoteList()
    fireEvent.click(screen.getByText('Build Laputa App'), { ctrlKey: true })
    await waitFor(() => {
      expect(onReplaceActiveTab).toHaveBeenCalledWith(mockEntries[0])
      expect(onEnterNeighborhood).toHaveBeenCalledWith(mockEntries[0])
    })
  })

  it('supports Cmd+Click on the entity pinned card', async () => {
    const { onReplaceActiveTab, onEnterNeighborhood } = renderNoteList({ selection: { kind: 'entity', entry: mockEntries[0] } })
    const titles = screen.getAllByText('Build Laputa App')
    fireEvent.click(titles[titles.length - 1], { metaKey: true })
    await waitFor(() => {
      expect(onReplaceActiveTab).toHaveBeenCalledWith(mockEntries[0])
      expect(onEnterNeighborhood).toHaveBeenCalledWith(mockEntries[0])
    })
  })

  it('opens the current tab from the entity pinned card on regular click', () => {
    const { onReplaceActiveTab, onEnterNeighborhood } = renderNoteList({ selection: { kind: 'entity', entry: mockEntries[0] } })
    const titles = screen.getAllByText('Build Laputa App')
    fireEvent.click(titles[titles.length - 1])
    expect(onReplaceActiveTab).toHaveBeenCalledWith(mockEntries[0])
    expect(onEnterNeighborhood).not.toHaveBeenCalled()
  })

  it('opens child notes from entity view in the current tab', () => {
    const { onReplaceActiveTab, onEnterNeighborhood } = renderNoteList({ selection: { kind: 'entity', entry: mockEntries[0] } })
    fireEvent.click(screen.getByText('Facebook Ads Strategy'))
    expect(onReplaceActiveTab).toHaveBeenCalledWith(mockEntries[1])
    expect(onEnterNeighborhood).not.toHaveBeenCalled()
  })
})

describe('NoteList type sections', () => {
  const typeEntry = {
    ...makeEntry({
      path: '/Users/luca/Laputa/types/project.md',
      filename: 'project.md',
      title: 'Project',
      isA: 'Type',
      snippet: 'Defines the Project type.',
      modifiedAt: 1700000000,
      fileSize: 200,
      wordCount: 50,
    }),
  }
  const entriesWithType = [...mockEntries, typeEntry]

  it('does not show a type note pinned card while browsing the section', () => {
    renderNoteList({
      entries: entriesWithType,
      selection: { kind: 'sectionGroup', type: 'Project' },
    })

    expect(screen.queryByText('Defines the Project type.')).not.toBeInTheDocument()
    expect(screen.getByText('Build Laputa App')).toBeInTheDocument()
  })

  it('renders a clickable type header that opens the type note', () => {
    const { onReplaceActiveTab } = renderNoteList({
      entries: entriesWithType,
      selection: { kind: 'sectionGroup', type: 'Project' },
    })

    const headerLink = screen.getByTestId('type-header-link')
    expect(headerLink).toHaveTextContent('Project')
    fireEvent.click(headerLink)
    expect(onReplaceActiveTab).toHaveBeenCalledWith(typeEntry)
  })

  it('does not render a type header outside type sections', () => {
    renderNoteList({ entries: entriesWithType, selection: allSelection })
    expect(screen.queryByTestId('type-header-link')).not.toBeInTheDocument()
  })
})

describe('NoteList traffic-light padding', () => {
  it('adds left padding when the sidebar is collapsed', () => {
    const { container } = renderNoteList({ sidebarCollapsed: true })
    const header = container.querySelector('.h-\\[52px\\]') as HTMLElement
    expect(header.style.paddingLeft).toBe('80px')
  })

  it('does not add extra left padding when the sidebar is expanded', () => {
    const { container } = renderNoteList({ sidebarCollapsed: false })
    const header = container.querySelector('.h-\\[52px\\]') as HTMLElement
    expect(header.style.paddingLeft).toBe('')
  })

  it('defaults to no extra padding when sidebarCollapsed is omitted', () => {
    const { container } = renderNoteList()
    const header = container.querySelector('.h-\\[52px\\]') as HTMLElement
    expect(header.style.paddingLeft).toBe('')
  })
})
