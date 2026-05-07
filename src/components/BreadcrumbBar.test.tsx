import type { ComponentProps } from 'react'
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { BreadcrumbBar } from './BreadcrumbBar'
import { formatShortcutDisplay } from '../hooks/appCommandCatalog'
import type { VaultEntry } from '../types'

const dragRegionMouseDown = vi.fn()

vi.mock('../hooks/useDragRegion', () => ({
  useDragRegion: () => ({ onMouseDown: dragRegionMouseDown }),
}))

const baseEntry: VaultEntry = {
  path: '/vault/note/test.md',
  filename: 'test.md',
  title: 'Test Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  archived: false,
  modifiedAt: 1700000000,
  createdAt: null,
  fileSize: 100,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  outgoingLinks: [],
  template: null,
  sort: null,
  sidebarLabel: null,
  view: null,
  visible: null,
  properties: {},
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  hasH1: false,
}

const archivedEntry: VaultEntry = {
  ...baseEntry,
  archived: true,
}

const defaultProps = {
  wordCount: 100,
  showDiffToggle: false,
  diffMode: false,
  diffLoading: false,
  onToggleDiff: vi.fn(),
}

type BreadcrumbBarRenderProps = Omit<ComponentProps<typeof BreadcrumbBar>, 'entry'>

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return { ...baseEntry, ...overrides }
}

function renderBreadcrumb(
  entryOverrides: Partial<VaultEntry> = {},
  props: Partial<BreadcrumbBarRenderProps> = {},
) {
  const entry = makeEntry(entryOverrides)
  return {
    entry,
    ...render(<BreadcrumbBar entry={entry} {...defaultProps} {...props} />),
  }
}

function renderEditableFilenameBreadcrumb(
  entryOverrides: Partial<VaultEntry> = {},
  props: Partial<BreadcrumbBarRenderProps> = {},
) {
  const onRenameFilename = vi.fn()
  const result = renderBreadcrumb(entryOverrides, { ...props, onRenameFilename })
  return { ...result, onRenameFilename }
}

function startFilenameRename() {
  fireEvent.doubleClick(screen.getByTestId('breadcrumb-filename-trigger'))
  return screen.getByTestId('breadcrumb-filename-input')
}

function expectDisplayTitleState(
  entryOverrides: Partial<VaultEntry>,
  expected: { displayTitle: string | null; filenameStem: string },
  props: Partial<BreadcrumbBarRenderProps> = {},
) {
  renderEditableFilenameBreadcrumb(entryOverrides, props)

  if (expected.displayTitle) {
    expect(screen.getByTestId('breadcrumb-display-title')).toHaveTextContent(expected.displayTitle)
  } else {
    expect(screen.queryByTestId('breadcrumb-display-title')).not.toBeInTheDocument()
  }
  expect(screen.getByTestId('breadcrumb-filename-trigger')).toHaveTextContent(expected.filenameStem)
}

async function expectTooltip(trigger: HTMLElement, ...parts: string[]) {
  act(() => {
    fireEvent.focus(trigger)
  })
  const tooltip = await screen.findByRole('tooltip')
  for (const part of parts) {
    expect(tooltip).toHaveTextContent(part)
  }
  act(() => {
    fireEvent.blur(trigger)
  })
}

async function openOverflowMenu() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'More note actions' }), {
    button: 0,
    ctrlKey: false,
  })
  return screen.findByRole('menu')
}

function mockCollapsedBreadcrumbOverflow() {
  const requestFrame = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0)
    return 1
  })
  const cancelFrame = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})
  const rects = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.classList.contains('breadcrumb-bar__actions')) {
      return DOMRect.fromRect({ x: 200, y: 0, width: 20, height: 52 })
    }
    return DOMRect.fromRect({ x: 0, y: 0, width: 500, height: 52 })
  })
  const scrollWidths = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function () {
    return this.classList.contains('breadcrumb-bar__actions') ? 400 : 500
  })

  return () => {
    requestFrame.mockRestore()
    cancelFrame.mockRestore()
    rects.mockRestore()
    scrollWidths.mockRestore()
  }
}

