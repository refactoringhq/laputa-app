import { render as rtlRender, screen, fireEvent, act, within } from '@testing-library/react'
import type { ComponentProps, PropsWithChildren, ReactElement } from 'react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { formatShortcutDisplay } from '../hooks/appCommandCatalog'
import { RUNTIME_STYLE_NONCE } from '../lib/runtimeStyleNonce'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    matches: false,
    media: '',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })),
})

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
  invoke: vi.fn(),
}))

// Hoisted mock editor — available before vi.mock factory runs.
// Tests can reconfigure spies (e.g. mockTryParse.mockResolvedValue) before rendering.
const mockEditor = vi.hoisted(() => ({
  tryParseMarkdownToBlocks: vi.fn(async () => [] as unknown[]),
  replaceBlocks: vi.fn(),
  insertBlocks: vi.fn(),
  document: [{ id: '1', type: 'paragraph', content: [], props: {}, children: [] }],
  insertInlineContent: vi.fn(),
  headless: false,
  onMount: vi.fn((cb: () => void) => { cb(); return () => {} }),
  prosemirrorView: {} as Record<string, unknown>,
  blocksToHTMLLossy: vi.fn(() => ''),
  blocksToMarkdownLossy: vi.fn(() => '# Test Project\n\nThis is a test note with some words to count.\n'),
  _tiptapEditor: { commands: { setContent: vi.fn() } },
  focus: vi.fn(),
  setTextCursorPosition: vi.fn(),
}))
const blockNoteCreation = vi.hoisted(() => ({
  options: [] as unknown[],
}))
const blockNoteViewState = vi.hoisted(() => ({
  onChange: null as (() => void) | null,
}))

// Mock BlockNote components
vi.mock('@blocknote/core', () => ({
  BlockNoteSchema: { create: () => ({ extend: () => ({}) }) },
  createCodeBlockSpec: vi.fn(() => ({})),
  createExtension: (factory: unknown) => () => factory,
  defaultInlineContentSpecs: {},
  filterSuggestionItems: vi.fn(() => []),
}))

