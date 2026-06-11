import { describe, expect, it, vi } from 'vitest'
import {
  applyTiptapTextSelection,
  getTiptapSelectionBridge,
  textPositionAtEditorPoint,
  type TiptapSelectionBridge,
} from './editorTiptapSelection'

function makeEditorDom(): Element {
  const dom = document.createElement('div')
  dom.getBoundingClientRect = vi.fn(() => ({
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
  return dom
}

function makeBridge(overrides: Partial<TiptapSelectionBridge> = {}): TiptapSelectionBridge {
  return {
    commands: {
      setTextSelection: vi.fn(),
    },
    state: {
      doc: {
        content: { size: 42 },
      },
    },
    view: {
      dom: makeEditorDom(),
      posAtCoords: vi.fn(() => ({ pos: 7 })),
    },
    ...overrides,
  }
}

describe('editor Tiptap selection helpers', () => {
  it('returns the private Tiptap bridge when the editor exposes one', () => {
    const bridge = makeBridge()

    expect(getTiptapSelectionBridge({ _tiptapEditor: bridge })).toBe(bridge)
    expect(getTiptapSelectionBridge({})).toBeNull()
  })

  it('does not ask a destroyed ProseMirror view for coordinates', () => {
    const posAtCoords = vi.fn(() => {
      throw new TypeError("Cannot read properties of null (reading 'nearestDesc')")
    })
    const bridge = makeBridge({
      view: {
        dom: makeEditorDom(),
        isDestroyed: true,
        posAtCoords,
      },
    })

    expect(textPositionAtEditorPoint(bridge, { clientX: 260, clientY: 120 })).toBeNull()
    expect(posAtCoords).not.toHaveBeenCalled()
  })

  it('returns null when coordinate lookup throws from a stale ProseMirror doc view', () => {
    const bridge = makeBridge({
      view: {
        dom: makeEditorDom(),
        posAtCoords: vi.fn(() => {
          throw new TypeError("Cannot read properties of null (reading 'nearestDesc')")
        }),
      },
    })

    expect(() => textPositionAtEditorPoint(bridge, { clientX: 260, clientY: 120 })).not.toThrow()
    expect(textPositionAtEditorPoint(bridge, { clientX: 260, clientY: 120 })).toBeNull()
  })

  it('clamps coordinates and falls back to the document end below the editor', () => {
    const posAtCoords = vi.fn(() => null)
    const bridge = makeBridge({
      view: {
        dom: makeEditorDom(),
        posAtCoords,
      },
    })

    expect(textPositionAtEditorPoint(bridge, { clientX: 999, clientY: 999 })).toBe(41)
    expect(posAtCoords).toHaveBeenCalledWith({ left: 719, top: 419 })
  })

  it('applies ordered Tiptap text selections and reports command failures', () => {
    const setTextSelection = vi.fn()
    const bridge = makeBridge({ commands: { setTextSelection } })

    expect(applyTiptapTextSelection(bridge, 12, 4)).toBe(true)
    expect(setTextSelection).toHaveBeenCalledWith({ from: 4, to: 12 })

    setTextSelection.mockImplementationOnce(() => {
      throw new Error('stale editor')
    })
    expect(applyTiptapTextSelection(bridge, 1, 2)).toBe(false)
  })
})
