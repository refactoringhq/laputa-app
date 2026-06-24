import { render, screen } from '@testing-library/react'
import type { ComponentType, ReactNode } from 'react'
import { expect, vi } from 'vitest'
import type { VaultEntry } from '../types'
import { TooltipProvider } from './ui/tooltip'

const state = vi.hoisted(() => ({
  capturedLinkToolbarProps: null as null | Record<string, unknown>,
  capturedToolbarProps: null as null | Record<string, unknown>,
  capturedSuggestionProps: {} as Record<string, Record<string, unknown>>,
  capturedImageDropArgs: null as null | Record<string, unknown>,
  capturedBlockNoteOnChange: null as null | (() => void),
  capturedMantineGetStyleNonce: null as null | (() => string),
  blockNoteViewError: null as Error | null,
  blockNoteViewErrorOnce: false,
  hoverGuardMock: vi.fn(),
  imageDropState: { isDragOver: false },
  linkActivationMock: vi.fn(),
  personMentionCandidates: [] as Record<string, unknown>[],
  wikilinkEntriesRef: { current: [] as VaultEntry[] },
  wikilinkCandidates: [] as Record<string, unknown>[],
}))

export function getSingleEditorViewTestState() {
  return state
}

vi.mock('@blocknote/react', () => ({
  ComponentsContext: {
    Provider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  },
  BlockNoteViewRaw: (props: {
    children?: ReactNode
    editable?: boolean
    className?: string
    emojiPicker?: boolean
    formattingToolbar?: boolean
    linkToolbar?: boolean
    slashMenu?: boolean
    sideMenu?: boolean
    onChange?: () => void
    theme?: string
  }) => {
    if (state.blockNoteViewError) {
      const error = state.blockNoteViewError
      if (state.blockNoteViewErrorOnce) {
        state.blockNoteViewError = null
        state.blockNoteViewErrorOnce = false
      }
      throw error
    }

    const {
      children,
      editable,
      className,
      emojiPicker,
      formattingToolbar,
      linkToolbar,
      slashMenu,
      sideMenu,
      ...restProps
    } = props
    state.capturedBlockNoteOnChange = props.onChange ?? null
    void emojiPicker
    void formattingToolbar
    void slashMenu
    void sideMenu

    return (
      <div
        data-testid="blocknote-view"
        data-editable={editable !== false ? 'true' : 'false'}
        data-link-toolbar={linkToolbar !== false ? 'true' : 'false'}
        className={className}
        {...restProps}
      >
        {children}
      </div>
    )
  },
  LinkToolbarController: (props: Record<string, unknown>) => {
    state.capturedLinkToolbarProps = props
    return <div data-testid="link-toolbar-controller" />
  },
  LinkToolbar: ({ children }: { children?: ReactNode }) => (
    <div className="bn-link-toolbar">{children}</div>
  ),
  EditLinkButton: () => <button type="button">Edit Link</button>,
  DeleteLinkButton: () => <button type="button">Remove Link</button>,
  SideMenuController: () => <div data-testid="side-menu-controller" />,
  SuggestionMenuController: (props: Record<string, unknown>) => {
    state.capturedSuggestionProps[String(props.triggerCharacter)] = props
    return <div data-testid={`suggestion-${String(props.triggerCharacter)}`} />
  },
  GridSuggestionMenuController: (props: Record<string, unknown>) => {
    state.capturedSuggestionProps[String(props.triggerCharacter)] = props
    return <div data-testid={`grid-suggestion-${String(props.triggerCharacter)}`} />
  },
  useComponentsContext: () => ({
    LinkToolbar: {
      Button: ({
        children,
        icon,
        label,
        onClick,
      }: {
        children?: ReactNode
        icon?: ReactNode
        label?: string
        onClick?: () => void
      }) => (
        <button onClick={onClick} type="button">
          {icon}
          {label}
          {children}
        </button>
      ),
    },
  }),
  useCreateBlockNote: vi.fn(),
  useDictionary: () => ({
    link_toolbar: {
      open: { tooltip: 'Open in a new tab' },
    },
  }),
}))

vi.mock('@blocknote/mantine', () => ({
  components: {},
}))

vi.mock('@mantine/core', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    MantineContext: React.createContext(null),
    MantineProvider: ({
      children,
      getStyleNonce,
    }: {
      children?: ReactNode
      getStyleNonce?: () => string
    }) => {
      state.capturedMantineGetStyleNonce = getStyleNonce ?? null
      return <>{children}</>
    },
  }
})

