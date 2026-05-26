import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  trackEventMock,
  buildTypeEntryMapMock,
  buildRawEditorBaseItemsMock,
  detectYamlErrorMock,
  extractWikilinkQueryMock,
  buildRawEditorAutocompleteStateMock,
  getRawEditorDropdownPositionMock,
  replaceActiveWikilinkQueryMock,
  useCodeMirrorMock,
} = vi.hoisted(() => ({
  trackEventMock: vi.fn(),
  buildTypeEntryMapMock: vi.fn(() => new Map()),
  buildRawEditorBaseItemsMock: vi.fn(() => []),
  detectYamlErrorMock: vi.fn(() => null),
  extractWikilinkQueryMock: vi.fn(() => null),
  buildRawEditorAutocompleteStateMock: vi.fn(),
  getRawEditorDropdownPositionMock: vi.fn(() => ({ top: 48, left: 96 })),
  replaceActiveWikilinkQueryMock: vi.fn(),
  useCodeMirrorMock: vi.fn(),
}))

type CodeMirrorCallbacks = {
  onCursorActivity: (view: unknown) => void
  onDocChange: (doc: string) => void
  onEscape: () => boolean
  onSave: () => void
}

let latestCallbacks: CodeMirrorCallbacks | null = null
let latestViewRef: MutableRefObject<{
  dispatch: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  state: {
    doc: { toString: () => string }
    selection: { main: { head: number } }
  }
} | null>

vi.mock('../lib/telemetry', () => ({
  trackEvent: trackEventMock,
}))

vi.mock('../utils/typeColors', () => ({
  buildTypeEntryMap: buildTypeEntryMapMock,
}))

vi.mock('../utils/rawEditorUtils', () => ({
  buildRawEditorAutocompleteState: buildRawEditorAutocompleteStateMock,
  buildRawEditorBaseItems: buildRawEditorBaseItemsMock,
  detectYamlError: detectYamlErrorMock,
  extractWikilinkQuery: extractWikilinkQueryMock,
  getRawEditorDropdownPosition: getRawEditorDropdownPositionMock,
  replaceActiveWikilinkQuery: replaceActiveWikilinkQueryMock,
}))

vi.mock('../hooks/useCodeMirror', () => ({
  useCodeMirror: useCodeMirrorMock,
}))

import { RawEditorView } from './RawEditorView'

vi.mock('./NoteSearchList', () => ({
  NoteSearchList: ({
    items,
    selectedIndex,
    onItemClick,
    onItemHover,
  }: {
    items: Array<{ title: string }>
    selectedIndex: number
    onItemClick: (item: { title: string }) => void
    onItemHover: (index: number) => void
  }) => (
    <div data-testid="raw-editor-note-search-list">
      {items.map((item, index) => (
        <button type="button"
          key={item.title}
          data-testid={`autocomplete-item-${index}`}
          data-selected={index === selectedIndex}
          onMouseEnter={() => onItemHover(index)}
          onClick={() => onItemClick(item)}
        >
          {item.title}
        </button>
      ))}
    </div>
  ),
}))

function createEntry(title: string) {
  return {
    path: `/vault/${title.toLowerCase().replace(/\s+/g, '-')}.md`,
    filename: `${title.toLowerCase().replace(/\s+/g, '-')}.md`,
    title,
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    owner: null,
    cadence: null,
    archived: false,
    modifiedAt: null,
    createdAt: null,
    fileSize: 0,
    snippet: '',
    wordCount: 0,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    sidebarLabel: null,
    template: null,
    sort: null,
    outgoingLinks: [],
    properties: {},
  }
}

const defaultProps = {
  content: '# Raw note',
  path: '/vault/raw-note.md',
  entries: [createEntry('Alpha'), createEntry('Beta')],
  onContentChange: vi.fn(),
  onSave: vi.fn(),
  vaultPath: '/vault',
}

function renderView(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...overrides }
  render(<RawEditorView {...props} />)
  return props
}

