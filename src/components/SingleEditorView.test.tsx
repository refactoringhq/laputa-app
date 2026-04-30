import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { VaultEntry } from '../types'
import { RUNTIME_STYLE_NONCE } from '../lib/runtimeStyleNonce'

const state = vi.hoisted(() => ({
  capturedLinkToolbarProps: null as null | Record<string, unknown>,
  capturedToolbarProps: null as null | Record<string, unknown>,
  capturedSuggestionProps: {} as Record<string, Record<string, unknown>>,
  capturedImageDropArgs: null as null | Record<string, unknown>,
  capturedBlockNoteOnChange: null as null | (() => void),
  capturedMantineGetStyleNonce: null as null | (() => string),
  hoverGuardMock: vi.fn(),
  imageDropState: { isDragOver: false },
  linkActivationMock: vi.fn(),
  personMentionCandidates: [] as Record<string, unknown>[],
  wikilinkEntriesRef: { current: [] as VaultEntry[] },
  wikilinkCandidates: [] as Record<string, unknown>[],
}))

vi.mock('@blocknote/react', () => ({
  ComponentsContext: {
    Provider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  },
  BlockNoteViewRaw: (props: {
    children?: ReactNode
    editable?: boolean
    className?: string
    formattingToolbar?: boolean
    linkToolbar?: boolean
    slashMenu?: boolean
    sideMenu?: boolean
    onChange?: () => void
    theme?: string
  }) => {
    const {
      children,
      editable,
      className,
      formattingToolbar,
      linkToolbar,
      slashMenu,
      sideMenu,
      ...restProps
    } = props
    state.capturedBlockNoteOnChange = props.onChange ?? null
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
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
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
  TolariaSideMenu: () => <div data-testid="tolaria-side-menu" />,
}))

vi.mock('./useEditorLinkActivation', () => ({
  useEditorLinkActivation: (containerRef: unknown, onNavigateWikilink: unknown) => (
    state.linkActivationMock(containerRef, onNavigateWikilink)
  ),
}))

import { openExternalUrl } from '../utils/url'
import { SingleEditorView } from './SingleEditorView'

const mockOpenExternalUrl = vi.mocked(openExternalUrl)

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
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

function createEditor() {
  const cursorBlock = { id: 'cursor-block', type: 'paragraph', content: [], children: [] }
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
    _tiptapEditor: { commands: { setContent: vi.fn() } },
    focus: vi.fn(),
    getTextCursorPosition: vi.fn(() => ({ block: cursorBlock })),
    insertBlocks: vi.fn(),
    insertInlineContent: vi.fn(),
    setTextCursorPosition: vi.fn(),
  }
}

function renderEditorHarness(editor = createEditor()) {
  render(
    <SingleEditorView
      editor={editor as never}
      entries={[makeEntry()]}
      onNavigateWikilink={vi.fn()}
    />,
  )

  const container = screen.getByTestId('blocknote-view').closest('.editor__blocknote-container')
  expect(container).toBeTruthy()
  return { container: container!, editor }
}

function createCodeBlockFixture(text: string) {
  const codeBlock = document.createElement('div')
  codeBlock.setAttribute('data-content-type', 'codeBlock')
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = text
  pre.appendChild(code)
  codeBlock.appendChild(pre)
  return { codeBlock, code }
}

