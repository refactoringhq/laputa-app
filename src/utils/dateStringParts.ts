export interface DateParts {
  year: number
  month: number
  day: number
}

export function parseDashDateParts(value: string): DateParts | null {
  const { datePart, timePart } = splitDateAndTime(value)
  if (!isValidOptionalTime(timePart)) return null
  return parseYearFirstDateParts(datePart)
}

function splitDateAndTime(value: string): { datePart: string; timePart: string | null } {
  const timeSeparatorIndex = value.indexOf('T')
  if (timeSeparatorIndex === -1) return { datePart: value, timePart: null }
  return {
    datePart: value.slice(0, timeSeparatorIndex),
    timePart: value.slice(timeSeparatorIndex + 1),
  }
}

function isValidOptionalTime(timePart: string | null): boolean {
  return timePart === null || isClockPrefix(timePart)
}

function parseYearFirstDateParts(datePart: string): DateParts | null {
  const parts = datePart.split('-')
  if (parts.length !== 3) return null
  if (!matchesLength(parts[0], 4)) return null
  if (!matchesLength(parts[1], 2)) return null
  if (!matchesLength(parts[2], 2)) return null
  if (!parts.every(isDigits)) return null
  return validDateParts({
    year: Number(parts[0]),
    month: Number(parts[1]),
    day: Number(parts[2]),
  })
}

export function parseSlashDateParts(value: string): DateParts | null {
  return parseDateTuple(value, '/', [undefined, undefined, [2, 4]])
}

export function dateFromParts(parts: DateParts): Date {
  return new Date(parts.year, parts.month - 1, parts.day)
}

function parseDateTuple(
  value: string,
  separator: string,
  lengths: readonly [number | undefined, number | undefined, number | readonly number[]],
): DateParts | null {
  const parts = value.split(separator)
  if (parts.length !== 3) return null
  if (!matchesLength(parts[0], lengths[0])) return null
  if (!matchesLength(parts[1], lengths[1])) return null
  if (!matchesLength(parts[2], lengths[2])) return null
  if (!parts.every(isDigits)) return null
  return validDateParts({
    year: Number(parts[2].length === 2 ? `20${parts[2]}` : parts[2]),
    month: Number(parts[0]),
    day: Number(parts[1]),
  })
}

function matchesLength(value: string, length: number | readonly number[] | undefined): boolean {
  if (length === undefined) return value.length > 0
  if (typeof length === 'number') return value.length === length
  return length.includes(value.length)
}

function isDigits(value: string): boolean {
  return value.length > 0 && [...value].every((char) => char >= '0' && char <= '9')
}

function isClockPrefix(value: string): boolean {
  const parts = value.split(':')
  return (parts.length === 2 || parts.length === 3)
    && matchesLength(parts[0], 2)
    && matchesLength(parts[1], 2)
    && (parts.length === 2 || matchesLength(parts[2], 2))
    && parts.every(isDigits)
}

function validDateParts(parts: DateParts): DateParts | null {
  const date = dateFromParts(parts)
  return date.getFullYear() === parts.year && date.getMonth() === parts.month - 1 && date.getDate() === parts.day
    ? parts
    : null
}
