import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { APP_COMMAND_IDS, getAppCommandShortcutDisplay } from '../hooks/appCommandCatalog'
import { makeEntry, mockEntries, renderNoteList } from '../test-utils/noteListTestUtils'

function setViewportSize(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
}

function renderNoteListWithFullActionMenu() {
  renderNoteList({
    canCopyGitUrl: vi.fn(() => true),
    onBulkArchive: vi.fn(),
    onBulkDeletePermanently: vi.fn(),
    onCopyFilePath: vi.fn(),
    onCopyGitUrl: vi.fn(),
    onEnterNeighborhood: vi.fn(),
    onExportPdf: vi.fn(),
    onOpenInNewWindow: vi.fn(),
    onRevealFile: vi.fn(),
    onToggleFavorite: vi.fn(),
    onToggleOrganized: vi.fn(),
  })
}

function openBuildLaputaActions() {
  fireEvent.contextMenu(screen.getByText('Build Laputa App'))
}

function clickBuildLaputaAction(label: string) {
  openBuildLaputaActions()
  fireEvent.click(screen.getByText(label))
}

describe('NoteList context menu', () => {
  it('opens note actions from a right-clicked note item', () => {
    const onOpenInNewWindow = vi.fn()
    const onEnterNeighborhood = vi.fn()
    const onBulkArchive = vi.fn()
    const onBulkDeletePermanently = vi.fn()
    const onExportPdf = vi.fn()
    const onToggleFavorite = vi.fn()
    const onToggleOrganized = vi.fn()
    const onRevealFile = vi.fn()
    const onCopyFilePath = vi.fn()
    const canCopyGitUrl = vi.fn(() => true)
    const onCopyGitUrl = vi.fn()

    renderNoteList({
      onOpenInNewWindow,
      onEnterNeighborhood,
      onBulkArchive,
      onBulkDeletePermanently,
      onExportPdf,
      onToggleFavorite,
      onToggleOrganized,
      onRevealFile,
      onCopyFilePath,
      canCopyGitUrl,
      onCopyGitUrl,
    })

    openBuildLaputaActions()

    expect(screen.getByTestId('note-list-context-menu')).toBeInTheDocument()
    expect(screen.getByTestId('note-list-context-menu')).toHaveClass('z-[12000]')
    expect(screen.getByText(getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteOpenInNewWindow)!)).toBeInTheDocument()
    expect(screen.getByText(getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteToggleFavorite)!)).toBeInTheDocument()
    expect(screen.getByText(getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteToggleOrganized)!)).toBeInTheDocument()
    expect(screen.getByText(getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteDelete)!)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Open in New Window'))
    expect(onOpenInNewWindow).toHaveBeenCalledWith(mockEntries[0])

    clickBuildLaputaAction('Add to Favorites')
    expect(onToggleFavorite).toHaveBeenCalledWith(mockEntries[0].path)

    clickBuildLaputaAction('Mark as Organized')
    expect(onToggleOrganized).toHaveBeenCalledWith(mockEntries[0].path)

    clickBuildLaputaAction("Open note's neighborhood")
    expect(onEnterNeighborhood).toHaveBeenCalledWith(mockEntries[0])

    clickBuildLaputaAction('Reveal in Finder')
    expect(onRevealFile).toHaveBeenCalledWith(mockEntries[0].path)

    clickBuildLaputaAction('Copy file path')
    expect(onCopyFilePath).toHaveBeenCalledWith(mockEntries[0].path)

    clickBuildLaputaAction('Copy git URL')
    expect(canCopyGitUrl).toHaveBeenCalledWith(mockEntries[0])
    expect(onCopyGitUrl).toHaveBeenCalledWith(mockEntries[0])

    clickBuildLaputaAction('Export note as PDF')
    expect(onExportPdf).toHaveBeenCalledWith(mockEntries[0])

    clickBuildLaputaAction('Archive this note')
    expect(onBulkArchive).toHaveBeenCalledWith([mockEntries[0].path])

    clickBuildLaputaAction('Delete this note')
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

  it('hides the git URL action for notes without a remote', () => {
    renderNoteList({
      canCopyGitUrl: () => false,
      onCopyGitUrl: vi.fn(),
      onCopyFilePath: vi.fn(),
    })

    fireEvent.contextMenu(screen.getByText('Build Laputa App'))

    expect(screen.queryByText('Copy git URL')).not.toBeInTheDocument()
  })

  it('keeps note actions visible when opened near the bottom-right viewport edge', () => {
    setViewportSize(1024, 768)
    renderNoteList({
      onOpenInNewWindow: vi.fn(),
      onBulkDeletePermanently: vi.fn(),
    })

    fireEvent.contextMenu(screen.getByText('Build Laputa App'), { clientX: 1000, clientY: 740 })

    const menu = screen.getByTestId('note-list-context-menu')
    expect(menu.style.left).toBe('')
    expect(menu.style.top).toBe('')
    expect(menu).toHaveStyle({
      bottom: '28px',
      maxHeight: '732px',
      right: '24px',
    })
  })

  it('caps note actions to the available viewport space from a mid-height right-click', () => {
    setViewportSize(420, 320)
    renderNoteListWithFullActionMenu()

    fireEvent.contextMenu(screen.getByText('Build Laputa App'), { clientX: 271, clientY: 157 })

    const menu = screen.getByTestId('note-list-context-menu')
    expect(menu).toHaveStyle({
      maxHeight: '155px',
      overflowY: 'auto',
      right: '149px',
      top: '157px',
    })
  })
})