describe('RawEditorView additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()

    latestViewRef = {
      current: {
        dispatch: vi.fn(),
        focus: vi.fn(),
        state: {
          doc: { toString: () => 'Before [[Al' },
          selection: { main: { head: 11 } },
        },
      },
    }

    buildRawEditorAutocompleteStateMock.mockImplementation(({ onInsertTarget }) => ({
      selectedIndex: 0,
      items: [
        { title: 'Alpha', path: '/vault/alpha.md', onItemClick: () => onInsertTarget('Alpha') },
        { title: 'Beta', path: '/vault/beta.md', onItemClick: () => onInsertTarget('Beta') },
      ],
    }))
    replaceActiveWikilinkQueryMock.mockReturnValue({
      text: 'Before [[Alpha]]',
      cursor: 15,
    })
    useCodeMirrorMock.mockImplementation((_container, _content, callbacks: CodeMirrorCallbacks) => {
      latestCallbacks = callbacks
      return latestViewRef
    })
  })

  it('debounces content updates, exposes latest content, flushes on save, and flushes pending edits on unmount', async () => {
    vi.useFakeTimers()
    const latestContentRef = { current: null as string | null }
    const onContentChange = vi.fn()
    const onSave = vi.fn()
    const { unmount } = render(
      <RawEditorView
        {...defaultProps}
        latestContentRef={latestContentRef}
        onContentChange={onContentChange}
        onSave={onSave}
      />,
    )

    expect(latestContentRef.current).toBe('# Raw note')

    act(() => {
      latestCallbacks?.onDocChange('draft 1')
      latestCallbacks?.onDocChange('draft 2')
    })

    expect(onContentChange).not.toHaveBeenCalled()
    expect(latestContentRef.current).toBe('draft 2')

    await act(async () => {
      vi.advanceTimersByTimeAsync(500)
    })

    expect(onContentChange).toHaveBeenCalledWith('/vault/raw-note.md', 'draft 2')

    act(() => {
      latestCallbacks?.onDocChange('draft 3')
      latestCallbacks?.onSave()
    })

    expect(onContentChange).toHaveBeenCalledWith('/vault/raw-note.md', 'draft 3')
    expect(onSave).toHaveBeenCalledTimes(1)

    act(() => {
      latestCallbacks?.onDocChange('draft 4')
    })

    unmount()

    expect(onContentChange).toHaveBeenCalledWith('/vault/raw-note.md', 'draft 4')
  })

  it('renders YAML errors from the parser result', () => {
    detectYamlErrorMock.mockReturnValue('Missing closing delimiter')

    renderView()

    expect(screen.getByTestId('raw-editor-yaml-error')).toHaveTextContent('Missing closing delimiter')
  })

  it('opens autocomplete from cursor activity, navigates items, inserts a wikilink, and closes on escape', async () => {
    extractWikilinkQueryMock.mockReturnValue('Al')
    const onContentChange = vi.fn()
    renderView({ onContentChange })

    act(() => {
      latestCallbacks?.onCursorActivity(latestViewRef.current as never)
    })

    expect(buildRawEditorAutocompleteStateMock).toHaveBeenCalled()
    expect(screen.getByTestId('raw-editor-wikilink-dropdown')).toBeInTheDocument()

    const presentation = screen.getByRole('presentation')
    fireEvent.keyDown(presentation, { key: 'ArrowDown' })
    fireEvent.keyDown(presentation, { key: 'ArrowUp' })
    fireEvent.keyDown(presentation, { key: 'Enter' })

    await waitFor(() => {
      expect(replaceActiveWikilinkQueryMock).toHaveBeenCalledWith('Before [[Al', 11, 'Alpha')
    })

    expect(latestViewRef.current?.dispatch).toHaveBeenCalledWith({
      changes: { from: 0, to: 'Before [[Al'.length, insert: 'Before [[Alpha]]' },
      selection: { anchor: 15 },
    })
    expect(trackEventMock).toHaveBeenCalledWith('wikilink_inserted')
    expect(onContentChange).toHaveBeenCalledWith('/vault/raw-note.md', 'Before [[Alpha]]')
    expect(latestViewRef.current?.focus).toHaveBeenCalledTimes(1)

    extractWikilinkQueryMock.mockReturnValue(null)
    act(() => {
      latestCallbacks?.onCursorActivity(latestViewRef.current as never)
    })
    expect(screen.queryByTestId('raw-editor-wikilink-dropdown')).not.toBeInTheDocument()

    extractWikilinkQueryMock.mockReturnValue('Al')
    act(() => {
      latestCallbacks?.onCursorActivity(latestViewRef.current as never)
    })
    expect(screen.getByTestId('raw-editor-wikilink-dropdown')).toBeInTheDocument()

    let escaped = false
    act(() => {
      escaped = latestCallbacks?.onEscape() ?? false
    })
    expect(escaped).toBe(true)
    expect(screen.queryByTestId('raw-editor-wikilink-dropdown')).not.toBeInTheDocument()
  })
})
