import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  isValid,
  parseISO,
  startOfDay,
  subDays,
  subMonths,
  subWeeks,
  subYears,
} from 'date-fns'

type RelativeUnit = 'day' | 'week' | 'month' | 'year'
type DateFilterInput = string
type RelativeToken = string
type RelativePattern = { amountToken: RelativeToken; future: boolean; unitToken: RelativeToken }

const NUMBER_WORDS = new Map<RelativeToken, number>([
  ['a', 1],
  ['an', 1],
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
])

const RELATIVE_UNITS = new Set<RelativeUnit>(['day', 'week', 'month', 'year'])
const NAMED_RELATIVE_DAY_OFFSETS = new Map<DateFilterInput, number>([
  ['today', 0],
  ['yesterday', -1],
  ['tomorrow', 1],
])
const RELATIVE_SHIFT = new Map<RelativeUnit, { future: typeof addDays; past: typeof subDays }>([
  ['day', { future: addDays, past: subDays }],
  ['week', { future: addWeeks, past: subWeeks }],
  ['month', { future: addMonths, past: subMonths }],
  ['year', { future: addYears, past: subYears }],
])

function parseRelativeAmount(token: RelativeToken): number | null {
  if (/^\d+$/.test(token)) return Number(token)
  return NUMBER_WORDS.get(token) ?? null
}

function normalizeRelativeUnit(token: RelativeToken): RelativeUnit | null {
  const unit = token.toLowerCase().replace(/s$/, '')
  return RELATIVE_UNITS.has(unit as RelativeUnit) ? unit as RelativeUnit : null
}

function shiftRelativeDate(reference: Date, unit: RelativeUnit, amount: number, future: boolean): Date {
  const shift = RELATIVE_SHIFT.get(unit)
  if (!shift) return reference
  return (future ? shift.future : shift.past)(reference, amount)
}

function parseNamedRelativeDate(normalized: DateFilterInput, base: Date): Date | null {
  const offsetDays = NAMED_RELATIVE_DAY_OFFSETS.get(normalized)
  return offsetDays === undefined ? null : addDays(base, offsetDays)
}

function futureRelativePattern(tokens: RelativeToken[]): RelativePattern | null {
  if (tokens.length !== 3 || tokens.at(0) !== 'in') return null
  return { amountToken: tokens.at(1) ?? '', future: true, unitToken: tokens.at(2) ?? '' }
}

function pastRelativePattern(tokens: RelativeToken[]): RelativePattern | null {
  if (tokens.length !== 3 || tokens.at(2) !== 'ago') return null
  return { amountToken: tokens.at(0) ?? '', future: false, unitToken: tokens.at(1) ?? '' }
}

function parseRelativeTokenPattern(tokens: RelativeToken[]): RelativePattern | null {
  if (tokens.length !== 3) return null
  return futureRelativePattern(tokens) ?? pastRelativePattern(tokens)
}

function parseRelativeDateInput(value: DateFilterInput, reference: Date): Date | null {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null

  const base = startOfDay(reference)
  const namedDate = parseNamedRelativeDate(normalized, base)
  if (namedDate) return namedDate

  const tokenPattern = parseRelativeTokenPattern(normalized.split(/\s+/))
  if (!tokenPattern) return null

  const amount = parseRelativeAmount(tokenPattern.amountToken)
  const unit = normalizeRelativeUnit(tokenPattern.unitToken)
  if (amount == null || unit == null) return null

  return shiftRelativeDate(base, unit, amount, tokenPattern.future)
}

export function parseDateFilterInput(value: DateFilterInput, reference = new Date()): Date | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const relative = parseRelativeDateInput(trimmed, reference)
  if (relative) return relative

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = parseISO(trimmed)
    return isValid(parsed) ? parsed : null
  }

  const timestamp = Date.parse(trimmed)
  if (Number.isNaN(timestamp)) return null
  return new Date(timestamp)
}

export function toDateFilterTimestamp(value: DateFilterInput, reference = new Date()): number | null {
  const parsed = parseDateFilterInput(value, reference)
  return parsed ? parsed.getTime() : null
}
