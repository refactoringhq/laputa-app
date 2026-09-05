import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useEditorTabSwap } from './useEditorTabSwap'

const initialBlocks = [{
  type: 'paragraph',
  content: [{ type: 'text', text: 'Old body', styles: {} }],
  children: [],
}]

function makeTab(path: string, content: string) {
  return {
    entry: { path, title: 'Note A', filename: 'note-a.md', type: 'Note', status: 'Active', aliases: [], isA: '' } as never,
    content,
  }
}

function makeEditor(docRef: { current: unknown[] }) {
  const editor = {
    get prosemirrorView() { return {} },
    onMount: (callback: () => void) => {
      callback()
      return () => {}
    },
    replaceBlocks: vi.fn((_oldBlocks, nextBlocks) => { docRef.current = nextBlocks as unknown[] }),
    insertBlocks: vi.fn(),
    blocksToMarkdownLossy: vi.fn(() => 'Old body'),
    tryParseMarkdownToBlocks: vi.fn(() => [{
      type: 'paragraph',
      content: [{ type: 'text', text: 'Fresh after background reload.', styles: {} }],
      children: [],
    }]),
    _tiptapEditor: {
      state: { doc: { content: { size: 8 } } },
      commands: {
        setContent: vi.fn(),
        setTextSelection: vi.fn(),
      },
    },
  }
  Object.defineProperty(editor, 'document', { get: () => docRef.current })
  return editor
}

function installFrameAndScrollSpies() {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0)
    return 0
  })
  vi.spyOn(document, 'querySelector').mockReturnValue({ scrollTop: 0 } as unknown as Element)
}

async function flushEditorTick() {
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
}

function appendFocusedEditorSelection() {
  const container = document.createElement('div')
  container.className = 'editor__blocknote-container'
  const editable = document.createElement('div')
  editable.contentEditable = 'true'
  editable.textContent = 'Old current note caret'
  container.appendChild(editable)
  document.body.appendChild(container)

  const range = document.createRange()
  range.setStart(editable.firstChild!, 8)
  range.collapse(true)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  editable.focus()

  return { container, editable, selection }
}

describe('useEditorTabSwap selection refresh', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('clears stale editor DOM selection before refreshing the current note content', async () => {
    installFrameAndScrollSpies()
    const docRef = { current: initialBlocks as unknown[] }
    const editor = makeEditor(docRef)
    const tabA = makeTab('a.md', '---\ntitle: Note A\n---\n\n# Note A\n\nOld body.')
    const refreshedTabA = makeTab(
      'a.md',
      '---\ntitle: Note A\n---\n\n# Note A\n\nFresh after background reload.',
    )

    const rendered = renderHook(
      ({ tabs }) => useEditorTabSwap({
        tabs,
        activeTabPath: 'a.md',
        editor: editor as never,
      }),
      { initialProps: { tabs: [tabA] } },
    )
    await flushEditorTick()

    const { editable, selection } = appendFocusedEditorSelection()
    const selectionChanges = vi.fn()
    document.addEventListener('selectionchange', selectionChanges)
    expect(selection.rangeCount).toBe(1)

    rendered.rerender({ tabs: [refreshedTabA] })
    await flushEditorTick()

    expect(window.getSelection()?.rangeCount).toBe(0)
    expect(selectionChanges).toHaveBeenCalled()
    expect(document.activeElement).not.toBe(editable)
    document.removeEventListener('selectionchange', selectionChanges)
  })

  it('preserves the editor selection when only the current note frontmatter changes', async () => {
    installFrameAndScrollSpies()
    const docRef = { current: initialBlocks as unknown[] }
    const editor = makeEditor(docRef)
    const tabA = makeTab('a.md', '---\ntitle: Note A\n---\n\nOld body')
    const refreshedTabA = makeTab(
      'a.md',
      '---\ntitle: Note A\nstatus: Reviewed\n---\n\nOld body',
    )

    const rendered = renderHook(
      ({ tabs }) => useEditorTabSwap({
        tabs,
        activeTabPath: 'a.md',
        editor: editor as never,
      }),
      { initialProps: { tabs: [tabA] } },
    )
    await flushEditorTick()
    editor.replaceBlocks.mockClear()

    const { editable, selection } = appendFocusedEditorSelection()
    rendered.rerender({ tabs: [refreshedTabA] })
    await flushEditorTick()

    expect(selection.rangeCount).toBe(1)
    expect(editable.contains(selection.anchorNode)).toBe(true)
    expect(editor.replaceBlocks).not.toHaveBeenCalled()
  })
})
