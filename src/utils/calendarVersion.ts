interface CalendarVersionParts {
  year: number
  month: number
  day: number
  channel?: string
  sequence?: number
}

export function formatCalendarVersionForDisplay(version: string): string | null {
  const parsed = parseCalendarVersion(version)
  if (!parsed) return null

  const calendarVersion = `${parsed.year}.${parsed.month}.${parsed.day}`
  if (parsed.channel === 'alpha' && parsed.sequence !== undefined) {
    return `Alpha ${calendarVersion}.${parsed.sequence}`
  }
  return calendarVersion
}

function isVersionNumberPart(value: string, expectedLength?: number): boolean {
  return (expectedLength === undefined || value.length === expectedLength)
    && value.length > 0
    && [...value].every((char) => char >= '0' && char <= '9')
}

function parseCalendarVersion(version: string): CalendarVersionParts | null {
  const versionParts = version.split('-')
  if (versionParts.length > 2) return null

  const [calendar, prerelease] = versionParts
  const calendarVersion = parseCalendarVersionParts(calendar)
  if (!calendarVersion) return null
  if (prerelease === undefined) return calendarVersion
  const prereleaseVersion = parsePrereleaseVersionParts(prerelease)
  return prereleaseVersion ? { ...calendarVersion, ...prereleaseVersion } : null
}

function parseCalendarVersionParts(calendar: string): CalendarVersionParts | null {
  const calendarParts = calendar.split('.')
  if (calendarParts.length !== 3) return null
  if (!isVersionNumberPart(calendarParts[0], 4)) return null
  if (!isVersionNumberPart(calendarParts[1])) return null
  if (!isVersionNumberPart(calendarParts[2])) return null
  return {
    year: Number(calendarParts[0]),
    month: Number(calendarParts[1]),
    day: Number(calendarParts[2]),
  }
}

function parsePrereleaseVersionParts(
  prerelease: string,
): Pick<CalendarVersionParts, 'channel' | 'sequence'> | null {
  const prereleaseParts = prerelease.split('.')
  if (prereleaseParts.length !== 2) return null
  if (!['alpha', 'stable'].includes(prereleaseParts[0])) return null
  if (!isVersionNumberPart(prereleaseParts[1])) return null
  return {
    channel: prereleaseParts[0],
    sequence: Number(prereleaseParts[1]),
  }
}
