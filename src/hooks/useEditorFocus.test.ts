import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useEditorFocus } from './useEditorFocus'
import type { FocusableEditor } from './editorFocusUtils'
import { trackEvent } from '../lib/telemetry'

vi.mock('../lib/telemetry', () => ({
  trackEvent: vi.fn(),
}))

function makeTiptapMock(hasHeading: boolean | Array<number | null> = true, headingNodeSize = 15) {
  const headingSizes = Array.isArray(hasHeading)
    ? hasHeading
    : [hasHeading ? headingNodeSize : null]
  const chainResult = { setTextSelection: vi.fn().mockReturnThis(), run: vi.fn() }
  let headingAttempt = 0
  const descendantsMock = vi.fn().mockImplementation((cb: (node: { type: { name: string }; nodeSize: number }, pos: number) => boolean | void) => {
    const currentHeadingSize = headingSizes[Math.min(headingAttempt, headingSizes.length - 1)]
    headingAttempt += 1
    if (currentHeadingSize !== null) cb({ type: { name: 'heading' }, nodeSize: currentHeadingSize }, 2)
  })
  return {
    state: { doc: { descendants: descendantsMock } },
    chain: vi.fn(() => chainResult),
    _chainResult: chainResult,
    _descendantsMock: descendantsMock,
  }
}

function expectSelectionRange(
  tiptap: ReturnType<typeof makeTiptapMock>,
  range: { from: number; to: number },
) {
  expect(tiptap.chain).toHaveBeenCalled()
  expect(tiptap._chainResult.setTextSelection).toHaveBeenCalledWith(range)
  expect(tiptap._chainResult.run).toHaveBeenCalled()
}

