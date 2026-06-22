import {
  appendToolbarButton,
  clipboardDataFor,
  createCodeBlockFixture,
  createEditor,
  createListItemFixture,
  createParagraphFixture,
  createTitleHeadingFixture,
  getSingleEditorViewTestState,
  makeEntry,
  mockOpenExternalUrl,
  mockOpenLocalFile,
  renderEditorHarness,
  renderEditorHarnessInScrollArea,
  renderLinkToolbarOpenButton,
  selectNodeContents,
} from './SingleEditorView.testUtils'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../types'
import { RUNTIME_STYLE_NONCE } from '../lib/runtimeStyleNonce'
import { insertPlainTextFromClipboardText } from '../utils/plainTextPaste'
import { SingleEditorView } from './SingleEditorView'
import { TooltipProvider } from './ui/tooltip'

const state = getSingleEditorViewTestState()

async function expectSelectedParagraphCopy(sourceText: string, expectedText: string) {
  const { container } = renderEditorHarness()
  const { paragraph, textNode } = createParagraphFixture(sourceText)
  await act(async () => {
    container.appendChild(paragraph)
    await Promise.resolve()
  })
  selectNodeContents(textNode)

  const clipboardData = { setData: vi.fn() }
  fireEvent.copy(paragraph, { clipboardData })

  expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', expectedText)
}

function seedMouseSelectionPositions(editor: ReturnType<typeof createEditor>, firstPosition: number, finalPosition: number) {
  editor._tiptapEditor.view.posAtCoords
    .mockReturnValueOnce({ pos: firstPosition })
    .mockReturnValueOnce({ pos: finalPosition })
    .mockReturnValueOnce({ pos: finalPosition })
}

