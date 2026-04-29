import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { extractEditorBody, getH1TextFromBlocks, replaceTitleInFrontmatter, useEditorTabSwap } from './useEditorTabSwap'
import { normalizeParsedImageBlocks } from './editorTabContent'
import { cacheNoteContent, clearPrefetchCache } from './useTabManagement'

describe('extractEditorBody', () => {
  it('strips frontmatter and preserves H1 heading for new note content', () => {
    const content = '---\ntitle: Untitled note\ntype: Note\nstatus: Active\n---\n\n# Untitled note\n\n'
    expect(extractEditorBody(content)).toBe('# Untitled note\n\n')
  })

  it('strips frontmatter and preserves H1 with body content', () => {
    const content = '---\ntitle: Test\n---\n# Test\n\nBody text here.'
    expect(extractEditorBody(content)).toBe('# Test\n\nBody text here.')
  })

  it('preserves H1 and body content after frontmatter', () => {
    const content = '---\ntitle: My Note\ntype: Note\n---\n\n# My Note\n\nFirst paragraph.\n\nSecond paragraph.'
    expect(extractEditorBody(content)).toBe('# My Note\n\nFirst paragraph.\n\nSecond paragraph.')
  })

  it('handles content without frontmatter', () => {
    const content = '# Just a Heading\n\nSome body text.'
    expect(extractEditorBody(content)).toBe('# Just a Heading\n\nSome body text.')
  })

  it('handles content without frontmatter or heading', () => {
    const content = 'Just plain text.'
    expect(extractEditorBody(content)).toBe('Just plain text.')
  })

  it('handles completely empty content', () => {
    expect(extractEditorBody('')).toBe('')
  })

  it('handles frontmatter-only content', () => {
    const content = '---\ntitle: Empty\n---\n'
    expect(extractEditorBody(content)).toBe('')
  })

  it('preserves wikilinks in body', () => {
    const content = '---\ntitle: Test\n---\n\n# Test\n\nSee [[Other Note]] for details.'
    expect(extractEditorBody(content)).toBe('# Test\n\nSee [[Other Note]] for details.')
  })

  it('preserves non-leading headings', () => {
    const content = '---\ntitle: Test\n---\n\nSome intro text.\n\n# A Heading\n\nMore text.'
    expect(extractEditorBody(content)).toBe('Some intro text.\n\n# A Heading\n\nMore text.')
  })

  it('preserves H1 for buildNoteContent output', () => {
    const content = '---\ntitle: My Project\ntype: Project\nstatus: Active\n---\n\n# My Project\n\n'
    expect(extractEditorBody(content)).toBe('# My Project\n\n')
  })

  it('preserves an empty H1 for untitled-note content', () => {
    const content = '---\ntype: Note\nstatus: Active\n---\n\n# \n\n'
    expect(extractEditorBody(content)).toBe('# \n\n')
  })
})

describe('getH1TextFromBlocks', () => {
  it('returns text from H1 heading block', () => {
    const blocks = makeHeadingBlocks([{ type: 'text', text: 'My Title', styles: {} }])
    expect(getH1TextFromBlocks(blocks)).toBe('My Title')
  })

  it('returns null for empty blocks', () => {
    expect(getH1TextFromBlocks([])).toBeNull()
  })

  it('returns null for non-heading first block', () => {
    const blocks = [{
      type: 'paragraph',
      content: [{ type: 'text', text: 'Just text' }],
    }]
    expect(getH1TextFromBlocks(blocks)).toBeNull()
  })

  it('returns null for H2 heading', () => {
    const blocks = makeHeadingBlocks([{ type: 'text', text: 'Subtitle' }], 2)
    expect(getH1TextFromBlocks(blocks)).toBeNull()
  })

  it('concatenates multiple text spans', () => {
    const blocks = makeHeadingBlocks([
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'World' },
    ])
    expect(getH1TextFromBlocks(blocks)).toBe('Hello World')
  })

  it('returns null for empty H1 content', () => {
    const blocks = makeHeadingBlocks([])
    expect(getH1TextFromBlocks(blocks)).toBeNull()
  })

  it('returns null for whitespace-only H1', () => {
    const blocks = makeHeadingBlocks([{ type: 'text', text: '   ' }])
    expect(getH1TextFromBlocks(blocks)).toBeNull()
  })

  it('returns null when blocks is null/undefined', () => {
    expect(getH1TextFromBlocks(null as unknown as unknown[])).toBeNull()
    expect(getH1TextFromBlocks(undefined as unknown as unknown[])).toBeNull()
  })

  it('filters non-text inline content', () => {
    const blocks = makeHeadingBlocks([
      { type: 'text', text: 'Title' },
      { type: 'wikilink', props: { target: 'linked' } },
    ])
    expect(getH1TextFromBlocks(blocks)).toBe('Title')
  })
})

