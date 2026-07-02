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
  audioParse: vi.fn(() => undefined),
  BlockNoteSchema: { create: () => ({ extend: () => ({}) }) },
  createAudioBlockConfig: vi.fn(() => ({})),
  createCodeBlockSpec: vi.fn(() => ({})),
  createExtension: (factory: unknown) => () => factory,
  createStyleSpec: vi.fn(() => ({})),
  createVideoBlockConfig: vi.fn(() => ({})),
  defaultInlineContentSpecs: {},
  filterSuggestionItems: vi.fn(() => []),
  videoParse: vi.fn(() => undefined),
}))

vi.mock('@blocknote/code-block', () => ({
  codeBlockOptions: {},
}))

const mockFilterSuggestionItems = vi.fn((...args: unknown[]) => args[0] ?? [])
vi.mock('@blocknote/core/extensions', () => ({
  filterSuggestionItems: (...args: unknown[]) => mockFilterSuggestionItems(...args),
}))

type SuggestionControllerProps = {
  triggerCharacter: string
  getItems: (query: string) => Promise<unknown[]>
}
const capturedGetItemsByTrigger: Record<string, (query: string) => Promise<unknown[]>> = {}
let capturedGetItems: ((query: string) => Promise<unknown[]>) | null = null
vi.mock('@blocknote/react', () => ({
  AudioBlock: () => null,
  AudioToExternalHTML: () => null,
  createReactBlockSpec: () => () => ({}),
  createReactInlineContentSpec: () => ({ render: () => null }),
  VideoBlock: () => null,
  VideoToExternalHTML: () => null,
  useCreateBlockNote: (options: unknown) => {
    blockNoteCreation.options.push(options)
    return mockEditor
  },
  useBlockNoteEditor: () => mockEditor,
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
  SuggestionMenuController: (props: SuggestionControllerProps) => {
    capturedGetItemsByTrigger[props.triggerCharacter] = props.getItems
    if (props.triggerCharacter === '[[') capturedGetItems = props.getItems
    return null
  },
  GridSuggestionMenuController: (props: SuggestionControllerProps) => {
    capturedGetItemsByTrigger[props.triggerCharacter] = props.getItems
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

vi.mock('./SheetEditor', () => ({
  SheetEditor: ({ path }: { path: string }) => <div data-testid="sheet-editor" data-path={path} />,
}))

import { Editor } from './Editor'
import type { VaultEntry } from '../types'
import { bindVaultConfigStore, resetVaultConfigStore } from '../utils/vaultConfigStore'
import { TooltipProvider } from '@/components/ui/tooltip'
import { clearParsedNoteBlockCache } from '../hooks/editorParsedBlockCache'

type EditorComponentProps = ComponentProps<typeof Editor>
type BlockNotePasteHandlerOptions = {
  plainTextAsMarkdown?: boolean
  prioritizeMarkdownOverHTML?: boolean
}
type BlockNotePasteHandlerContext = {
  defaultPasteHandler: (options?: BlockNotePasteHandlerOptions) => boolean | undefined
  editor: { pasteText: (text: string) => boolean | undefined }
  event: ClipboardEvent
}
type BlockNoteCreationOptions = {
  pasteHandler?: (context: BlockNotePasteHandlerContext) => boolean | undefined
}

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

function latestBlockNoteOptions(): BlockNoteCreationOptions {
  const options = blockNoteCreation.options.at(-1)
  if (!options || typeof options !== 'object') {
    throw new Error('BlockNote editor was not created')
  }
  return options as BlockNoteCreationOptions
}

function clipboardEventForPlainText(text: string): ClipboardEvent {
  const clipboardData = {
    getData: vi.fn((type: string) => type === 'text/plain' ? text : ''),
    types: ['text/plain'],
  }

  return { clipboardData } as unknown as ClipboardEvent
}

function runConfiguredPlainTextPaste(text: string) {
  renderEditor()

  const pasteHandler = latestBlockNoteOptions().pasteHandler
  if (!pasteHandler) {
    throw new Error('BlockNote paste handler was not configured')
  }

  const pasteText = vi.fn(() => true)
  const defaultPasteHandler = vi.fn(() => true)
  const handled = pasteHandler({
    defaultPasteHandler,
    editor: { pasteText },
    event: clipboardEventForPlainText(text),
  })

  return { defaultPasteHandler, handled, pasteText }
}

async function flushEditorSwapWork() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      if (typeof window.requestAnimationFrame === 'function') {
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve())
        })
      }
      await new Promise(resolve => setTimeout(resolve, 0))
      await Promise.resolve()
    })
  }
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

  it('pastes SQL wildcard plain text without treating the asterisk as Markdown', () => {
    const { defaultPasteHandler, handled, pasteText } = runConfiguredPlainTextPaste('SELECT * FROM OPENQUERY')

    expect(handled).toBe(true)
    expect(pasteText).toHaveBeenCalledWith('SELECT * FROM OPENQUERY')
    expect(defaultPasteHandler).not.toHaveBeenCalled()
  })

  it('keeps plain Markdown emphasis on the BlockNote default paste path', () => {
    const { defaultPasteHandler, pasteText } = runConfiguredPlainTextPaste('*italic*')

    expect(defaultPasteHandler).toHaveBeenCalledTimes(1)
    expect(pasteText).not.toHaveBeenCalled()
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
      expect.stringMatching(/^asset:\/\/localhost\/%2Fvault%2Fassets%2Freport\.pdf\?tolaria_pdf_preview=/u),
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
        <div data-testid="note-list-container" role="listbox" aria-label="Notes" tabIndex={0} />
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
      await flushEditorSwapWork()

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

  it('does not parse active sheets through the hidden rich editor', async () => {
    const sheetEntry: VaultEntry = {
      ...mockEntry,
      path: '/vault/project/model.md',
      filename: 'model.md',
      title: 'Model',
      display: 'sheet',
    }
    mockEditor.tryParseMarkdownToBlocks.mockClear()

    renderEditor({
      tabs: [{
        entry: sheetEntry,
        content: '---\n_display: sheet\n---\nMetric,January\nRevenue,1200',
      }],
      activeTabPath: sheetEntry.path,
      entries: [sheetEntry],
    })
    await flushEditorSwapWork()

    expect(screen.getByTestId('sheet-editor')).toHaveAttribute('data-path', sheetEntry.path)
    expect(mockEditor.tryParseMarkdownToBlocks).not.toHaveBeenCalled()
  })

  it('keeps the rich editor out of spellcheck without disabling IME autocorrection', () => {
    renderEditor({
      tabs: [mockTab],
      activeTabPath: mockEntry.path,
    })

    const editable = screen.getByTestId('blocknote-editable')
    expect(editable).toHaveAttribute('spellcheck', 'false')
    expect(editable).toHaveAttribute('autocomplete', 'off')
    expect(editable).not.toHaveAttribute('autocorrect')
    expect(editable).not.toHaveAttribute('autocapitalize')
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
    expect(screen.queryByTestId('editor-content-skeleton')).not.toBeInTheDocument()
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
    expect(await screen.findByRole('button', { name: 'Table Heading' }, { timeout: 5000 })).toBeInTheDocument()
  })

  // Regression: editor content did not appear on first load because BlockNote's
  // replaceBlocks/insertBlocks internally calls flushSync, which fails silently
  // when invoked from within React's useEffect. Fix: defer outside the effect.
  it('applies parsed content blocks after deferred swap work (regression: flushSync-in-lifecycle)', async () => {
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

  it('prefixes inserted wikilinks when the selected note is in another workspace', async () => {
    const personalWorkspace = {
      id: 'personal',
      label: 'Personal',
      alias: 'personal',
      path: '/personal',
      shortLabel: 'PE',
      color: null,
      icon: null,
      mounted: true,
      available: true,
      defaultForNewNotes: true,
    }
    const teamWorkspace = {
      id: 'team',
      label: 'Team',
      alias: 'team',
      path: '/team',
      shortLabel: 'TE',
      color: null,
      icon: null,
      mounted: true,
      available: true,
      defaultForNewNotes: false,
    }
    const source = {
      ...mockEntry,
      path: '/personal/source.md',
      filename: 'source.md',
      title: 'Source',
      workspace: personalWorkspace,
    }
    const target = {
      ...mockEntry,
      path: '/team/projects/alpha.md',
      filename: 'alpha.md',
      title: 'Alpha',
      workspace: teamWorkspace,
    }
    capturedGetItems = null
    mockFilterSuggestionItems.mockImplementation((items: unknown[]) => items)
    render(
      <Editor
        {...defaultProps}
        tabs={[{ entry: source, content: '# Source\n' }]}
        activeTabPath={source.path}
        entries={[source, target]}
        vaultPath="/personal"
      />,
    )

    mockEditor.insertInlineContent.mockClear()
    const items = await capturedGetItems!('Alpha')
    expect(items[0].workspace).toBe(teamWorkspace)
    items[0].onItemClick()

    expect(mockEditor.insertInlineContent).toHaveBeenCalledWith([
      { type: 'wikilink', props: { target: 'team/projects/alpha' } },
      ' ',
    ], { updateSelection: true })
    mockFilterSuggestionItems.mockImplementation((items: unknown[]) => items)
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
