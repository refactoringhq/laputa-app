import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TableOfContentsPanel } from './TableOfContentsPanel'
import type { VaultEntry } from '../types'

const baseEntry: VaultEntry = {
  path: '/vault/project/test.md',
  filename: 'test.md',
  title: 'Test Project',
  isA: 'Project',
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

function createEditor(documentBlocks: unknown[]) {
  return {
    document: documentBlocks,
    focus: vi.fn(),
    setTextCursorPosition: vi.fn(),
  }
}

describe('TableOfContentsPanel', () => {
  it('renders a nested heading tree and collapses child headings', () => {
    const editor = createEditor([
      { id: 'intro', type: 'heading', props: { level: 1 }, content: 'Intro' },
      { id: 'setup', type: 'heading', props: { level: 2 }, content: 'Setup' },
      { id: 'details', type: 'heading', props: { level: 3 }, content: 'Details' },
      { id: 'usage', type: 'heading', props: { level: 1 }, content: 'Usage' },
    ])

    render(
      <TableOfContentsPanel
        activeEntry={baseEntry}
        documentRevision={0}
        editor={editor}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Table of Contents' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Intro' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Setup' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Intro' }))

    expect(screen.getByRole('button', { name: 'Intro' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Setup' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Usage' })).toBeInTheDocument()
  })

  it('moves the editor cursor to the selected heading', () => {
    const editor = createEditor([
      { id: 'target-heading', type: 'heading', props: { level: 1 }, content: 'Target' },
    ])
    const onHeadingSelected = vi.fn()

    render(
      <TableOfContentsPanel
        activeEntry={baseEntry}
        documentRevision={0}
        editor={editor}
        onClose={vi.fn()}
        onHeadingSelected={onHeadingSelected}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Target' }))

    expect(editor.focus).toHaveBeenCalledOnce()
    expect(editor.setTextCursorPosition).toHaveBeenCalledWith('target-heading', 'start')
    expect(onHeadingSelected).toHaveBeenCalledWith(expect.objectContaining({ id: 'target-heading' }))
  })

  it('updates when the editor document revision changes', () => {
    const editor = createEditor([
      { id: 'intro', type: 'heading', props: { level: 1 }, content: 'Intro' },
    ])
    const { rerender } = render(
      <TableOfContentsPanel
        activeEntry={baseEntry}
        documentRevision={0}
        editor={editor}
        onClose={vi.fn()}
      />,
    )

    editor.document = [
      { id: 'intro', type: 'heading', props: { level: 1 }, content: 'Intro' },
      { id: 'live-update', type: 'heading', props: { level: 2 }, content: 'Live update' },
    ]
    rerender(
      <TableOfContentsPanel
        activeEntry={baseEntry}
        documentRevision={1}
        editor={editor}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Live update' })).toBeInTheDocument()
  })

  it('shows an empty state when the note has no headings', () => {
    render(
      <TableOfContentsPanel
        activeEntry={baseEntry}
        documentRevision={0}
        editor={createEditor([{ id: 'body', type: 'paragraph', content: 'Body' }])}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('No headings in this note')).toBeInTheDocument()
  })

  it('keeps the close action in the panel header', () => {
    const onClose = vi.fn()
    render(
      <TableOfContentsPanel
        activeEntry={baseEntry}
        documentRevision={0}
        editor={createEditor([])}
        onClose={onClose}
      />,
    )

    const panel = screen.getByTestId('table-of-contents-panel')
    fireEvent.click(within(panel).getByRole('button', { name: 'Close table of contents' }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
