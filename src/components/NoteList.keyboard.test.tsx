import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteList } from './NoteList'
import {
  allSelection,
  mockEntries,
} from '../test-utils/noteListTestUtils'
import type { SidebarSelection, VaultEntry } from '../types'
import * as tabManagement from '../hooks/useTabManagement'

function NoteListKeyboardHarness({
  onOpen,
  onEnterNeighborhood = () => {},
  selection = allSelection,
}: {
  onOpen: (entry: VaultEntry) => void
  onEnterNeighborhood?: (entry: VaultEntry) => void
  selection?: SidebarSelection
}) {
  const [selectedNote, setSelectedNote] = useState<VaultEntry | null>(null)

  const handleOpen = (entry: VaultEntry) => {
    setSelectedNote(entry)
    onOpen(entry)
  }

  return (
    <NoteList
      entries={mockEntries}
      selection={selection}
      selectedNote={selectedNote}
      noteListFilter="open"
      onNoteListFilterChange={() => {}}
      onSelectNote={handleOpen}
      onReplaceActiveTab={handleOpen}
      onEnterNeighborhood={onEnterNeighborhood}
      onCreateNote={() => {}}
    />
  )
}

describe('NoteList keyboard activation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('focuses the list on click and continues arrow navigation from the clicked note', async () => {
    const onOpen = vi.fn()
    render(<NoteListKeyboardHarness onOpen={onOpen} />)

    fireEvent.click(screen.getByText('Facebook Ads Strategy'))

    const container = screen.getByTestId('note-list-container')
    await waitFor(() => {
      expect(document.activeElement).toBe(container)
      expect(
        container.querySelector('[data-highlighted="true"]')?.getAttribute('data-note-path'),
      ).toBe(mockEntries[1].path)
    })

    fireEvent.keyDown(container, { key: 'ArrowDown' })

    await waitFor(() => {
      expect(onOpen).toHaveBeenNthCalledWith(1, mockEntries[1])
      expect(onOpen).toHaveBeenNthCalledWith(2, mockEntries[2])
    })
  })

  it('navigates from global arrow keys when the editor is not focused', async () => {
    const onOpen = vi.fn()
    render(
      <>
        <button type="button">Outside</button>
        <NoteListKeyboardHarness onOpen={onOpen} />
      </>,
    )

    screen.getByText('Outside').focus()
    fireEvent.keyDown(window, { key: 'ArrowDown' })

    await waitFor(() => {
      expect(onOpen).toHaveBeenCalledWith(mockEntries[0])
    })
  })

  it('supports Cmd+Enter to pivot the highlighted note into Neighborhood mode', async () => {
    const onOpen = vi.fn()
    const onEnterNeighborhood = vi.fn()
    render(
      <NoteListKeyboardHarness
        onOpen={onOpen}
        onEnterNeighborhood={onEnterNeighborhood}
        selection={{ kind: 'entity', entry: mockEntries[0] }}
      />,
    )

    const container = screen.getByTestId('note-list-container')
    fireEvent.keyDown(container, { key: 'ArrowDown' })
    fireEvent.keyDown(container, { key: 'ArrowDown' })
    fireEvent.keyDown(container, { key: 'Enter', metaKey: true })

    await waitFor(() => {
      expect(onOpen).toHaveBeenLastCalledWith(mockEntries[4])
      expect(onEnterNeighborhood).toHaveBeenCalledWith(mockEntries[4])
    })
  })

  it('prefetches note content on hover so click opens can use the warm path', () => {
    const prefetchSpy = vi.spyOn(tabManagement, 'prefetchNoteContent').mockImplementation(() => {})
    render(<NoteListKeyboardHarness onOpen={vi.fn()} />)

    const noteRow = screen.getByText('Facebook Ads Strategy').closest('[data-note-path]')
    expect(noteRow).not.toBeNull()

    fireEvent.mouseEnter(noteRow!)

    expect(prefetchSpy).toHaveBeenCalledWith(mockEntries[1])
  })
})
