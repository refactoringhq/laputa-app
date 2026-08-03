import type { ComponentType, CSSProperties, SVGAttributes } from 'react'
import type { VaultEntry } from '../../types'
import { DEFAULT_DATE_DISPLAY_FORMAT, type DateDisplayFormat } from '../../utils/dateDisplay'
import { detectPropertyType, formatDateValue } from '../../utils/propertyTypes'
import { getMappedStatusStyle } from '../../utils/statusStyles'
import { getTypeColor, getTypeLightColor } from '../../utils/typeColors'
import { isUrlValue, normalizeUrl } from '../../utils/url'
import { resolveEntry, wikilinkDisplay, wikilinkTarget } from '../../utils/wikilink'
import { getTypeIcon } from './typeIcon'

export interface PropertyChipValue {
  label: string
  noteIcon: string | null
  typeIcon: ComponentType<SVGAttributes<SVGSVGElement>> | null
  style?: CSSProperties
  action?: { kind: 'note'; entry: VaultEntry } | { kind: 'url'; url: string }
  tone: 'neutral' | 'relationship' | 'status' | 'url'
}

export interface PropertyChipResolveContext {
  allEntries: VaultEntry[]
  typeEntryMap: Record<string, VaultEntry>
  dateDisplayFormat?: DateDisplayFormat
}

const URL_CHIP_STYLE: CSSProperties = {
  backgroundColor: 'var(--accent-blue-light)',
  color: 'var(--accent-blue)',
}

type ChipScalarValue = string | number | boolean | null

interface RelationshipChipLabelInput {
  displayLabel: string
  ref: string
  targetEntry: VaultEntry | undefined
}

