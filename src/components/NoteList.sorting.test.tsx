import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NoteList } from './NoteList'
import { APP_STORAGE_KEYS, LEGACY_APP_STORAGE_KEYS } from '../constants/appStorage'
import { getSortComparator } from '../utils/noteListHelpers'
import { buildNoteListProps, makeEntry, mockEntries, renderNoteList } from '../test-utils/noteListTestUtils'
import type { ViewFile } from '../types'

describe('getSortComparator', () => {
  it('sorts by modified date descending', () => {
    const entries = [
      makeEntry({ title: 'A', modifiedAt: 1000 }),
      makeEntry({ title: 'B', modifiedAt: 3000 }),
      makeEntry({ title: 'C', modifiedAt: 2000 }),
    ]

    expect(entries.sort(getSortComparator('modified')).map((entry) => entry.title)).toEqual(['B', 'C', 'A'])
  })

  it('sorts by created date descending', () => {
    const entries = [
      makeEntry({ title: 'A', createdAt: 3000, modifiedAt: 1000 }),
      makeEntry({ title: 'B', createdAt: 1000, modifiedAt: 3000 }),
      makeEntry({ title: 'C', createdAt: 2000, modifiedAt: 2000 }),
    ]

    expect(entries.sort(getSortComparator('created')).map((entry) => entry.title)).toEqual(['A', 'C', 'B'])
  })

  it('falls back to modifiedAt when createdAt is null', () => {
    const entries = [
      makeEntry({ title: 'A', createdAt: null, modifiedAt: 5000 }),
      makeEntry({ title: 'B', createdAt: 2000, modifiedAt: 1000 }),
    ]

    expect(entries.sort(getSortComparator('created')).map((entry) => entry.title)).toEqual(['A', 'B'])
  })

  it('sorts by title alphabetically', () => {
    const entries = [
      makeEntry({ title: 'Zebra' }),
      makeEntry({ title: 'Alpha' }),
      makeEntry({ title: 'Middle' }),
    ]

    expect(entries.sort(getSortComparator('title')).map((entry) => entry.title)).toEqual(['Alpha', 'Middle', 'Zebra'])
  })

  it('sorts by status with the expected priority', () => {
    const entries = [
      makeEntry({ title: 'Done', status: 'Done', modifiedAt: 1000 }),
      makeEntry({ title: 'Active', status: 'Active', modifiedAt: 1000 }),
      makeEntry({ title: 'NoStatus', status: null, modifiedAt: 1000 }),
      makeEntry({ title: 'Paused', status: 'Paused', modifiedAt: 1000 }),
    ]

    expect(entries.sort(getSortComparator('status')).map((entry) => entry.title)).toEqual(['Active', 'Paused', 'Done', 'NoStatus'])
  })

  it('uses modifiedAt as the status tiebreaker', () => {
    const entries = [
      makeEntry({ title: 'OlderActive', status: 'Active', modifiedAt: 1000 }),
      makeEntry({ title: 'NewerActive', status: 'Active', modifiedAt: 3000 }),
    ]

    expect(entries.sort(getSortComparator('status')).map((entry) => entry.title)).toEqual(['NewerActive', 'OlderActive'])
  })

  it('supports ascending modified sorting', () => {
    const entries = [
      makeEntry({ title: 'A', modifiedAt: 1000 }),
      makeEntry({ title: 'B', modifiedAt: 3000 }),
      makeEntry({ title: 'C', modifiedAt: 2000 }),
    ]

    expect(entries.sort(getSortComparator('modified', 'asc')).map((entry) => entry.title)).toEqual(['A', 'C', 'B'])
  })

  it('supports descending title sorting', () => {
    const entries = [
      makeEntry({ title: 'Zebra' }),
      makeEntry({ title: 'Alpha' }),
      makeEntry({ title: 'Middle' }),
    ]

    expect(entries.sort(getSortComparator('title', 'desc')).map((entry) => entry.title)).toEqual(['Zebra', 'Middle', 'Alpha'])
  })

  it('supports ascending created sorting', () => {
    const entries = [
      makeEntry({ title: 'A', createdAt: 3000, modifiedAt: 1000 }),
      makeEntry({ title: 'B', createdAt: 1000, modifiedAt: 3000 }),
      makeEntry({ title: 'C', createdAt: 2000, modifiedAt: 2000 }),
    ]

    expect(entries.sort(getSortComparator('created', 'asc')).map((entry) => entry.title)).toEqual(['B', 'C', 'A'])
  })

  it('supports descending status sorting', () => {
    const entries = [
      makeEntry({ title: 'Done', status: 'Done', modifiedAt: 1000 }),
      makeEntry({ title: 'Active', status: 'Active', modifiedAt: 1000 }),
      makeEntry({ title: 'NoStatus', status: null, modifiedAt: 1000 }),
    ]

    expect(entries.sort(getSortComparator('status', 'desc')).map((entry) => entry.title)).toEqual(['NoStatus', 'Done', 'Active'])
  })
})

