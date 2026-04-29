import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  buildCodeMirrorRestoreState,
  captureRawEditorPositionSnapshot,
  captureRichEditorPositionSnapshot,
  restoreBlockNoteView,
  restoreCodeMirrorView,
  type BlockNotePositionEditor,
  type CodeMirrorViewLike,
} from './editorModePosition'

interface MockBlock {
  id: string
  markdown: string
  content?: unknown
}

const content = '---\ntitle: Demo\n---\n# Title\n\nParagraph one\n\n## Tail'
const blocks: MockBlock[] = [
  { id: 'title', markdown: '# Title', content: [] },
  { id: 'details', markdown: 'Paragraph one', content: [] },
  { id: 'tail', markdown: '## Tail', content: [] },
]

function makeEditor(blocks: MockBlock[]): BlockNotePositionEditor {
  let selectedBlocks: MockBlock[] | undefined
  const cursorBlock = blocks[0]

  return {
    document: blocks,
    getSelection: () => selectedBlocks ? { blocks: selectedBlocks } : undefined,
    getTextCursorPosition: () => ({ block: cursorBlock }),
    blocksToMarkdownLossy: (items: unknown[]) => (items as MockBlock[]).map(item => item.markdown).join('\n\n'),
    setSelection: vi.fn(),
    setTextCursorPosition: vi.fn(),
    focus: vi.fn(),
  }
}

function installRawView(view: CodeMirrorViewLike) {
  const host = document.createElement('div')
  host.setAttribute('data-testid', 'raw-editor-codemirror')
  Object.assign(host, { __cmView: view })
  document.body.appendChild(host)
  return host
}

function captureAndRestoreRawSelection(
  selection: { anchor: number; head: number },
) {
  const editor = makeEditor(blocks)
  const view: CodeMirrorViewLike = {
    state: {
      doc: { toString: () => content },
      selection: { main: selection },
    },
    scrollDOM: { scrollTop: 48 },
    dispatch: vi.fn(),
    focus: vi.fn(),
  }

  installRawView(view)
  const snapshot = captureRawEditorPositionSnapshot(document)

  return {
    editor,
    restored: restoreBlockNoteView(editor, snapshot!, document),
  }
}

describe('editorModePosition', () => {
  beforeEach(() => {
    const scrollHost = document.createElement('div')
    scrollHost.className = 'editor-scroll-area'
    scrollHost.scrollTop = 128
    document.body.appendChild(scrollHost)
    const detailBlock = document.createElement('div')
    detailBlock.setAttribute('data-id', 'details')
    detailBlock.scrollIntoView = vi.fn()
    document.body.appendChild(detailBlock)
    const tailBlock = document.createElement('div')
    tailBlock.setAttribute('data-id', 'tail')
    tailBlock.scrollIntoView = vi.fn()
    document.body.appendChild(tailBlock)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('maps the current BlockNote block to a raw-editor restore selection', () => {
    const editor = makeEditor(blocks)
    editor.getTextCursorPosition = () => ({ block: blocks[1] })

    const snapshot = captureRichEditorPositionSnapshot(editor, document)
    expect(snapshot).toEqual({
      anchorBlockIndex: 1,
      headBlockIndex: 1,
      scrollTop: 128,
    })

    const restoreState = buildCodeMirrorRestoreState(editor, content, snapshot!)
    expect(restoreState?.scrollTop).toBe(128)
    expect(content.slice(restoreState!.anchor, restoreState!.head).trim()).toBe('Paragraph one')
  })

  it('restores a raw-editor selection and scroll position through the DOM bridge', () => {
    const dispatch = vi.fn()
    const focus = vi.fn()
    const view: CodeMirrorViewLike = {
      state: {
        doc: { toString: () => content },
        selection: { main: { anchor: 0, head: 0 } },
      },
      scrollDOM: { scrollTop: 0 },
      dispatch,
      focus,
    }
    installRawView(view)

    const restored = restoreCodeMirrorView(document, {
      anchor: 10,
      head: 21,
      scrollTop: 96,
    })

    expect(restored).toBe(true)
    expect(dispatch).toHaveBeenCalledWith({ selection: { anchor: 10, head: 21 } })
    expect(view.scrollDOM.scrollTop).toBe(96)
    expect(focus).toHaveBeenCalled()
  })

  it('clamps stale raw-editor restore selections to the current document', () => {
    const shortContent = '# Short'
    const dispatch = vi.fn((spec: { selection: { anchor: number; head: number } }) => {
      if (spec.selection.anchor > shortContent.length || spec.selection.head > shortContent.length) {
        throw new RangeError('Selection points outside of document')
      }
    })
    const view: CodeMirrorViewLike = {
      state: {
        doc: { toString: () => shortContent },
        selection: { main: { anchor: 0, head: 0 } },
      },
      scrollDOM: { scrollTop: 0 },
      dispatch,
      focus: vi.fn(),
    }
    installRawView(view)

    const restored = restoreCodeMirrorView(document, {
      anchor: 500,
      head: 800,
      scrollTop: 12,
    })

    expect(restored).toBe(true)
    expect(dispatch).toHaveBeenCalledWith({
      selection: {
        anchor: shortContent.length,
        head: shortContent.length,
      },
    })
    expect(view.scrollDOM.scrollTop).toBe(12)
  })

  it('maps a raw-editor cursor back to the nearest BlockNote block', () => {
    const paragraphOffset = content.indexOf('Paragraph one') + 5
    const { editor, restored } = captureAndRestoreRawSelection({
      anchor: paragraphOffset,
      head: paragraphOffset,
    })

    expect(restored).toBe(true)
    expect(editor.setTextCursorPosition).toHaveBeenCalledWith('details', 'end')
    expect(editor.focus).toHaveBeenCalled()
  })

  it('restores a multi-block raw selection back into a BlockNote block range', () => {
    const startOffset = content.indexOf('# Title')
    const endOffset = content.indexOf('## Tail') + '## Tail'.length
    const { editor, restored } = captureAndRestoreRawSelection({
      anchor: startOffset,
      head: endOffset,
    })

    expect(restored).toBe(true)
    expect(editor.setSelection).toHaveBeenCalledWith('title', 'tail')
    expect(editor.focus).toHaveBeenCalled()
  })

  it('falls back to the nearest content block when raw restore lands on media', () => {
    const contentWithMedia = '---\ntitle: Demo\n---\n# Title\n\n![media](media.png)\n\nParagraph tail'
    const mediaBlocks: MockBlock[] = [
      { id: 'title', markdown: '# Title', content: [] },
      { id: 'image', markdown: '![media](media.png)' },
      { id: 'tail', markdown: 'Paragraph tail', content: [] },
    ]
    const editor = makeEditor(mediaBlocks)
    const view: CodeMirrorViewLike = {
      state: {
        doc: { toString: () => contentWithMedia },
        selection: {
          main: {
            anchor: contentWithMedia.indexOf('![media]') + 3,
            head: contentWithMedia.indexOf('![media]') + 3,
          },
        },
      },
      scrollDOM: { scrollTop: 48 },
      dispatch: vi.fn(),
      focus: vi.fn(),
    }

    installRawView(view)
    const snapshot = captureRawEditorPositionSnapshot(document)
    const restored = restoreBlockNoteView(editor, snapshot!, document)

    expect(restored).toBe(true)
    expect(editor.setTextCursorPosition).toHaveBeenCalledWith('tail', 'end')
    expect(editor.focus).toHaveBeenCalled()
  })
})
