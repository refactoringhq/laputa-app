import { render, screen, fireEvent, act, within } from '@testing-library/react'
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
  it('shows delete button', () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onDelete={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Delete this note' })).toBeInTheDocument()
  })

  it('calls onDelete when delete button is clicked', () => {
    const onDelete = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete this note' }))
    expect(onDelete).toHaveBeenCalledOnce()
  })
})

describe('BreadcrumbBar — archive/unarchive', () => {
  it('shows archive button for non-archived note', () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onArchive={vi.fn()} onUnarchive={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Archive this note' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restore this archived note' })).not.toBeInTheDocument()
  })

  it('shows unarchive button for archived note', () => {
    render(<BreadcrumbBar entry={archivedEntry} {...defaultProps} onArchive={vi.fn()} onUnarchive={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Restore this archived note' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive this note' })).not.toBeInTheDocument()
  })

  it('calls onArchive when archive button is clicked', () => {
    const onArchive = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onArchive={onArchive} />)
    fireEvent.click(screen.getByRole('button', { name: 'Archive this note' }))
    expect(onArchive).toHaveBeenCalledOnce()
  })

  it('calls onUnarchive when unarchive button is clicked', () => {
    const onUnarchive = vi.fn()
    render(<BreadcrumbBar entry={archivedEntry} {...defaultProps} onUnarchive={onUnarchive} />)
    fireEvent.click(screen.getByRole('button', { name: 'Restore this archived note' }))
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
  it('shows the sync button when the filename diverges from the title slug', () => {
    const entry = { ...baseEntry, title: 'Fresh Title', filename: 'untitled-note-123.md' }
    render(<BreadcrumbBar entry={entry} {...defaultProps} onRenameFilename={vi.fn()} />)
    expect(screen.getByTestId('breadcrumb-sync-button')).toBeInTheDocument()
  })

  it('hides the sync button when the filename already matches the title slug', () => {
    const entry = { ...baseEntry, title: 'Test Note', filename: 'test-note.md' }
    render(<BreadcrumbBar entry={entry} {...defaultProps} onRenameFilename={vi.fn()} />)
    expect(screen.queryByTestId('breadcrumb-sync-button')).not.toBeInTheDocument()
  })

  it('clicking the sync button renames the file to the title slug', () => {
    const onRenameFilename = vi.fn()
    const entry = { ...baseEntry, title: 'Fresh Title', filename: 'untitled-note-123.md' }
    render(<BreadcrumbBar entry={entry} {...defaultProps} onRenameFilename={onRenameFilename} />)
    fireEvent.click(screen.getByTestId('breadcrumb-sync-button'))
    expect(onRenameFilename).toHaveBeenCalledWith(entry.path, 'fresh-title')
  })

  it('lets keyboard users press Enter on the filename to start editing', () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onRenameFilename={vi.fn()} />)
    fireEvent.keyDown(screen.getByTestId('breadcrumb-filename-trigger'), { key: 'Enter' })
    expect(screen.getByTestId('breadcrumb-filename-input')).toHaveValue('test')
  })

  it('double-clicking the filename enters edit mode and Enter confirms the rename', () => {
    const onRenameFilename = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onRenameFilename={onRenameFilename} />)

    fireEvent.doubleClick(screen.getByTestId('breadcrumb-filename-trigger'))
    const input = screen.getByTestId('breadcrumb-filename-input')
    fireEvent.change(input, { target: { value: 'renamed-file' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onRenameFilename).toHaveBeenCalledWith(baseEntry.path, 'renamed-file')
  })

  it('pressing Escape while editing cancels the inline rename', () => {
    const onRenameFilename = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onRenameFilename={onRenameFilename} />)

    fireEvent.doubleClick(screen.getByTestId('breadcrumb-filename-trigger'))
    const input = screen.getByTestId('breadcrumb-filename-input')
    fireEvent.change(input, { target: { value: 'renamed-file' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onRenameFilename).not.toHaveBeenCalled()
    expect(screen.queryByTestId('breadcrumb-filename-input')).not.toBeInTheDocument()
  })

  it('blur confirms the inline rename when the value changed', () => {
    const onRenameFilename = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onRenameFilename={onRenameFilename} />)

    fireEvent.doubleClick(screen.getByTestId('breadcrumb-filename-trigger'))
    const input = screen.getByTestId('breadcrumb-filename-input')
    fireEvent.change(input, { target: { value: 'renamed-on-blur' } })
    fireEvent.blur(input)

    expect(onRenameFilename).toHaveBeenCalledWith(baseEntry.path, 'renamed-on-blur')
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

  it('exposes lower-priority actions through the overflow menu', async () => {
    render(
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

    fireEvent.pointerDown(screen.getByRole('button', { name: 'More note actions' }), {
      button: 0,
      ctrlKey: false,
    })

    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Show the current diff' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Switch to wide note width' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Reveal in Finder' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Copy file path' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Archive this note' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Delete this note' })).toBeInTheDocument()
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