describe('BreadcrumbBar — drag region', () => {
  it('forwards mousedown events to the shared drag-region hook', () => {
    const { container } = render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)
    const bar = container.querySelector('.breadcrumb-bar') as HTMLElement

    fireEvent.mouseDown(bar, { button: 0 })

    expect(dragRegionMouseDown).toHaveBeenCalledOnce()
  })

  it('has data-tauri-drag-region on the container', () => {
    const { container } = render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)
    const bar = container.firstElementChild as HTMLElement
    expect(bar.dataset.tauriDragRegion).toBeDefined()
  })

  it('marks the center spacer as a drag region', () => {
    const { container } = render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)
    const spacer = container.querySelector('.breadcrumb-bar__drag-spacer')
    expect(spacer).toHaveAttribute('data-tauri-drag-region')
    expect(spacer).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('BreadcrumbBar — delete', () => {
  it('shows delete in the overflow menu', async () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onDelete={vi.fn()} />)
    const menu = await openOverflowMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Delete this note' })).toBeInTheDocument()
  })

  it('calls onDelete from the overflow menu', async () => {
    const onDelete = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onDelete={onDelete} />)
    const menu = await openOverflowMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete this note' }))
    expect(onDelete).toHaveBeenCalledOnce()
  })
})

describe('BreadcrumbBar — archive/unarchive', () => {
  it('shows archive in the overflow menu for non-archived note', async () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onArchive={vi.fn()} onUnarchive={vi.fn()} />)
    const menu = await openOverflowMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Archive this note' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Restore this archived note' })).not.toBeInTheDocument()
  })

  it('shows unarchive in the overflow menu for archived note', async () => {
    render(<BreadcrumbBar entry={archivedEntry} {...defaultProps} onArchive={vi.fn()} onUnarchive={vi.fn()} />)
    const menu = await openOverflowMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Restore this archived note' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Archive this note' })).not.toBeInTheDocument()
  })

  it('calls onArchive from the overflow menu', async () => {
    const onArchive = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onArchive={onArchive} />)
    const menu = await openOverflowMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Archive this note' }))
    expect(onArchive).toHaveBeenCalledOnce()
  })

  it('calls onUnarchive from the overflow menu', async () => {
    const onUnarchive = vi.fn()
    render(<BreadcrumbBar entry={archivedEntry} {...defaultProps} onUnarchive={onUnarchive} />)
    const menu = await openOverflowMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Restore this archived note' }))
    expect(onUnarchive).toHaveBeenCalledOnce()
  })
})

describe('BreadcrumbBar — file actions', () => {
  it('reveals the current file from the breadcrumb toolbar', () => {
    const onRevealFile = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onRevealFile={onRevealFile} />)

    fireEvent.click(screen.getByRole('button', { name: 'Reveal in Finder' }))

    expect(onRevealFile).toHaveBeenCalledWith('/vault/note/test.md')
  })

  it('copies the current file path from the breadcrumb toolbar', () => {
    const onCopyFilePath = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onCopyFilePath={onCopyFilePath} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy file path' }))

    expect(onCopyFilePath).toHaveBeenCalledWith('/vault/note/test.md')
  })
})

describe('BreadcrumbBar — organized shortcut hint', () => {
  it('shows Cmd+E on the organized toggle tooltip', async () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onToggleOrganized={vi.fn()} />)
    await expectTooltip(
      screen.getByRole('button', { name: 'Set note as organized' }),
      'Set note as organized',
      formatShortcutDisplay({ display: '⌘E' }),
    )
  })

  it('hides the organized toggle when the workflow is disabled', () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)
    expect(screen.queryByRole('button', { name: 'Set note as organized' })).not.toBeInTheDocument()
  })
})

describe('BreadcrumbBar — neighborhood action', () => {
  it("opens the current note's neighborhood from the map button", () => {
    const onEnterNeighborhood = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onEnterNeighborhood={onEnterNeighborhood} />)

    fireEvent.click(screen.getByRole('button', { name: "Open note's neighborhood" }))

    expect(onEnterNeighborhood).toHaveBeenCalledWith(baseEntry)
  })

  it('uses the requested neighborhood tooltip copy', async () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onEnterNeighborhood={vi.fn()} />)

    await expectTooltip(screen.getByRole('button', { name: "Open note's neighborhood" }), "Open note's neighborhood")
  })
})

