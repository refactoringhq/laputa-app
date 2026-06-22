import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EditorContentLayout } from './EditorContentLayout'

vi.mock('../BreadcrumbBar', () => ({
  BreadcrumbBar: ({ content, noteWidth }: { content?: string; noteWidth?: string }) => (
    <div data-testid="breadcrumb-bar" data-content={content} data-note-width={noteWidth} />
  ),
}))

vi.mock('../ArchivedNoteBanner', () => ({
  ArchivedNoteBanner: () => <div data-testid="archived-banner" />,
}))

vi.mock('../ConflictNoteBanner', () => ({
  ConflictNoteBanner: () => <div data-testid="conflict-banner" />,
}))

vi.mock('../RawEditorView', () => ({
  RawEditorView: () => <div data-testid="raw-editor-view" />,
}))

vi.mock('../SheetEditor', () => ({
  SheetEditor: ({
    content,
    flushContentRef,
    path,
  }: {
    content: string
    flushContentRef?: React.MutableRefObject<((path: string) => void) | null>
    path: string
  }) => (
    <div
      data-testid="sheet-editor"
      data-content={content}
      data-has-flush-ref={String(Boolean(flushContentRef))}
      data-path={path}
    />
  ),
}))

vi.mock('../SingleEditorView', () => ({
  SingleEditorView: () => <div data-testid="single-editor-view" />,
}))

vi.mock('../DiffView', () => ({
  DiffView: () => <div data-testid="diff-view" />,
}))

function createModel(overrides: Record<string, unknown> = {}) {
  return {
    activeTab: {
      entry: {
        path: '/vault/project/demo.md',
        filename: 'demo.md',
        title: 'Demo Note',
      },
      content: 'Body',
    },
    isLoadingNewTab: false,
    entries: [],
    editor: {},
    diffMode: false,
    diffContent: null,
    diffLoading: false,
    richEditorContentReady: true,
    onToggleDiff: vi.fn(),
    effectiveRawMode: false,
    onToggleRaw: vi.fn(),
    onRawContentChange: vi.fn(),
    onSave: vi.fn(),
    showEditor: true,
    isArchived: false,
    onUnarchiveNote: undefined,
    path: '/vault/project/demo.md',
    isConflicted: false,
    onKeepMine: vi.fn(),
    onKeepTheirs: vi.fn(),
    breadcrumbBarRef: createRef<HTMLDivElement>(),
    wordCount: 12,
    vaultPath: '/vault',
    cssVars: {},
    onNavigateWikilink: vi.fn(),
    onEditorChange: vi.fn(),
    isDeletedPreview: false,
    rawLatestContentRef: { current: null },
    noteWidth: 'normal',
    onToggleNoteWidth: vi.fn(),
    forceRawMode: false,
    showAIChat: false,
    onToggleAIChat: vi.fn(),
    inspectorCollapsed: true,
    onToggleInspector: vi.fn(),
    showDiffToggle: false,
    onToggleFavorite: vi.fn(),
    onToggleOrganized: vi.fn(),
    onDeleteNote: vi.fn(),
    onArchiveNote: vi.fn(),
    ...overrides,
  } as never
}

describe('EditorContentLayout', () => {
  it('never renders the legacy title section', () => {
    const { container } = render(<EditorContentLayout {...createModel()} />)

    expect(container.querySelector('.title-section')).toBeNull()
    expect(screen.queryByTestId('title-field-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('single-editor-view')).toBeInTheDocument()
  })

  it('shows the loading skeleton instead of stale editor chrome while switching tabs', () => {
    const { container } = render(
      <EditorContentLayout
        {...createModel({
          activeTab: null,
          isLoadingNewTab: true,
        })}
      />,
    )

    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(screen.queryByTestId('title-field-input')).not.toBeInTheDocument()
  })

  it('keeps stale rich-editor content hidden until the selected note swap is applied', () => {
    const { container } = render(
      <EditorContentLayout
        {...createModel({
          richEditorContentReady: false,
          activeTab: {
            entry: {
              path: '/vault/project/new-note.md',
              filename: 'new-note.md',
              title: 'New Note',
            },
            content: '# New Note',
          },
        })}
      />,
    )

    expect(screen.queryByTestId('single-editor-view')).not.toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(screen.getByTestId('breadcrumb-bar')).toHaveAttribute('data-content', '# New Note')
  })

  it('marks the editor content root and breadcrumb with the note width mode', () => {
    const { container } = render(<EditorContentLayout {...createModel({ noteWidth: 'wide' })} />)

    expect(container.firstElementChild).toHaveClass('editor-content-width--wide')
    expect(screen.getByTestId('breadcrumb-bar')).toHaveAttribute('data-note-width', 'wide')
  })

  it('passes the active note content into the breadcrumb', () => {
    render(<EditorContentLayout {...createModel({
      activeTab: {
        entry: {
          path: '/vault/project/ref-570.md',
          filename: 'ref-570.md',
          title: 'Reference Planning Notes',
        },
        content: '---\ntitle: Reference Planning Notes\n---\n\nBody',
      },
    })} />)

    expect(screen.getByTestId('breadcrumb-bar')).toHaveAttribute(
      'data-content',
      '---\ntitle: Reference Planning Notes\n---\n\nBody',
    )
  })

  it('keeps raw mode out of the rich-editor content wrapper', () => {
    render(<EditorContentLayout {...createModel({
      effectiveRawMode: true,
      showEditor: false,
      noteWidth: 'normal',
    })} />)

    const rawEditor = screen.getByTestId('raw-editor-view')
    const findScope = rawEditor.closest('[data-editor-find-scope="true"]')

    expect(findScope).toHaveClass('editor-scroll-area')
    expect(rawEditor.closest('.editor-content-wrapper')).toBeNull()
  })

  it('routes sheet notes to the sheet editor without the rich-editor wrapper', async () => {
    const sheetFlushRef = { current: null }
    render(<EditorContentLayout {...createModel({
      cssVars: { '--editor-accent': '#155dff' },
      isSheet: true,
      sheetFlushRef,
      activeTab: {
        entry: {
          path: '/vault/project/budget.md',
          filename: 'budget.md',
          title: 'Budget',
        },
        content: 'Metric,January\nRevenue,1200',
      },
    })} />)

    const sheetEditor = await screen.findByTestId('sheet-editor')

    expect(sheetEditor).toHaveAttribute('data-path', '/vault/project/budget.md')
    expect(sheetEditor).toHaveAttribute('data-content', 'Metric,January\nRevenue,1200')
    expect(sheetEditor).toHaveAttribute('data-has-flush-ref', 'true')
    expect(screen.queryByTestId('single-editor-view')).not.toBeInTheDocument()
    expect(sheetEditor.closest('.editor-content-wrapper')).toBeNull()
    const findScope = sheetEditor.closest('[data-editor-find-scope="true"]')
    expect(findScope).toHaveClass(
      'editor-scroll-area',
      'editor-scroll-area--sheet',
    )
    expect(findScope).toHaveStyle({ '--editor-accent': '#155dff' })
  })
})
