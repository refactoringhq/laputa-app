import { describe, expect, it } from 'vitest'
import { formatCalendarVersionForDisplay } from './calendarVersion'

describe('formatCalendarVersionForDisplay', () => {
  it('formats valid calendar and alpha versions', () => {
    expect(formatCalendarVersionForDisplay('2026.5.17')).toBe('2026.5.17')
    expect(formatCalendarVersionForDisplay('2026.5.17-alpha.1')).toBe('Alpha 2026.5.17.1')
  })

  it('rejects malformed prerelease suffixes', () => {
    expect(formatCalendarVersionForDisplay('2026.5.17-alpha.1-extra')).toBeNull()
    expect(formatCalendarVersionForDisplay('2026.5.17-stable.1-extra')).toBeNull()
  })
})