vi.mock('../hooks/useTheme', () => ({
  useEditorTheme: () => ({ cssVars: { '--editor-accent': '#abc' } }),
}))

vi.mock('../hooks/useImageDrop', () => ({
  useImageDrop: (args: Record<string, unknown>) => {
    state.capturedImageDropArgs = args
    return state.imageDropState
  },
}))

vi.mock('../utils/url', () => ({
  normalizeExternalUrl: vi.fn((url: string) => (
    url.startsWith('http://') || url.startsWith('https://') ? url : null
  )),
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
  openLocalFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../utils/typeColors', () => ({
  buildTypeEntryMap: () => ({}),
}))

vi.mock('../utils/wikilinkSuggestions', () => ({
  MIN_QUERY_LENGTH: 2,
  deduplicateByPath: <T,>(items: T[]) => items,
  preFilterWikilinks: () => state.wikilinkCandidates,
}))

vi.mock('../utils/personMentionSuggestions', () => ({
  PERSON_MENTION_MIN_QUERY: 1,
  filterPersonMentions: () => state.personMentionCandidates,
}))

vi.mock('../utils/suggestionEnrichment', () => ({
  attachClickHandlers: <T,>(items: T[]) => items,
  enrichSuggestionItems: <T,>(items: T[]) => items,
  hasMultipleSuggestionWorkspaces: () => false,
}))

vi.mock('./WikilinkSuggestionMenu', () => ({
  WikilinkSuggestionMenu: () => <div data-testid="wikilink-suggestion-menu" />,
}))

vi.mock('./editorSchema', () => ({
  _wikilinkEntriesRef: state.wikilinkEntriesRef,
}))

vi.mock('./blockNoteSideMenuHoverGuard', () => ({
  useBlockNoteSideMenuHoverGuard: (containerRef: unknown) => state.hoverGuardMock(containerRef),
}))

vi.mock('./tolariaEditorFormattingConfig', () => ({
  getTolariaSlashMenuItems: vi.fn(async () => []),
}))

vi.mock('./tolariaEditorFormatting', () => ({
  TolariaFormattingToolbar: () => <div data-testid="tolaria-formatting-toolbar" />,
  TolariaFormattingToolbarController: (props: Record<string, unknown>) => {
    state.capturedToolbarProps = props
    return <div data-testid="tolaria-formatting-toolbar-controller" />
  },
}))

vi.mock('./tolariaBlockNoteSideMenu', () => ({
  TolariaCollapsedHeadingsController: () => <div data-testid="tolaria-collapsed-headings-controller" />,
  TolariaSideMenu: () => <div data-testid="tolaria-side-menu" />,
}))

vi.mock('./useEditorLinkActivation', () => ({
  useEditorLinkActivation: (containerRef: unknown, onNavigateWikilink: unknown, vaultPath: unknown) => (
    state.linkActivationMock(containerRef, onNavigateWikilink, vaultPath)
  ),
}))

import { openExternalUrl, openLocalFile } from '../utils/url'
import { SingleEditorView } from './SingleEditorView'

export const mockOpenExternalUrl = vi.mocked(openExternalUrl)
export const mockOpenLocalFile = vi.mocked(openLocalFile)

export function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    path: '/vault/project/alpha.md',
    filename: 'alpha.md',
    title: 'Alpha',
    isA: 'Project',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: 'Active',
    archived: false,
    modifiedAt: 1,
    createdAt: 1,
    fileSize: 10,
    snippet: '',
    wordCount: 0,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    sidebarLabel: null,
    template: null,
    sort: null,
    view: null,
    visible: null,
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    outgoingLinks: [],
    properties: {},
    hasH1: true,
    fileKind: 'markdown',
    ...overrides,
  }
}

export function createEditor() {
  const cursorBlock = { id: 'cursor-block', type: 'paragraph', content: [], children: [] }
  const tiptapDom = document.createElement('div')
  tiptapDom.getBoundingClientRect = vi.fn(() => ({
    bottom: 420,
    height: 360,
    left: 120,
    right: 720,
    toJSON: () => ({}),
    top: 60,
    width: 600,
    x: 120,
    y: 60,
  }))

  return {
    document: [
      { id: 'heading-block', type: 'heading', content: [], children: [] },
      cursorBlock,
    ],
    domElement: undefined as HTMLElement | undefined,
    tryParseMarkdownToBlocks: vi.fn(async () => [
      { type: 'table', content: { type: 'tableContent' } },
    ]),
    blocksToHTMLLossy: vi.fn(() => '<table>seeded</table>'),
    _tiptapEditor: {
      commands: {
        setContent: vi.fn(),
        setTextSelection: vi.fn(),
      },
      state: { doc: { content: { size: 100 } } },
      view: {
        dom: tiptapDom,
        posAtCoords: vi.fn(() => ({ pos: 1 })),
      },
    },
    focus: vi.fn(),
    getBlock: vi.fn(() => null),
    getTextCursorPosition: vi.fn(() => ({ block: cursorBlock })),
    insertBlocks: vi.fn(),
    insertInlineContent: vi.fn(),
    replaceBlocks: vi.fn(() => {
      state.blockNoteViewError = null
    }),
    setTextCursorPosition: vi.fn(),
  }
}