describe('replaceTitleInFrontmatter', () => {
  it('replaces title value in frontmatter', () => {
    const fm = '---\ntitle: Old Title\ntype: Note\n---\n\n'
    expect(replaceTitleInFrontmatter(fm, 'New Title')).toBe('---\ntitle: New Title\ntype: Note\n---\n\n')
  })

  it('handles title with extra spaces after colon', () => {
    const fm = '---\ntitle:   Old Title\n---\n'
    expect(replaceTitleInFrontmatter(fm, 'New Title')).toBe('---\ntitle:   New Title\n---\n')
  })

  it('returns unchanged frontmatter when no title line exists', () => {
    const fm = '---\ntype: Note\n---\n'
    expect(replaceTitleInFrontmatter(fm, 'New Title')).toBe('---\ntype: Note\n---\n')
  })

  it('replaces only the title line, not other fields', () => {
    const fm = '---\ntitle: Old\ntype: Note\nstatus: Active\n---\n\n'
    expect(replaceTitleInFrontmatter(fm, 'Updated')).toBe('---\ntitle: Updated\ntype: Note\nstatus: Active\n---\n\n')
  })

  it('handles empty string as frontmatter', () => {
    expect(replaceTitleInFrontmatter('', 'Title')).toBe('')
  })
})

describe('normalizeParsedImageBlocks', () => {
  it('clears broken-image fallback widths from local asset image blocks', () => {
    const blocks = normalizeParsedImageBlocks([{
      type: 'image',
      props: {
        url: 'asset://localhost/%2Fvault%2Fattachments%2Fshot.png',
        previewWidth: 16,
      },
    }])

    expect(blocks).toEqual([{
      type: 'image',
      props: {
        url: 'asset://localhost/%2Fvault%2Fattachments%2Fshot.png',
        previewWidth: undefined,
      },
    }])
  })

  it('preserves explicit image widths and non-local image URLs', () => {
    const blocks = normalizeParsedImageBlocks([
      {
        type: 'image',
        props: {
          url: 'asset://localhost/%2Fvault%2Fattachments%2Fresized.png',
          previewWidth: 240,
        },
      },
      {
        type: 'image',
        props: {
          url: 'https://example.test/preview.png',
          previewWidth: 16,
        },
      },
    ])

    expect(blocks).toEqual([
      {
        type: 'image',
        props: {
          url: 'asset://localhost/%2Fvault%2Fattachments%2Fresized.png',
          previewWidth: 240,
        },
      },
      {
        type: 'image',
        props: {
          url: 'https://example.test/preview.png',
          previewWidth: 16,
        },
      },
    ])
  })
})

const blocksA = [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }]

function makeTab(path: string, title: string) {
  return {
    entry: { path, title, filename: `${title}.md`, type: 'Note', status: 'Active', aliases: [], isA: '' } as never,
    content: `---\ntitle: ${title}\n---\n\n# ${title}\n\nBody of ${title}.`,
  }
}

function makeUntitledTab(path: string, title = 'Untitled Note 1', remainder = '') {
  return {
    entry: { path, title, filename: `${title}.md`, type: 'Note', status: 'Active', aliases: [], isA: '' } as never,
    content: `---\ntype: Note\nstatus: Active\n---\n\n# \n\n${remainder}`,
  }
}

