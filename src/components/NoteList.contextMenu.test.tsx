import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockEntries, renderNoteList } from '../test-utils/noteListTestUtils'

describe('NoteList context menu', () => {
  it('opens note actions from a right-clicked note item', () => {
    const onOpenInNewWindow = vi.fn()
    const onEnterNeighborhood = vi.fn()
    const onBulkArchive = vi.fn()
    const onBulkDeletePermanently = vi.fn()

    renderNoteList({
      onOpenInNewWindow,
      onEnterNeighborhood,
      onBulkArchive,
      onBulkDeletePermanently,
    })

    fireEvent.contextMenu(screen.getByText('Build Laputa App'))

    expect(screen.getByTestId('note-list-context-menu')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Open in New Window'))
    expect(onOpenInNewWindow).toHaveBeenCalledWith(mockEntries[0])

    fireEvent.contextMenu(screen.getByText('Build Laputa App'))
    fireEvent.click(screen.getByText("Open note's neighborhood"))
    expect(onEnterNeighborhood).toHaveBeenCalledWith(mockEntries[0])

    fireEvent.contextMenu(screen.getByText('Build Laputa App'))
    fireEvent.click(screen.getByText('Archive this note'))
    expect(onBulkArchive).toHaveBeenCalledWith([mockEntries[0].path])

    fireEvent.contextMenu(screen.getByText('Build Laputa App'))
    fireEvent.click(screen.getByText('Delete this note'))
    expect(onBulkDeletePermanently).toHaveBeenCalledWith([mockEntries[0].path])
  })
})
