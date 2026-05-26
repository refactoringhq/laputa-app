import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDocumentZoom, zoomCursorFix } from './zoomCursorFix'

function mockComputedZoom(value: string) {
  const realGetComputedStyle = window.getComputedStyle.bind(window)
  return vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = realGetComputedStyle(element, pseudo)
    if (element === document.documentElement) {
      return new Proxy(style, {
        get(target, prop) {
          if (prop === 'zoom') return value
          const current = Reflect.get(target, prop)
          return typeof current === 'function' ? current.bind(target) : current
        },
      })
    }
    return style
  })
}

describe('zoomCursorFix extra coverage', () => {
  let parent: HTMLDivElement

  beforeEach(() => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    document.documentElement.style.removeProperty('zoom')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.documentElement.style.removeProperty('zoom')
    document.body.innerHTML = ''
    delete (document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint
  })

  function createView() {
    return new EditorView({
      parent,
      state: EditorState.create({
        doc: 'hello world',
        extensions: [zoomCursorFix()],
      }),
    })
  }

  it('falls back to inline zoom values when computed zoom is invalid', () => {
    mockComputedZoom('not-a-number')
    const inlineZoomSpy = vi.spyOn(document.documentElement.style, 'getPropertyValue')

    inlineZoomSpy.mockReturnValueOnce('125%')
    expect(getDocumentZoom()).toBe(1.25)

    inlineZoomSpy.mockReturnValueOnce('-20%')
    expect(getDocumentZoom()).toBe(1)
  })

  it('uses caretRangeFromPoint for zoomed coordinates and restores prototype methods on destroy', () => {
    const protoPosAtCoords = vi.spyOn(EditorView.prototype, 'posAtCoords').mockReturnValue(99)
    const protoPosAndSideAtCoords = vi.spyOn(EditorView.prototype, 'posAndSideAtCoords').mockReturnValue({ pos: 99, assoc: -1 })
    const view = createView()
    mockComputedZoom('2')

    const textNode = view.contentDOM.querySelector('.cm-line')?.firstChild
    expect(textNode).toBeTruthy()

    const range = document.createRange()
    range.setStart(textNode as Node, 3)
    range.setEnd(textNode as Node, 3)

    Object.defineProperty(document, 'caretRangeFromPoint', {
      configurable: true,
      value: vi.fn(() => range),
    })

    expect(view.posAtCoords({ x: 20, y: 30 }, true)).toBe(3)
    expect((view as unknown as { posAndSideAtCoords: (coords: { x: number; y: number }, precise?: boolean) => unknown })
      .posAndSideAtCoords({ x: 20, y: 30 }, false)).toEqual({ pos: 3, assoc: 1 })
    expect(protoPosAtCoords).not.toHaveBeenCalled()
    expect(protoPosAndSideAtCoords).not.toHaveBeenCalled()

    view.destroy()
    expect(Object.hasOwn(view, 'posAtCoords')).toBe(false)
    expect(Object.hasOwn(view, 'posAndSideAtCoords')).toBe(false)
  })

  it('falls back to original coordinate methods when zoom is 1 or caret lookup misses', () => {
    const protoPosAtCoords = vi.spyOn(EditorView.prototype, 'posAtCoords').mockImplementation((coords) => (
      coords.x === 10 && coords.y === 15 ? 11 : 7
    ))
    const protoPosAndSideAtCoords = vi.spyOn(EditorView.prototype, 'posAndSideAtCoords').mockImplementation((coords) => (
      coords.x === 10 && coords.y === 15 ? { pos: 11, assoc: -1 } : { pos: 7, assoc: -1 }
    ))
    const view = createView()

    expect(view.posAtCoords({ x: 8, y: 12 }, true)).toBe(7)
    expect(protoPosAtCoords).toHaveBeenCalledWith({ x: 8, y: 12 }, true)

    mockComputedZoom('2')
    Object.defineProperty(document, 'caretRangeFromPoint', {
      configurable: true,
      value: vi.fn(() => null),
    })

    expect(view.posAtCoords({ x: 20, y: 30 }, false)).toBe(11)
    expect(protoPosAtCoords).toHaveBeenCalledWith({ x: 10, y: 15 }, false)
    expect((view as unknown as { posAndSideAtCoords: (coords: { x: number; y: number }, precise?: boolean) => unknown })
      .posAndSideAtCoords({ x: 20, y: 30 }, true)).toEqual({ pos: 11, assoc: -1 })
    expect(protoPosAndSideAtCoords).toHaveBeenCalledWith({ x: 10, y: 15 }, true)
  })
})
