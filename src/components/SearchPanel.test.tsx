import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SearchPanel } from './SearchPanel'
import type { VaultEntry } from '../types'

// Mock the mock-tauri module (component uses mockInvoke when isTauri() is false)
vi.mock('../mock-tauri', () => ({
  mockInvoke: vi.fn(),
  isTauri: () => false,
}))

import { mockInvoke } from '../mock-tauri'
const mockInvokeFn = vi.mocked(mockInvoke)

const NOW = Math.floor(Date.now() / 1000)

const MOCK_ENTRIES: VaultEntry[] = [
  {
    path: '/vault/essay/ai-apis.md',
    filename: 'ai-apis.md',
    title: 'How to Design AI-first APIs',
    isA: 'Essay',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    owner: null,
    cadence: null,
    archived: false,
    modifiedAt: NOW - 7200,
    createdAt: NOW - 86400 * 30,
    fileSize: 500,
    snippet: 'A guide to designing APIs for AI',
    wordCount: 1247,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    template: null, sort: null,
    outgoingLinks: ['topic/ai', 'topic/api-design', 'person/luca'],
    properties: {},
  },
  {
    path: '/vault/event/retreat.md',
    filename: 'retreat.md',
    title: 'Refactoring Retreat',
    isA: 'Event',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    owner: null,
    cadence: null,
    archived: false,
    modifiedAt: NOW - 86400 * 5,
    createdAt: NOW - 86400 * 5,
    fileSize: 300,
    snippet: 'Team retreat event',
    wordCount: 856,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    template: null, sort: null,
    outgoingLinks: ['person/bob'],
    properties: {},
  },
]

