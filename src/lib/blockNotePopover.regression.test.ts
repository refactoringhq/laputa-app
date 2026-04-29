import { describe, expect, it } from 'vitest'
import { getMountedBoundingClientRectCache } from '@blocknote/react'

describe('patched BlockNote popover references', () => {
  it('uses the virtual rect when a remounting suggestion menu has no DOM element', () => {
    const fallbackRect = new DOMRect(4, 8, 16, 24)
    const readRect = getMountedBoundingClientRectCache({
      element: undefined,
      getBoundingClientRect: () => fallbackRect,
    } as never)

    expect(() => readRect()).not.toThrow()
    expect(readRect()).toBe(fallbackRect)
  })
})