vi.mock('@blocknote/code-block', () => ({
  codeBlockOptions: {},
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock
const mockFilterSuggestionItems = vi.fn((...args: any[]) => args[0] ?? [])
vi.mock('@blocknote/core/extensions', () => ({
  filterSuggestionItems: (...args: unknown[]) => mockFilterSuggestionItems(...args),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock
const capturedGetItemsByTrigger: Record<string, (query: string) => Promise<any[]>> = {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock
let capturedGetItems: ((query: string) => Promise<any[]>) | null = null
vi.mock('@blocknote/react', () => ({
  createReactBlockSpec: () => () => ({}),
  createReactInlineContentSpec: () => ({ render: () => null }),
  useCreateBlockNote: (options: unknown) => {
    blockNoteCreation.options.push(options)
    return mockEditor
  },
  FormattingToolbar: ({ children }: PropsWithChildren) => <>{children}</>,
  LinkToolbar: ({ children }: PropsWithChildren) => <>{children}</>,
  getFormattingToolbarItems: () => [],
  getDefaultReactSlashMenuItems: () => [],
  ComponentsContext: {
    Provider: ({ children }: PropsWithChildren) => <>{children}</>,
  },
  BlockNoteViewRaw: ({
    children,
    editable,
    onChange,
  }: PropsWithChildren<{ editable?: boolean; onChange?: () => void }>) => {
    blockNoteViewState.onChange = onChange ?? null
    return (
      <div data-testid="blocknote-view" data-editable={editable !== false ? 'true' : 'false'}>
        <div
          contentEditable={editable !== false}
          data-testid="blocknote-editable"
          suppressContentEditableWarning
        />
        {children}
      </div>
    )
  },
  FormattingToolbarController: () => null,
  LinkToolbarController: () => null,
  EditLinkButton: () => null,
  DeleteLinkButton: () => null,
  SideMenuController: () => null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock
  SuggestionMenuController: (props: any) => {
    capturedGetItemsByTrigger[props.triggerCharacter] = props.getItems
    if (props.triggerCharacter === '[[') capturedGetItems = props.getItems
    return null
  },
  useComponentsContext: () => ({
    LinkToolbar: {
      Button: ({
        children,
        label,
        onClick,
      }: PropsWithChildren<{ label?: string; onClick?: () => void }>) => (
        <button onClick={onClick} type="button">
          {label}
          {children}
        </button>
      ),
    },
  }),
  useDictionary: () => ({
    link_toolbar: {
      open: { tooltip: 'Open in a new tab' },
    },
  }),
}))

vi.mock('@blocknote/mantine', () => ({
  components: {},
}))

vi.mock('@blocknote/mantine/style.css', () => ({}))

vi.mock('./tolariaEditorFormatting', () => ({
  TolariaFormattingToolbar: ({ children }: PropsWithChildren) => <>{children}</>,
  TolariaFormattingToolbarController: () => null,
}))

import { Editor } from './Editor'
import {
  applyPendingRawExitContent,
  rememberPendingRawExitContent,
  syncActiveTabIntoRawBuffer,
} from './editorRawModeSync'
import type { VaultEntry } from '../types'
import { bindVaultConfigStore, resetVaultConfigStore } from '../utils/vaultConfigStore'
import { TooltipProvider } from '@/components/ui/tooltip'
import { clearParsedNoteBlockCache } from '../hooks/editorParsedBlockCache'

type EditorComponentProps = ComponentProps<typeof Editor>

function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: TooltipProvider })
}

const mockEntry: VaultEntry = {
  path: '/vault/project/test.md',
  filename: 'test.md',
  title: 'Test Project',
  isA: 'Project',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: 'Active',
  archived: false,
  modifiedAt: 1700000000,
  createdAt: null,
  fileSize: 1024,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  template: null, sort: null,
  outgoingLinks: [],
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

const mockContent = `---
title: Test Project
is_a: Project
Status: Active
---

# Test Project

This is a test note with some words to count.
`

const mockTab = { entry: mockEntry, content: mockContent }
const otherEntry: VaultEntry = {
  ...mockEntry,
  path: '/vault/other.md',
  filename: 'other.md',
  title: 'Other Note',
}
const otherTab = { entry: otherEntry, content: '# Other\n' }

const defaultProps = {
  tabs: [] as { entry: VaultEntry; content: string }[],
  activeTabPath: null as string | null,
  entries: [mockEntry],
  onNavigateWikilink: vi.fn(),
  inspectorCollapsed: true,
  onToggleInspector: vi.fn(),
  inspectorWidth: 280,
  onInspectorResize: vi.fn(),
  inspectorEntry: null as VaultEntry | null,
  inspectorContent: null as string | null,
  gitHistory: [],
  onCreateNote: vi.fn(),
}

function renderEditor(overrides: Partial<EditorComponentProps> = {}) {
  return render(<Editor {...defaultProps} {...overrides} />)
}

describe('Editor', () => {
  beforeEach(() => {
    blockNoteCreation.options = []
    blockNoteViewState.onChange = null
    mockEditor.document = [{ id: '1', type: 'paragraph', content: [], props: {}, children: [] }]
    clearParsedNoteBlockCache()
  })

  it('shows empty state when no tabs are open', () => {
    const quickOpenHint = formatShortcutDisplay({ display: '⌘P / ⌘O' })
    const newNoteHint = formatShortcutDisplay({ display: '⌘N' })
    const { container } = renderEditor()
    expect(screen.getByText('Select a note to start editing')).toBeInTheDocument()
    const shortcutHint = Array.from(container.querySelectorAll('span.text-xs.text-muted-foreground'))
      .find((element) => element.textContent === `${quickOpenHint} to search · ${newNoteHint} to create`)

    expect(shortcutHint).toBeInTheDocument()
  })

  it('renders an invisible drag region in the empty state', () => {
    const { container } = renderEditor()
    const dragRegion = container.querySelector('[data-testid="editor-empty-state-drag-region"]')

    expect(dragRegion).toHaveAttribute('data-tauri-drag-region')
    expect(dragRegion).toHaveAttribute('aria-hidden', 'true')
  })

  it.each([
    ['renders tab bar with open tabs', {}],
    ['shows BlockNote editor when a tab is active', {}],
    ['renders editor for modified file without breadcrumb status', { getNoteStatus: () => 'modified' as const }],
    ['renders editor for new file without breadcrumb status', { getNoteStatus: () => 'new' as const }],
  ])('%s', (_label, overrides) => {
    renderEditor({
      tabs: [mockTab],
      activeTabPath: mockEntry.path,
      ...overrides,
    })

    expect(screen.getByTestId('blocknote-view')).toBeInTheDocument()
  })

  it('renders an in-app image preview for binary image tabs', () => {
    const imageEntry: VaultEntry = {
      ...mockEntry,
      path: '/vault/assets/photo.png',
      filename: 'photo.png',
      title: 'photo.png',
      fileKind: 'binary',
    }

    renderEditor({
      tabs: [{ entry: imageEntry, content: '' }],
      activeTabPath: imageEntry.path,
      entries: [imageEntry],
    })

    const preview = screen.getByTestId('file-preview')
    expect(preview).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute(
      'src',
      'asset://localhost/%2Fvault%2Fassets%2Fphoto.png',
    )
    expect(screen.queryByTestId('blocknote-view')).not.toBeInTheDocument()
  })

  it('renders an in-app PDF preview for binary PDF tabs', () => {
    const pdfEntry: VaultEntry = {
      ...mockEntry,
      path: '/vault/assets/report.pdf',
      filename: 'report.pdf',
      title: 'report.pdf',
      fileKind: 'binary',
    }

    renderEditor({
      tabs: [{ entry: pdfEntry, content: '' }],
      activeTabPath: pdfEntry.path,
      entries: [pdfEntry],
    })

    expect(screen.getByTestId('pdf-file-preview')).toHaveAttribute(
      'data',
      'asset://localhost/%2Fvault%2Fassets%2Freport.pdf',
    )
    expect(screen.queryByTestId('blocknote-view')).not.toBeInTheDocument()
  })

  it('shows a graceful fallback when an image preview fails to render', () => {
    const imageEntry: VaultEntry = {
      ...mockEntry,
      path: '/vault/assets/broken.png',
      filename: 'broken.png',
      title: 'broken.png',
      fileKind: 'binary',
    }

    renderEditor({
      tabs: [{ entry: imageEntry, content: '' }],
      activeTabPath: imageEntry.path,
      entries: [imageEntry],
    })

    fireEvent.error(screen.getByRole('img', { name: 'broken.png' }))

    expect(screen.getByTestId('file-preview-fallback')).toHaveTextContent('Image preview failed')
    expect(screen.getByRole('button', { name: 'Open in default app' })).toBeInTheDocument()
  })

  it('shows an explicit unsupported-file fallback for non-image binary tabs', () => {
    const binaryEntry: VaultEntry = {
      ...mockEntry,
      path: '/vault/assets/archive.zip',
      filename: 'archive.zip',
      title: 'archive.zip',
      fileKind: 'binary',
    }

    renderEditor({
      tabs: [{ entry: binaryEntry, content: '' }],
      activeTabPath: binaryEntry.path,
      entries: [binaryEntry],
    })

    expect(screen.getByTestId('file-preview-fallback')).toHaveTextContent('Preview unavailable')
    expect(screen.getByText('ZIP file')).toBeInTheDocument()
  })

  it('moves focus back to the note list when Escape is pressed on the file preview', () => {
    const imageEntry: VaultEntry = {
      ...mockEntry,
      path: '/vault/assets/photo.png',
      filename: 'photo.png',
      title: 'photo.png',
      fileKind: 'binary',
    }

    render(
      <>
        <div data-testid="note-list-container" tabIndex={0} />
        <Editor
          {...defaultProps}
          tabs={[{ entry: imageEntry, content: '' }]}
          activeTabPath={imageEntry.path}
          entries={[imageEntry]}
        />
      </>,
    )

    const preview = screen.getByTestId('file-preview')
    preview.focus()
    fireEvent.keyDown(preview, { key: 'Escape' })

    expect(screen.getByTestId('note-list-container')).toHaveFocus()
  })

  it('passes the runtime CSP style nonce into BlockNote and TipTap', () => {
    renderEditor({
      tabs: [mockTab],
      activeTabPath: mockEntry.path,
    })

    expect(blockNoteCreation.options.at(-1)).toMatchObject({
      _tiptapOptions: {
        injectNonce: RUNTIME_STYLE_NONCE,
      },
    })
  })

  it('registers a rich-editor flush hook for pending BlockNote changes', async () => {
    const onContentChange = vi.fn()
    const flushPendingEditorContentRef = { current: null as ((path: string) => void) | null }
    const originalMarkdownSerializer = mockEditor.blocksToMarkdownLossy.getMockImplementation()
    mockEditor.replaceBlocks.mockClear()

    try {
      renderEditor({
        tabs: [mockTab],
        activeTabPath: mockEntry.path,
        onContentChange,
        flushPendingEditorContentRef,
      })

      await vi.waitFor(() => {
        expect(blockNoteViewState.onChange).toEqual(expect.any(Function))
        expect(flushPendingEditorContentRef.current).toEqual(expect.any(Function))
      })
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

      mockEditor.blocksToMarkdownLossy.mockReturnValueOnce('# Test Project\n\nEdited rich body.\n')

      act(() => {
        blockNoteViewState.onChange?.()
      })
      expect(onContentChange).not.toHaveBeenCalled()

      act(() => {
        flushPendingEditorContentRef.current?.(mockEntry.path)
      })

      expect(onContentChange).toHaveBeenCalledWith(
        mockEntry.path,
        expect.stringContaining('Edited rich body.'),
      )
    } finally {
      mockEditor.blocksToMarkdownLossy.mockImplementation(originalMarkdownSerializer)
    }
  })

  it('disables native text assistance on the rich editor editable surface', () => {
    renderEditor({
      tabs: [mockTab],
      activeTabPath: mockEntry.path,
    })

    const editable = screen.getByTestId('blocknote-editable')
    expect(editable).toHaveAttribute('spellcheck', 'false')
    expect(editable).toHaveAttribute('autocorrect', 'off')
    expect(editable).toHaveAttribute('autocomplete', 'off')
    expect(editable).toHaveAttribute('autocapitalize', 'off')
  })

  it('renders breadcrumb bar with action buttons', async () => {
    renderEditor({
      tabs: [mockTab],
      activeTabPath: mockEntry.path,
    })

    expect(screen.getByRole('button', { name: 'Open the raw editor' })).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More note actions' }), {
      button: 0,
      ctrlKey: false,
    })
    expect(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Delete this note' })).toBeInTheDocument()
  })

  it('keeps editor chrome visible while active note content is loading', () => {
    renderEditor({
      tabs: [],
      activeTabPath: mockEntry.path,
      entries: [mockEntry],
      inspectorCollapsed: false,
      inspectorEntry: mockEntry,
      inspectorContent: mockContent,
    })

    expect(screen.getByTestId('breadcrumb-filename-trigger')).toHaveTextContent('test')
    expect(screen.getAllByText('Properties').length).toBeGreaterThan(0)
    expect(screen.queryByText('Select a note to start editing')).not.toBeInTheDocument()
    expect(screen.queryByTestId('blocknote-view')).not.toBeInTheDocument()

    const skeleton = screen.getByTestId('editor-content-skeleton')
    expect(skeleton.closest('.editor-content-wrapper')).not.toBeNull()
    expect(skeleton.closest('.editor-scroll-area')).not.toBeNull()
  })

  it('hides the legacy title field for untitled draft notes', () => {
    const draftEntry: VaultEntry = {
      ...mockEntry,
      path: '/vault/untitled-note-1700000000.md',
      filename: 'untitled-note-1700000000.md',
      title: 'Untitled Note 1700000000',
      hasH1: false,
    }
    const draftTab = {
      entry: draftEntry,
      content: '---\ntype: Note\nstatus: Active\n---\n',
    }

    render(
      <Editor
        {...defaultProps}
        tabs={[draftTab]}
        activeTabPath={draftEntry.path}
        entries={[draftEntry]}
        getNoteStatus={() => 'unsaved'}
      />
    )

    expect(screen.queryByTestId('title-field-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('blocknote-view')).toBeInTheDocument()
  })

  it('renders git diff in the breadcrumb overflow menu when file is modified', async () => {
    render(
      <Editor
        {...defaultProps}
        tabs={[mockTab]}
        activeTabPath={mockEntry.path}
        getNoteStatus={() => 'modified'}
        onLoadDiff={async () => '+ added line'}
      />
    )
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More note actions' }), {
      button: 0,
      ctrlKey: false,
    })
    expect(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Git diff' })).toBeInTheDocument()
  })

  it('includes inspector panel', () => {
    render(
      <Editor
        {...defaultProps}
        inspectorCollapsed={false}
        inspectorEntry={mockEntry}
        inspectorContent={mockContent}
      />
    )
    // Inspector renders "Properties" header
    expect(screen.getAllByText('Properties').length).toBeGreaterThan(0)
  })

  it('renders the table of contents panel from the active note content', async () => {
    mockEditor.document = [
      { id: 'toc-heading', type: 'heading', content: [{ type: 'text', text: 'Table Heading' }], props: { level: 2 }, children: [] },
    ]

    render(
      <Editor
        {...defaultProps}
        tabs={[mockTab]}
        activeTabPath={mockEntry.path}
        inspectorEntry={mockEntry}
        inspectorContent={`${mockContent}\n\n## Table Heading`}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open table of contents' }))

    expect(screen.getByTestId('table-of-contents-panel')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Table Heading' })).toBeInTheDocument()
  })

  // Regression: editor content did not appear on first load because BlockNote's
  // replaceBlocks/insertBlocks internally calls flushSync, which fails silently
  // when invoked from within React's useEffect. Fix: defer via queueMicrotask.
  it('applies parsed content blocks via deferred microtask (regression: flushSync-in-lifecycle)', async () => {
    const testBlocks = [
      { id: 'b1', type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }], props: {}, children: [] },
    ]
    mockEditor.tryParseMarkdownToBlocks.mockResolvedValue(testBlocks)
    mockEditor.replaceBlocks.mockClear()
    mockEditor.insertBlocks.mockClear()

    render(
      <Editor
        {...defaultProps}
        tabs={[mockTab]}
        activeTabPath={mockEntry.path}
      />
    )

    // Content swap is deferred via queueMicrotask — should NOT be called synchronously
    expect(mockEditor.replaceBlocks).not.toHaveBeenCalled()

    // After microtask + async parse resolve, blocks should be applied
    await vi.waitFor(() => {
      expect(mockEditor.replaceBlocks).toHaveBeenCalled()
    })

    // Clean up mock for other tests
    mockEditor.tryParseMarkdownToBlocks.mockResolvedValue([])
    mockEditor.replaceBlocks.mockClear()
    mockEditor.insertBlocks.mockClear()
  })

  it('does not apply note A raw content to note B when raw mode closes during note B load', async () => {
    resetVaultConfigStore()
    bindVaultConfigStore(
      {
        zoom: null,
        view_mode: null,
        editor_mode: null,
        tag_colors: null,
        status_colors: null,
        property_display_modes: null,
        inbox: null,
      },
      vi.fn(),
    )

    const rawToggleRef = { current: (() => {}) as () => void }
    const onContentChange = vi.fn()
    const noteA = {
      entry: {
        ...mockEntry,
        path: '/vault/project/note-a.md',
        filename: 'note-a.md',
        title: 'Note A',
      },
      content: '---\ntitle: Note A\n---\n\n# Note A\n\nAlpha body.',
    }
    const noteBEntry: VaultEntry = {
      ...mockEntry,
      path: '/vault/project/note-b.md',
      filename: 'note-b.md',
      title: 'Note B',
    }
    const noteB = {
      entry: noteBEntry,
      content: '---\ntitle: Note B\n---\n\n# Note B\n\nBravo body.',
    }

    const { rerender } = render(
      <Editor
        {...defaultProps}
        tabs={[noteA]}
        activeTabPath={noteA.entry.path}
        entries={[noteA.entry, noteBEntry]}
        onContentChange={onContentChange}
        rawToggleRef={rawToggleRef}
      />,
    )

    await vi.waitFor(() => {
      expect(typeof rawToggleRef.current).toBe('function')
    })

    await act(async () => {
      await rawToggleRef.current()
    })
    onContentChange.mockClear()
    mockEditor.tryParseMarkdownToBlocks.mockClear()
    mockEditor.replaceBlocks.mockClear()

    rerender(
      <Editor
        {...defaultProps}
        tabs={[noteA]}
        activeTabPath={noteB.entry.path}
        entries={[noteA.entry, noteBEntry]}
        onContentChange={onContentChange}
        rawToggleRef={rawToggleRef}
      />,
    )

    await act(async () => {
      await rawToggleRef.current()
    })

    expect(onContentChange).not.toHaveBeenCalledWith(noteB.entry.path, noteA.content)

    rerender(
      <Editor
        {...defaultProps}
        tabs={[noteA, noteB]}
        activeTabPath={noteB.entry.path}
        entries={[noteA.entry, noteB.entry]}
        onContentChange={onContentChange}
        rawToggleRef={rawToggleRef}
      />,
    )

    await vi.waitFor(() => {
      expect(mockEditor.tryParseMarkdownToBlocks).toHaveBeenCalledWith(expect.stringContaining('Note B'))
    })
    expect(mockEditor.tryParseMarkdownToBlocks).not.toHaveBeenCalledWith(expect.stringContaining('Note A'))

    resetVaultConfigStore()
  })

  it('updates the open raw editor when tab content changes externally', async () => {
    resetVaultConfigStore()
    bindVaultConfigStore(
      {
        zoom: null,
        view_mode: null,
        editor_mode: null,
        tag_colors: null,
        status_colors: null,
        property_display_modes: null,
        inbox: null,
      },
      vi.fn(),
    )

    const rawToggleRef = { current: (() => {}) as () => void }
    const initialContent = '---\nowner: [[Alice]]\nstatus: Active\n---\n\n# Test Project\n\nBody.\n'
    const updatedContent = '---\nowner: [[Bob]]\nstatus: Active\n---\n\n# Test Project\n\nBody.\n'
    const initialTab = { entry: mockEntry, content: initialContent }
    const updatedTab = { entry: mockEntry, content: updatedContent }

    const { rerender } = render(
      <Editor
        {...defaultProps}
        tabs={[initialTab]}
        activeTabPath={mockEntry.path}
        entries={[mockEntry]}
        rawToggleRef={rawToggleRef}
      />,
    )

    await vi.waitFor(() => {
      expect(typeof rawToggleRef.current).toBe('function')
    })

    await act(async () => {
      await rawToggleRef.current()
    })

    await vi.waitFor(() => {
      expect(screen.getByTestId('raw-editor-codemirror').textContent).toContain('owner: [[Alice]]')
    })

    rerender(
      <Editor
        {...defaultProps}
        tabs={[updatedTab]}
        activeTabPath={mockEntry.path}
        entries={[mockEntry]}
        rawToggleRef={rawToggleRef}
      />,
    )

    await vi.waitFor(() => {
      expect(screen.getByTestId('raw-editor-codemirror').textContent).toContain('owner: [[Bob]]')
    })

    resetVaultConfigStore()
  })

  it('opens raw mode from unchanged rich content without rewriting pasted markdown source', async () => {
    resetVaultConfigStore()
    bindVaultConfigStore(
      {
        zoom: null,
        view_mode: null,
        editor_mode: null,
        tag_colors: null,
        status_colors: null,
        property_display_modes: null,
        inbox: null,
      },
      vi.fn(),
    )

    const rawToggleRef = { current: (() => {}) as () => void }
    const sourceContent = '---\ntitle: Pasted\n---\nFirst pasted line\nSecond pasted line\n'
    const pastedTab = { entry: mockEntry, content: sourceContent }
    const originalMarkdownSerializer = mockEditor.blocksToMarkdownLossy.getMockImplementation()
    mockEditor.blocksToMarkdownLossy.mockReturnValue('First pasted line\\\\\n\\\\\nSecond pasted line\n')

    try {
      render(
        <Editor
          {...defaultProps}
          tabs={[pastedTab]}
          activeTabPath={mockEntry.path}
          entries={[mockEntry]}
          rawToggleRef={rawToggleRef}
        />,
      )

      await vi.waitFor(() => {
        expect(typeof rawToggleRef.current).toBe('function')
      })

      await act(async () => {
        await rawToggleRef.current()
      })

      await vi.waitFor(() => {
        expect(screen.getByTestId('raw-editor-codemirror').textContent).toContain('First pasted line')
      })
      expect(screen.getByTestId('raw-editor-codemirror').textContent).toContain('Second pasted line')
      expect(screen.getByTestId('raw-editor-codemirror').textContent).not.toContain('\\\\')
    } finally {
      mockEditor.blocksToMarkdownLossy.mockImplementation(originalMarkdownSerializer)
      resetVaultConfigStore()
    }
  })
})

describe('applyPendingRawExitContent', () => {
  it('overrides only the matching tab when raw content is newer than tab state', () => {
    const pending = {
      path: mockEntry.path,
      content: '---\ntype: Note\nstatus: Active\n---\n| Head 1 | Head 2 | Head 3 |\n| --- | --- | --- |\n| A | B | C |\n',
    }

    const result = applyPendingRawExitContent([mockTab, otherTab], pending)

    expect(result[0]).toEqual({ ...mockTab, content: pending.content })
    expect(result[1]).toBe(otherTab)
  })

  it('returns the original tabs array when the pending raw content is already synced', () => {
    const tabs = [mockTab, otherTab]
    const pending = { path: mockEntry.path, content: mockContent }

    expect(applyPendingRawExitContent(tabs, pending)).toBe(tabs)
  })
})

describe('raw-mode sync content guards', () => {
  it('does not emit a content change when entering raw mode normalizes markdown', () => {
    const onContentChange = vi.fn()
    const rawLatestContentRef = { current: null as string | null }

    const result = syncActiveTabIntoRawBuffer({
      editor: mockEditor as never,
      activeTabPath: mockEntry.path,
      activeTabContent: mockContent,
      rawLatestContentRef,
    })

    expect(result).toBe('---\ntitle: Test Project\nis_a: Project\nStatus: Active\n---\n# Test Project\n\nThis is a test note with some words to count.\n')
    expect(rawLatestContentRef.current).toBe(result)
    expect(onContentChange).not.toHaveBeenCalled()
  })

  it('captures the latest serialized markdown when entering raw mode', () => {
    const rawLatestContentRef = { current: null as string | null }

    mockEditor.blocksToMarkdownLossy.mockReturnValueOnce('# Test Project\n\nUpdated body\n')

    const result = syncActiveTabIntoRawBuffer({
      editor: mockEditor as never,
      activeTabPath: mockEntry.path,
      activeTabContent: mockContent,
      rawLatestContentRef,
    })

    expect(result).toBe('---\ntitle: Test Project\nis_a: Project\nStatus: Active\n---\n# Test Project\n\nUpdated body\n')
    expect(rawLatestContentRef.current).toBe(result)
  })

  it('keeps raw-mode serialization portable for vault attachment images', () => {
    const rawLatestContentRef = { current: null as string | null }

    mockEditor.blocksToMarkdownLossy.mockReturnValueOnce(
      '# Test Project\n\n![shot](asset://localhost/%2Fvault%2Fattachments%2Fshot.png)\n',
    )

    const result = syncActiveTabIntoRawBuffer({
      editor: mockEditor as never,
      activeTabPath: mockEntry.path,
      activeTabContent: mockContent,
      rawLatestContentRef,
      vaultPath: '/vault',
    })

    expect(result).toBe(
      '---\ntitle: Test Project\nis_a: Project\nStatus: Active\n---\n# Test Project\n\n![shot](attachments/shot.png)\n',
    )
    expect(rawLatestContentRef.current).toBe(result)
  })

  it('serializes rich math nodes back to Markdown source when entering raw mode', () => {
    const rawLatestContentRef = { current: null as string | null }
    const originalDocument = mockEditor.document
    const originalSerializer = mockEditor.blocksToMarkdownLossy.getMockImplementation()

    try {
      mockEditor.document = [
        {
          id: 'math-inline',
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Inline ', styles: {} },
            { type: 'mathInline', props: { latex: 'E=mc^2' } },
          ],
          props: {},
          children: [],
        },
        {
          id: 'math-block',
          type: 'mathBlock',
          props: { latex: '\\int_0^1 x\\,dx' },
          children: [],
        },
      ]
      mockEditor.blocksToMarkdownLossy.mockImplementation((blocks: unknown[]) => (
        (blocks as Array<{ content?: Array<{ text?: string }> }>)
          .map((block) => block.content?.map((item) => item.text ?? '').join('') ?? '')
          .join('\n\n')
      ))

      const result = syncActiveTabIntoRawBuffer({
        editor: mockEditor as never,
        activeTabPath: mockEntry.path,
        activeTabContent: mockContent,
        rawLatestContentRef,
      })

      expect(result).toBe(
        '---\ntitle: Test Project\nis_a: Project\nStatus: Active\n---\nInline $E=mc^2$\n\n$$\n\\int_0^1 x\\,dx\n$$\n',
      )
      expect(rawLatestContentRef.current).toBe(result)
    } finally {
      mockEditor.document = originalDocument
      mockEditor.blocksToMarkdownLossy.mockImplementation(originalSerializer)
    }
  })

  it('does not emit a content change when leaving raw mode without user edits', () => {
    const onContentChange = vi.fn()
    const normalizedContent = '---\ntitle: Test Project\nis_a: Project\nStatus: Active\n---\n# Test Project\n\nThis is a test note with some words to count.\n'

    const result = rememberPendingRawExitContent({
      activeTabPath: mockEntry.path,
      activeTabContent: mockContent,
      rawInitialContent: normalizedContent,
      rawLatestContentRef: { current: normalizedContent },
      onContentChange,
    })

    expect(result).toBeNull()
    expect(onContentChange).not.toHaveBeenCalled()
  })

  it('emits a content change when leaving raw mode with edited markdown', () => {
    const onContentChange = vi.fn()
    const normalizedContent = '---\ntitle: Test Project\nis_a: Project\nStatus: Active\n---\n# Test Project\n\nThis is a test note with some words to count.\n'
    const editedContent = `${normalizedContent}\nUpdated in raw mode\n`

    const result = rememberPendingRawExitContent({
      activeTabPath: mockEntry.path,
      activeTabContent: mockContent,
      rawInitialContent: normalizedContent,
      rawLatestContentRef: { current: editedContent },
      onContentChange,
    })

    expect(result).toEqual({ path: mockEntry.path, content: editedContent })
    expect(onContentChange).toHaveBeenCalledWith(mockEntry.path, editedContent)
  })
})

describe('click empty editor space', () => {
  it('focuses editor at end of last block when clicking empty space below content', () => {
    mockEditor.focus.mockClear()
    mockEditor.setTextCursorPosition.mockClear()

    render(
      <Editor {...defaultProps} tabs={[mockTab]} activeTabPath={mockEntry.path} />
    )

    const container = document.querySelector('.editor__blocknote-container')
    expect(container).toBeTruthy()

    // Click directly on the container (simulates clicking empty space below content)
    fireEvent.click(container!)

    expect(mockEditor.setTextCursorPosition).toHaveBeenCalledWith('1', 'end')
    expect(mockEditor.focus).toHaveBeenCalled()
  })

  it('does not interfere with clicks on contenteditable elements', () => {
    mockEditor.focus.mockClear()
    mockEditor.setTextCursorPosition.mockClear()

    render(
      <Editor {...defaultProps} tabs={[mockTab]} activeTabPath={mockEntry.path} />
    )

    // Simulate clicking on a contenteditable child (which ProseMirror would handle)
    const container = document.querySelector('.editor__blocknote-container')!
    const editableDiv = document.createElement('div')
    editableDiv.setAttribute('contenteditable', 'true')
    container.appendChild(editableDiv)

    fireEvent.click(editableDiv)

    expect(mockEditor.setTextCursorPosition).not.toHaveBeenCalled()
    // Clean up
    container.removeChild(editableDiv)
  })

  it('restores the cursor to the H1 when clicking the title block', async () => {
    mockEditor.focus.mockClear()
    mockEditor.setTextCursorPosition.mockClear()
    mockEditor.document = [
      { id: 'title', type: 'heading', content: [{ type: 'text', text: 'Alpha Project', styles: {} }], props: { level: 1 }, children: [] },
      { id: 'body', type: 'paragraph', content: [], props: {}, children: [] },
    ]

    render(
      <Editor {...defaultProps} tabs={[mockTab]} activeTabPath={mockEntry.path} />
    )

    const container = document.querySelector('.editor__blocknote-container')!
    const editableDiv = document.createElement('div')
    editableDiv.setAttribute('contenteditable', 'true')
    const heading = document.createElement('h1')
    heading.textContent = 'Alpha Project'
    heading.setAttribute('data-content-type', 'heading')
    heading.setAttribute('data-level', '1')
    editableDiv.appendChild(heading)
    container.appendChild(editableDiv)

    fireEvent.click(heading)
    await act(() => Promise.resolve())

    expect(mockEditor.setTextCursorPosition).toHaveBeenCalledWith('title', 'end')
    expect(mockEditor.focus).toHaveBeenCalled()

    container.removeChild(editableDiv)
  })

})

describe('archived note behavior', () => {
  it('shows archive banner immediately when entry changes to archived (reactive)', () => {
    const { rerender } = render(
      <Editor {...defaultProps} tabs={[mockTab]} activeTabPath={mockEntry.path} onUnarchiveNote={vi.fn()} />
    )
    expect(screen.queryByTestId('archived-note-banner')).not.toBeInTheDocument()

    const archivedEntry = { ...mockEntry, archived: true }
    const archivedTab = { entry: archivedEntry, content: mockContent }
    rerender(
      <Editor {...defaultProps} entries={[archivedEntry]} tabs={[archivedTab]} activeTabPath={mockEntry.path} onUnarchiveNote={vi.fn()} />
    )
    expect(screen.getByTestId('archived-note-banner')).toBeInTheDocument()
  })

  it('removes archive banner immediately when entry is unarchived (reactive)', () => {
    const archivedEntry: VaultEntry = { ...mockEntry, archived: true }
    const archivedTab = { entry: archivedEntry, content: mockContent }
    const { rerender } = render(
      <Editor {...defaultProps} entries={[archivedEntry]} tabs={[archivedTab]} activeTabPath={archivedEntry.path} onUnarchiveNote={vi.fn()} />
    )
    expect(screen.getByTestId('archived-note-banner')).toBeInTheDocument()

    const unarchivedEntry = { ...archivedEntry, archived: false }
    const unarchivedTab = { entry: unarchivedEntry, content: mockContent }
    rerender(
      <Editor {...defaultProps} entries={[unarchivedEntry]} tabs={[unarchivedTab]} activeTabPath={archivedEntry.path} onUnarchiveNote={vi.fn()} />
    )
    expect(screen.queryByTestId('archived-note-banner')).not.toBeInTheDocument()
  })
})

describe('wikilink autocomplete', () => {
  const entries: VaultEntry[] = [
    { ...mockEntry, title: 'Alpha Project', filename: 'alpha.md', aliases: ['al'] },
    { ...mockEntry, title: 'Beta Review', filename: 'beta.md', path: '/vault/beta.md', aliases: [] },
    { ...mockEntry, title: 'Gamma Notes', filename: 'gamma.md', path: '/vault/gamma.md', aliases: ['gam'] },
  ]

  function renderWithEntries() {
    capturedGetItems = null
    mockFilterSuggestionItems.mockClear()
    render(
      <Editor
        {...defaultProps}
        tabs={[mockTab]}
        activeTabPath={mockEntry.path}
        entries={entries}
      />
    )
  }

  it('returns empty array for query shorter than 2 characters', async () => {
    renderWithEntries()
    expect(capturedGetItems).toBeTruthy()
    expect(await capturedGetItems!('')).toEqual([])
    expect(await capturedGetItems!('a')).toEqual([])
    // filterSuggestionItems should NOT be called for short queries
    expect(mockFilterSuggestionItems).not.toHaveBeenCalled()
  })

  it('returns items for query of 2+ characters', async () => {
    renderWithEntries()
    const items = await capturedGetItems!('Al')
    expect(items.length).toBeGreaterThan(0)
    expect(mockFilterSuggestionItems).toHaveBeenCalled()
  })

  it('normalizes BlockNote trigger-prefixed wikilink queries before filtering', async () => {
    renderWithEntries()
    const items = await capturedGetItems!('[[Al')
    expect(items.length).toBeGreaterThan(0)
  })

  it('limits results to MAX_RESULTS (20)', async () => {
    // Create many entries that will all match
    const manyEntries = Array.from({ length: 50 }, (_, i) => ({
      ...mockEntry,
      title: `Match Item ${i}`,
      filename: `match-${i}.md`,
      path: `/vault/match-${i}.md`,
      aliases: [],
    }))

    capturedGetItems = null
    mockFilterSuggestionItems.mockImplementation((items: unknown[]) => items)
    render(
      <Editor
        {...defaultProps}
        tabs={[mockTab]}
        activeTabPath={mockEntry.path}
        entries={manyEntries}
      />
    )

    const items = await capturedGetItems!('Match')
    expect(items.length).toBeLessThanOrEqual(20)
    mockFilterSuggestionItems.mockImplementation((items: unknown[]) => items)
  })

  it('each item has onItemClick that inserts wikilink', async () => {
    renderWithEntries()
    mockEditor.insertInlineContent.mockClear()
    const items = await capturedGetItems!('Alpha')
    expect(items.length).toBeGreaterThan(0)
    items[0].onItemClick()
    expect(mockEditor.insertInlineContent).toHaveBeenCalledWith([
      { type: 'wikilink', props: { target: 'vault/project/test' } },
      ' ',
    ], { updateSelection: true })
  })

  it('deduplicates entries with the same path', async () => {
    const dupEntries: VaultEntry[] = [
      { ...mockEntry, title: 'Dup Note', filename: 'dup.md', path: '/vault/dup.md', aliases: [] },
      { ...mockEntry, title: 'Dup Note Copy', filename: 'dup.md', path: '/vault/dup.md', aliases: [] },
      { ...mockEntry, title: 'Other Note', filename: 'other.md', path: '/vault/other.md', aliases: [] },
    ]
    capturedGetItems = null
    mockFilterSuggestionItems.mockImplementation((items: unknown[]) => items)
    render(
      <Editor
        {...defaultProps}
        tabs={[mockTab]}
        activeTabPath={mockEntry.path}
        entries={dupEntries}
      />
    )
    const items = await capturedGetItems!('Note')
    const paths = items.map((i: { path: string }) => i.path)
    expect(new Set(paths).size).toBe(paths.length)
    mockFilterSuggestionItems.mockImplementation((items: unknown[]) => items)
  })

  it('shows Note chips and icons for explicit Note entries while keeping untyped entries neutral', async () => {
    const mixedEntries: VaultEntry[] = [
      { ...mockEntry, title: 'Test Project', filename: 'proj.md', path: '/vault/proj.md', isA: 'Project', aliases: [] },
      { ...mockEntry, title: 'Test Plain', filename: 'plain.md', path: '/vault/plain.md', isA: null, aliases: [] },
      { ...mockEntry, title: 'Test Explicit', filename: 'explicit.md', path: '/vault/explicit.md', isA: 'Note', aliases: [] },
    ]
    capturedGetItems = null
    mockFilterSuggestionItems.mockImplementation((items: unknown[]) => items)
    render(
      <Editor
        {...defaultProps}
        tabs={[mockTab]}
        activeTabPath={mockEntry.path}
        entries={mixedEntries}
      />
    )
    const items = await capturedGetItems!('Test')
    // Typed entries should have noteType, color, and a left-side icon
    const project = items.find((i: { title: string }) => i.title === 'Test Project')
    expect(project).toBeDefined()
    expect(project!.noteType).toBe('Project')
    expect(project!.typeColor).toBeTruthy()
    expect(project!.TypeIcon).toBeTruthy()

    const explicitNote = items.find((i: { title: string }) => i.title === 'Test Explicit')
    expect(explicitNote).toBeDefined()
    expect(explicitNote!.noteType).toBe('Note')
    expect(explicitNote!.typeColor).toBeTruthy()
    expect(explicitNote!.TypeIcon).toBeTruthy()

    // Untyped entries should remain neutral
    const plainNote = items.find((i: { title: string }) => i.title === 'Test Plain')
    expect(plainNote).toBeDefined()
    expect(plainNote!.noteType).toBeUndefined()
    expect(plainNote!.typeColor).toBeUndefined()
    mockFilterSuggestionItems.mockImplementation((items: unknown[]) => items)
  })

  it('disambiguates entries with the same title by appending folder name', async () => {
    const sameTitle: VaultEntry[] = [
      { ...mockEntry, title: 'Standup', filename: 'standup.md', path: '/vault/work/standup.md', aliases: [] },
      { ...mockEntry, title: 'Standup', filename: 'standup.md', path: '/vault/personal/standup.md', aliases: [] },
    ]
    capturedGetItems = null
    mockFilterSuggestionItems.mockImplementation((items: unknown[]) => items)
    render(
      <Editor
        {...defaultProps}
        tabs={[mockTab]}
        activeTabPath={mockEntry.path}
        entries={sameTitle}
      />
    )
    const items = await capturedGetItems!('Standup')
    expect(items).toHaveLength(2)
    const titles = items.map((i: { title: string }) => i.title)
    expect(new Set(titles).size).toBe(2)
    expect(titles).toContain('Standup (work)')
    expect(titles).toContain('Standup (personal)')
    mockFilterSuggestionItems.mockImplementation((items: unknown[]) => items)
  })
})

describe('person @mention autocomplete', () => {
  const personEntry: VaultEntry = {
    ...mockEntry,
    title: 'Matteo Cellini',
    filename: 'matteo-cellini.md',
    path: '/vault/person/matteo-cellini.md',
    isA: 'Person',
    aliases: ['Matteo'],
  }
  const nonPersonEntry: VaultEntry = {
    ...mockEntry,
    title: 'Build Laputa App',
    filename: 'laputa-app.md',
    path: '/vault/project/laputa-app.md',
    isA: 'Project',
    aliases: [],
  }
  const entries = [personEntry, nonPersonEntry]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock
  let getPersonItems: ((query: string) => Promise<any[]>) | null = null

  function renderForMention() {
    mockFilterSuggestionItems.mockClear()
    mockFilterSuggestionItems.mockImplementation((items: unknown[]) => items)
    render(
      <Editor
        {...defaultProps}
        tabs={[mockTab]}
        activeTabPath={mockEntry.path}
        entries={entries}
      />
    )
    getPersonItems = capturedGetItemsByTrigger['@'] ?? null
  }

  it('registers a SuggestionMenuController with @ trigger', () => {
    renderForMention()
    expect(getPersonItems).toBeTruthy()
  })

  it('returns only Person entries for matching query', async () => {
    renderForMention()
    const items = await getPersonItems!('Mat')
    expect(items.length).toBe(1)
    expect(items[0].title).toBe('Matteo Cellini')
  })

  it('excludes non-Person entries', async () => {
    renderForMention()
    const items = await getPersonItems!('Lap')
    expect(items).toHaveLength(0)
  })

  it('works with single-character query', async () => {
    renderForMention()
    const items = await getPersonItems!('M')
    expect(items.length).toBeGreaterThan(0)
  })

  it('inserts a wikilink when person item is clicked', async () => {
    renderForMention()
    mockEditor.insertInlineContent.mockClear()
    const items = await getPersonItems!('Matteo')
    expect(items.length).toBeGreaterThan(0)
    items[0].onItemClick()
    expect(mockEditor.insertInlineContent).toHaveBeenCalledWith([
      { type: 'wikilink', props: { target: 'vault/person/matteo-cellini' } },
      ' ',
    ], { updateSelection: true })
  })

  it('shows Person type badge on results', async () => {
    renderForMention()
    const items = await getPersonItems!('Matteo')
    expect(items[0].noteType).toBe('Person')
    expect(items[0].typeColor).toBeTruthy()
  })
})
