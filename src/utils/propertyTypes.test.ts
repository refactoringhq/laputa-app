import { describe, it, expect, beforeEach } from 'vitest'
import {
  detectPropertyType,
  formatDateValue,
  toISODate,
  getEffectiveDisplayMode,
  loadDisplayModeOverrides,
  saveDisplayModeOverride,
  removeDisplayModeOverride,
} from './propertyTypes'

// Mock localStorage (jsdom's may be incomplete)
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
    get length() { return Object.keys(store).length },
    key: (i: number) => Object.keys(store)[i] ?? null,
  }
})()
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

function withTimezone<T>(timezone: string, fn: () => T): T {
  const previousTimezone = process.env.TZ
  process.env.TZ = timezone
  try {
    return fn()
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimezone
  }
}

describe('detectPropertyType', () => {
  it('detects boolean from value type', () => {
    expect(detectPropertyType('archived', true)).toBe('boolean')
    expect(detectPropertyType('published', false)).toBe('boolean')
  })

  it('detects number from value type', () => {
    expect(detectPropertyType('estimate', 3)).toBe('number')
    expect(detectPropertyType('ratio', -1.5)).toBe('number')
  })

  it('detects status from key name', () => {
    expect(detectPropertyType('status', 'Active')).toBe('status')
    expect(detectPropertyType('Status', 'Draft')).toBe('status')
  })

  it('detects status from known status values', () => {
    expect(detectPropertyType('phase', 'active')).toBe('status')
    expect(detectPropertyType('state', 'done')).toBe('status')
    expect(detectPropertyType('progress', 'in progress')).toBe('status')
    expect(detectPropertyType('result', 'published')).toBe('status')
  })

  it('detects date from ISO string', () => {
    expect(detectPropertyType('deadline', '2026-03-31')).toBe('date')
    expect(detectPropertyType('due_date', '2026-01-15T10:00')).toBe('date')
  })

  it('detects date from date-like key names with date value', () => {
    expect(detectPropertyType('start_date', '2026-06-01')).toBe('date')
    expect(detectPropertyType('scheduled', '2026-02-25')).toBe('date')
  })

  it('detects date from ISO string even without date key', () => {
    expect(detectPropertyType('custom_field', '2026-03-31')).toBe('date')
  })

  it('returns text for plain strings', () => {
    expect(detectPropertyType('owner', 'Luca Rossi')).toBe('text')
    expect(detectPropertyType('cadence', 'Weekly')).toBe('text')
  })

  it('returns text for null/undefined', () => {
    expect(detectPropertyType('anything', null)).toBe('text')
    expect(detectPropertyType('anything', undefined as never)).toBe('text')
  })

  it('detects tags from tag-like key names with array values', () => {
    expect(detectPropertyType('tags', ['a', 'b'])).toBe('tags')
    expect(detectPropertyType('keywords', ['react', 'tauri'])).toBe('tags')
    expect(detectPropertyType('categories', ['frontend'])).toBe('tags')
    expect(detectPropertyType('labels', ['bug', 'fix'])).toBe('tags')
  })

  it('returns text for arrays with non-tag key names', () => {
    expect(detectPropertyType('aliases', ['a', 'b'])).toBe('text')
    expect(detectPropertyType('custom_list', ['x', 'y'])).toBe('text')
  })

  it('detects tags from tag-like key names even with scalar string values', () => {
    expect(detectPropertyType('tags', 'Has Pic')).toBe('tags')
    expect(detectPropertyType('Tags', 'solo-tag')).toBe('tags')
    expect(detectPropertyType('keywords', 'react')).toBe('tags')
    expect(detectPropertyType('categories', 'frontend')).toBe('tags')
    expect(detectPropertyType('labels', 'bug')).toBe('tags')
  })

  it('treats date-keyed fields with non-date values as text', () => {
    expect(detectPropertyType('deadline', 'active')).toBe('text')
  })

  it('detects common date format MM/DD/YYYY', () => {
    expect(detectPropertyType('due', '02/25/2026')).toBe('date')
  })

  it('detects hex color values as color', () => {
    expect(detectPropertyType('background', '#FFFFFF')).toBe('color')
    expect(detectPropertyType('foreground', '#37352F')).toBe('color')
    expect(detectPropertyType('primary', '#155DFF')).toBe('color')
    expect(detectPropertyType('custom', '#3b82f6')).toBe('color')
  })

  it('detects short hex colors as color', () => {
    expect(detectPropertyType('accent', '#fff')).toBe('color')
    expect(detectPropertyType('color', '#abc')).toBe('color')
  })

  it('does not detect non-hex named colors without color key', () => {
    expect(detectPropertyType('custom_field', 'red')).toBe('text')
    expect(detectPropertyType('custom_field', 'blue')).toBe('text')
  })

  it('detects named colors with color-related keys', () => {
    expect(detectPropertyType('fill', 'red')).toBe('color')
    expect(detectPropertyType('background', 'blue')).toBe('color')
  })

  it('does not detect invalid hex as color', () => {
    expect(detectPropertyType('background', '#zzzzzz')).toBe('text')
    expect(detectPropertyType('color', 'not-a-color')).toBe('text')
  })
})