function makeBlankBodyTab(path: string, title = 'Untitled Note 1') {
  return {
    entry: { path, title, filename: `${title}.md`, type: 'Note', status: 'Active', aliases: [], isA: '' } as never,
    content: '---\ntype: Note\nstatus: Active\n---\n',
  }
}

function makeMockEditor(docRef: { current: unknown[] }) {
  const editor = {
    document: docRef.current,
    get prosemirrorView() { return {} },
    onMount: (cb: () => void) => { cb(); return () => {} },
    replaceBlocks: vi.fn((_old, newBlocks) => { docRef.current = newBlocks }),
    insertBlocks: vi.fn(),
    blocksToMarkdownLossy: vi.fn(() => ''),
    blocksToHTMLLossy: vi.fn(() => ''),
    tryParseMarkdownToBlocks: vi.fn(() => blocksA),
    _tiptapEditor: {
      state: { doc: { content: { size: 8 } } },
      commands: {
        setContent: vi.fn(),
        setTextSelection: vi.fn(),
      },
    },
    _docRef: docRef,
  }
  Object.defineProperty(editor, 'document', { get: () => docRef.current })
  return editor
}

function makeHeadingBlocks(
  content: Array<Record<string, unknown>>,
  level = 1,
) {
  return [{
    type: 'heading',
    props: { level },
    content,
  }]
}

async function flushEditorTick() {
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
}

function installEditorDomSpies(scrollTop = 0) {
  const scrollEl = { scrollTop }
  const frameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(0)
    return 0
  })
  vi.spyOn(document, 'querySelector').mockReturnValue(scrollEl as unknown as Element)
  return { scrollEl, frameSpy }
}

type SwapHarnessProps = {
  tabs: ReturnType<typeof makeTab>[]
  activeTabPath: string | null
  rawMode?: boolean
}

async function createSwapHarness(options: {
  initialProps: SwapHarnessProps
  onContentChange?: (path: string, content: string) => void
  setupEditor?: (editor: ReturnType<typeof makeMockEditor>) => void
}) {
  installEditorDomSpies()

  const docRef = { current: blocksA as unknown[] }
  const mockEditor = makeMockEditor(docRef)
  options.setupEditor?.(mockEditor)

  let currentProps = options.initialProps
  const rendered = renderHook(
    (props: SwapHarnessProps) => useEditorTabSwap({
      ...props,
      editor: mockEditor as never,
      onContentChange: options.onContentChange,
    }),
    { initialProps: currentProps },
  )

  await flushEditorTick()

  return {
    ...rendered,
    mockEditor,
    async rerenderWith(nextProps: Partial<SwapHarnessProps>) {
      currentProps = { ...currentProps, ...nextProps }
      rendered.rerender(currentProps)
      await flushEditorTick()
    },
  }
}

