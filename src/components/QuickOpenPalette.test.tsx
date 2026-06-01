import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QuickOpenPalette } from './QuickOpenPalette'
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
  owner: null,
  cadence: null,
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
  template: null, sort: null,
  outgoingLinks: [],
  ...overrides,
})

const entries: VaultEntry[] = [
  makeEntry({ path: '/vault/note/alpha.md', title: 'Alpha Project', isA: 'Project', modifiedAt: 1700000003 }),
  makeEntry({ path: '/vault/note/beta.md', title: 'Beta Notes', isA: 'Note', modifiedAt: 1700000002 }),
  makeEntry({ path: '/vault/note/gamma.md', title: 'Gamma Experiment', isA: 'Experiment', modifiedAt: 1700000001 }),
]

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

describe('QuickOpenPalette', () => {
  const onSelect = vi.fn()
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <QuickOpenPalette open={false} entries={entries} onSelect={onSelect} onClose={onClose} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows search input when open', () => {
    render(<QuickOpenPalette open={true} entries={entries} onSelect={onSelect} onClose={onClose} />)
    expect(screen.getByPlaceholderText('Search notes...')).toBeInTheDocument()
  })

  it('shows entries sorted by most recently modified when no query', () => {
    render(<QuickOpenPalette open={true} entries={entries} onSelect={onSelect} onClose={onClose} />)
    const items = screen.getAllByText(/Alpha|Beta|Gamma/)
    expect(items[0].textContent).toBe('Alpha Project')
    expect(items[1].textContent).toBe('Beta Notes')
  })

  it('filters entries by fuzzy search', () => {
    render(<QuickOpenPalette open={true} entries={entries} onSelect={onSelect} onClose={onClose} />)
    const input = screen.getByPlaceholderText('Search notes...')
    fireEvent.change(input, { target: { value: 'alpha' } })

    expect(screen.getByText('Alpha Project')).toBeInTheDocument()
    expect(screen.queryByText('Beta Notes')).not.toBeInTheDocument()
  })

  it('shows "No matching notes" when query has no results', () => {
    render(<QuickOpenPalette open={true} entries={entries} onSelect={onSelect} onClose={onClose} />)
    const input = screen.getByPlaceholderText('Search notes...')
    fireEvent.change(input, { target: { value: 'zzzzzzz' } })

    expect(screen.getByText('No matching notes')).toBeInTheDocument()
  })

  it('creates a note from an unmatched query when pressing Enter', async () => {
    const onCreateNote = vi.fn()
    render(
      <QuickOpenPalette
        open={true}
        entries={entries}
        onSelect={onSelect}
        onCreateNote={onCreateNote}
        onClose={onClose}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText('Search notes...'), { target: { value: 'New Research Brief' } })

    expect(screen.getByText('Create note "New Research Brief"')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter' })

    await waitFor(() => {
      expect(onCreateNote).toHaveBeenCalledWith('New Research Brief')
    })
    expect(onSelect).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('keeps the palette open when unmatched note creation is rejected', async () => {
    const onCreateNote = vi.fn().mockResolvedValue(false)
    render(
      <QuickOpenPalette
        open={true}
        entries={entries}
        onSelect={onSelect}
        onCreateNote={onCreateNote}
        onClose={onClose}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText('Search notes...'), { target: { value: 'Externally Created Note' } })
    fireEvent.keyDown(window, { key: 'Enter' })

    await waitFor(() => {
      expect(onCreateNote).toHaveBeenCalledWith('Externally Created Note')
    })
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows type badge for entries with isA', () => {
    render(<QuickOpenPalette open={true} entries={entries} onSelect={onSelect} onClose={onClose} />)
    expect(screen.getByText('Project')).toBeInTheDocument()
    expect(screen.getByText('Experiment')).toBeInTheDocument()
  })

  it('calls onSelect and onClose when clicking an entry', () => {
    render(<QuickOpenPalette open={true} entries={entries} onSelect={onSelect} onClose={onClose} />)
    fireEvent.click(screen.getByText('Beta Notes'))

    expect(onSelect).toHaveBeenCalledWith(entries[1])
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when pressing Escape', () => {
    render(<QuickOpenPalette open={true} entries={entries} onSelect={onSelect} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('navigates with arrow keys and selects with Enter', () => {
    render(<QuickOpenPalette open={true} entries={entries} onSelect={onSelect} onClose={onClose} />)

    // Move down one
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    // Select with Enter
    fireEvent.keyDown(window, { key: 'Enter' })

    // Should select the second entry (index 1)
    expect(onSelect).toHaveBeenCalledWith(entries[1])
    expect(onClose).toHaveBeenCalled()
  })

  it('does not go below the last item with ArrowDown', () => {
    render(<QuickOpenPalette open={true} entries={entries} onSelect={onSelect} onClose={onClose} />)

    // Press down many times
    for (let i = 0; i < 10; i++) {
      fireEvent.keyDown(window, { key: 'ArrowDown' })
    }
    fireEvent.keyDown(window, { key: 'Enter' })

    // Should select last entry
    expect(onSelect).toHaveBeenCalledWith(entries[2])
  })

  it('does not go above first item with ArrowUp', () => {
    render(<QuickOpenPalette open={true} entries={entries} onSelect={onSelect} onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'ArrowUp' })
    fireEvent.keyDown(window, { key: 'Enter' })

    // Should still select first entry
    expect(onSelect).toHaveBeenCalledWith(entries[0])
  })

  it('calls onClose when clicking the backdrop', () => {
    render(<QuickOpenPalette open={true} entries={entries} onSelect={onSelect} onClose={onClose} />)

    // Click the backdrop (outermost div)
    const backdrop = screen.getByPlaceholderText('Search notes...').closest('.fixed')!
    fireEvent.click(backdrop)

    expect(onClose).toHaveBeenCalled()
  })
})