describe('formatDateValue', () => {
  it('formats ISO date to friendly format', () => {
    const result = formatDateValue('2026-03-31')
    expect(result).toBe('Mar 31, 2026')
  })

  it('formats ISO datetime', () => {
    const result = formatDateValue('2026-02-25T10:00')
    expect(result).toBe('Feb 25, 2026')
  })

  it('formats MM/DD/YYYY', () => {
    const result = formatDateValue('02/25/2026')
    expect(result).toBe('Feb 25, 2026')
  })

  it('returns original value for non-date strings', () => {
    expect(formatDateValue('not a date')).toBe('not a date')
  })
})

describe('toISODate', () => {
  it('converts ISO date to YYYY-MM-DD', () => {
    expect(toISODate('2026-03-31')).toBe('2026-03-31')
  })

  it('extracts date from ISO datetime', () => {
    expect(toISODate('2026-02-25T10:00:00')).toBe('2026-02-25')
  })

  it('keeps local ISO datetime dates stable in positive-offset timezones', () => {
    withTimezone('Europe/Rome', () => {
      expect(toISODate('2026-04-29T00:00:00')).toBe('2026-04-29')
    })
  })

  it('returns original value for non-date strings', () => {
    expect(toISODate('not a date')).toBe('not a date')
  })
})

describe('display mode overrides (localStorage)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns empty object when no overrides saved', () => {
    expect(loadDisplayModeOverrides()).toEqual({})
  })

  it('saves and loads an override', () => {
    saveDisplayModeOverride('deadline', 'date')
    const overrides = loadDisplayModeOverrides()
    expect(overrides.deadline).toBe('date')
  })

  it('removes an override', () => {
    saveDisplayModeOverride('deadline', 'date')
    removeDisplayModeOverride('deadline')
    expect(loadDisplayModeOverrides()).toEqual({})
  })

  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem('tolaria:display-mode-overrides', 'not valid json')
    expect(loadDisplayModeOverrides()).toEqual({})
  })
})

describe('getEffectiveDisplayMode', () => {
  it('uses auto-detected mode when no override', () => {
    expect(getEffectiveDisplayMode('status', 'Active', {})).toBe('status')
  })

  it('uses override when present', () => {
    expect(getEffectiveDisplayMode('status', 'Active', { status: 'text' })).toBe('text')
  })

  it('prefers override over auto-detection', () => {
    expect(getEffectiveDisplayMode('deadline', '2026-03-31', { deadline: 'text' })).toBe('text')
  })

  it('uses tags override for array values', () => {
    expect(getEffectiveDisplayMode('custom', ['a', 'b'], { custom: 'tags' })).toBe('tags')
  })
})