describe('useEditorTabSwap raw mode sync', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('swaps in the new note when the path updates before tabs catch up', async () => {
    const tabA = makeTab('a.md', 'Note A')
    const tabB = makeTab('b.md', 'March 2024')

    const { mockEditor, rerenderWith } = await createSwapHarness({
      initialProps: { tabs: [tabA], activeTabPath: 'a.md', rawMode: false },
    })
    mockEditor.tryParseMarkdownToBlocks.mockClear()
    mockEditor.replaceBlocks.mockClear()

    await rerenderWith({ tabs: [tabA], activeTabPath: 'b.md' })
    expect(mockEditor.tryParseMarkdownToBlocks).not.toHaveBeenCalled()

    await rerenderWith({ tabs: [tabB] })

    expect(mockEditor.tryParseMarkdownToBlocks).toHaveBeenCalledWith(
      expect.stringContaining('March 2024'),
    )
    expect(mockEditor.replaceBlocks).toHaveBeenCalled()
  })

  it('signals when the target tab content has been applied', async () => {
    const swapListener = vi.fn()
    window.addEventListener('laputa:editor-tab-swapped', swapListener)

    const tabA = makeTab('a.md', 'Note A')
    const tabB = makeTab('b.md', 'March 2024')

    const { rerenderWith } = await createSwapHarness({
      initialProps: { tabs: [tabA], activeTabPath: 'a.md', rawMode: false },
    })
    swapListener.mockClear()

    await rerenderWith({ tabs: [tabB], activeTabPath: 'b.md' })

    expect(swapListener).toHaveBeenCalledTimes(1)
    const event = swapListener.mock.calls[0][0] as CustomEvent
    expect(event.detail.path).toBe('b.md')

    window.removeEventListener('laputa:editor-tab-swapped', swapListener)
  })

  it('hard-resets the editor when the target note body is blank', async () => {
    const populatedTab = makeTab('a.md', 'Note A')
    const untitledTab = makeBlankBodyTab('untitled.md')

    const { mockEditor, rerenderWith } = await createSwapHarness({
      initialProps: { tabs: [populatedTab], activeTabPath: 'a.md', rawMode: false },
    })
    mockEditor._tiptapEditor.commands.setContent.mockClear()
    mockEditor.replaceBlocks.mockClear()

    await rerenderWith({ tabs: [untitledTab], activeTabPath: 'untitled.md' })

    expect(mockEditor._tiptapEditor.commands.setContent).toHaveBeenCalledWith('<p></p>')
    expect(mockEditor.replaceBlocks).not.toHaveBeenCalled()
  })

  it('renders empty H1 untitled notes via TipTap HTML content', async () => {
    const populatedTab = makeTab('a.md', 'Note A')
    const untitledTab = makeUntitledTab('untitled.md')

    const { mockEditor, rerenderWith } = await createSwapHarness({
      initialProps: { tabs: [populatedTab], activeTabPath: 'a.md', rawMode: false },
    })
    mockEditor.tryParseMarkdownToBlocks.mockClear()
    mockEditor.replaceBlocks.mockClear()
    mockEditor._tiptapEditor.commands.setContent.mockClear()

    await rerenderWith({ tabs: [untitledTab], activeTabPath: 'untitled.md' })

    expect(mockEditor.tryParseMarkdownToBlocks).not.toHaveBeenCalled()
    expect(mockEditor.replaceBlocks).not.toHaveBeenCalled()
    expect(mockEditor._tiptapEditor.commands.setContent).toHaveBeenCalledWith('<h1></h1><p></p>')
  })

  it('renders empty H1 typed notes with template content under the title', async () => {
    const populatedTab = makeTab('a.md', 'Note A')
    const typedUntitledTab = makeUntitledTab('untitled.md', 'Untitled Project 1', '## Objective\n\n')

    const { mockEditor, rerenderWith } = await createSwapHarness({
      initialProps: { tabs: [populatedTab], activeTabPath: 'a.md', rawMode: false },
      setupEditor: (editor) => {
        editor.blocksToHTMLLossy.mockReturnValue('<h2>Objective</h2><p></p>')
      },
    })
    mockEditor.tryParseMarkdownToBlocks.mockClear()
    mockEditor._tiptapEditor.commands.setContent.mockClear()

    await rerenderWith({ tabs: [typedUntitledTab], activeTabPath: 'untitled.md' })

    expect(mockEditor.tryParseMarkdownToBlocks).toHaveBeenCalledWith('## Objective\n\n')
    expect(mockEditor._tiptapEditor.commands.setContent).toHaveBeenCalledWith('<h1></h1><h2>Objective</h2><p></p>')
  })

  it('reuses cached editor blocks when reopening a recently visited note', async () => {
    const tabA = makeTab('a.md', 'Note A')
    const tabB = makeTab('b.md', 'Note B')

    const { mockEditor, rerenderWith } = await createSwapHarness({
      initialProps: { tabs: [tabA], activeTabPath: 'a.md', rawMode: false },
    })

    await rerenderWith({ tabs: [tabB], activeTabPath: 'b.md' })

    mockEditor.tryParseMarkdownToBlocks.mockClear()
    mockEditor.replaceBlocks.mockClear()

    await rerenderWith({ tabs: [tabA], activeTabPath: 'a.md' })

    expect(mockEditor.tryParseMarkdownToBlocks).not.toHaveBeenCalled()
    expect(mockEditor.replaceBlocks).toHaveBeenCalled()
  })

  it('prepares prefetched note blocks before the note is opened', async () => {
    clearPrefetchCache()
    const tabA = makeTab('a.md', 'Note A')
    const tabB = {
      ...makeTab('b.md', 'Likely Next'),
      content: '---\ntitle: Likely Next\n---\n\n# Likely Next\n\nPrepared body.',
    }

    const { mockEditor, rerenderWith } = await createSwapHarness({
      initialProps: { tabs: [tabA], activeTabPath: 'a.md', rawMode: false },
    })
    mockEditor.tryParseMarkdownToBlocks.mockClear()

    cacheNoteContent('b.md', tabB.content)
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)))

    expect(mockEditor.tryParseMarkdownToBlocks).toHaveBeenCalledWith(
      expect.stringContaining('Prepared body.'),
    )

    mockEditor.tryParseMarkdownToBlocks.mockClear()
    await rerenderWith({ tabs: [tabB], activeTabPath: 'b.md' })

    expect(mockEditor.tryParseMarkdownToBlocks).not.toHaveBeenCalled()
    clearPrefetchCache()
  })

  it('clears stale editor DOM selection before switching notes', async () => {
    const tabA = makeTab('a.md', 'Note A')
    const tabB = makeTab('b.md', 'Note B')

    const { rerenderWith } = await createSwapHarness({
      initialProps: { tabs: [tabA], activeTabPath: 'a.md', rawMode: false },
    })

    const container = document.createElement('div')
    container.className = 'editor__blocknote-container'
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    editable.textContent = 'Old note caret'
    container.appendChild(editable)
    document.body.appendChild(container)

    try {
      const range = document.createRange()
      range.setStart(editable.firstChild!, 4)
      range.collapse(true)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      editable.focus()

      expect(selection.rangeCount).toBe(1)

      await rerenderWith({ tabs: [tabB], activeTabPath: 'b.md' })

      expect(window.getSelection()?.rangeCount).toBe(0)
      expect(document.activeElement).not.toBe(editable)
    } finally {
      container.remove()
    }
  })

  it('resets stale TipTap selection before applying a switched note', async () => {
    const tabA = makeTab('a.md', 'Note A')
    const tabB = makeTab('b.md', 'Note B')

    const { mockEditor, rerenderWith } = await createSwapHarness({
      initialProps: { tabs: [tabA], activeTabPath: 'a.md', rawMode: false },
      setupEditor: (editor) => {
        editor._tiptapEditor.state.doc.content.size = 3
      },
    })
    mockEditor._tiptapEditor.commands.setTextSelection.mockClear()

    await rerenderWith({ tabs: [tabB], activeTabPath: 'b.md' })

    expect(mockEditor._tiptapEditor.commands.setTextSelection).toHaveBeenCalledWith(1)
    expect(mockEditor.replaceBlocks).toHaveBeenCalled()
  })

  it('re-parses when the active tab content changes without a path change', async () => {
    const tabA = makeTab('a.md', 'Note A')
    const refreshedTabA = {
      ...tabA,
      content: '---\ntitle: Note A\n---\n\n# Note A\n\nFresh after pull.',
    }

    const { mockEditor, rerenderWith } = await createSwapHarness({
      initialProps: { tabs: [tabA], activeTabPath: 'a.md', rawMode: false },
    })

    mockEditor.tryParseMarkdownToBlocks.mockClear()
    mockEditor.replaceBlocks.mockClear()

    await rerenderWith({ tabs: [refreshedTabA], activeTabPath: 'a.md' })

    expect(mockEditor.tryParseMarkdownToBlocks).toHaveBeenCalledWith(
      expect.stringContaining('Fresh after pull.'),
    )
    expect(mockEditor.replaceBlocks).toHaveBeenCalled()
  })

  it('repairs parsed blocks with missing ids before applying them to the editor', async () => {
    const tabA = makeTab('a.md', 'Note A')
    const malformedTab = {
      ...makeTab('malformed.md', 'Malformed'),
      content: '---\ntitle: Malformed\n---\n\n# Malformed\n\n- Parent\n  - Child',
    }

    const { mockEditor, rerenderWith } = await createSwapHarness({
      initialProps: { tabs: [tabA], activeTabPath: 'a.md', rawMode: false },
      setupEditor: (editor) => {
        editor.tryParseMarkdownToBlocks.mockReturnValue([
          {
            type: 'bulletListItem',
            content: [{ type: 'text', text: 'Parent', styles: {} }],
            children: [
              {
                type: 'bulletListItem',
                content: [{ type: 'text', text: 'Child', styles: {} }],
                children: [],
              },
            ],
          },
        ])
      },
    })
    mockEditor.replaceBlocks.mockClear()

    await rerenderWith({ tabs: [malformedTab], activeTabPath: 'malformed.md' })

    const appliedBlocks = mockEditor.replaceBlocks.mock.calls[0][1]
    expect(appliedBlocks).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        children: [
          expect.objectContaining({
            id: expect.any(String),
          }),
        ],
      }),
    ])
  })

  it('replaces non-object malformed parsed blocks before applying them to the editor', async () => {
    const tabA = makeTab('a.md', 'Note A')
    const malformedTab = {
      ...makeTab('malformed.md', 'Malformed'),
      content: '---\ntitle: Malformed\n---\n\n# Malformed\n\nRecovered body.',
    }

    const { mockEditor, rerenderWith } = await createSwapHarness({
      initialProps: { tabs: [tabA], activeTabPath: 'a.md', rawMode: false },
      setupEditor: (editor) => {
        editor.tryParseMarkdownToBlocks.mockReturnValue([
          null,
          'dangling content',
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Parent', styles: {} }],
            children: [
              undefined,
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Child', styles: {} }],
                children: [],
              },
            ],
          },
        ])
      },
    })
    mockEditor.replaceBlocks.mockClear()

    await rerenderWith({ tabs: [malformedTab], activeTabPath: 'malformed.md' })

    const appliedBlocks = mockEditor.replaceBlocks.mock.calls[0][1]
    expect(appliedBlocks).toEqual([
      expect.objectContaining({ id: expect.any(String), type: 'paragraph', content: [], children: [] }),
      expect.objectContaining({ id: expect.any(String), type: 'paragraph', content: [], children: [] }),
      expect.objectContaining({
        id: expect.any(String),
        children: [
          expect.objectContaining({ id: expect.any(String), type: 'paragraph', content: [], children: [] }),
          expect.objectContaining({
            id: expect.any(String),
            content: [{ type: 'text', text: 'Child', styles: {} }],
          }),
        ],
      }),
    ])
  })

  it('ignores editor change events before the pending tab swap applies a new untitled note', async () => {
    vi.spyOn(document, 'querySelector').mockReturnValue({ scrollTop: 0 } as unknown as Element)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })

    const onContentChange = vi.fn()
    const docRef = { current: blocksA as unknown[] }
    const mockEditor = makeMockEditor(docRef)
    Object.defineProperty(mockEditor, 'document', { get: () => docRef.current })

    const populatedTab = makeTab('a.md', 'Note A')
    const untitledTab = makeUntitledTab('untitled.md')

    const { result, rerender } = renderHook(
      ({ tabs, activeTabPath }) => useEditorTabSwap({
        tabs, activeTabPath, editor: mockEditor as never, onContentChange,
      }),
      { initialProps: { tabs: [populatedTab], activeTabPath: 'a.md' } },
    )

    await act(() => new Promise(r => setTimeout(r, 0)))

    const queued: Array<() => void> = []
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((cb: VoidFunction) => {
      queued.push(cb)
    })

    rerender({ tabs: [untitledTab], activeTabPath: 'untitled.md' })

    expect(queued).toHaveLength(1)

    act(() => {
      result.current.handleEditorChange()
    })

    expect(onContentChange).not.toHaveBeenCalled()

    await act(async () => {
      queued.shift()?.()
      await Promise.resolve()
    })
  })

  it('serializes rich inline math nodes back to Markdown on editor changes', async () => {
    vi.spyOn(document, 'querySelector').mockReturnValue({ scrollTop: 0 } as unknown as Element)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })

    const onContentChange = vi.fn()
    const docRef = { current: blocksA as unknown[] }
    const mockEditor = makeMockEditor(docRef)
    Object.defineProperty(mockEditor, 'document', { get: () => docRef.current })
    mockEditor.blocksToMarkdownLossy.mockImplementation((blocks: unknown[]) => (
      (blocks as Array<{ content?: Array<{ text?: string }> }>)
        .map((block) => block.content?.map((item) => item.text ?? '').join('') ?? '')
        .join('\n\n')
    ))

    const tabA = makeTab('a.md', 'Note A')

    const { result } = renderHook(
      () => useEditorTabSwap({
        tabs: [tabA],
        activeTabPath: 'a.md',
        editor: mockEditor as never,
        onContentChange,
      }),
    )

    await act(() => new Promise(r => setTimeout(r, 0)))

    docRef.current = [{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Inline ', styles: {} },
        { type: 'mathInline', props: { latex: 'x^2' } },
      ],
      children: [],
    }]

    act(() => {
      result.current.handleEditorChange()
    })

    expect(onContentChange).toHaveBeenCalledWith(
      'a.md',
      '---\ntitle: Note A\n---\nInline $x^2$\n',
    )
  })

  it('re-parses from tab.content when rawMode transitions from true to false', async () => {
    vi.spyOn(document, 'querySelector').mockReturnValue({ scrollTop: 0 } as unknown as Element)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })

    const docRef = { current: blocksA as unknown[] }
    const mockEditor = makeMockEditor(docRef)
    Object.defineProperty(mockEditor, 'document', { get: () => docRef.current })

    const tabA = makeTab('a.md', 'Note A')

    const { rerender } = renderHook(
      ({ tabs, activeTabPath, rawMode }) => useEditorTabSwap({
        tabs, activeTabPath, editor: mockEditor as never, rawMode,
      }),
      { initialProps: { tabs: [tabA], activeTabPath: 'a.md', rawMode: false as boolean } },
    )

    // Initial load — parses and caches blocks
    await act(() => new Promise(r => setTimeout(r, 0)))

    // Enter raw mode
    rerender({ tabs: [tabA], activeTabPath: 'a.md', rawMode: true })
    await act(() => new Promise(r => setTimeout(r, 0)))

    // Simulate raw editing: tab content was updated externally
    const updatedTab = {
      ...tabA,
      content: '---\ntitle: Updated Title\n---\n\n# Updated Title\n\nNew body content.',
    }
    mockEditor.tryParseMarkdownToBlocks.mockClear()
    mockEditor.replaceBlocks.mockClear()

    // Exit raw mode with updated content
    rerender({ tabs: [updatedTab], activeTabPath: 'a.md', rawMode: false })
    await act(() => new Promise(r => setTimeout(r, 0)))

    // Verify re-parse happened with updated body content
    expect(mockEditor.tryParseMarkdownToBlocks).toHaveBeenCalledWith(
      expect.stringContaining('Updated Title'),
    )
    expect(mockEditor.replaceBlocks).toHaveBeenCalled()
  })

  it('does not skip swap when rawMode is on (editor hidden)', async () => {
    vi.spyOn(document, 'querySelector').mockReturnValue({ scrollTop: 0 } as unknown as Element)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })

    const docRef = { current: blocksA as unknown[] }
    const mockEditor = makeMockEditor(docRef)
    Object.defineProperty(mockEditor, 'document', { get: () => docRef.current })

    const tabA = makeTab('a.md', 'Note A')

    const { rerender } = renderHook(
      ({ tabs, activeTabPath, rawMode }) => useEditorTabSwap({
        tabs, activeTabPath, editor: mockEditor as never, rawMode,
      }),
      { initialProps: { tabs: [tabA], activeTabPath: 'a.md', rawMode: false as boolean } },
    )

    await act(() => new Promise(r => setTimeout(r, 0)))
    mockEditor.replaceBlocks.mockClear()

    // Enter raw mode and update content
    const updatedTab = { ...tabA, content: '---\ntitle: Changed\n---\n\n# Changed\n\nEdited.' }
    rerender({ tabs: [updatedTab], activeTabPath: 'a.md', rawMode: true })
    await act(() => new Promise(r => setTimeout(r, 0)))

    // While in raw mode, the editor should NOT be updated
    expect(mockEditor.replaceBlocks).not.toHaveBeenCalled()
  })

  it('preserves content through multiple BlockNote→raw→BlockNote cycles', async () => {
    vi.spyOn(document, 'querySelector').mockReturnValue({ scrollTop: 0 } as unknown as Element)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })

    const docRef = { current: blocksA as unknown[] }
    const mockEditor = makeMockEditor(docRef)
    Object.defineProperty(mockEditor, 'document', { get: () => docRef.current })

    const tabA = makeTab('a.md', 'Note A')

    const { rerender } = renderHook(
      ({ tabs, activeTabPath, rawMode }) => useEditorTabSwap({
        tabs, activeTabPath, editor: mockEditor as never, rawMode,
      }),
      { initialProps: { tabs: [tabA], activeTabPath: 'a.md', rawMode: false as boolean } },
    )
    await act(() => new Promise(r => setTimeout(r, 0)))

    // Cycle 1: raw mode on → edit → raw mode off
    rerender({ tabs: [tabA], activeTabPath: 'a.md', rawMode: true })
    await act(() => new Promise(r => setTimeout(r, 0)))

    const edit1 = { ...tabA, content: '---\ntitle: Edit 1\n---\n\n# Edit 1\n\nFirst edit.' }
    mockEditor.tryParseMarkdownToBlocks.mockClear()
    rerender({ tabs: [edit1], activeTabPath: 'a.md', rawMode: false })
    await act(() => new Promise(r => setTimeout(r, 0)))
    expect(mockEditor.tryParseMarkdownToBlocks).toHaveBeenCalledWith(
      expect.stringContaining('Edit 1'),
    )

    // Cycle 2: raw mode on → edit → raw mode off
    rerender({ tabs: [edit1], activeTabPath: 'a.md', rawMode: true })
    await act(() => new Promise(r => setTimeout(r, 0)))

    const edit2 = { ...tabA, content: '---\ntitle: Edit 2\n---\n\n# Edit 2\n\nSecond edit.' }
    mockEditor.tryParseMarkdownToBlocks.mockClear()
    rerender({ tabs: [edit2], activeTabPath: 'a.md', rawMode: false })
    await act(() => new Promise(r => setTimeout(r, 0)))
    expect(mockEditor.tryParseMarkdownToBlocks).toHaveBeenCalledWith(
      expect.stringContaining('Edit 2'),
    )
  })
})

describe('useEditorTabSwap scroll position', () => {

  afterEach(() => { vi.restoreAllMocks() })

  it('defaults to scroll top 0 for newly opened note', async () => {
    const scrollEl = { scrollTop: 0 }
    vi.spyOn(document, 'querySelector').mockReturnValue(scrollEl as unknown as Element)
    const rAF = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })

    const docRef = { current: blocksA as unknown[] }
    const mockEditor = makeMockEditor(docRef)
    Object.defineProperty(mockEditor, 'document', { get: () => docRef.current })

    const tabA = makeTab('a.md', 'Note A')

    renderHook(
      ({ tabs, activeTabPath }) => useEditorTabSwap({
        tabs,
        activeTabPath,
        editor: mockEditor as never,
      }),
      { initialProps: { tabs: [tabA], activeTabPath: 'a.md' } },
    )

    await act(() => new Promise(r => setTimeout(r, 0)))

    // For a fresh note, scroll should go to 0
    expect(rAF).toHaveBeenCalled()
    expect(scrollEl.scrollTop).toBe(0)
  })
})