describe('BreadcrumbBar — title in breadcrumb (always rendered, CSS-toggled)', () => {
  it('always renders title elements in the DOM', () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)
    expect(screen.getByText('Note')).toBeInTheDocument()
    expect(screen.getByText('›')).toBeInTheDocument()
    expect(screen.getByText('test')).toBeInTheDocument()
  })

  it('does not render emoji note icons in the breadcrumb filename', () => {
    const entryWithEmoji = { ...baseEntry, icon: '🚀' }
    render(<BreadcrumbBar entry={entryWithEmoji} {...defaultProps} />)
    expect(screen.getByTestId('breadcrumb-filename-trigger')).toHaveTextContent('test')
    expect(screen.queryByText('🚀')).not.toBeInTheDocument()
  })

  it('does not render Phosphor note icons in the breadcrumb filename', () => {
    const entryWithPhosphor = { ...baseEntry, icon: 'cooking-pot' }
    render(<BreadcrumbBar entry={entryWithPhosphor} {...defaultProps} />)
    expect(screen.getByTestId('breadcrumb-filename-trigger')).toHaveTextContent('test')
    expect(screen.queryByTestId('breadcrumb-note-icon')).not.toBeInTheDocument()
  })

  it('falls back to "Note" when isA is null', () => {
    const entryNoType = { ...baseEntry, isA: null }
    render(<BreadcrumbBar entry={entryNoType} {...defaultProps} />)
    expect(screen.getByText('Note')).toBeInTheDocument()
  })

  it('separator visibility is controlled by data-title-hidden while using the shared border chrome', () => {
    const { container } = render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)
    const bar = container.querySelector('.breadcrumb-bar')!
    expect(bar).toHaveClass('border-b', 'border-transparent')
    expect(bar).toHaveAttribute('data-title-hidden')
  })

  it('keeps the breadcrumb title visible in raw mode', () => {
    const { container } = render(
      <BreadcrumbBar entry={baseEntry} {...defaultProps} rawMode onToggleRaw={vi.fn()} />,
    )

    expect(container.querySelector('.breadcrumb-bar')).toHaveAttribute('data-title-hidden')
  })
})

