import { describe, expect, it } from 'vitest'
import {
  getAnchoredDropdownLeft,
  getNextHighlightIndex,
  getPreviousHighlightIndex,
  isCreateOptionVisible,
} from './propertyDropdownUtils'

describe('propertyDropdownUtils', () => {
  it('wraps highlight movement across the available option range', () => {
    expect(getNextHighlightIndex(-1, 3)).toBe(0)
    expect(getNextHighlightIndex(2, 3)).toBe(0)
    expect(getPreviousHighlightIndex(0, 3)).toBe(2)
    expect(getPreviousHighlightIndex(-1, 0)).toBe(-1)
  })

  it('hides create options for blank or duplicate values', () => {
    expect(isCreateOptionVisible('', ['Draft'])).toBe(false)
    expect(isCreateOptionVisible(' draft ', ['Draft'])).toBe(false)
    expect(isCreateOptionVisible('Review', ['Draft'])).toBe(true)
  })

  it('keeps an anchored dropdown within the viewport margins', () => {
    expect(getAnchoredDropdownLeft(300, 208, 800)).toBe(92)
    expect(getAnchoredDropdownLeft(100, 208, 800)).toBe(8)
    expect(getAnchoredDropdownLeft(900, 208, 800)).toBe(584)
  })

  it('keeps an over-wide dropdown at the visible left margin', () => {
    expect(getAnchoredDropdownLeft(320, 400, 320, 8)).toBe(8)
  })
})