describe('SearchPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <SearchPanel open={false} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders search input when open', () => {
    render(
      <SearchPanel open={true} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )
    expect(screen.getByPlaceholderText('Search in all notes...')).toBeInTheDocument()
  })

  it('shows empty state hint when no query', () => {
    render(
      <SearchPanel open={true} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )
    expect(screen.getByText('Search across all note contents')).toBeInTheDocument()
    expect(screen.getByText('Enter to open · Esc to close')).toBeInTheDocument()
  })

  it('has no keyword/semantic toggle', () => {
    render(
      <SearchPanel open={true} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )
    expect(screen.queryByText('Keyword')).not.toBeInTheDocument()
    expect(screen.queryByText('Semantic')).not.toBeInTheDocument()
  })

  it('calls onClose when clicking overlay', () => {
    const onClose = vi.fn()
    render(
      <SearchPanel open={true} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={onClose} />,
    )
    const overlay = screen.getByPlaceholderText('Search in all notes...').closest('.fixed')!
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn()
    render(
      <SearchPanel open={true} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={onClose} />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('performs keyword search', async () => {
    mockInvokeFn.mockResolvedValue({
      results: [
        { title: 'How to Design AI-first APIs', path: '/vault/essay/ai-apis.md', snippet: '...designing APIs for AI...', score: 0.87, note_type: 'Essay' },
      ],
      elapsed_ms: 48,
    })

    render(
      <SearchPanel open={true} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )

    const input = screen.getByPlaceholderText('Search in all notes...')
    fireEvent.change(input, { target: { value: 'api design' } })

    await waitFor(() => {
      expect(mockInvokeFn).toHaveBeenCalledWith('search_vault', {
        vaultPath: '/vault',
        query: 'api design',
        mode: 'keyword',
        limit: 20,
      })
    })

    await waitFor(() => {
      expect(screen.getByText('How to Design AI-first APIs')).toBeInTheDocument()
    })
  })

  it('shows note title from VaultEntry instead of filename from search result', async () => {
    mockInvokeFn.mockResolvedValue({
      results: [
        { title: 'ai-apis', path: '/vault/essay/ai-apis.md', snippet: '...designing APIs...', score: 0.87, note_type: null },
      ],
      elapsed_ms: 12,
    })

    render(
      <SearchPanel open={true} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )

    const input = screen.getByPlaceholderText('Search in all notes...')
    fireEvent.change(input, { target: { value: 'api' } })

    await waitFor(() => {
      // Should show VaultEntry title, not filename-based search result title
      expect(screen.getByText('How to Design AI-first APIs')).toBeInTheDocument()
      expect(screen.queryByText('ai-apis')).not.toBeInTheDocument()
    })
  })

  it('shows no results message when search returns empty', async () => {
    mockInvokeFn.mockResolvedValue({ results: [], elapsed_ms: 10 })

    render(
      <SearchPanel open={true} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )

    const input = screen.getByPlaceholderText('Search in all notes...')
    fireEvent.change(input, { target: { value: 'xyznonexistent' } })

    await waitFor(() => {
      expect(screen.getByText('No results found')).toBeInTheDocument()
    })
  })

  it('navigates results with arrow keys', async () => {
    mockInvokeFn.mockResolvedValue({
      results: [
        { title: 'Result One', path: '/vault/essay/ai-apis.md', snippet: 'First result', score: 0.9, note_type: null },
        { title: 'Result Two', path: '/vault/event/retreat.md', snippet: 'Second result', score: 0.8, note_type: null },
      ],
      elapsed_ms: 20,
    })

    render(
      <SearchPanel open={true} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )

    const input = screen.getByPlaceholderText('Search in all notes...')
    fireEvent.change(input, { target: { value: 'test' } })

    await waitFor(() => {
      expect(screen.getByText('How to Design AI-first APIs')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.keyDown(input, { key: 'ArrowDown' })
    })

    await waitFor(() => {
      const resultTwo = screen.getByText('Refactoring Retreat').closest('[class*="cursor-pointer"]')!
      expect(resultTwo.className).toContain('bg-accent')
    })
  })

  it('moves down one result when ArrowDown is pressed in the input', async () => {
    const entries: VaultEntry[] = [
      ...MOCK_ENTRIES,
      {
        ...MOCK_ENTRIES[0],
        path: '/vault/topic/search.md',
        filename: 'search.md',
        title: 'Search Patterns',
      },
    ]
    mockInvokeFn.mockResolvedValue({
      results: [
        { title: 'Result One', path: '/vault/essay/ai-apis.md', snippet: 'First result', score: 0.9, note_type: null },
        { title: 'Result Two', path: '/vault/event/retreat.md', snippet: 'Second result', score: 0.8, note_type: null },
        { title: 'Result Three', path: '/vault/topic/search.md', snippet: 'Third result', score: 0.7, note_type: null },
      ],
      elapsed_ms: 20,
    })

    render(
      <SearchPanel open={true} vaultPath="/vault" entries={entries} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )

    const input = screen.getByPlaceholderText('Search in all notes...')
    fireEvent.change(input, { target: { value: 'test' } })

    await waitFor(() => {
      expect(screen.getByText('Search Patterns')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.keyDown(input, { key: 'ArrowDown' })
    })

    await waitFor(() => {
      const resultTwo = screen.getByText('Refactoring Retreat').closest('[class*="cursor-pointer"]')!
      const resultThree = screen.getByText('Search Patterns').closest('[class*="cursor-pointer"]')!
      expect(resultTwo.className).toContain('bg-accent')
      expect(resultThree.className).not.toContain('bg-accent')
    })
  })

  it('ignores duplicate native ArrowDown keydown events for one press', async () => {
    const entries: VaultEntry[] = [
      ...MOCK_ENTRIES,
      {
        ...MOCK_ENTRIES[0],
        path: '/vault/topic/search.md',
        filename: 'search.md',
        title: 'Search Patterns',
      },
    ]
    mockInvokeFn.mockResolvedValue({
      results: [
        { title: 'Result One', path: '/vault/essay/ai-apis.md', snippet: 'First result', score: 0.9, note_type: null },
        { title: 'Result Two', path: '/vault/event/retreat.md', snippet: 'Second result', score: 0.8, note_type: null },
        { title: 'Result Three', path: '/vault/topic/search.md', snippet: 'Third result', score: 0.7, note_type: null },
      ],
      elapsed_ms: 20,
    })

    render(
      <SearchPanel open={true} vaultPath="/vault" entries={entries} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )

    const input = screen.getByPlaceholderText('Search in all notes...')
    fireEvent.change(input, { target: { value: 'test' } })

    await waitFor(() => {
      expect(screen.getByText('Search Patterns')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      fireEvent.keyDown(input, { key: 'ArrowDown' })
    })

    await waitFor(() => {
      const resultTwo = screen.getByText('Refactoring Retreat').closest('[class*="cursor-pointer"]')!
      const resultThree = screen.getByText('Search Patterns').closest('[class*="cursor-pointer"]')!
      expect(resultTwo.className).toContain('bg-accent')
      expect(resultThree.className).not.toContain('bg-accent')
    })
  })

  it('allows a second ArrowDown press immediately after keyup', async () => {
    const entries: VaultEntry[] = [
      ...MOCK_ENTRIES,
      {
        ...MOCK_ENTRIES[0],
        path: '/vault/topic/search.md',
        filename: 'search.md',
        title: 'Search Patterns',
      },
    ]
    mockInvokeFn.mockResolvedValue({
      results: [
        { title: 'Result One', path: '/vault/essay/ai-apis.md', snippet: 'First result', score: 0.9, note_type: null },
        { title: 'Result Two', path: '/vault/event/retreat.md', snippet: 'Second result', score: 0.8, note_type: null },
        { title: 'Result Three', path: '/vault/topic/search.md', snippet: 'Third result', score: 0.7, note_type: null },
      ],
      elapsed_ms: 20,
    })

    render(
      <SearchPanel open={true} vaultPath="/vault" entries={entries} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )

    const input = screen.getByPlaceholderText('Search in all notes...')
    fireEvent.change(input, { target: { value: 'test' } })

    await waitFor(() => {
      expect(screen.getByText('Search Patterns')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      fireEvent.keyUp(input, { key: 'ArrowDown' })
      fireEvent.keyDown(input, { key: 'ArrowDown' })
    })

    await waitFor(() => {
      expect(screen.getByText('Search Patterns').closest('[class*="cursor-pointer"]')!.className).toContain('bg-accent')
    })
  })

  it('selects result on Enter and calls onSelectNote', async () => {
    mockInvokeFn.mockResolvedValue({
      results: [
        { title: 'How to Design AI-first APIs', path: '/vault/essay/ai-apis.md', snippet: 'First', score: 0.9, note_type: null },
      ],
      elapsed_ms: 20,
    })

    const onSelectNote = vi.fn()
    const onClose = vi.fn()
    render(
      <SearchPanel open={true} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={onSelectNote} onClose={onClose} />,
    )

    const input = screen.getByPlaceholderText('Search in all notes...')
    fireEvent.change(input, { target: { value: 'api' } })

    await waitFor(() => {
      expect(screen.getByText('How to Design AI-first APIs')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    await waitFor(() => {
      expect(onSelectNote).toHaveBeenCalledWith(MOCK_ENTRIES[0])
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('shows result count and elapsed time', async () => {
    mockInvokeFn.mockResolvedValue({
      results: [
        { title: 'Result', path: '/vault/essay/ai-apis.md', snippet: 'Content', score: 0.9, note_type: null },
      ],
      elapsed_ms: 123,
    })

    render(
      <SearchPanel open={true} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )

    fireEvent.change(screen.getByPlaceholderText('Search in all notes...'), { target: { value: 'test' } })

    await waitFor(() => {
      expect(screen.getByText(/1 result/)).toBeInTheDocument()
      expect(screen.getByText(/123ms/)).toBeInTheDocument()
    })
  })

  it('displays note type badge from vault entries', async () => {
    mockInvokeFn.mockResolvedValue({
      results: [
        { title: 'How to Design AI-first APIs', path: '/vault/essay/ai-apis.md', snippet: 'Content', score: 0.9, note_type: null },
      ],
      elapsed_ms: 20,
    })

    render(
      <SearchPanel open={true} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )

    fireEvent.change(screen.getByPlaceholderText('Search in all notes...'), { target: { value: 'api' } })

    await waitFor(() => {
      expect(screen.getByText('Essay')).toBeInTheDocument()
    })
  })

  it('shows workspace initials at the far right instead of prefixing result titles', async () => {
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
    const workspaceEntries = [
      { ...MOCK_ENTRIES[0], path: '/team/essay/ai-apis.md', workspace: teamWorkspace },
      { ...MOCK_ENTRIES[1], path: '/personal/event/retreat.md', workspace: personalWorkspace },
    ]
    mockInvokeFn.mockResolvedValue({
      results: [
        { title: 'How to Design AI-first APIs', path: '/team/essay/ai-apis.md', snippet: 'Content', score: 0.9, note_type: null },
      ],
      elapsed_ms: 20,
    })

    render(
      <SearchPanel open={true} vaultPath="/personal" entries={workspaceEntries} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )

    fireEvent.change(screen.getByPlaceholderText('Search in all notes...'), { target: { value: 'api' } })

    await waitFor(() => {
      expect(screen.getByText('How to Design AI-first APIs')).toBeInTheDocument()
    })
    expect(screen.queryByText(/Team \//)).not.toBeInTheDocument()
    const workspaceBadge = screen.getByTestId('search-result-workspace-badge')
    expect(workspaceBadge).toHaveTextContent('TE')
    expect(screen.getByText('Essay').compareDocumentPosition(workspaceBadge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows metadata subtitle with word count and links', async () => {
    mockInvokeFn.mockResolvedValue({
      results: [
        { title: 'How to Design AI-first APIs', path: '/vault/essay/ai-apis.md', snippet: 'Content', score: 0.9, note_type: null },
      ],
      elapsed_ms: 20,
    })

    render(
      <SearchPanel open={true} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )

    fireEvent.change(screen.getByPlaceholderText('Search in all notes...'), { target: { value: 'api' } })

    await waitFor(() => {
      expect(screen.getByText(/1,247 words/)).toBeInTheDocument()
      expect(screen.getByText(/3 links/)).toBeInTheDocument()
    })
  })

  it('omits links from subtitle when entry has zero outgoing links', async () => {
    const noLinksEntries = MOCK_ENTRIES.map(e =>
      e.path === '/vault/essay/ai-apis.md' ? { ...e, outgoingLinks: [] } : e,
    )
    mockInvokeFn.mockResolvedValue({
      results: [
        { title: 'How to Design AI-first APIs', path: '/vault/essay/ai-apis.md', snippet: '', score: 0.9, note_type: null },
      ],
      elapsed_ms: 20,
    })

    render(
      <SearchPanel open={true} vaultPath="/vault" entries={noLinksEntries} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )

    fireEvent.change(screen.getByPlaceholderText('Search in all notes...'), { target: { value: 'api' } })

    await waitFor(() => {
      expect(screen.getByText(/1,247 words/)).toBeInTheDocument()
      expect(screen.queryByText(/links/)).not.toBeInTheDocument()
    })
  })

  it('shows loading spinner while searching', async () => {
    const resolvers: ((v: unknown) => void)[] = []
    mockInvokeFn.mockImplementation(
      () => new Promise(resolve => { resolvers.push(resolve) }),
    )

    render(
      <SearchPanel open={true} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )

    fireEvent.change(screen.getByPlaceholderText('Search in all notes...'), { target: { value: 'test' } })

    // Spinner appears when search starts (after debounce)
    await waitFor(() => {
      expect(screen.getByTestId('search-spinner')).toBeInTheDocument()
    })

    // Resolve keyword search
    resolvers[0]({
      results: [{ title: 'Result', path: '/vault/essay/ai-apis.md', snippet: '', score: 0.9, note_type: null }],
      elapsed_ms: 30,
    })

    // Spinner disappears after search completes — VaultEntry title shown instead of search result title
    await waitFor(() => {
      expect(screen.getByText('How to Design AI-first APIs')).toBeInTheDocument()
      expect(screen.queryByTestId('search-spinner')).not.toBeInTheDocument()
    })
  })

  it('discards stale results when query changes rapidly', async () => {
    mockInvokeFn.mockImplementation(async (_cmd: string, args?: Record<string, unknown>) => {
      const q = (args as Record<string, string>)?.query
      if (q === 'second') {
        return {
          results: [{ title: 'Second Result', path: '/vault/event/retreat.md', snippet: '', score: 0.9, note_type: null }],
          elapsed_ms: 30,
        }
      }
      return { results: [], elapsed_ms: 0 }
    })

    render(
      <SearchPanel open={true} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )

    const input = screen.getByPlaceholderText('Search in all notes...')
    // Type first query, then immediately change to second (within debounce)
    fireEvent.change(input, { target: { value: 'first' } })
    fireEvent.change(input, { target: { value: 'second' } })

    // Only second query results should appear — VaultEntry title shown
    await waitFor(() => {
      expect(screen.getByText('Refactoring Retreat')).toBeInTheDocument()
    })
  })

  it('deduplicates results when backend returns same note twice', async () => {
    mockInvokeFn.mockResolvedValue({
      results: [
        { title: 'How to Design AI-first APIs', path: '/vault/essay/ai-apis.md', snippet: 'keyword hit', score: 0.7, note_type: 'Essay' },
        { title: 'Refactoring Retreat', path: '/vault/event/retreat.md', snippet: 'unique', score: 0.6, note_type: 'Event' },
        { title: 'How to Design AI-first APIs', path: '/vault/essay/ai-apis.md', snippet: 'duplicate hit', score: 0.9, note_type: 'Essay' },
      ],
      elapsed_ms: 48,
    })

    render(
      <SearchPanel open={true} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )

    fireEvent.change(screen.getByPlaceholderText('Search in all notes...'), { target: { value: 'api' } })

    await waitFor(() => {
      const titles = screen.getAllByText('How to Design AI-first APIs')
      expect(titles).toHaveLength(1) // deduped — not 2
    })

    await waitFor(() => {
      expect(screen.getByText(/2 results/)).toBeInTheDocument()
    })
  })

  it('cancels inflight searches when panel closes', async () => {
    const resolvers: ((v: unknown) => void)[] = []
    mockInvokeFn.mockImplementation(
      () => new Promise(resolve => { resolvers.push(resolve) }),
    )

    const { rerender } = render(
      <SearchPanel open={true} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )

    fireEvent.change(screen.getByPlaceholderText('Search in all notes...'), { target: { value: 'slow query' } })

    // Wait for keyword search to start
    await waitFor(() => {
      expect(resolvers).toHaveLength(1)
    })

    // Close the panel while search is inflight
    rerender(
      <SearchPanel open={false} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )

    // Resolve the inflight keyword search — should be discarded (stale generation)
    resolvers[0]({
      results: [{ title: 'Stale Result', path: '/vault/essay/ai-apis.md', snippet: '', score: 0.9, note_type: null }],
      elapsed_ms: 30,
    })

    // Reopen panel
    rerender(
      <SearchPanel open={true} vaultPath="/vault" entries={MOCK_ENTRIES} onSelectNote={vi.fn()} onClose={vi.fn()} />,
    )

    // Should NOT show the stale result — panel was reset
    expect(screen.queryByText('Stale Result')).not.toBeInTheDocument()
    expect(screen.getByText('Search across all note contents')).toBeInTheDocument()
  })
})