function normalizeOpenableUrl(value: string): string | null {
  if (!isUrlValue(value)) return null
  const normalized = normalizeUrl(value)
  try {
    const url = new URL(normalized)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function truncateChipLabel(raw: string): string {
  return raw.length > 40 ? `${raw.slice(0, 37)}…` : raw
}

function formatChipLabel(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const raw = String(value)
  const openableUrl = normalizeOpenableUrl(raw)
  if (openableUrl) return new URL(openableUrl).hostname
  return truncateChipLabel(raw)
}

function resolveTargetTypeEntry(targetEntry: VaultEntry, typeEntryMap: Record<string, VaultEntry>): VaultEntry | undefined {
  return targetEntry.isA ? (typeEntryMap[targetEntry.isA] ?? typeEntryMap[targetEntry.isA.toLowerCase()]) : undefined
}

function findMatchingKey(values: Record<string, unknown>, propName: string): string | undefined {
  return Object.keys(values).find((key) => key.toLowerCase() === propName.toLowerCase())
}

function resolveRelationshipChipStyle(targetEntry: VaultEntry, typeEntryMap: Record<string, VaultEntry>): CSSProperties | undefined {
  const typeEntry = resolveTargetTypeEntry(targetEntry, typeEntryMap)
  const color = getTypeColor(targetEntry.isA, typeEntry?.color)
  const backgroundColor = getTypeLightColor(targetEntry.isA, typeEntry?.color)
  if (color === 'var(--muted-foreground)' && backgroundColor === 'var(--muted)') return undefined
  return { color, backgroundColor }
}

function resolveRelationshipChip(
  ref: string,
  allEntries: VaultEntry[],
  typeEntryMap: Record<string, VaultEntry>,
): PropertyChipValue | null {
  const targetEntry = resolveEntry(allEntries, wikilinkTarget(ref))
  const displayLabel = wikilinkDisplay(ref)
  const label = relationshipChipLabel({ displayLabel, ref, targetEntry })
  if (!label) return null
  if (!targetEntry) {
    return {
      label,
      noteIcon: null,
      typeIcon: null,
      tone: 'neutral',
    }
  }

  const typeEntry = resolveTargetTypeEntry(targetEntry, typeEntryMap)
  return {
    label,
    noteIcon: targetEntry.icon ?? null,
    typeIcon: targetEntry.isA ? getTypeIcon(targetEntry.isA, typeEntry?.icon) : null,
    style: resolveRelationshipChipStyle(targetEntry, typeEntryMap),
    action: { kind: 'note', entry: targetEntry },
    tone: 'relationship',
  }
}

function relationshipChipLabel({ displayLabel, ref, targetEntry }: RelationshipChipLabelInput): string {
  if (ref.includes('|')) return displayLabel
  return targetEntry?.title ?? displayLabel
}

function resolveScalarChip(value: unknown): PropertyChipValue | null {
  const label = formatChipLabel(value)
  if (!label) return null

  const openableUrl = typeof value === 'string' ? normalizeOpenableUrl(value) : null
  if (openableUrl) {
    return {
      label,
      noteIcon: null,
      typeIcon: null,
      style: URL_CHIP_STYLE,
      action: { kind: 'url', url: openableUrl },
      tone: 'url',
    }
  }

  return {
    label,
    noteIcon: null,
    typeIcon: null,
    tone: 'neutral',
  }
}

function resolveDateChip(value: ChipScalarValue, dateDisplayFormat: DateDisplayFormat): PropertyChipValue | null {
  const label = truncateChipLabel(formatDateValue(String(value), dateDisplayFormat))
  if (!label) return null

  return {
    label,
    noteIcon: null,
    typeIcon: null,
    tone: 'neutral',
  }
}

function resolveStatusChip(value: ChipScalarValue): PropertyChipValue | null {
  const label = formatChipLabel(value)
  if (!label) return null

  const status = String(value)
  const style = getMappedStatusStyle(status)
  return {
    label: `• ${label}`,
    noteIcon: null,
    typeIcon: null,
    style: style ? { backgroundColor: style.bg, color: style.color } : undefined,
    tone: 'status',
  }
}

function resolvePropertyValueChip(
  propName: string,
  value: ChipScalarValue | undefined,
  dateDisplayFormat: DateDisplayFormat,
): PropertyChipValue | null {
  if (value === undefined) return null
  const displayMode = detectPropertyType(propName, value)
  if (displayMode === 'status') return resolveStatusChip(value)
  if (displayMode === 'date') return resolveDateChip(value, dateDisplayFormat)
  return resolveScalarChip(value)
}

function resolveRelationshipChipValues(
  entry: VaultEntry,
  propName: string,
  allEntries: VaultEntry[],
  typeEntryMap: Record<string, VaultEntry>,
): PropertyChipValue[] | null {
  const relationshipKey = findMatchingKey(entry.relationships, propName)
  if (!relationshipKey) return null
  const refs = Reflect.get(entry.relationships, relationshipKey) as string[]
  return refs
    .map((ref) => resolveRelationshipChip(ref, allEntries, typeEntryMap))
    .filter((chip): chip is PropertyChipValue => chip !== null)
}

function resolveScalarChipValues(
  entry: VaultEntry,
  propName: string,
  dateDisplayFormat: DateDisplayFormat,
): PropertyChipValue[] {
  const propertyKey = findMatchingKey(entry.properties, propName)
  if (!propertyKey) return []

  const rawValue = Reflect.get(entry.properties, propertyKey) as unknown
  const values = Array.isArray(rawValue) ? rawValue : [rawValue]
  return values
    .map((value) => resolvePropertyValueChip(propertyKey, value, dateDisplayFormat))
    .filter((chip): chip is PropertyChipValue => chip !== null)
}

export function resolvePropertyChipValues(
  entry: VaultEntry,
  propName: string,
  context: PropertyChipResolveContext,
): PropertyChipValue[] {
  const dateDisplayFormat = context.dateDisplayFormat ?? DEFAULT_DATE_DISPLAY_FORMAT
  if (propName.toLowerCase() === 'status') {
    const statusChip = resolvePropertyValueChip(propName, entry.status, dateDisplayFormat)
    return statusChip ? [statusChip] : []
  }

  return resolveRelationshipChipValues(entry, propName, context.allEntries, context.typeEntryMap)
    ?? resolveScalarChipValues(entry, propName, dateDisplayFormat)
}

export function resolvePropertyChipLabels(
  entry: VaultEntry,
  displayProps: string[],
  context: PropertyChipResolveContext,
): string[] {
  const labels: string[] = []
  for (const propName of displayProps) {
    const values = resolvePropertyChipValues(entry, propName, context)
    for (const value of values) labels.push(value.label)
  }
  return labels
}