describe('BreadcrumbBar — filename controls', () => {
  it('shows a legacy display title while keeping the filename visible', () => {
    expectDisplayTitleState(
      {
        title: 'Reference Planning Notes',
        filename: 'ref-570.md',
        hasH1: false,
      },
      { displayTitle: 'Reference Planning Notes', filenameStem: 'ref-570' },
    )
  })

  it('uses opened content when stale metadata marks a legacy note as H1-titled', () => {
    expectDisplayTitleState(
      {
        title: 'Reference Planning Notes',
        filename: 'ref-570.md',
        hasH1: true,
      },
      { displayTitle: 'Reference Planning Notes', filenameStem: 'ref-570' },
      {
        content: '---\ntitle: Reference Planning Notes\ntype: Note\n---\n\nBody without an H1.',
      },
    )
  })

  it('keeps content-derived H1 notes focused on the filename breadcrumb', () => {
    expectDisplayTitleState(
      {
        title: 'Reference Planning Notes',
        filename: 'manual-filename.md',
        hasH1: false,
      },
      { displayTitle: null, filenameStem: 'manual-filename' },
      {
        content: '---\ntitle: Reference Planning Notes\n---\n\n# Canonical H1\n\nBody.',
      },
    )
  })

  it('does not duplicate the display title when the filename already matches it', () => {
    expectDisplayTitleState(
      {
        title: 'Reference Planning Notes',
        filename: 'reference-planning-notes.md',
        hasH1: false,
      },
      { displayTitle: null, filenameStem: 'reference-planning-notes' },
    )
  })

  it('does not duplicate the display title when the filename matches with spaces', () => {
    expectDisplayTitleState(
      {
        title: 'Reference Planning Notes',
        filename: 'Reference Planning Notes.md',
        hasH1: false,
      },
      { displayTitle: null, filenameStem: 'Reference Planning Notes' },
    )
  })

  it('keeps H1-titled notes focused on the filename breadcrumb', () => {
    expectDisplayTitleState(
      {
        title: 'Reference Planning Notes',
        filename: 'manual-filename.md',
        hasH1: true,
      },
      { displayTitle: null, filenameStem: 'manual-filename' },
    )
  })

  it('shows the sync button when the filename diverges from the title slug', () => {
    renderEditableFilenameBreadcrumb({ title: 'Fresh Title', filename: 'untitled-note-123.md' })
    expect(screen.getByTestId('breadcrumb-sync-button')).toBeInTheDocument()
  })

  it('hides the sync button when the filename already matches the title slug', () => {
    renderEditableFilenameBreadcrumb({ title: 'Test Note', filename: 'test-note.md' })
    expect(screen.queryByTestId('breadcrumb-sync-button')).not.toBeInTheDocument()
  })

  it('clicking the sync button renames the file to the title slug', () => {
    const { entry, onRenameFilename } = renderEditableFilenameBreadcrumb({
      title: 'Fresh Title',
      filename: 'untitled-note-123.md',
    })

    fireEvent.click(screen.getByTestId('breadcrumb-sync-button'))

    expect(onRenameFilename).toHaveBeenCalledWith(entry.path, 'fresh-title')
  })

  it('lets keyboard users press Enter on the filename to start editing', () => {
    renderEditableFilenameBreadcrumb()

    fireEvent.keyDown(screen.getByTestId('breadcrumb-filename-trigger'), { key: 'Enter' })

    expect(screen.getByTestId('breadcrumb-filename-input')).toHaveValue('test')
  })

  it('double-clicking the filename enters edit mode and Enter confirms the rename', () => {
    const { entry, onRenameFilename } = renderEditableFilenameBreadcrumb()

    const input = startFilenameRename()
    fireEvent.change(input, { target: { value: 'renamed-file' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onRenameFilename).toHaveBeenCalledWith(entry.path, 'renamed-file')
  })

  it('pressing Escape while editing cancels the inline rename', () => {
    const { onRenameFilename } = renderEditableFilenameBreadcrumb()

    const input = startFilenameRename()
    fireEvent.change(input, { target: { value: 'renamed-file' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onRenameFilename).not.toHaveBeenCalled()
    expect(screen.queryByTestId('breadcrumb-filename-input')).not.toBeInTheDocument()
  })

  it('blur confirms the inline rename when the value changed', () => {
    const { entry, onRenameFilename } = renderEditableFilenameBreadcrumb()

    const input = startFilenameRename()
    fireEvent.change(input, { target: { value: 'renamed-on-blur' } })
    fireEvent.blur(input)

    expect(onRenameFilename).toHaveBeenCalledWith(entry.path, 'renamed-on-blur')
  })
})

describe('BreadcrumbBar — action buttons always right-aligned', () => {
  it('actions container has ml-auto so buttons are always right-aligned', () => {
    const { container } = render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)
    const actions = container.querySelector('.breadcrumb-bar__actions')
    expect(actions).toBeInTheDocument()
    expect(actions).toHaveClass('ml-auto')
    expect(actions).toHaveStyle({ gap: '8px' })
  })

  it('keeps grouped action buttons evenly spaced', () => {
    render(
      <BreadcrumbBar
        entry={baseEntry}
        {...defaultProps}
        noteWidth="normal"
        onToggleNoteWidth={vi.fn()}
        onRevealFile={vi.fn()}
        onCopyFilePath={vi.fn()}
      />,
    )

    const fileActionsGroup = screen.getByTestId('breadcrumb-reveal-file').closest('.breadcrumb-bar__overflowable-action')
    expect(fileActionsGroup).toHaveClass('gap-2')
    const widthActionGroup = screen.getByRole('button', { name: 'Switch to wide note width' }).closest('.breadcrumb-bar__overflowable-action')
    expect(widthActionGroup).toHaveClass('gap-2')
  })

  it('end-aligns toolbar action tooltips so zoomed windows keep them inside the right edge', async () => {
    render(
      <BreadcrumbBar
        entry={baseEntry}
        {...defaultProps}
        onToggleFavorite={vi.fn()}
      />,
    )

    act(() => {
      fireEvent.focus(screen.getByRole('button', { name: 'Add to favorites' }))
    })

    const tooltip = await screen.findByRole('tooltip')
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveAttribute('data-align', 'end')
    expect(tooltip).toHaveTextContent('Add to favorites')
  })

  it('lets the title use the free space before the fixed drag gap', () => {
    const { container } = render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)

    expect(container.querySelector('.breadcrumb-bar__title')).toHaveClass('flex-1')
    expect(container.querySelector('.breadcrumb-bar__drag-spacer')).toHaveClass('w-6', 'shrink-0')
    expect(container.querySelector('.breadcrumb-bar__drag-spacer')).not.toHaveClass('flex-1')
  })

  it('does not render the unused backlinks or more-actions placeholders', () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)
    expect(screen.queryByRole('button', { name: 'Backlinks are coming soon' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More note actions are coming soon' })).not.toBeInTheDocument()
  })

  it('keeps git diff first while placing archive and delete at the bottom', async () => {
    const restoreMeasurement = mockCollapsedBreadcrumbOverflow()

    try {
      const { container } = render(
        <BreadcrumbBar
          entry={baseEntry}
          {...defaultProps}
          showDiffToggle
          noteWidth="normal"
          onToggleNoteWidth={vi.fn()}
          onRevealFile={vi.fn()}
          onCopyFilePath={vi.fn()}
          onArchive={vi.fn()}
          onDelete={vi.fn()}
        />,
      )

      await waitFor(() => {
        expect(container.querySelector('.breadcrumb-bar__actions')).toHaveAttribute('data-overflow-collapsed', 'true')
      })

      const menu = await openOverflowMenu()
      const menuLabels = within(menu).getAllByRole('menuitem').map((item) => item.textContent)
      expect(menuLabels[0]).toBe('Git diff')
      expect(menuLabels.slice(-2)).toEqual(['Archive this note', 'Delete this note'])
    } finally {
      restoreMeasurement()
    }
  })

  it('does not duplicate visible lower-priority toolbar actions in the permanent overflow menu', async () => {
    render(
      <BreadcrumbBar
        entry={baseEntry}
        {...defaultProps}
        noteWidth="normal"
        onToggleNoteWidth={vi.fn()}
        onRevealFile={vi.fn()}
        onCopyFilePath={vi.fn()}
        onEnterNeighborhood={vi.fn()}
      />,
    )

    const menu = await openOverflowMenu()
    expect(within(menu).queryByRole('menuitem', { name: 'Switch to wide note width' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Reveal in Finder' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Copy file path' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: "Open note's neighborhood" })).not.toBeInTheDocument()
  })

  it('exposes lower-priority actions when overflow hides their toolbar buttons', async () => {
    const restoreMeasurement = mockCollapsedBreadcrumbOverflow()

    try {
      const { container } = render(
        <BreadcrumbBar
          entry={baseEntry}
          {...defaultProps}
          noteWidth="normal"
          onToggleNoteWidth={vi.fn()}
          onRevealFile={vi.fn()}
          onCopyFilePath={vi.fn()}
          onEnterNeighborhood={vi.fn()}
        />,
      )

      await waitFor(() => {
        expect(container.querySelector('.breadcrumb-bar__actions')).toHaveAttribute('data-overflow-collapsed', 'true')
      })

      const menu = await openOverflowMenu()
      expect(within(menu).getByRole('menuitem', { name: 'Switch to wide note width' })).toBeInTheDocument()
      expect(within(menu).getByRole('menuitem', { name: 'Reveal in Finder' })).toBeInTheDocument()
      expect(within(menu).getByRole('menuitem', { name: 'Copy file path' })).toBeInTheDocument()
      expect(within(menu).getByRole('menuitem', { name: "Open note's neighborhood" })).toBeInTheDocument()
    } finally {
      restoreMeasurement()
    }
  })
})

describe('BreadcrumbBar — raw editor toggle', () => {
  it('shows Raw editor button with tooltip "Raw editor" when rawMode is off', () => {
    const onToggleRaw = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} rawMode={false} onToggleRaw={onToggleRaw} />)
    expect(screen.getByRole('button', { name: 'Open the raw editor' })).toBeInTheDocument()
  })

  it('shows "Back to editor" tooltip when rawMode is on', () => {
    const onToggleRaw = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} rawMode={true} onToggleRaw={onToggleRaw} />)
    expect(screen.getByRole('button', { name: 'Return to the editor' })).toBeInTheDocument()
  })

  it('calls onToggleRaw when raw button is clicked', () => {
    const onToggleRaw = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} rawMode={false} onToggleRaw={onToggleRaw} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open the raw editor' }))
    expect(onToggleRaw).toHaveBeenCalledOnce()
  })

  it('hides raw toggle when forceRawMode is true (non-markdown file)', () => {
    const onToggleRaw = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} rawMode={true} onToggleRaw={onToggleRaw} forceRawMode={true} />)
    expect(screen.queryByRole('button', { name: 'Open the raw editor' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Return to the editor' })).not.toBeInTheDocument()
  })

  it('shows raw toggle when forceRawMode is false (markdown file)', () => {
    const onToggleRaw = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} rawMode={false} onToggleRaw={onToggleRaw} forceRawMode={false} />)
    expect(screen.getByRole('button', { name: 'Open the raw editor' })).toBeInTheDocument()
  })
})

