import { describe, expect, it } from 'vitest'
import { substituteTemplate } from './templateSubstitution'

const FIXED_NOW = new Date('2026-06-06T14:30:00')

describe('substituteTemplate', () => {
  it('substitutes {{date}} with the ISO date by default', () => {
    expect(substituteTemplate('Today is {{date}}.', { now: FIXED_NOW })).toBe('Today is 2026-06-06.')
  })

  it('substitutes {{date:fmt}} with a date-fns format pattern', () => {
    expect(substituteTemplate('{{date:EEEE, MMMM d}}', { now: FIXED_NOW })).toBe('Saturday, June 6')
  })

  it('substitutes {{time}} with HH:mm by default', () => {
    expect(substituteTemplate('At {{time}}', { now: FIXED_NOW })).toBe('At 14:30')
  })

  it('substitutes {{time:fmt}} with a custom time pattern', () => {
    expect(substituteTemplate('{{time:HH:mm:ss}}', { now: FIXED_NOW })).toBe('14:30:00')
  })

  it('substitutes {{type}} from context', () => {
    expect(substituteTemplate('# {{type}}', { type: 'Meeting' })).toBe('# Meeting')
  })

  it('resolves {{type}} to empty when absent', () => {
    expect(substituteTemplate('[{{type}}]', {})).toBe('[]')
  })

  it('leaves unknown tokens verbatim', () => {
    expect(substituteTemplate('Hello {{foo}}', { now: FIXED_NOW })).toBe('Hello {{foo}}')
  })

  it('leaves malformed syntax literal', () => {
    expect(substituteTemplate('Price: {{5 dollars}', { now: FIXED_NOW })).toBe('Price: {{5 dollars}')
  })

  it('leaves a token with an invalid date format verbatim', () => {
    expect(substituteTemplate('{{date:not-a-format}}', { now: FIXED_NOW })).toBe('{{date:not-a-format}}')
  })

  it('returns the string unchanged when there are no tokens', () => {
    expect(substituteTemplate('plain markdown body', {})).toBe('plain markdown body')
  })

  it('handles multiple tokens in one string', () => {
    const result = substituteTemplate('{{date}} / {{type}} / {{time}}', { type: 'Journal', now: FIXED_NOW })
    expect(result).toBe('2026-06-06 / Journal / 14:30')
  })

  it('uses the real current time when no now is provided', () => {
    const before = substituteTemplate('{{date}}')
    const after = substituteTemplate('{{date}}')
    expect(before).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(after).toBe(before)
  })
})