export function renderEditorHarness(editor = createEditor(), options: { vaultPath?: string } = {}) {
  render(
    <SingleEditorView
      editor={editor as never}
      entries={[makeEntry()]}
      onNavigateWikilink={vi.fn()}
      vaultPath={options.vaultPath}
    />,
    { wrapper: TooltipProvider },
  )

  const container = screen.getByTestId('blocknote-view').closest('.editor__blocknote-container')
  expect(container).toBeTruthy()
  return { container: container!, editor }
}

export function renderEditorHarnessInScrollArea(editor = createEditor()) {
  render(
    <div className="editor-scroll-area" data-testid="editor-scroll-area">
      <div className="editor-content-wrapper">
        <SingleEditorView
          editor={editor as never}
          entries={[makeEntry()]}
          onNavigateWikilink={vi.fn()}
        />
      </div>
    </div>,
    { wrapper: TooltipProvider },
  )

  const scrollArea = screen.getByTestId('editor-scroll-area')
  const container = screen.getByTestId('blocknote-view').closest('.editor__blocknote-container')
  expect(container).toBeTruthy()
  return { container: container!, editor, scrollArea }
}

export function createCodeBlockFixture(text: string) {
  const codeBlock = document.createElement('div')
  codeBlock.setAttribute('data-content-type', 'codeBlock')
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = text
  pre.appendChild(code)
  codeBlock.appendChild(pre)
  return { codeBlock, code }
}

export function createParagraphFixture(text: string) {
  const paragraph = document.createElement('p')
  const textNode = document.createTextNode(text)
  paragraph.appendChild(textNode)
  return { paragraph, textNode }
}

export function selectNodeContents(node: Node) {
  const range = document.createRange()
  range.selectNodeContents(node)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

export function appendToolbarButton(container: Element, className: string, text: string) {
  const toolbar = document.createElement('div')
  toolbar.className = className
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = text
  toolbar.appendChild(button)
  container.appendChild(toolbar)
  return button
}

export function createTitleHeadingFixture(container: Element) {
  const titleHeading = document.createElement('div')
  titleHeading.setAttribute('data-content-type', 'heading')
  titleHeading.setAttribute('data-level', '1')

  const inlineHeading = document.createElement('div')
  inlineHeading.className = 'bn-inline-content'
  titleHeading.appendChild(inlineHeading)
  container.appendChild(titleHeading)

  return inlineHeading
}

export function createListItemFixture(container: Element, contentType: 'bulletListItem' | 'checkListItem', text = '') {
  const listItem = document.createElement('div')
  listItem.setAttribute('data-content-type', contentType)

  const inlineContent = document.createElement('div')
  inlineContent.className = 'bn-inline-content'
  inlineContent.textContent = text
  listItem.appendChild(inlineContent)
  container.appendChild(listItem)

  return inlineContent
}

export function clipboardDataFor(formats: Record<string, string>) {
  return {
    getData: vi.fn((format: string) => formats[format] ?? ''),
  }
}

type LinkToolbarHarnessProps = {
  url: string
  text: string
  range: { from: number; to: number }
  setToolbarOpen?: (open: boolean) => void
  setToolbarPositionFrozen?: (open: boolean) => void
}

export function renderLinkToolbarOpenButton(options: {
  url: string
  text?: string
  vaultPath?: string
}) {
  render(
    <SingleEditorView
      editor={createEditor() as never}
      entries={[makeEntry()]}
      onNavigateWikilink={vi.fn()}
      vaultPath={options.vaultPath}
    />,
  )

  const LinkToolbarComponent = state.capturedLinkToolbarProps?.linkToolbar as ComponentType<LinkToolbarHarnessProps>

  render(
    <LinkToolbarComponent
      url={options.url}
      text={options.text ?? 'Example'}
      range={{ from: 1, to: 8 }}
    />,
  )
}
