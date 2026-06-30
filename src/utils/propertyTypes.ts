import type { FrontmatterValue } from '../components/Inspector'
import { CalendarBlank as CalendarIcon, Circle, Hash, Link, Palette, Tag, TextT as Type, ToggleLeft } from '@phosphor-icons/react'
import { getAppStorageItem } from '../constants/appStorage'
import { isValidCssColor, isColorKeyName } from './colorUtils'
import { dateFromParts, parseDashDateParts, parseSlashDateParts, type DateParts } from './dateStringParts'
import { DEFAULT_DATE_DISPLAY_FORMAT, formatDateValueForDisplay, type DateDisplayFormat } from './dateDisplay'
import { updateVaultConfigField } from './vaultConfigStore'
import { canonicalSystemMetadataKey } from './systemMetadata'

export type PropertyDisplayMode = 'text' | 'number' | 'date' | 'boolean' | 'status' | 'url' | 'tags' | 'color'
type PropertyKey = string
type PropertyValueText = string
type PropertyKeyPatterns = readonly PropertyKey[]
type DisplayModeOverrides = Record<PropertyKey, PropertyDisplayMode>

const STATUS_VALUES = new Set<PropertyValueText>([
  'active', 'done', 'paused', 'archived', 'dropped',
  'open', 'closed', 'not started', 'draft', 'mixed',
  'published', 'in progress', 'blocked', 'cancelled', 'pending',
])

const STATUS_KEY_PATTERNS: PropertyKeyPatterns = ['status']
const DATE_KEY_PATTERNS: PropertyKeyPatterns = ['date', 'deadline', 'due', 'start', 'end', 'scheduled', 'timestamp']
const URL_KEY_PATTERNS: PropertyKeyPatterns = ['resource', 'url', 'link', 'href', 'website']
const TAGS_KEY_PATTERNS: PropertyKeyPatterns = ['tags', 'keywords', 'categories', 'labels']

function isIconKey(key: PropertyKey): boolean {
  return canonicalSystemMetadataKey(key) === '_icon'
}

function keyMatchesPatterns(key: PropertyKey, patterns: PropertyKeyPatterns): boolean {
  const lower = key.toLowerCase()
  return patterns.some(p => lower === p || lower.includes(p))
}

function isDateString(value: PropertyValueText): boolean {
  return parseISODateParts(value) !== null || parseCommonDateParts(value) !== null
}

function isStatusKey(key: PropertyKey): boolean {
  return keyMatchesPatterns(key, STATUS_KEY_PATTERNS)
}

function isDateKey(key: PropertyKey): boolean {
  return keyMatchesPatterns(key, DATE_KEY_PATTERNS)
}

function isUrlKey(key: PropertyKey): boolean {
  return keyMatchesPatterns(key, URL_KEY_PATTERNS)
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
  if (isUrlKey(key)) return 'url'
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
  Reflect.set(overrides, propertyName, mode)
  persistDisplayModeOverrides(overrides)
}

export function removeDisplayModeOverride(propertyName: PropertyKey): void {
  const overrides = loadDisplayModeOverrides()
  Reflect.deleteProperty(overrides, propertyName)
  persistDisplayModeOverrides(overrides)
}

export function getEffectiveDisplayMode(
  key: PropertyKey,
  value: FrontmatterValue,
  overrides: DisplayModeOverrides,
): PropertyDisplayMode {
  return (Reflect.get(overrides, key) as PropertyDisplayMode | undefined) ?? detectPropertyType(key, value)
}

function parseISODateParts(value: PropertyValueText): DateParts | null {
  return parseDashDateParts(value)
}

function parseCommonDateParts(value: PropertyValueText): DateParts | null {
  return parseSlashDateParts(value)
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

export function formatDateValue(
  value: PropertyValueText,
  dateDisplayFormat: DateDisplayFormat = DEFAULT_DATE_DISPLAY_FORMAT,
): PropertyValueText {
  return resolveDateFromValue(value)
    ? formatDateValueForDisplay(value, dateDisplayFormat)
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