describe('NoteList sort controls', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem(APP_STORAGE_KEYS.sortPreferences)
      localStorage.removeItem(LEGACY_APP_STORAGE_KEYS.sortPreferences)
    } catch {
      // ignore storage failures in tests
    }
  })

  const zamEntries = [
    makeEntry({ path: '/a.md', title: 'Zebra', modifiedAt: 3000 }),
    makeEntry({ path: '/b.md', title: 'Alpha', modifiedAt: 1000 }),
    makeEntry({ path: '/c.md', title: 'Middle', modifiedAt: 2000 }),
  ]

  function makeView(overrides: Partial<ViewFile> = {}): ViewFile {
    return {
      filename: 'rated-books.yml',
      definition: {
        name: 'Rated Books',
        icon: null,
        color: null,
        sort: null,
        filters: { all: [{ field: 'type', op: 'equals', value: 'Book' }] },
        ...overrides.definition,
      },
      ...overrides,
    }
  }

  function renderManagedViewSort(entries: typeof zamEntries, view = makeView()) {
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

  function openListSortMenu(entries = mockEntries) {
    renderNoteList({ entries })
    fireEvent.click(screen.getByTestId('sort-button-__list__'))
  }

  it('shows the sort button in flat list view', () => {
    renderNoteList()
    expect(screen.getByTestId('sort-button-__list__')).toBeInTheDocument()
  })

  it('shows a per-group sort button in entity view', () => {
    renderNoteList({ selection: { kind: 'entity', entry: mockEntries[0] } })
    expect(screen.getByTestId('sort-button-Children')).toBeInTheDocument()
  })

  it('opens the sort menu and lists all built-in options', () => {
    openListSortMenu()
    expect(screen.getByTestId('sort-menu-__list__')).toBeInTheDocument()
    expect(screen.getByTestId('sort-option-modified')).toBeInTheDocument()
    expect(screen.getByTestId('sort-option-created')).toBeInTheDocument()
    expect(screen.getByTestId('sort-option-title')).toBeInTheDocument()
    expect(screen.getByTestId('sort-option-status')).toBeInTheDocument()
  })

  it('keeps the sort menu in a viewport-clamped fixed layer', () => {
    renderNoteList()
    const trigger = screen.getByTestId('sort-button-__list__')
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 20,
      top: 20,
      right: 44,
      bottom: 40,
      left: 0,
      width: 44,
      height: 20,
      toJSON: () => ({}),
    })

    fireEvent.click(trigger)

    const menu = screen.getByTestId('sort-menu-__list__')
    expect(menu).toHaveClass('fixed')
    expect(menu).toHaveStyle({ left: '8px', top: '44px' })
  })

  it('changes list order when a different sort option is selected', () => {
    openListSortMenu(zamEntries)

    let titles = screen.getAllByText(/Zebra|Alpha|Middle/).map((element) => element.textContent)
    expect(titles).toEqual(['Zebra', 'Middle', 'Alpha'])

    fireEvent.click(screen.getByTestId('sort-option-title'))

    titles = screen.getAllByText(/Zebra|Alpha|Middle/).map((element) => element.textContent)
    expect(titles).toEqual(['Alpha', 'Middle', 'Zebra'])
  })

  it('closes the sort menu after choosing an option', () => {
    openListSortMenu()
    fireEvent.click(screen.getByTestId('sort-option-title'))
    expect(screen.queryByTestId('sort-menu-__list__')).not.toBeInTheDocument()
  })

  it('shows direction arrows for every sort option', () => {
    openListSortMenu()
    expect(screen.getByTestId('sort-dir-asc-modified')).toBeInTheDocument()
    expect(screen.getByTestId('sort-dir-desc-modified')).toBeInTheDocument()
    expect(screen.getByTestId('sort-dir-asc-title')).toBeInTheDocument()
    expect(screen.getByTestId('sort-dir-desc-title')).toBeInTheDocument()
  })

  it('reverses list order when a direction arrow is chosen', () => {
    openListSortMenu(zamEntries)

    let titles = screen.getAllByText(/Zebra|Alpha|Middle/).map((element) => element.textContent)
    expect(titles).toEqual(['Zebra', 'Middle', 'Alpha'])

    fireEvent.click(screen.getByTestId('sort-dir-asc-modified'))

    titles = screen.getAllByText(/Zebra|Alpha|Middle/).map((element) => element.textContent)
    expect(titles).toEqual(['Alpha', 'Middle', 'Zebra'])
  })

  it('persists the chosen direction', () => {
    const entries = [
      makeEntry({ path: '/a.md', title: 'Zebra', modifiedAt: 3000 }),
      makeEntry({ path: '/b.md', title: 'Alpha', modifiedAt: 1000 }),
    ]

    renderNoteList({ entries })
    fireEvent.click(screen.getByTestId('sort-button-__list__'))
    fireEvent.click(screen.getByTestId('sort-dir-desc-title'))

    const titles = screen.getAllByText(/Zebra|Alpha/).map((element) => element.textContent)
    expect(titles).toEqual(['Zebra', 'Alpha'])
  })

  it('keeps the sort direction icon in sync with the active sort', () => {
    renderNoteList()
    expect(screen.getByTestId('sort-direction-icon-__list__')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('sort-button-__list__'))
    fireEvent.click(screen.getByTestId('sort-option-title'))

    expect(screen.getByTestId('sort-direction-icon-__list__')).toBeInTheDocument()
  })

  it('sorts entity relationship groups independently', () => {
    const parent = makeEntry({
      path: '/parent.md',
      filename: 'parent.md',
      title: 'Parent',
      isA: 'Project',
    })
    const child1 = makeEntry({
      path: '/child1.md',
      filename: 'child1.md',
      title: 'Zebra Note',
      belongsTo: ['[[parent]]'],
      modifiedAt: 3000,
    })
    const child2 = makeEntry({
      path: '/child2.md',
      filename: 'child2.md',
      title: 'Alpha Note',
      belongsTo: ['[[parent]]'],
      modifiedAt: 1000,
    })

    renderNoteList({
      entries: [parent, child1, child2],
      selection: { kind: 'entity', entry: parent },
    })

    let titles = screen.getAllByText(/Zebra Note|Alpha Note/).map((element) => element.textContent)
    expect(titles).toEqual(['Zebra Note', 'Alpha Note'])

    fireEvent.click(screen.getByTestId('sort-button-Children'))
    fireEvent.click(screen.getByTestId('sort-option-title'))

    titles = screen.getAllByText(/Zebra Note|Alpha Note/).map((element) => element.textContent)
    expect(titles).toEqual(['Alpha Note', 'Zebra Note'])
  })

  it('shows custom properties after a separator in the sort menu', () => {
    const entries = [
      makeEntry({ path: '/a.md', title: 'A', properties: { Priority: 'High', Rating: 5 } }),
      makeEntry({ path: '/b.md', title: 'B', properties: { Priority: 'Low', Company: 'Acme' } }),
    ]

    renderNoteList({ entries })
    fireEvent.click(screen.getByTestId('sort-button-__list__'))

    expect(screen.getByTestId('sort-separator')).toBeInTheDocument()
    expect(screen.getByTestId('sort-option-property:Company')).toBeInTheDocument()
    expect(screen.getByTestId('sort-option-property:Priority')).toBeInTheDocument()
    expect(screen.getByTestId('sort-option-property:Rating')).toBeInTheDocument()
  })

  it('omits the custom-property separator when no properties exist', () => {
    renderNoteList()
    fireEvent.click(screen.getByTestId('sort-button-__list__'))
    expect(screen.queryByTestId('sort-separator')).not.toBeInTheDocument()
  })

  it('sorts entries by a custom property', () => {
    const entries = [
      makeEntry({ path: '/a.md', title: 'A', modifiedAt: 3000, properties: { Rating: 3 } }),
      makeEntry({ path: '/b.md', title: 'B', modifiedAt: 2000, properties: { Rating: 1 } }),
      makeEntry({ path: '/c.md', title: 'C', modifiedAt: 1000, properties: { Rating: 5 } }),
    ]

    renderNoteList({ entries })
    fireEvent.click(screen.getByTestId('sort-button-__list__'))
    fireEvent.click(screen.getByTestId('sort-option-property:Rating'))

    const titles = screen.getAllByText(/^[ABC]$/).map((element) => element.textContent)
    expect(titles).toEqual(['B', 'A', 'C'])
  })

  it('pushes entries without a custom property to the end', () => {
    const entries = [
      makeEntry({ path: '/a.md', title: 'A', modifiedAt: 3000, properties: { Priority: 'High' } }),
      makeEntry({ path: '/b.md', title: 'B', modifiedAt: 2000, properties: {} }),
      makeEntry({ path: '/c.md', title: 'C', modifiedAt: 1000, properties: { Priority: 'Low' } }),
    ]

    renderNoteList({ entries })
    fireEvent.click(screen.getByTestId('sort-button-__list__'))
    fireEvent.click(screen.getByTestId('sort-option-property:Priority'))

    const titles = screen.getAllByText(/^[ABC]$/).map((element) => element.textContent)
    expect(titles).toEqual(['A', 'C', 'B'])
  })

  it('loads view sort properties from the current view results only', () => {
    const entries = [
      makeEntry({ path: '/book-a.md', title: 'Book A', isA: 'Book', properties: { Rating: 3 } }),
      makeEntry({ path: '/book-b.md', title: 'Book B', isA: 'Book', properties: { Priority: 'High' } }),
      makeEntry({ path: '/project-a.md', title: 'Project A', isA: 'Project', properties: { Owner: 'Luca' } }),
    ]

    renderManagedViewSort(entries)
    fireEvent.click(screen.getByTestId('sort-button-__list__'))

    expect(screen.getByTestId('sort-option-property:Priority')).toBeInTheDocument()
    expect(screen.getByTestId('sort-option-property:Rating')).toBeInTheDocument()
    expect(screen.queryByTestId('sort-option-property:Owner')).not.toBeInTheDocument()
  })

  it('supports keyboard selection for view sorting and persists the chosen property', () => {
    const entries = [
      makeEntry({ path: '/book-a.md', title: 'Book A', isA: 'Book', modifiedAt: 1000, properties: { Rating: 3 } }),
      makeEntry({ path: '/book-b.md', title: 'Book B', isA: 'Book', modifiedAt: 3000, properties: { Rating: 1 } }),
      makeEntry({ path: '/book-c.md', title: 'Book C', isA: 'Book', modifiedAt: 2000, properties: { Rating: 5 } }),
    ]

    renderManagedViewSort(entries)
    fireEvent.click(screen.getByTestId('sort-button-__list__'))
    fireEvent.keyDown(screen.getByTestId('sort-menu-__list__'), { key: 'End' })
    expect(screen.getByTestId('sort-option-property:Rating')).toHaveFocus()

    fireEvent.keyDown(screen.getByTestId('sort-option-property:Rating'), { key: 'Enter' })

    const titles = screen.getAllByText(/^Book [ABC]$/).map((element) => element.textContent)
    expect(titles).toEqual(['Book B', 'Book A', 'Book C'])
    expect(screen.queryByTestId('sort-menu-__list__')).not.toBeInTheDocument()
  })
})
