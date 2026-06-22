import { describe, expect, it } from 'vitest'
import { directionForCalloutMarkerText } from './richEditorTextDirection'

describe('directionForCalloutMarkerText', () => {
  it('uses the first strong RTL character after an Obsidian callout marker', () => {
    expect(directionForCalloutMarkerText('[!note] כותרת חשובה')).toBe('rtl')
    expect(directionForCalloutMarkerText('[!warning]- مرحبا بالعالم')).toBe('rtl')
  })

  it('leaves English callout and quote content on browser auto direction', () => {
    expect(directionForCalloutMarkerText('[!note] Important title')).toBe('auto')
    expect(directionForCalloutMarkerText('A regular quote')).toBe('auto')
  })

  it('detects RTL quote content without a callout marker', () => {
    expect(directionForCalloutMarkerText('ציטוט חשוב')).toBe('rtl')
  })
})
