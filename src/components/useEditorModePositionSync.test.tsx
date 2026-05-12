import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  buildCodeMirrorRestoreState,
  captureRawEditorPositionSnapshot,
  captureRichEditorPositionSnapshot,
  type CodeMirrorRestoreState,
  type BlockNotePositionEditor,
  type CodeMirrorViewLike,
  type RawEditorPositionSnapshot,
} from './editorModePosition'
import { useEditorModePositionSync } from './useEditorModePositionSync'

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

function makeEditor(): BlockNotePositionEditor {
  return {
    document: blocks,
    getSelection: () => undefined,
    getTextCursorPosition: () => ({ block: blocks[1] }),
    blocksToMarkdownLossy: (items: unknown[]) => (items as MockBlock[]).map(item => item.markdown).join('\n\n'),
    setSelection: vi.fn(),
    setTextCursorPosition: vi.fn(),
    focus: vi.fn(),
  }
}

function installBlockNoteScrollHost() {
  const host = document.createElement('div')
  host.className = 'editor-scroll-area'
  host.scrollTop = 72
  document.body.appendChild(host)
  const detailBlock = document.createElement('div')
  detailBlock.setAttribute('data-id', 'details')
  detailBlock.scrollIntoView = vi.fn()
  document.body.appendChild(detailBlock)
}

function installRawView(view: CodeMirrorViewLike) {
  const host = document.createElement('div')
  host.setAttribute('data-testid', 'raw-editor-codemirror')
  Object.assign(host, { __cmView: view })
  document.body.appendChild(host)
}

describe('useEditorModePositionSync', () => {
  beforeEach(() => {
    installBlockNoteScrollHost()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('restores the raw editor view after toggling from rich mode', () => {
    const editor = makeEditor()
    const dispatch = vi.fn()
    const focus = vi.fn()
    const pendingRawRestoreRef = { current: null as CodeMirrorRestoreState | null }
    const pendingRoundTripRawRestoreRef = { current: null as { path: string; state: CodeMirrorRestoreState } | null }
    const pendingRichRestoreRef = { current: null as RawEditorPositionSnapshot | null }
    installRawView({
      state: {
        doc: { toString: () => content },
        selection: { main: { anchor: 0, head: 0 } },
      },
      scrollDOM: { scrollTop: 0 },
      dispatch,
      focus,
    })

    const { result, rerender } = renderHook(
      ({ rawMode }) => {
        useEditorModePositionSync({
          activeTabPath: 'note.md',
          editor: editor as never,
          pendingRawRestoreRef,
          pendingRoundTripRawRestoreRef,
          pendingRichRestoreRef,
          rawMode,
        })
        return { pendingRawRestoreRef, pendingRoundTripRawRestoreRef, pendingRichRestoreRef }
      },
      { initialProps: { rawMode: false } },
    )

    act(() => {
      const snapshot = captureRichEditorPositionSnapshot(editor, document)
      result.current.pendingRawRestoreRef.current = snapshot
        ? buildCodeMirrorRestoreState(editor, content, snapshot)
        : null
    })
    rerender({ rawMode: true })

    const selectionCall = dispatch.mock.calls[0]?.[0]
    expect(selectionCall?.selection?.anchor).toBe(content.indexOf('Paragraph one'))
    expect(content.slice(selectionCall.selection.anchor, selectionCall.selection.head).trim()).toBe('Paragraph one')
    expect(focus).toHaveBeenCalled()
  })

  it('restores the BlockNote cursor after toggling back from raw mode', async () => {
    const editor = makeEditor()
    const paragraphOffset = content.indexOf('Paragraph one') + 5
    const pendingRawRestoreRef = { current: null as CodeMirrorRestoreState | null }
    const pendingRoundTripRawRestoreRef = { current: null as { path: string; state: CodeMirrorRestoreState } | null }
    const pendingRichRestoreRef = { current: null as RawEditorPositionSnapshot | null }
    installRawView({
      state: {
        doc: { toString: () => content },
        selection: { main: { anchor: paragraphOffset, head: paragraphOffset } },
      },
      scrollDOM: { scrollTop: 24 },
      dispatch: vi.fn(),
      focus: vi.fn(),
    })

    const { result, rerender } = renderHook(
      ({ rawMode }) => {
        useEditorModePositionSync({
          activeTabPath: 'note.md',
          editor: editor as never,
          pendingRawRestoreRef,
          pendingRoundTripRawRestoreRef,
          pendingRichRestoreRef,
          rawMode,
        })
        return { pendingRawRestoreRef, pendingRoundTripRawRestoreRef, pendingRichRestoreRef }
      },
      { initialProps: { rawMode: true } },
    )

    act(() => {
      result.current.pendingRichRestoreRef.current = captureRawEditorPositionSnapshot(document)
    })
    rerender({ rawMode: false })
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      window.dispatchEvent(new CustomEvent('laputa:editor-tab-swapped', {
        detail: { path: 'note.md' },
      }))
    })

    expect(editor.setTextCursorPosition).toHaveBeenCalledWith('details', 'end')
    expect(editor.focus).toHaveBeenCalled()
  })

  it('cancels a pending BlockNote restore when raw mode starts again before the frame runs', () => {
    const editor = makeEditor()
    const paragraphOffset = content.indexOf('Paragraph one') + 5
    const pendingRawRestoreRef = { current: null as CodeMirrorRestoreState | null }
    const pendingRoundTripRawRestoreRef = { current: null as { path: string; state: CodeMirrorRestoreState } | null }
    const pendingRichRestoreRef = { current: null as RawEditorPositionSnapshot | null }
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrame = 1
    vi.mocked(window.requestAnimationFrame).mockImplementation((callback: FrameRequestCallback) => {
      const id = nextFrame
      nextFrame += 1
      frames.set(id, callback)
      return id
    })
    installRawView({
      state: {
        doc: { toString: () => content },
        selection: { main: { anchor: paragraphOffset, head: paragraphOffset } },
      },
      scrollDOM: { scrollTop: 24 },
      dispatch: vi.fn(),
      focus: vi.fn(),
    })

    const { result, rerender } = renderHook(
      ({ rawMode }) => {
        useEditorModePositionSync({
          activeTabPath: 'note.md',
          editor: editor as never,
          pendingRawRestoreRef,
          pendingRoundTripRawRestoreRef,
          pendingRichRestoreRef,
          rawMode,
        })
        return { pendingRawRestoreRef, pendingRoundTripRawRestoreRef, pendingRichRestoreRef }
      },
      { initialProps: { rawMode: true } },
    )

    act(() => {
      result.current.pendingRichRestoreRef.current = captureRawEditorPositionSnapshot(document)
    })
    rerender({ rawMode: false })
    act(() => {
      window.dispatchEvent(new CustomEvent('laputa:editor-tab-swapped', {
        detail: { path: 'note.md' },
      }))
    })
    const restoreFrame = frames.get(1)
    expect(restoreFrame).toBeDefined()

    rerender({ rawMode: true })
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1)

    act(() => {
      restoreFrame?.(0)
    })

    expect(editor.setTextCursorPosition).not.toHaveBeenCalled()
    expect(editor.focus).not.toHaveBeenCalled()
  })
})
