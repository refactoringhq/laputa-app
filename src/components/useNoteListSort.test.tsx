import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NoteList } from './NoteList'
import { APP_STORAGE_KEYS, LEGACY_APP_STORAGE_KEYS } from '../constants/appStorage'
import type { VaultEntry, SidebarSelection } from '../types'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    path: '/test/note.md', filename: 'note.md', title: 'Test Note',
    isA: 'Note', aliases: [], belongsTo: [], relatedTo: [],
    status: null, owner: null, cadence: null, archived: false,
    modifiedAt: 1700000000,
    createdAt: null, fileSize: 100, snippet: '', wordCount: 0,
    relationships: {}, icon: null, color: null, order: null,
    sidebarLabel: null, template: null, sort: null,
    outgoingLinks: [], properties: {},
    ...overrides,
  }
}

const noop = vi.fn()

function storeListSort(option: string, direction: 'asc' | 'desc') {
  localStorageMock.setItem(APP_STORAGE_KEYS.sortPreferences, JSON.stringify({ '__list__': { option, direction } }))
}

function renderWithPrioritySort(entries: VaultEntry[]) {
  storeListSort('property:priority', 'asc')
  renderNoteList({ entries, selection: { kind: 'filter', filter: 'all' } })
}

function expectVisibleNoteOrder(expectedTitles: string[]) {
  const items = screen.getAllByText(new RegExp(expectedTitles.join('|')))
  expect(items.map((item) => item.textContent)).toEqual(expectedTitles)
}

function renderNoteList(props: {
  entries: VaultEntry[]
  selection: SidebarSelection
  onUpdateTypeSort?: (path: string, key: string, value: string | number | boolean | string[] | null) => void
  updateEntry?: (path: string, patch: Partial<VaultEntry>) => void
}) {
  return render(
    <NoteList
      entries={props.entries}
      selection={props.selection}
      selectedNote={null}
      onSelectNote={noop}
      onReplaceActiveTab={noop}
      onCreateNote={noop}
      onUpdateTypeSort={props.onUpdateTypeSort}
      updateEntry={props.updateEntry}
    />,
  )
}

beforeEach(() => { localStorageMock.clear() })

describe('useNoteListSort (via NoteList)', () => {
  it('renders notes sorted by modified date by default', () => {
    const entries = [
      makeEntry({ path: '/a.md', title: 'Alpha', modifiedAt: 1000 }),
      makeEntry({ path: '/b.md', title: 'Beta', modifiedAt: 3000 }),
      makeEntry({ path: '/c.md', title: 'Charlie', modifiedAt: 2000 }),
    ]
    renderNoteList({ entries, selection: { kind: 'filter', filter: 'all' } })
    const items = screen.getAllByText(/Alpha|Beta|Charlie/)
    expect(items[0].textContent).toBe('Beta')
    expect(items[1].textContent).toBe('Charlie')
    expect(items[2].textContent).toBe('Alpha')
  })

  it('reads sort from type document for sectionGroup selection', () => {
    const typeDoc = makeEntry({ path: '/note.md', title: 'Note', isA: 'Type', sort: 'title:asc' })
    const entries = [
      typeDoc,
      makeEntry({ path: '/c.md', title: 'Charlie', modifiedAt: 3000 }),
      makeEntry({ path: '/a.md', title: 'Alpha', modifiedAt: 1000 }),
      makeEntry({ path: '/b.md', title: 'Beta', modifiedAt: 2000 }),
    ]
    renderNoteList({ entries, selection: { kind: 'sectionGroup', type: 'Note', label: 'Notes' } })
    const items = screen.getAllByText(/Alpha|Beta|Charlie/)
    expect(items[0].textContent).toBe('Alpha')
    expect(items[1].textContent).toBe('Beta')
    expect(items[2].textContent).toBe('Charlie')
  })

  it('shows type title as header for sectionGroup selection', () => {
    const typeDoc = makeEntry({ path: '/project.md', title: 'Project', isA: 'Type' })
    renderNoteList({ entries: [typeDoc], selection: { kind: 'sectionGroup', type: 'Project', label: 'Projects' } })
    expect(screen.getByText('Project')).toBeInTheDocument()
  })

  it('migrates localStorage sort to type frontmatter when type has no sort', () => {
    storeListSort('title', 'asc')
    const onUpdateTypeSort = vi.fn()
    const updateEntry = vi.fn()
    const typeDoc = makeEntry({ path: '/project.md', title: 'Project', isA: 'Type', sort: null })
    const entries = [typeDoc, makeEntry()]

    renderNoteList({
      entries,
      selection: { kind: 'sectionGroup', type: 'Project', label: 'Projects' },
      onUpdateTypeSort,
      updateEntry,
    })

    expect(onUpdateTypeSort).toHaveBeenCalledWith('/project.md', 'sort', 'title:asc')
    expect(updateEntry).toHaveBeenCalledWith('/project.md', { sort: 'title:asc' })
  })

  it('does not migrate if type already has sort', () => {
    storeListSort('title', 'asc')
    const onUpdateTypeSort = vi.fn()
    const updateEntry = vi.fn()
    const typeDoc = makeEntry({ path: '/project.md', title: 'Project', isA: 'Type', sort: 'modified:desc' })
    const entries = [typeDoc, makeEntry()]

    renderNoteList({
      entries,
      selection: { kind: 'sectionGroup', type: 'Project', label: 'Projects' },
      onUpdateTypeSort,
      updateEntry,
    })

    expect(onUpdateTypeSort).not.toHaveBeenCalled()
  })

  it('keeps property sort safe when entries are missing the property', () => {
    renderWithPrioritySort([
      makeEntry({ path: '/a.md', title: 'Alpha', modifiedAt: 1000, properties: {} }),
      makeEntry({ path: '/b.md', title: 'Beta', modifiedAt: 3000, properties: {} }),
    ])
    expectVisibleNoteOrder(['Alpha', 'Beta'])
    expect(screen.getByTestId('sort-button-__list__')).toHaveTextContent('priority')
  })

  it('uses property sort when property exists in entries', () => {
    renderWithPrioritySort([
      makeEntry({ path: '/b.md', title: 'Beta', modifiedAt: 3000, properties: { priority: 2 } }),
      makeEntry({ path: '/a.md', title: 'Alpha', modifiedAt: 1000, properties: { priority: 1 } }),
    ])
    expectVisibleNoteOrder(['Alpha', 'Beta'])
  })

  it('reads legacy list sort preferences when Tolaria key is absent', () => {
    localStorageMock.setItem(LEGACY_APP_STORAGE_KEYS.sortPreferences, JSON.stringify({ '__list__': { option: 'title', direction: 'asc' } }))
    const entries = [
      makeEntry({ path: '/c.md', title: 'Charlie', modifiedAt: 3000 }),
      makeEntry({ path: '/a.md', title: 'Alpha', modifiedAt: 1000 }),
    ]

    renderNoteList({ entries, selection: { kind: 'filter', filter: 'all' } })
    const items = screen.getAllByText(/Alpha|Charlie/)
    expect(items[0].textContent).toBe('Alpha')
    expect(items[1].textContent).toBe('Charlie')
  })
})
