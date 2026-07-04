import { render as rtlRender, act } from '@testing-library/react'
import type { ComponentProps, PropsWithChildren, ReactElement } from 'react'
import { expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { clearParsedNoteBlockCache } from '../hooks/editorParsedBlockCache'
import type { VaultEntry } from '../types'

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

const mockEditor = vi.hoisted(() => ({
  tryParseMarkdownToBlocks: vi.fn(async () => [] as unknown[]),
  replaceBlocks: vi.fn(),
  insertBlocks: vi.fn(),
  document: [{ id: '1', type: 'paragraph', content: [], props: {}, children: [] }],
  getBlock: vi.fn((id: string) => (
    id === '1'
      ? { id: '1', type: 'paragraph', content: [], props: {}, children: [] }
      : undefined
  )),
  getTextCursorPosition: vi.fn(() => ({
    block: { id: '1', type: 'paragraph', content: [], props: {}, children: [] },
  })),
  insertInlineContent: vi.fn(),
  headless: false,
  onMount: vi.fn((cb: () => void) => { cb(); return () => {} }),
  prosemirrorView: {} as Record<string, unknown>,
  blocksToHTMLLossy: vi.fn(() => ''),
  blocksToMarkdownLossy: vi.fn(() => '# Test Project\n\nThis is a test note with some words to count.\n'),
  _tiptapEditor: { commands: { setContent: vi.fn() } },
  focus: vi.fn(),
  setTextCursorPosition: vi.fn(),
  transact: vi.fn((callback: () => void) => callback()),
  updateBlock: vi.fn(),
}))
const blockNoteCreation = vi.hoisted(() => ({
  options: [] as unknown[],
}))
const blockNoteViewState = vi.hoisted(() => ({
  onChange: null as (() => void) | null,
}))

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

export const mockFilterSuggestionItems = vi.fn((...args: unknown[]) => args[0] ?? [])
vi.mock('@blocknote/core/extensions', () => ({
  filterSuggestionItems: (...args: unknown[]) => mockFilterSuggestionItems(...args),
}))

type SuggestionItem = {
  title?: string
  path?: string
  workspace?: unknown
  noteType?: string
  typeColor?: unknown
  TypeIcon?: unknown
  onItemClick: () => void
}
type SuggestionControllerProps = {
  triggerCharacter: string
  getItems: (query: string) => Promise<SuggestionItem[]>
}
export const capturedSuggestionState = {
  getItemsByTrigger: {} as Record<string, (query: string) => Promise<SuggestionItem[]>>,
  getItems: null as ((query: string) => Promise<SuggestionItem[]>) | null,
}
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
    capturedSuggestionState.getItemsByTrigger[props.triggerCharacter] = props.getItems
    if (props.triggerCharacter === '[[') capturedSuggestionState.getItems = props.getItems
    return null
  },
  GridSuggestionMenuController: (props: SuggestionControllerProps) => {
    capturedSuggestionState.getItemsByTrigger[props.triggerCharacter] = props.getItems
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

export function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: TooltipProvider })
}

export const mockEntry: VaultEntry = {
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

export const mockContent = `---
title: Test Project
is_a: Project
Status: Active
---

# Test Project

This is a test note with some words to count.
`

export const mockTab = { entry: mockEntry, content: mockContent }

export const defaultProps = {
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

export function EditorTestHarness(props: EditorComponentProps) {
  return <Editor {...props} />
}

export function renderEditor(overrides: Partial<EditorComponentProps> = {}) {
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

export function runConfiguredPlainTextPaste(text: string) {
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

export async function flushEditorSwapWork() {
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

export function resetEditorTestState() {
  blockNoteCreation.options = []
  blockNoteViewState.onChange = null
  mockEditor.document = [{ id: '1', type: 'paragraph', content: [], props: {}, children: [] }]
  capturedSuggestionState.getItems = null
  capturedSuggestionState.getItemsByTrigger = {}
  clearParsedNoteBlockCache()
}

export { blockNoteCreation, blockNoteViewState, mockEditor }

it('provides the shared Editor test harness', () => {
  expect(mockEditor).toBeDefined()
})