describe('useEditorFocus', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  function setup(
    isMounted: boolean,
    tiptap?: ReturnType<typeof makeTiptapMock>,
    editorOverrides: Record<string, unknown> = {},
  ) {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.tabIndex = -1
    document.body.appendChild(editable)
    const editor = {
      focus: vi.fn(() => editable.focus()),
      _tiptapEditor: tiptap,
      ...editorOverrides,
    } as FocusableEditor & Record<string, unknown>
    const mountedRef = { current: isMounted }
    renderHook(() => useEditorFocus(editor, mountedRef))
    return { editor, tiptap, editable }
  }

  it('focuses editor via rAF when already mounted', async () => {
    const rAF = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
    const { editor } = setup(true)

    window.dispatchEvent(new CustomEvent('laputa:focus-editor'))

    expect(rAF).toHaveBeenCalled()
    expect(editor.focus).toHaveBeenCalled()
  })

  it('focuses editor via setTimeout when not yet mounted', () => {
    vi.useFakeTimers()
    const { editor } = setup(false)

    window.dispatchEvent(new CustomEvent('laputa:focus-editor'))

    expect(editor.focus).not.toHaveBeenCalled()
    vi.advanceTimersByTime(80)
    expect(editor.focus).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('waits for the matching tab swap event when a target path is provided', () => {
    const rAF = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
    vi.spyOn(window, 'setTimeout')
    const { editor } = setup(true)

    window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { path: '/vault/new-note.md' } }))

    expect(editor.focus).not.toHaveBeenCalled()
    expect(rAF).not.toHaveBeenCalled()

    window.dispatchEvent(new CustomEvent('laputa:editor-tab-swapped', { detail: { path: '/vault/other.md' } }))
    expect(editor.focus).not.toHaveBeenCalled()

    window.dispatchEvent(new CustomEvent('laputa:editor-tab-swapped', { detail: { path: '/vault/new-note.md' } }))
    expect(rAF).toHaveBeenCalled()
    expect(editor.focus).toHaveBeenCalled()
  })

  it('falls back to focusing when the swap event never arrives', () => {
    vi.useFakeTimers()
    const rAF = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
    const { editor } = setup(true)

    window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { path: '/vault/new-note.md' } }))

    expect(editor.focus).not.toHaveBeenCalled()
    vi.advanceTimersByTime(249)
    expect(editor.focus).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(rAF).toHaveBeenCalled()
    expect(editor.focus).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('cleans up event listener on unmount', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.tabIndex = -1
    document.body.appendChild(editable)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal mock for test
    const editor = { focus: vi.fn(() => editable.focus()) } as any
    const mountedRef = { current: true }
    const { unmount } = renderHook(() => useEditorFocus(editor, mountedRef))

    unmount()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
    window.dispatchEvent(new CustomEvent('laputa:focus-editor'))

    expect(editor.focus).not.toHaveBeenCalled()
  })

  it('falls back to focusing the editable DOM node when editor.focus does not make it active', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
    const editable = document.createElement('div')
    editable.className = 'ProseMirror'
    editable.setAttribute('contenteditable', 'true')
    editable.tabIndex = -1
    document.body.appendChild(editable)
    const editableFocus = vi.spyOn(editable, 'focus')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal mock for test
    const editor = { focus: vi.fn(), _tiptapEditor: undefined } as any
    const mountedRef = { current: true }
    renderHook(() => useEditorFocus(editor, mountedRef))

    window.dispatchEvent(new CustomEvent('laputa:focus-editor'))

    expect(editor.focus).toHaveBeenCalled()
    expect(editableFocus).toHaveBeenCalled()
  })

  describe('selectTitle behavior', () => {
    it('selects H1 text when selectTitle is true and editor is mounted', () => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
      const tiptap = makeTiptapMock(true)
      const { editor } = setup(true, tiptap)

      window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { selectTitle: true } }))

      expect(editor.focus).toHaveBeenCalled()
      expectSelectionRange(tiptap, { from: 3, to: 16 })
    })

    it('does not select title when selectTitle is false (default)', () => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
      const tiptap = makeTiptapMock(true)
      const { editor } = setup(true, tiptap)

      window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { selectTitle: false } }))

      expect(editor.focus).toHaveBeenCalled()
      expect(tiptap.chain).not.toHaveBeenCalled()
    })

    it('does not select title when selectTitle is absent from event detail', () => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
      const tiptap = makeTiptapMock(true)
      const { editor } = setup(true, tiptap)

      window.dispatchEvent(new CustomEvent('laputa:focus-editor'))

      expect(editor.focus).toHaveBeenCalled()
      expect(tiptap.chain).not.toHaveBeenCalled()
    })

    it('skips selection when no heading found in document', () => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
      const tiptap = makeTiptapMock(false)
      const { editor } = setup(true, tiptap)

      window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { selectTitle: true } }))

      expect(editor.focus).toHaveBeenCalled()
      expect(tiptap.chain).not.toHaveBeenCalled()
    })

    it('places a text cursor inside an empty H1 instead of selecting through the next block', () => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
      const tiptap = makeTiptapMock(true)
      const setTextCursorPosition = vi.fn()
      const { editor } = setup(true, tiptap, {
        document: [
          { id: 'title', type: 'heading', props: { level: 1 }, content: [] },
          { id: 'body', type: 'paragraph', props: {}, content: [] },
        ],
        setTextCursorPosition,
      })

      window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { selectTitle: true } }))

      expect(editor.focus).toHaveBeenCalled()
      expect(setTextCursorPosition).toHaveBeenCalledWith('title', 'start')
      expect(tiptap.chain).not.toHaveBeenCalled()
    })

    it('selects H1 text after timeout when editor not yet mounted', () => {
      vi.useFakeTimers()
      // Mock rAF synchronously so the deferred selectFirstHeading call inside doFocus
      // runs immediately when requestAnimationFrame is invoked, keeping the test simple.
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
      const tiptap = makeTiptapMock(true)
      const { editor } = setup(false, tiptap)

      window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { selectTitle: true } }))

      expect(editor.focus).not.toHaveBeenCalled()
      vi.advanceTimersByTime(80)
      expect(editor.focus).toHaveBeenCalled()
      expect(tiptap.chain).toHaveBeenCalled()
      expect(tiptap._chainResult.setTextSelection).toHaveBeenCalledWith({ from: 3, to: 16 })
      vi.useRealTimers()
    })

    it('selection happens in second rAF (not first), allowing content swap to complete', () => {
      // Verify the double-rAF contract: focus in rAF1, selection deferred to rAF2.
      // This ensures the new note's blocks are applied (via queueMicrotask between frames)
      // before selectFirstHeading runs.
      const callbacks: FrameRequestCallback[] = []
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        callbacks.push(cb)
        return callbacks.length
      })
      const tiptap = makeTiptapMock(true)
      const { editor } = setup(true, tiptap)

      window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { selectTitle: true } }))

      // rAF 1 is scheduled (doFocus)
      expect(callbacks.length).toBe(1)
      callbacks[0](0)

      // After rAF 1: editor focused, but selection NOT yet triggered
      expect(editor.focus).toHaveBeenCalled()
      expect(tiptap.chain).not.toHaveBeenCalled()

      // rAF 2 is now scheduled (selectFirstHeading)
      expect(callbacks.length).toBe(2)
      callbacks[1](0)

      // After rAF 2: heading is selected
      expectSelectionRange(tiptap, { from: 3, to: 16 })
    })

    it('retries title selection until the heading arrives on a later frame', () => {
      const callbacks: FrameRequestCallback[] = []
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        callbacks.push(cb)
        return callbacks.length
      })
      const tiptap = makeTiptapMock([null, 15])
      const { editor } = setup(true, tiptap)

      window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { selectTitle: true } }))

      expect(callbacks.length).toBe(1)
      callbacks[0](0)

      expect(editor.focus).toHaveBeenCalled()
      expect(tiptap.chain).not.toHaveBeenCalled()

      expect(callbacks.length).toBe(2)
      callbacks[1](0)

      expect(tiptap.chain).not.toHaveBeenCalled()
      expect(callbacks.length).toBe(3)

      callbacks[2](0)

      expectSelectionRange(tiptap, { from: 3, to: 16 })
    })

    it('recovers and retries a mismatched title-selection transaction', () => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const tiptap = makeTiptapMock(true)
      tiptap._chainResult.run.mockImplementationOnce(() => {
        throw new RangeError('Applying a mismatched transaction')
      })
      const { editor } = setup(true, tiptap)

      window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { selectTitle: true } }))

      expect(editor.focus).toHaveBeenCalled()
      expect(tiptap._chainResult.run).toHaveBeenCalledTimes(2)
      expect(consoleWarn).toHaveBeenCalledWith(
        '[editor] Recovered rich-editor transform error:',
        expect.any(RangeError),
      )
      expect(trackEvent).toHaveBeenCalledWith('rich_editor_transform_error_recovered', {
        reason: 'mismatched_transaction',
      })
    })

    it('collapses selection to the caret for an empty H1', () => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
      const tiptap = makeTiptapMock(true, 2)
      const { editor } = setup(true, tiptap)

      window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { selectTitle: true } }))

      expect(editor.focus).toHaveBeenCalled()
      expectSelectionRange(tiptap, { from: 3, to: 3 })
    })
  })
})
