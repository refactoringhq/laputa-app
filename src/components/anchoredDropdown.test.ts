import { describe, expect, it } from 'vitest'
import {
  getAnchoredDropdownLeft,
  resolveAnchoredDropdownPosition,
} from './anchoredDropdown'

function makeRect({
  left,
  right,
  top,
  bottom,
}: {
  left: number
  right: number
  top: number
  bottom: number
}): DOMRectReadOnly {
  return {
    left,
    right,
    top,
    bottom,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  }
}

describe('anchoredDropdown', () => {
  it('keeps an anchored dropdown within the viewport margins', () => {
    expect(getAnchoredDropdownLeft(300, 208, 800)).toBe(92)
    expect(getAnchoredDropdownLeft(100, 208, 800)).toBe(8)
    expect(getAnchoredDropdownLeft(900, 208, 800)).toBe(584)
  })

  it('keeps an over-wide dropdown at the visible left margin', () => {
    expect(getAnchoredDropdownLeft(320, 400, 320, 8)).toBe(8)
  })

  it('opens below the anchor when there is enough viewport height', () => {
    const position = resolveAnchoredDropdownPosition(
      makeRect({ left: 130, right: 300, top: 80, bottom: 100 }),
      { width: 170, maxHeight: 280, minHeight: 160, offset: 4, viewportPadding: 8 },
      { width: 800, height: 600 },
    )

    expect(position).toEqual({ left: 130, top: 104, maxHeight: 280 })
  })

  it('normalizes anchor and viewport coordinates while the app is zoomed', () => {
    const position = resolveAnchoredDropdownPosition(
      makeRect({ left: 1170, right: 1261, top: 650, bottom: 681.2 }),
      { width: 208, offset: 4, viewportPadding: 8 },
      { width: 1600, height: 900, zoom: 1.3 },
    )

    expect(position).toEqual({ left: 762, top: 528 })
  })

  it('opens above the anchor and clamps horizontally when there is not enough room below', () => {
    const position = resolveAnchoredDropdownPosition(
      makeRect({ left: 650, right: 820, top: 580, bottom: 604 }),
      { width: 170, maxHeight: 280, minHeight: 160, offset: 4, viewportPadding: 8 },
      { width: 800, height: 640 },
    )

    expect(position).toEqual({ left: 622, top: 296, maxHeight: 280 })
  })
})
