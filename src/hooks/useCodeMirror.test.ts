import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { RUNTIME_STYLE_NONCE } from '../lib/runtimeStyleNonce'
import { useCodeMirror, type CodeMirrorCallbacks } from './useCodeMirror'

const noop = () => {}
const noopCallbacks: CodeMirrorCallbacks = {
  onDocChange: noop,
  onCursorActivity: noop,
  onSave: noop,
  onEscape: () => false,
}
const originalUserAgent = navigator.userAgent

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  })
}

describe('useCodeMirror', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    setUserAgent(originalUserAgent)
    document.body.removeChild(container)
  })

  it('creates an EditorView in the container', () => {
    const ref = { current: container }
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'hello world', noopCallbacks),
    )
    expect(result.current.current).not.toBeNull()
    expect(container.querySelector('.cm-editor')).toBeInTheDocument()
  })

  it('does not vertically offset line numbers from editor text', () => {
    const ref = { current: container }
    renderHook(() =>
      useCodeMirror(ref, '---\ntype: Note\n---', noopCallbacks),
    )
    const gutters = container.querySelector('.cm-gutters')

    expect(gutters).toBeInTheDocument()
    expect(getComputedStyle(gutters!).paddingTop).toBe('0px')
  })

  it('tags generated CodeMirror style elements with the runtime CSP nonce', () => {
    const ref = { current: container }
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'hello world', noopCallbacks),
    )

    expect(result.current.current?.state.facet(EditorView.cspNonce)).toBe(RUNTIME_STYLE_NONCE)
  })

  it('enables per-line auto text direction for mixed LTR and RTL content', () => {
    const ref = { current: container }
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'English\nمرحبا بالعالم', noopCallbacks),
    )
    const view = result.current.current!

    expect(view.state.facet(EditorView.perLineTextDirection)).toBe(true)
    expect([...container.querySelectorAll('.cm-line')].map(line => line.getAttribute('dir'))).toEqual(['auto', 'auto'])
  })

  it('calls requestMeasure when laputa-zoom-change event fires', () => {
    const ref = { current: container }
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'hello', noopCallbacks),
    )
    const view = result.current.current!
    const spy = vi.spyOn(view, 'requestMeasure')

    act(() => {
      window.dispatchEvent(new Event('laputa-zoom-change'))
    })

    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('stops listening for zoom changes after unmount', () => {
    const ref = { current: container }
    const { result, unmount } = renderHook(() =>
      useCodeMirror(ref, 'hello', noopCallbacks),
    )
    const view = result.current.current!
    const spy = vi.spyOn(view, 'requestMeasure')

    unmount()

    act(() => {
      window.dispatchEvent(new Event('laputa-zoom-change'))
    })

    // After unmount, the listener should be removed — requestMeasure should NOT be called.
    // (The view is also destroyed on unmount, so this verifies cleanup.)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('syncs content prop changes to the editor', () => {
    const ref = { current: container }
    const onDocChange = vi.fn()
    const callbacks = { ...noopCallbacks, onDocChange }
    const { result, rerender } = renderHook(
      ({ content }) => useCodeMirror(ref, content, callbacks),
      { initialProps: { content: '---\ntitle: Hello\n---\nBody' } },
    )
    const view = result.current.current!
    expect(view.state.doc.toString()).toBe('---\ntitle: Hello\n---\nBody')

    // Simulate external content update (e.g. frontmatter written to disk)
    rerender({ content: '---\ntitle: Hello\nTrashed: true\n---\nBody' })

    expect(view.state.doc.toString()).toBe('---\ntitle: Hello\nTrashed: true\n---\nBody')
    // External sync should NOT trigger onDocChange (would cause infinite loop)
    expect(onDocChange).not.toHaveBeenCalled()
  })

  it('lets app Escape handling run before the CodeMirror default keymap', () => {
    const ref = { current: container }
    const onEscape = vi.fn(() => true)
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'hello', { ...noopCallbacks, onEscape }),
    )
    const view = result.current.current!

    act(() => {
      view.focus()
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Escape',
      }))
    })

    expect(onEscape).toHaveBeenCalledOnce()
  })

  it('inserts a literal tab instead of letting Tab move focus away', () => {
    const ref = { current: container }
    const onDocChange = vi.fn()
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'hello', { ...noopCallbacks, onDocChange }),
    )
    const view = result.current.current!

    act(() => {
      view.dispatch({ selection: { anchor: view.state.doc.length } })
      view.focus()
    })

    const handled = !view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Tab',
    }))

    expect(handled).toBe(true)
    expect(view.state.doc.toString()).toBe('hello\t')
    expect(onDocChange).toHaveBeenCalledWith('hello\t')
  })

  it('keeps Windows Home and End inside the current raw-editor line when visual boundary lookup crosses lines', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
    const ref = { current: container }
    const content = [
      'previous paragraph',
      'current paragraph with enough wrapped raw Markdown to expose WebView2 boundary drift',
    ].join('\n')
    const { result } = renderHook(() =>
      useCodeMirror(ref, content, noopCallbacks),
    )
    const view = result.current.current!
    const currentLine = view.state.doc.line(2)
    const cursor = currentLine.from + 'current paragraph'.length
    vi.spyOn(view, 'moveToLineBoundary').mockImplementation(() => EditorSelection.cursor(2))

    act(() => {
      view.dispatch({ selection: { anchor: cursor } })
      view.focus()
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Home',
      }))
    })

    expect(view.state.selection.main.head).toBe(currentLine.from)

    act(() => {
      view.dispatch({ selection: { anchor: cursor } })
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'End',
      }))
    })

    expect(view.state.selection.main.head).toBe(currentLine.to)
  })

  it('falls back when Windows Home visual boundary lookup stays in the paragraph but on the wrong row', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
    const ref = { current: container }
    const content = 'current paragraph with enough wrapped raw Markdown to expose WebView2 boundary drift'
    const { result } = renderHook(() =>
      useCodeMirror(ref, content, noopCallbacks),
    )
    const view = result.current.current!
    const currentLine = view.state.doc.line(1)
    const cursor = currentLine.from + 'current paragraph'.length
    const driftedBoundary = currentLine.from + 'cur'.length
    const originalCoordsAtPos = view.coordsAtPos.bind(view)
    vi.spyOn(view, 'moveToLineBoundary').mockImplementation(() => EditorSelection.cursor(driftedBoundary))
    vi.spyOn(view, 'coordsAtPos').mockImplementation((pos, side) => {
      if (pos === cursor) return { left: 12, right: 12, top: 120, bottom: 136 }
      if (pos === driftedBoundary) return { left: 12, right: 12, top: 40, bottom: 56 }
      return originalCoordsAtPos(pos, side)
    })

    act(() => {
      view.dispatch({ selection: { anchor: cursor } })
      view.focus()
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Home',
      }))
    })

    expect(view.state.selection.main.head).toBe(currentLine.from)
  })

  it('does not sync when content matches current editor state', () => {
    const ref = { current: container }
    const { result, rerender } = renderHook(
      ({ content }) => useCodeMirror(ref, content, noopCallbacks),
      { initialProps: { content: 'hello' } },
    )
    const view = result.current.current!
    const spy = vi.spyOn(view, 'dispatch')

    // Re-render with same content — no dispatch needed
    rerender({ content: 'hello' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('installs zoomCursorFix that overrides posAtCoords on the view instance', () => {
    const ref = { current: container }
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'hello world', noopCallbacks),
    )
    const view = result.current.current!
    // The extension overrides posAtCoords on the instance (not the prototype)
    expect(Object.hasOwn(view, 'posAtCoords')).toBe(true)
  })
})
