import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, createEvent } from '@testing-library/react'
import { NoteSearchList } from './NoteSearchList'
import type { NoteSearchResultItem } from './NoteSearchList'

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

interface TestItem extends NoteSearchResultItem {
  id: string
}

const items: TestItem[] = [
  { id: '1', title: 'Alpha Project', noteType: 'Project', typeColor: 'var(--accent-blue)', typeLightColor: 'var(--accent-blue-light)' },
  { id: '2', title: 'Beta Notes' },
  { id: '3', title: 'Gamma Experiment', noteType: 'Experiment' },
]

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

describe('NoteSearchList', () => {
  const onItemClick = vi.fn()
  const onItemHover = vi.fn()

  const renderList = ({
    listItems = items,
    selectedIndex = 0,
    getItemKey = (item: TestItem) => item.id,
    itemClick = onItemClick,
    itemHover,
    activateOnMouseDown,
    emptyMessage,
  }: {
    listItems?: TestItem[]
    selectedIndex?: number
    getItemKey?: (item: TestItem, index: number) => string
    itemClick?: (item: TestItem, index: number) => void
    itemHover?: (index: number) => void
    activateOnMouseDown?: boolean
    emptyMessage?: string
  } = {}) => render(
    <NoteSearchList
      items={listItems}
      selectedIndex={selectedIndex}
      getItemKey={getItemKey}
      onItemClick={itemClick}
      onItemHover={itemHover}
      activateOnMouseDown={activateOnMouseDown}
      emptyMessage={emptyMessage}
    />,
  )

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all items with titles', () => {
    render(
      <NoteSearchList
        items={items}
        selectedIndex={0}
        getItemKey={(item) => item.id}
        onItemClick={onItemClick}
      />,
    )
    expect(screen.getByText('Alpha Project')).toBeInTheDocument()
    expect(screen.getByText('Beta Notes')).toBeInTheDocument()
    expect(screen.getByText('Gamma Experiment')).toBeInTheDocument()
  })

  it('shows type badge when noteType is present', () => {
    render(
      <NoteSearchList
        items={items}
        selectedIndex={0}
        getItemKey={(item) => item.id}
        onItemClick={onItemClick}
      />,
    )
    expect(screen.getByText('Project')).toBeInTheDocument()
    expect(screen.getByText('Experiment')).toBeInTheDocument()
  })

  it('does not show type badge when noteType is absent', () => {
    render(
      <NoteSearchList
        items={[{ id: '2', title: 'Beta Notes' }]}
        selectedIndex={0}
        getItemKey={(item: TestItem) => item.id}
        onItemClick={onItemClick}
      />,
    )
    expect(screen.getByText('Beta Notes')).toBeInTheDocument()
    // No badge element should exist
    expect(screen.queryByText('Note')).not.toBeInTheDocument()
  })

  it('applies typeColor and typeLightColor to badge when provided', () => {
    render(
      <NoteSearchList
        items={[items[0]]}
        selectedIndex={0}
        getItemKey={(item) => item.id}
        onItemClick={onItemClick}
      />,
    )
    const badge = screen.getByText('Project')
    expect(badge.style.color).toBe('var(--accent-blue)')
    expect(badge.style.backgroundColor).toBe('var(--accent-blue-light)')
  })

  it('shows workspace initials at the far right when workspace metadata is present', () => {
    render(
      <NoteSearchList
        items={[{ ...items[0], workspace: teamWorkspace }]}
        selectedIndex={0}
        getItemKey={(item) => item.id}
        onItemClick={onItemClick}
      />,
    )

    const typeBadge = screen.getByText('Project')
    const workspaceBadge = screen.getByTestId('note-search-workspace-badge')
    const row = workspaceBadge.closest('div')!
    expect(workspaceBadge).toHaveTextContent('TE')
    expect(typeBadge.compareDocumentPosition(workspaceBadge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(row).toContainElement(workspaceBadge)
    expect(workspaceBadge.getAttribute('style')).toContain('border-color: var(--accent-green)')
  })

  it('shows empty message when no items', () => {
    renderList({ listItems: [], getItemKey: () => '', emptyMessage: 'No matching notes' })
    expect(screen.getByText('No matching notes')).toBeInTheDocument()
  })

  it('shows default empty message', () => {
    renderList({ listItems: [], getItemKey: () => '' })
    expect(screen.getByText('No results')).toBeInTheDocument()
  })

  it('calls onItemClick when an item is clicked', () => {
    renderList()
    fireEvent.click(screen.getByText('Beta Notes'))
    expect(onItemClick).toHaveBeenCalledWith(items[1], 1)
  })

  it('can activate an item on mouse down for transient popovers', () => {
    render(
      <NoteSearchList
        items={items}
        selectedIndex={0}
        getItemKey={(item) => item.id}
        onItemClick={onItemClick}
        activateOnMouseDown
      />,
    )

    fireEvent.mouseDown(screen.getByText('Beta Notes'))
    fireEvent.click(screen.getByText('Beta Notes'))

    expect(onItemClick).toHaveBeenCalledTimes(1)
    expect(onItemClick).toHaveBeenCalledWith(items[1], 1)
  })

  it('keeps focus on the current editor/input while clicking an item', () => {
    render(
      <NoteSearchList
        items={items}
        selectedIndex={0}
        getItemKey={(item) => item.id}
        onItemClick={onItemClick}
      />,
    )
    const mouseDown = createEvent.mouseDown(screen.getByText('Beta Notes'))
    const preventDefault = vi.spyOn(mouseDown, 'preventDefault')

    fireEvent(screen.getByText('Beta Notes'), mouseDown)

    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('does not call onItemHover for mouse enter alone', () => {
    renderList({ itemHover: onItemHover })
    fireEvent.mouseEnter(screen.getByText('Gamma Experiment'))
    expect(onItemHover).not.toHaveBeenCalled()
  })

  it('calls onItemHover when the mouse actually moves over an item', () => {
    renderList({ itemHover: onItemHover })
    fireEvent.mouseMove(screen.getByText('Gamma Experiment'), { clientX: 10, clientY: 10 })
    fireEvent.mouseMove(screen.getByText('Gamma Experiment'), { clientX: 10, clientY: 11 })
    expect(onItemHover).toHaveBeenCalledWith(2)
  })

  it('does not call onItemHover for a zero-delta mousemove after a keyboard-opened list appears', () => {
    renderList({ itemHover: onItemHover })

    fireEvent.mouseMove(screen.getByText('Gamma Experiment'), {
      clientX: 10,
      clientY: 10,
      screenX: 10,
      screenY: 10,
    })

    expect(onItemHover).not.toHaveBeenCalled()
  })

  it('highlights selected item with accent background', () => {
    render(
      <NoteSearchList
        items={items}
        selectedIndex={1}
        getItemKey={(item) => item.id}
        onItemClick={onItemClick}
      />,
    )
    const selectedItem = screen.getByText('Beta Notes').closest('div')!
    expect(selectedItem.className).toContain('bg-accent')

    const unselectedItem = screen.getByText('Alpha Project').closest('div')!
    expect(unselectedItem.className).not.toContain('bg-accent')
  })

  it('calls scrollIntoView on the selected item', () => {
    const scrollMock = vi.fn()
    Element.prototype.scrollIntoView = scrollMock

    const { rerender } = render(
      <NoteSearchList
        items={items}
        selectedIndex={0}
        getItemKey={(item) => item.id}
        onItemClick={onItemClick}
      />,
    )

    scrollMock.mockClear()

    rerender(
      <NoteSearchList
        items={items}
        selectedIndex={2}
        getItemKey={(item) => item.id}
        onItemClick={onItemClick}
      />,
    )

    expect(scrollMock).toHaveBeenCalledWith({ block: 'nearest' })
  })
})
