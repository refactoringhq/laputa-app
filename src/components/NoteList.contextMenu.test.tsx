import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { APP_COMMAND_IDS, getAppCommandShortcutDisplay } from '../hooks/appCommandCatalog'
import { makeEntry, mockEntries, renderNoteList } from '../test-utils/noteListTestUtils'

describe('NoteList context menu', () => {
  it('opens note actions from a right-clicked note item', () => {
    const onOpenInNewWindow = vi.fn()
    const onEnterNeighborhood = vi.fn()
    const onBulkArchive = vi.fn()
    const onBulkDeletePermanently = vi.fn()
    const onToggleFavorite = vi.fn()
    const onToggleOrganized = vi.fn()
    const onRevealFile = vi.fn()
    const onCopyFilePath = vi.fn()

    renderNoteList({
      onOpenInNewWindow,
      onEnterNeighborhood,
      onBulkArchive,
      onBulkDeletePermanently,
      onToggleFavorite,
      onToggleOrganized,
      onRevealFile,
      onCopyFilePath,
    })

    fireEvent.contextMenu(screen.getByText('Build Laputa App'))

    expect(screen.getByTestId('note-list-context-menu')).toBeInTheDocument()
    expect(screen.getByText(getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteOpenInNewWindow)!)).toBeInTheDocument()
    expect(screen.getByText(getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteToggleFavorite)!)).toBeInTheDocument()
    expect(screen.getByText(getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteToggleOrganized)!)).toBeInTheDocument()
    expect(screen.getByText(getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteDelete)!)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Open in New Window'))
    expect(onOpenInNewWindow).toHaveBeenCalledWith(mockEntries[0])

    fireEvent.contextMenu(screen.getByText('Build Laputa App'))
    fireEvent.click(screen.getByText('Add to Favorites'))
    expect(onToggleFavorite).toHaveBeenCalledWith(mockEntries[0].path)

    fireEvent.contextMenu(screen.getByText('Build Laputa App'))
    fireEvent.click(screen.getByText('Mark as Organized'))
    expect(onToggleOrganized).toHaveBeenCalledWith(mockEntries[0].path)

    fireEvent.contextMenu(screen.getByText('Build Laputa App'))
    fireEvent.click(screen.getByText("Open note's neighborhood"))
    expect(onEnterNeighborhood).toHaveBeenCalledWith(mockEntries[0])

    fireEvent.contextMenu(screen.getByText('Build Laputa App'))
    fireEvent.click(screen.getByText('Reveal in Finder'))
    expect(onRevealFile).toHaveBeenCalledWith(mockEntries[0].path)

    fireEvent.contextMenu(screen.getByText('Build Laputa App'))
    fireEvent.click(screen.getByText('Copy file path'))
    expect(onCopyFilePath).toHaveBeenCalledWith(mockEntries[0].path)

    fireEvent.contextMenu(screen.getByText('Build Laputa App'))
    fireEvent.click(screen.getByText('Archive this note'))
    expect(onBulkArchive).toHaveBeenCalledWith([mockEntries[0].path])

    fireEvent.contextMenu(screen.getByText('Build Laputa App'))
    fireEvent.click(screen.getByText('Delete this note'))
    expect(onBulkDeletePermanently).toHaveBeenCalledWith([mockEntries[0].path])
  })

  it('shows stateful favorite and organized labels for pinned notes', () => {
    renderNoteList({
      entries: [
        makeEntry({
          favorite: true,
          organized: true,
          path: '/vault/stateful.md',
          title: 'Stateful Note',
        }),
      ],
      onToggleFavorite: vi.fn(),
      onToggleOrganized: vi.fn(),
    })

    fireEvent.contextMenu(screen.getByText('Stateful Note'))

    expect(screen.getByText('Remove from Favorites')).toBeInTheDocument()
    expect(screen.getByText('Mark as Unorganized')).toBeInTheDocument()
  })
})
