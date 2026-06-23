import { afterEach, describe, expect, it, vi } from 'vitest'
import { restorePendingRemountState } from './inlineWikilinkRemountState'
import type { InlineSelectionRange } from './inlineWikilinkDom'

function rect({
  top,
  bottom,
  height = bottom - top,
}: {
  top: number
  bottom: number
  height?: number
}): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom,
    left: 0,
    right: 200,
    width: 200,
    height,
    toJSON: () => ({}),
  } as DOMRect
}

function setElementRect(element: HTMLElement, domRect: DOMRect) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => domRect,
  })
}

function mockSelectionRect(domRect: DOMRect) {
  const range = document.createRange()
  Object.defineProperty(range, 'getBoundingClientRect', {
    configurable: true,
    value: () => domRect,
  })
  vi.spyOn(window, 'getSelection').mockReturnValue({
    rangeCount: 1,
    getRangeAt: () => range,
  } as unknown as Selection)
}

describe('restorePendingRemountState', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('scrolls the restored caret into view instead of replaying a stale scroll offset', () => {
    const editor = document.createElement('div')
    const target: InlineSelectionRange = { start: 80, end: 80 }
    const focusSelectionRange = vi.fn()
    const pendingFocusRef = { current: target }
    const pendingScrollTopRef = { current: 12 }

    editor.scrollTop = 0
    setElementRect(editor, rect({ top: 0, bottom: 40 }))
    mockSelectionRect(rect({ top: 70, bottom: 90 }))

    restorePendingRemountState(
      editor,
      focusSelectionRange,
      pendingFocusRef,
      pendingScrollTopRef,
    )

    expect(focusSelectionRange).toHaveBeenCalledWith(target)
    expect(editor.scrollTop).toBeGreaterThan(12)
    expect(pendingFocusRef.current).toBeNull()
    expect(pendingScrollTopRef.current).toBeNull()
  })
})