function dragPrimarySelection(target: Element, start: { clientX: number; clientY: number }, end: { clientX: number; clientY: number }) {
  fireEvent.mouseDown(target, { button: 0, ...start })
  fireEvent.mouseMove(window, { buttons: 1, ...end })
  fireEvent.mouseUp(window, end)
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
    state.blockNoteViewError = null
    state.blockNoteViewErrorOnce = false
    state.imageDropState.isDragOver = false
    state.personMentionCandidates = []
    state.wikilinkEntriesRef.current = []
    state.wikilinkCandidates = []
    mockOpenExternalUrl.mockClear()
    mockOpenLocalFile.mockClear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.classList.remove('dark')
    delete window.__laputaTest
  })

  it('repairs the live editor document before remounting after a stale missing-id block error', async () => {
    state.blockNoteViewError = new Error("Block doesn't have id")
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const editor = createEditor()
    editor.document = [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Recovered body', styles: {} }],
        children: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Recovered child', styles: {} }],
            children: [],
          },
        ],
      },
    ]

    try {
      render(
        <SingleEditorView
          editor={editor as never}
          entries={[makeEntry()]}
          onNavigateWikilink={vi.fn()}
        />,
        { wrapper: TooltipProvider, onRecoverableError: () => {} },
      )

      await waitFor(() => {
        expect(screen.getByTestId('blocknote-view')).toBeInTheDocument()
      })
      expect(screen.getByTestId('blocknote-view')).toHaveAttribute('data-editable', 'true')
      expect(editor.replaceBlocks).toHaveBeenCalledTimes(1)
      expect(editor.replaceBlocks.mock.calls[0][1]).toEqual([
        expect.objectContaining({
          id: expect.any(String),
          children: [],
        }),
        expect.objectContaining({
          id: expect.any(String),
          content: [{ type: 'text', text: 'Recovered child', styles: {} }],
          children: [],
        }),
      ])
    } finally {
      consoleError.mockRestore()
    }
  })

  it('remounts after a BlockNote table row index render error', async () => {
    state.blockNoteViewError = new RangeError(
      'Index 1 out of range for <tableRow(tableCell(tableParagraph("A")))>',
    )
    state.blockNoteViewErrorOnce = true
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const editor = createEditor()

    try {
      render(
        <SingleEditorView
          editor={editor as never}
          entries={[makeEntry()]}
          onNavigateWikilink={vi.fn()}
        />,
        { wrapper: TooltipProvider, onRecoverableError: () => {} },
      )

      await waitFor(() => {
        expect(screen.getByTestId('blocknote-view')).toBeInTheDocument()
      })
      expect(screen.getByTestId('blocknote-view')).toHaveAttribute('data-editable', 'true')
      expect(editor.replaceBlocks).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
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

  it('runs suggestion item clicks when BlockNote keeps the editor DOM outside the React container', () => {
    const editor = createEditor()
    editor.domElement = document.createElement('div')
    document.body.appendChild(editor.domElement)
    const itemClick = vi.fn()

    try {
      render(
        <SingleEditorView
          editor={editor as never}
          entries={[makeEntry()]}
          onNavigateWikilink={vi.fn()}
        />,
      )

      ;(state.capturedSuggestionProps['[['].onItemClick as (item: { onItemClick: () => void }) => void)({
        onItemClick: itemClick,
      })

      expect(itemClick).toHaveBeenCalledOnce()
    } finally {
      editor.domElement.remove()
    }
  })

  it('inserts the selected emoji from shortcode suggestions', async () => {
    const editor = createEditor()

    render(
      <SingleEditorView
        editor={editor as never}
        entries={[makeEntry()]}
        onNavigateWikilink={vi.fn()}
      />,
    )

    const getEmojiItems = state.capturedSuggestionProps[':'].getItems as (
      query: string
    ) => Promise<Array<{ id: string; name: string; onItemClick: () => void }>>

    const italyItems = await getEmojiItems(':it')
    expect(italyItems[0]).toMatchObject({ id: '🇮🇹' })
    expect(italyItems[0].name).toMatch(/italy/i)

    const items = await getEmojiItems(':rocket')
    const rocketItem = items.find(item => item.id === '🚀')

    expect(rocketItem).toMatchObject({ name: 'rocket' })
    rocketItem!.onItemClick()

    expect(editor.insertInlineContent).toHaveBeenCalledWith('🚀', { updateSelection: true })
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

  it('copies selected fenced code text without markdown escape backslashes', async () => {
    const json = '{\n  "id": "Demo"\n}'
    const { container } = renderEditorHarness()
    const { codeBlock, code } = createCodeBlockFixture(json)
    await act(async () => {
      container.appendChild(codeBlock)
      await Promise.resolve()
    })
    selectNodeContents(code)

    const clipboardData = { setData: vi.fn() }
    fireEvent.copy(code, { clipboardData })

    expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', json)
  })

  it('copies CJK fenced code text from the selected DOM fragment when selection text is mojibake', async () => {
    const text = 'const label = "中文測試"'
    const { container } = renderEditorHarness()
    const { codeBlock, code } = createCodeBlockFixture(text)
    await act(async () => {
      container.appendChild(codeBlock)
      await Promise.resolve()
    })

    const range = document.createRange()
    range.selectNodeContents(code)
    const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => range,
      toString: () => 'const label = "ä¸­æ–‡æ¸¬è©¦"',
    } as Selection)

    const clipboardData = { setData: vi.fn() }
    fireEvent.copy(code, { clipboardData })
    getSelection.mockRestore()

    expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', text)
  })

  it('copies fenced code from the code-block action button', async () => {
    const json = '{\n  "id": "Demo"\n}'
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const { container, editor } = renderEditorHarness()
    const { codeBlock } = createCodeBlockFixture(json)
    act(() => {
      container.appendChild(codeBlock)
    })

    fireEvent.mouseMove(codeBlock)
    const copyButton = await screen.findByRole('button', { name: 'Copy code to clipboard' })
    fireEvent.click(copyButton)

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(json))
    expect(editor.focus).not.toHaveBeenCalled()
  })

  it('keeps full-note copy selections from collapsing to code-block text only', async () => {
    const { container } = renderEditorHarness()
    const paragraph = document.createElement('p')
    paragraph.textContent = 'Before'
    const { codeBlock, code } = createCodeBlockFixture('const value = 1')
    await act(async () => {
      container.append(paragraph, codeBlock)
      await Promise.resolve()
    })

    const range = document.createRange()
    range.setStartBefore(paragraph)
    range.setEndAfter(codeBlock)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const clipboardData = { setData: vi.fn() }
    fireEvent.copy(code, { clipboardData })

    expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', 'Beforeconst value = 1')
    expect(clipboardData.setData).not.toHaveBeenCalledWith('text/plain', 'const value = 1')
  })

  it.each([
    {
      expectedText: 'Only copied words',
      name: 'copies ordinary selected editor text without appending a newline',
      sourceText: 'Only copied words',
    },
    {
      expectedText: 'First line\nSecond line',
      name: 'removes one synthetic terminal newline while preserving internal newlines',
      sourceText: 'First line\nSecond line\n',
    },
  ])('$name', async ({ expectedText, sourceText }) => {
    await expectSelectedParagraphCopy(sourceText, expectedText)
  })

  it('keeps selected rich text available as HTML when normalizing plain copy text', async () => {
    const { container } = renderEditorHarness()
    const paragraph = document.createElement('p')
    const strong = document.createElement('strong')
    strong.textContent = 'Bold copy'
    paragraph.appendChild(strong)
    await act(async () => {
      container.appendChild(paragraph)
      await Promise.resolve()
    })
    selectNodeContents(strong)

    const clipboardData = { setData: vi.fn() }
    fireEvent.copy(strong, { clipboardData })

    expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', 'Bold copy')
    expect(clipboardData.setData).toHaveBeenCalledWith('text/html', '<strong>Bold copy</strong>')
  })

  it('handles registered plain-text paste requests through BlockNote insertion', () => {
    const { container, editor } = renderEditorHarness()

    fireEvent.focus(container)

    expect(insertPlainTextFromClipboardText('Plain\nText')).toBe(true)
    expect(editor.focus).toHaveBeenCalled()
    expect(editor.insertInlineContent).toHaveBeenCalledWith('Plain\nText', {
      updateSelection: true,
    })
  })

  it('routes rich title-heading paste through safe plain-text inline insertion', () => {
    const { container, editor } = renderEditorHarness()
    const inlineHeading = createTitleHeadingFixture(container)
    const clipboardData = clipboardDataFor({
      'text/html': '<h1>Pasted <em>Title</em></h1><table><tr><td>Cell</td></tr></table>',
      'text/plain': 'Pasted Title\nCell',
    })

    const didBubble = fireEvent.paste(inlineHeading, { clipboardData })

    expect(didBubble).toBe(false)
    expect(editor.focus).toHaveBeenCalled()
    expect(editor.insertInlineContent).toHaveBeenCalledWith('Pasted Title\nCell', {
      updateSelection: true,
    })
  })

  it('leaves plain title-heading paste on BlockNote native handling', () => {
    const { container, editor } = renderEditorHarness()
    const inlineHeading = createTitleHeadingFixture(container)
    const clipboardData = clipboardDataFor({ 'text/plain': 'Plain Title' })

    const didBubble = fireEvent.paste(inlineHeading, { clipboardData })

    expect(didBubble).toBe(true)
    expect(editor.insertInlineContent).not.toHaveBeenCalled()
  })

  it.each([
    ['bulletListItem', 'Pasted bullet text'],
    ['checkListItem', 'Pasted checklist text'],
  ] as const)('routes plain paste in an empty %s through BlockNote insertion', (contentType, text) => {
    const { container, editor } = renderEditorHarness()
    const listItem = createListItemFixture(container, contentType)
    const clipboardData = clipboardDataFor({ 'text/plain': text })

    const didBubble = fireEvent.paste(listItem, { clipboardData })

    expect(didBubble).toBe(false)
    expect(editor.focus).toHaveBeenCalled()
    expect(editor.insertInlineContent).toHaveBeenCalledWith(text, {
      updateSelection: true,
    })
  })

  it('leaves non-empty list item paste on BlockNote native handling', () => {
    const { container, editor } = renderEditorHarness()
    const listItem = createListItemFixture(container, 'bulletListItem', 'Existing text')
    const clipboardData = clipboardDataFor({ 'text/plain': 'Plain Title' })

    const didBubble = fireEvent.paste(listItem, { clipboardData })

    expect(didBubble).toBe(true)
    expect(editor.insertInlineContent).not.toHaveBeenCalled()
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

  it('extends mouse selections from editor whitespace using clamped BlockNote coordinates', () => {
    const { container, editor } = renderEditorHarness()
    seedMouseSelectionPositions(editor, 4, 18)
    dragPrimarySelection(container, { clientX: 12, clientY: 72 }, { clientX: 680, clientY: 180 })

    expect(editor.focus).toHaveBeenCalled()
    expect(editor._tiptapEditor.view.posAtCoords).toHaveBeenNthCalledWith(1, {
      left: 121,
      top: 72,
    })
    expect(editor._tiptapEditor.commands.setTextSelection).toHaveBeenNthCalledWith(1, {
      from: 4,
      to: 4,
    })
    expect(editor._tiptapEditor.commands.setTextSelection).toHaveBeenLastCalledWith({
      from: 4,
      to: 18,
    })

    fireEvent.click(container)

    expect(editor.setTextCursorPosition).not.toHaveBeenCalled()
  })

  it('extends mouse selections from the surrounding editor scroll whitespace', () => {
    const { editor, scrollArea } = renderEditorHarnessInScrollArea()
    seedMouseSelectionPositions(editor, 5, 22)
    dragPrimarySelection(scrollArea, { clientX: 24, clientY: 96 }, { clientX: 920, clientY: 190 })

    expect(editor.focus).toHaveBeenCalled()
    expect(editor._tiptapEditor.view.posAtCoords).toHaveBeenNthCalledWith(1, {
      left: 121,
      top: 96,
    })
    expect(editor._tiptapEditor.view.posAtCoords).toHaveBeenNthCalledWith(2, {
      left: 719,
      top: 190,
    })
    expect(editor._tiptapEditor.commands.setTextSelection).toHaveBeenLastCalledWith({
      from: 5,
      to: 22,
    })
  })

  it('extends mouse selections to the document end when dragging below the editor content', () => {
    const { container, editor } = renderEditorHarness()
    editor._tiptapEditor.state.doc.content.size = 42
    editor._tiptapEditor.view.posAtCoords
      .mockReturnValueOnce({ pos: 7 })
      .mockReturnValue(null)

    fireEvent.mouseDown(container, { button: 0, clientX: 250, clientY: 80 })
    fireEvent.mouseMove(window, { buttons: 1, clientX: 260, clientY: 900 })
    fireEvent.mouseUp(window, { clientX: 260, clientY: 900 })

    expect(editor._tiptapEditor.view.posAtCoords).toHaveBeenNthCalledWith(2, {
      left: 260,
      top: 419,
    })
    expect(editor._tiptapEditor.commands.setTextSelection).toHaveBeenLastCalledWith({
      from: 7,
      to: 41,
    })
  })

  it('leaves native BlockNote and non-primary mouse selections alone', () => {
    const { container, editor } = renderEditorHarness()
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    container.appendChild(editable)

    fireEvent.mouseDown(editable, { button: 0, clientX: 200, clientY: 80 })
    fireEvent.mouseMove(window, { buttons: 1, clientX: 260, clientY: 120 })
    fireEvent.mouseDown(container, { button: 2, clientX: 200, clientY: 80 })

    expect(editor._tiptapEditor.view.posAtCoords).not.toHaveBeenCalled()
    expect(editor._tiptapEditor.commands.setTextSelection).not.toHaveBeenCalled()
  })

  it('routes the custom link-toolbar open action through openExternalUrl', () => {
    renderLinkToolbarOpenButton({ url: 'https://example.com/docs' })

    fireEvent.click(screen.getByRole('button', { name: 'Open in a new tab' }))

    expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('routes link-toolbar attachment actions through the active vault path', () => {
    renderLinkToolbarOpenButton({
      url: 'attachments/report.pdf',
      text: 'report.pdf',
      vaultPath: '/vault',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open in a new tab' }))

    expect(mockOpenLocalFile).toHaveBeenCalledWith('/vault/attachments/report.pdf', '/vault')
    expect(mockOpenExternalUrl).not.toHaveBeenCalled()
  })

  it('opens BlockNote file block names through the active vault path', () => {
    const editor = createEditor()
    editor.getBlock.mockReturnValue({
      type: 'file',
      props: { url: 'asset://localhost/%2Fvault%2Fattachments%2Freport.pdf' },
    })
    const { container } = renderEditorHarness(editor, { vaultPath: '/vault' })

    const blockContainer = document.createElement('div')
    blockContainer.setAttribute('data-node-type', 'blockContainer')
    blockContainer.dataset.id = 'pdf-block'
    const fileBlock = document.createElement('div')
    fileBlock.setAttribute('data-file-block', '')
    const fileName = document.createElement('span')
    fileName.className = 'bn-file-name-with-icon'
    fileName.textContent = 'report.pdf'
    fileBlock.appendChild(fileName)
    blockContainer.appendChild(fileBlock)
    container.appendChild(blockContainer)

    fireEvent.click(fileName)

    expect(editor.getBlock).toHaveBeenCalledWith('pdf-block')
    expect(mockOpenLocalFile).toHaveBeenCalledWith('/vault/attachments/report.pdf', '/vault')
    expect(editor.setTextCursorPosition).not.toHaveBeenCalled()
    expect(editor.focus).not.toHaveBeenCalled()
  })
})