function selectNodeContents(node: Node) {
  const range = document.createRange()
  range.selectNodeContents(node)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function appendToolbarButton(container: Element, className: string, text: string) {
  const toolbar = document.createElement('div')
  toolbar.className = className
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = text
  toolbar.appendChild(button)
  container.appendChild(toolbar)
  return button
}

describe('SingleEditorView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.capturedLinkToolbarProps = null
    state.capturedToolbarProps = null
    state.capturedSuggestionProps = {}
    state.capturedImageDropArgs = null
    state.capturedBlockNoteOnChange = null
    state.capturedMantineGetStyleNonce = null
    state.imageDropState.isDragOver = false
    state.personMentionCandidates = []
    state.wikilinkEntriesRef.current = []
    state.wikilinkCandidates = []
    mockOpenExternalUrl.mockClear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.classList.remove('dark')
    delete window.__laputaTest
  })

  it('registers the seeded BlockNote test bridge, applies column widths, and cleans it up on unmount', async () => {
    const editor = createEditor()
    const entries = [makeEntry()]
    const { unmount } = render(
      <SingleEditorView
        editor={editor as never}
        entries={entries}
        onNavigateWikilink={vi.fn()}
      />,
    )

    expect(state.wikilinkEntriesRef.current).toEqual(entries)
    expect(typeof window.__laputaTest?.seedBlockNoteTable).toBe('function')

    await act(async () => {
      await window.__laputaTest?.seedBlockNoteTable?.([120, null, 80])
    })

    expect(editor.blocksToHTMLLossy).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'table',
        content: expect.objectContaining({
          type: 'tableContent',
          columnWidths: [120, null, 80],
        }),
      }),
      expect.objectContaining({ type: 'paragraph' }),
    ])
    expect(editor._tiptapEditor.commands.setContent).toHaveBeenCalledWith('<table>seeded</table>')
    expect(editor.focus).toHaveBeenCalled()

    unmount()

    expect(window.__laputaTest?.seedBlockNoteTable).toBeUndefined()
  })

  it('shows the drag overlay and inserts dropped images after the active cursor block', () => {
    state.imageDropState.isDragOver = true
    const editor = createEditor()

    render(
      <SingleEditorView
        editor={editor as never}
        entries={[makeEntry()]}
        onNavigateWikilink={vi.fn()}
        vaultPath="/vault"
      />,
    )

    expect(screen.getByText('Drop image here')).toBeInTheDocument()

    act(() => {
      (state.capturedImageDropArgs?.onImageUrl as (url: string) => void)('https://example.com/image.png')
    })

    expect(editor.insertBlocks).toHaveBeenCalledWith(
      [{ type: 'image', props: { url: 'https://example.com/image.png' } }],
      expect.objectContaining({ id: 'cursor-block' }),
      'after',
    )
  })

  it('wires the toolbar mouse guard and suggestion item click handlers', () => {
    const editor = createEditor()
    render(
      <SingleEditorView
        editor={editor as never}
        entries={[makeEntry()]}
        onNavigateWikilink={vi.fn()}
      />,
    )

    expect(state.hoverGuardMock).toHaveBeenCalledOnce()
    expect(state.linkActivationMock).toHaveBeenCalledOnce()
    expect(screen.getByTestId('blocknote-view')).toHaveAttribute('data-link-toolbar', 'false')
    expect(state.capturedLinkToolbarProps).toEqual(expect.objectContaining({
      linkToolbar: expect.any(Function),
      floatingUIOptions: expect.objectContaining({
        elementProps: expect.objectContaining({
          onMouseDownCapture: expect.any(Function),
        }),
      }),
    }))

    const onMouseDownCapture = (
      (state.capturedToolbarProps?.floatingUIOptions as { elementProps: { onMouseDownCapture: (event: { target: HTMLElement; preventDefault: () => void }) => void } })
    ).elementProps.onMouseDownCapture
    const menuTrigger = document.createElement('button')
    menuTrigger.setAttribute('aria-haspopup', 'menu')
    const menuPreventDefault = vi.fn()
    onMouseDownCapture({ target: menuTrigger, preventDefault: menuPreventDefault })
    expect(menuPreventDefault).not.toHaveBeenCalled()

    const normalTarget = document.createElement('div')
    const normalPreventDefault = vi.fn()
    onMouseDownCapture({ target: normalTarget, preventDefault: normalPreventDefault })
    expect(normalPreventDefault).toHaveBeenCalledOnce()

    const linkToolbarMouseDownCapture = (
      (state.capturedLinkToolbarProps?.floatingUIOptions as { elementProps: { onMouseDownCapture: (event: { target: HTMLElement; preventDefault: () => void }) => void } })
    ).elementProps.onMouseDownCapture
    const linkInput = document.createElement('input')
    const linkInputPreventDefault = vi.fn()
    linkToolbarMouseDownCapture({ target: linkInput, preventDefault: linkInputPreventDefault })
    expect(linkInputPreventDefault).not.toHaveBeenCalled()

    const linkActionTarget = document.createElement('button')
    const linkActionPreventDefault = vi.fn()
    linkToolbarMouseDownCapture({ target: linkActionTarget, preventDefault: linkActionPreventDefault })
    expect(linkActionPreventDefault).toHaveBeenCalledOnce()

    const onWikiItemClick = vi.fn()
    const onMentionItemClick = vi.fn()
    ;(state.capturedSuggestionProps['[['].onItemClick as (item: { onItemClick: () => void }) => void)({ onItemClick: onWikiItemClick })
    ;(state.capturedSuggestionProps['@'].onItemClick as (item: { onItemClick: () => void }) => void)({ onItemClick: onMentionItemClick })

    expect(onWikiItemClick).toHaveBeenCalledOnce()
    expect(onMentionItemClick).toHaveBeenCalledOnce()
  })

  it('renders when a reload returns an entry with missing suggestion metadata', () => {
    const reloadedEntry = {
      ...makeEntry({ path: '/vault/project/reloaded.md', title: 'Reloaded' }),
      filename: undefined,
      aliases: undefined,
      isA: undefined,
    } as unknown as VaultEntry

    expect(() => {
      render(
        <SingleEditorView
          editor={createEditor() as never}
          entries={[reloadedEntry]}
          onNavigateWikilink={vi.fn()}
        />,
      )
    }).not.toThrow()
  })

  it('ignores stale suggestion item clicks after the editor DOM disconnects', () => {
    const editor = createEditor()
    editor.domElement = document.createElement('div')

    render(
      <SingleEditorView
        editor={editor as never}
        entries={[makeEntry()]}
        onNavigateWikilink={vi.fn()}
      />,
    )

    const staleItemClick = vi.fn(() => {
      throw new TypeError('Cannot read properties of undefined (reading isConnected)')
    })

    expect(() => {
      ;(state.capturedSuggestionProps['[['].onItemClick as (item: { onItemClick: () => void }) => void)({
        onItemClick: staleItemClick,
      })
    }).not.toThrow()
    expect(staleItemClick).not.toHaveBeenCalled()
  })

  it('guards stale click handlers stored on wikilink suggestion items', async () => {
    const editor = createEditor()
    editor.domElement = document.createElement('div')
    const staleItemClick = vi.fn(() => {
      throw new TypeError('Cannot read properties of undefined (reading isConnected)')
    })
    state.wikilinkCandidates = [{
      title: 'Alpha',
      path: '/vault/project/alpha.md',
      onItemClick: staleItemClick,
    }]

    render(
      <SingleEditorView
        editor={editor as never}
        entries={[makeEntry()]}
        onNavigateWikilink={vi.fn()}
      />,
    )

    const getItems = state.capturedSuggestionProps['[['].getItems as (
      query: string
    ) => Promise<Array<{ onItemClick: () => void }>>
    const items = await getItems('al')

    expect(items).toHaveLength(1)
    expect(() => items[0].onItemClick()).not.toThrow()
    expect(staleItemClick).not.toHaveBeenCalled()
  })

  it('passes the active document theme to BlockNote', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    document.documentElement.classList.add('dark')

    render(
      <SingleEditorView
        editor={createEditor() as never}
        entries={[makeEntry()]}
        onNavigateWikilink={vi.fn()}
      />,
    )

    expect(screen.getByTestId('blocknote-view')).toHaveAttribute('theme', 'dark')
    expect(screen.getByTestId('blocknote-view')).toHaveAttribute('data-mantine-color-scheme', 'dark')
  })

  it('passes the runtime CSP style nonce to Mantine fallback style tags', () => {
    render(
      <SingleEditorView
        editor={createEditor() as never}
        entries={[makeEntry()]}
        onNavigateWikilink={vi.fn()}
      />,
    )

    expect(state.capturedMantineGetStyleNonce?.()).toBe(RUNTIME_STYLE_NONCE)
  })

  it('defers rich-editor change propagation until IME composition ends', async () => {
    const editor = createEditor()
    const onChange = vi.fn()

    render(
      <SingleEditorView
        editor={editor as never}
        entries={[makeEntry()]}
        onNavigateWikilink={vi.fn()}
        onChange={onChange}
      />,
    )

    const blockNoteView = screen.getByTestId('blocknote-view')

    fireEvent.compositionStart(blockNoteView)
    act(() => {
      state.capturedBlockNoteOnChange?.()
    })
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.compositionEnd(blockNoteView)
    await act(async () => {
      await Promise.resolve()
    })

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('copies selected fenced code text without markdown escape backslashes', () => {
    const json = '{\n  "id": "Demo"\n}'
    const { container } = renderEditorHarness()
    const { codeBlock, code } = createCodeBlockFixture(json)
    container.appendChild(codeBlock)
    selectNodeContents(code)

    const clipboardData = { setData: vi.fn() }
    fireEvent.copy(code, { clipboardData })

    expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', json)
  })

  it('does not override full-note copy selections that merely include a code block', () => {
    const { container } = renderEditorHarness()
    const paragraph = document.createElement('p')
    paragraph.textContent = 'Before'
    const { codeBlock, code } = createCodeBlockFixture('const value = 1')
    container.append(paragraph, codeBlock)

    const range = document.createRange()
    range.setStartBefore(paragraph)
    range.setEndAfter(codeBlock)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const clipboardData = { setData: vi.fn() }
    fireEvent.copy(code, { clipboardData })

    expect(clipboardData.setData).not.toHaveBeenCalled()
  })

  it('routes clicks on the empty title wrapper back into the H1 block', async () => {
    const editor = createEditor()

    render(
      <SingleEditorView
        editor={editor as never}
        entries={[makeEntry()]}
        onNavigateWikilink={vi.fn()}
      />,
    )

    const container = screen.getByTestId('blocknote-view').closest('.editor__blocknote-container')
    expect(container).toBeTruthy()

    const titleBlockOuter = document.createElement('div')
    titleBlockOuter.className = 'bn-block-outer'

    const titleBlock = document.createElement('div')
    titleBlock.className = 'bn-block'

    const titleHeading = document.createElement('div')
    titleHeading.setAttribute('data-content-type', 'heading')
    titleHeading.setAttribute('data-level', '1')

    const inlineHeading = document.createElement('div')
    inlineHeading.className = 'bn-inline-content'
    titleHeading.appendChild(inlineHeading)
    titleBlock.appendChild(titleHeading)
    titleBlockOuter.appendChild(titleBlock)
    container?.appendChild(titleBlockOuter)

    fireEvent.click(titleBlockOuter)
    await act(async () => {
      await Promise.resolve()
    })

    expect(editor.setTextCursorPosition).toHaveBeenCalledWith('heading-block', 'end')
    expect(editor.focus).toHaveBeenCalled()
  })

  it('ignores editor-container click handling for link toolbar interactions', () => {
    const { container, editor } = renderEditorHarness()
    const linkAction = appendToolbarButton(container, 'bn-link-toolbar', 'Open in a new tab')

    fireEvent.click(linkAction)

    expect(editor.setTextCursorPosition).not.toHaveBeenCalled()
    expect(editor.focus).not.toHaveBeenCalled()
  })

  it('ignores editor-container click handling for BlockNote side-menu actions', () => {
    const { container, editor } = renderEditorHarness()
    const action = appendToolbarButton(container, 'bn-side-menu', 'Add block')

    fireEvent.click(action)

    expect(editor.setTextCursorPosition).not.toHaveBeenCalled()
    expect(editor.focus).not.toHaveBeenCalled()
  })

  it('falls back to the nearest editable block when the trailing block has no inline content', () => {
    const editor = createEditor()
    editor.document = [
      { id: 'paragraph-block', type: 'paragraph', content: [], children: [] },
      { id: 'image-block', type: 'image', children: [] },
    ]
    editor.setTextCursorPosition = vi.fn((blockId: string) => {
      if (blockId === 'image-block') {
        throw new Error('Attempting to set selection anchor in block without content (id image-block)')
      }
    })

    render(
      <SingleEditorView
        editor={editor as never}
        entries={[makeEntry()]}
        onNavigateWikilink={vi.fn()}
      />,
    )

    const container = screen.getByTestId('blocknote-view').closest('.editor__blocknote-container')
    expect(container).toBeTruthy()

    expect(() => fireEvent.click(container!)).not.toThrow()
    expect(editor.setTextCursorPosition).toHaveBeenCalledWith('paragraph-block', 'end')
    expect(editor.focus).toHaveBeenCalled()
  })

  it('routes the custom link-toolbar open action through openExternalUrl', () => {
    render(
      <SingleEditorView
        editor={createEditor() as never}
        entries={[makeEntry()]}
        onNavigateWikilink={vi.fn()}
      />,
    )

    const LinkToolbarComponent = state.capturedLinkToolbarProps?.linkToolbar as React.ComponentType<{
      url: string
      text: string
      range: { from: number; to: number }
      setToolbarOpen?: (open: boolean) => void
      setToolbarPositionFrozen?: (open: boolean) => void
    }>

    render(
      <LinkToolbarComponent
        url="https://example.com/docs"
        text="Example"
        range={{ from: 1, to: 8 }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open in a new tab' }))

    expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://example.com/docs')
  })
})