describe('BreadcrumbBar — note width toggle', () => {
  it('shows the wide width action while normal', () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} noteWidth="normal" onToggleNoteWidth={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Switch to wide note width' })).toBeInTheDocument()
  })

  it('shows the normal width action while wide', () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} noteWidth="wide" onToggleNoteWidth={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Switch to normal note width' })).toBeInTheDocument()
  })

  it('calls onToggleNoteWidth when the width button is clicked', () => {
    const onToggleNoteWidth = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} noteWidth="normal" onToggleNoteWidth={onToggleNoteWidth} />)

    fireEvent.click(screen.getByRole('button', { name: 'Switch to wide note width' }))

    expect(onToggleNoteWidth).toHaveBeenCalledOnce()
  })
})

describe('BreadcrumbBar — table of contents toggle', () => {
  it('shows the table of contents action and calls the toggle handler', () => {
    const onToggleTableOfContents = vi.fn()
    render(
      <BreadcrumbBar
        entry={baseEntry}
        {...defaultProps}
        onToggleTableOfContents={onToggleTableOfContents}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open table of contents' }))

    expect(onToggleTableOfContents).toHaveBeenCalledOnce()
  })

  it('uses the close label while the table of contents panel is active', () => {
    render(
      <BreadcrumbBar
        entry={baseEntry}
        {...defaultProps}
        showTableOfContents
        onToggleTableOfContents={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Close table of contents' })).toBeInTheDocument()
  })

  it('shows the table of contents shortcut in the button tooltip', async () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onToggleTableOfContents={vi.fn()} />)
    await expectTooltip(
      screen.getByRole('button', { name: 'Open table of contents' }),
      'Open table of contents',
      formatShortcutDisplay({ display: '⌘⇧T' }),
    )
  })

  it('offers the table of contents action from the overflow menu', async () => {
    const onToggleTableOfContents = vi.fn()
    const restoreMeasurement = mockCollapsedBreadcrumbOverflow()

    try {
      const { container } = render(
        <BreadcrumbBar
          entry={baseEntry}
          {...defaultProps}
          onToggleTableOfContents={onToggleTableOfContents}
        />,
      )

      await waitFor(() => {
        expect(container.querySelector('.breadcrumb-bar__actions')).toHaveAttribute('data-overflow-collapsed', 'true')
      })

      const menu = await openOverflowMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open table of contents' }))

      expect(onToggleTableOfContents).toHaveBeenCalledOnce()
    } finally {
      restoreMeasurement()
    }
  })
})
