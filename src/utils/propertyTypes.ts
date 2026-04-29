import type { FrontmatterValue } from '../components/Inspector'
import { getAppStorageItem } from '../constants/appStorage'
import { isValidCssColor, isColorKeyName } from './colorUtils'
import { updateVaultConfigField } from './vaultConfigStore'
import { CalendarIcon, Type, ToggleLeft, Circle, Link, Tag, Palette, Hash } from 'lucide-react'
import { canonicalSystemMetadataKey } from './systemMetadata'

export type PropertyDisplayMode = 'text' | 'number' | 'date' | 'boolean' | 'status' | 'url' | 'tags' | 'color'
type PropertyKey = string
type PropertyValueText = string
type PropertyKeyPatterns = readonly PropertyKey[]
type DisplayModeOverrides = Record<PropertyKey, PropertyDisplayMode>

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2})?)?/
const COMMON_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/

const STATUS_VALUES = new Set<PropertyValueText>([
  'active', 'done', 'paused', 'archived', 'dropped',
  'open', 'closed', 'not started', 'draft', 'mixed',
  'published', 'in progress', 'blocked', 'cancelled', 'pending',
])

const STATUS_KEY_PATTERNS: PropertyKeyPatterns = ['status']
const DATE_KEY_PATTERNS: PropertyKeyPatterns = ['date', 'deadline', 'due', 'start', 'end', 'scheduled']
const TAGS_KEY_PATTERNS: PropertyKeyPatterns = ['tags', 'keywords', 'categories', 'labels']

function isIconKey(key: PropertyKey): boolean {
  return canonicalSystemMetadataKey(key) === '_icon'
}

function keyMatchesPatterns(key: PropertyKey, patterns: PropertyKeyPatterns): boolean {
  const lower = key.toLowerCase()
  return patterns.some(p => lower === p || lower.includes(p))
}

function isDateString(value: PropertyValueText): boolean {
  return ISO_DATE_RE.test(value) || COMMON_DATE_RE.test(value)
}

function isStatusKey(key: PropertyKey): boolean {
  return keyMatchesPatterns(key, STATUS_KEY_PATTERNS)
}

function isDateKey(key: PropertyKey): boolean {
  return keyMatchesPatterns(key, DATE_KEY_PATTERNS)
}

function isStatusString(key: PropertyKey, value: PropertyValueText): boolean {
  if (isStatusKey(key)) return true
  if (isDateKey(key)) return false
  return STATUS_VALUES.has(value.toLowerCase())
}

function isColorString(key: PropertyKey, value: PropertyValueText): boolean {
  return isValidCssColor(value) && (value.startsWith('#') || isColorKeyName(key))
}

function detectStringType(key: PropertyKey, strValue: PropertyValueText): PropertyDisplayMode {
  if (isIconKey(key)) return 'text'
  if (isStatusString(key, strValue)) return 'status'
  if (isDateString(strValue)) return 'date'
  if (isColorString(key, strValue)) return 'color'
  return 'text'
}

export function detectPropertyType(key: PropertyKey, value: FrontmatterValue): PropertyDisplayMode {
  if (value === null || value === undefined) return 'text'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (isIconKey(key)) return 'text'
  if (keyMatchesPatterns(key, TAGS_KEY_PATTERNS)) return 'tags'
  if (Array.isArray(value)) return 'text'
  return detectStringType(key, String(value))
}

let vaultOverrides: DisplayModeOverrides | null = null

/** Initialize display mode overrides from vault config (replaces localStorage). */
export function initDisplayModeOverrides(overrides: Record<PropertyKey, PropertyValueText>): void {
  vaultOverrides = overrides as DisplayModeOverrides
}

export function loadDisplayModeOverrides(): DisplayModeOverrides {
  if (vaultOverrides !== null) return { ...vaultOverrides }
  const raw = getAppStorageItem('propertyModes')
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function persistDisplayModeOverrides(overrides: DisplayModeOverrides): void {
  vaultOverrides = { ...overrides }
  const snapshot = Object.keys(overrides).length > 0 ? { ...overrides } : null
  updateVaultConfigField('property_display_modes', snapshot as Record<PropertyKey, PropertyValueText> | null)
}

export function saveDisplayModeOverride(propertyName: PropertyKey, mode: PropertyDisplayMode): void {
  const overrides = loadDisplayModeOverrides()
  overrides[propertyName] = mode
  persistDisplayModeOverrides(overrides)
}

export function removeDisplayModeOverride(propertyName: PropertyKey): void {
  const overrides = loadDisplayModeOverrides()
  delete overrides[propertyName]
  persistDisplayModeOverrides(overrides)
}

export function getEffectiveDisplayMode(
  key: PropertyKey,
  value: FrontmatterValue,
  overrides: DisplayModeOverrides,
): PropertyDisplayMode {
  return overrides[key] ?? detectPropertyType(key, value)
}

interface DateParts {
  year: number
  month: number
  day: number
}

function validDateParts(parts: DateParts): DateParts | null {
  const date = dateFromParts(parts)
  return date.getFullYear() === parts.year && date.getMonth() === parts.month - 1 && date.getDate() === parts.day
    ? parts
    : null
}

function parseISODateParts(value: PropertyValueText): DateParts | null {
  const match = value.match(ISO_DATE_RE)
  if (!match) return null
  return validDateParts({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  })
}

function parseCommonDateParts(value: PropertyValueText): DateParts | null {
  const match = value.match(COMMON_DATE_RE)
  if (!match) return null
  return validDateParts({
    year: Number(match[3]),
    month: Number(match[1]),
    day: Number(match[2]),
  })
}

function dateFromParts(parts: DateParts): Date {
  return new Date(parts.year, parts.month - 1, parts.day)
}

function formatISODateParts(parts: DateParts): string {
  const yyyy = String(parts.year).padStart(4, '0')
  const mm = String(parts.month).padStart(2, '0')
  const dd = String(parts.day).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function resolveDateFromValue(value: PropertyValueText): Date | null {
  const parts = parseISODateParts(value) ?? parseCommonDateParts(value)
  return parts ? dateFromParts(parts) : null
}

export function formatDateValue(value: PropertyValueText): PropertyValueText {
  const date = resolveDateFromValue(value)
  return date
    ? date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : value
}

export function toISODate(value: PropertyValueText): PropertyValueText {
  const parts = parseISODateParts(value)
  return parts ? formatISODateParts(parts) : value
}

export const DISPLAY_MODE_ICONS: Record<PropertyDisplayMode, typeof Type> = {
  text: Type, number: Hash, date: CalendarIcon, boolean: ToggleLeft, status: Circle, url: Link, tags: Tag, color: Palette,
}

export const DISPLAY_MODE_OPTIONS: { value: PropertyDisplayMode; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'status', label: 'Status' },
  { value: 'url', label: 'URL' },
  { value: 'tags', label: 'Tags' },
  { value: 'color', label: 'Color' },
]
