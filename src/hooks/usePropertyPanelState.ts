import { useMemo, useState, useCallback } from 'react'
import type { VaultEntry } from '../types'
import type { FrontmatterValue } from '../components/Inspector'
import type { ParsedFrontmatter } from '../utils/frontmatter'
import {
  type PropertyDisplayMode,
  getEffectiveDisplayMode,
  loadDisplayModeOverrides,
  saveDisplayModeOverride,
  removeDisplayModeOverride,
} from '../utils/propertyTypes'
import { containsWikilinks } from '../components/DynamicPropertiesPanel'
import { canonicalFrontmatterKey, canonicalSystemMetadataKey, isSystemMetadataKey } from '../utils/systemMetadata'

// Keys to skip showing in Properties (handled by dedicated UI or internal)
// Compared case-insensitively via isVisibleProperty()
const SKIP_KEYS = new Set(['aliases', 'workspace', 'title', 'type', 'is_a', 'is a', '_archived', 'archived', 'archived_at', '_favorite', '_favorite_index', '_organized'])
const RELATIONSHIP_SCHEMA_KEYS = new Set(['belongs_to', 'related_to', 'has'])

type PropertyEntry = [string, FrontmatterValue]

function coerceValue(raw: string): FrontmatterValue {
  if (raw.toLowerCase() === 'true') return true
  if (raw.toLowerCase() === 'false') return false
  if (!isNaN(Number(raw)) && raw.trim() !== '') return Number(raw)
  return raw
}

function coerceNumberValue(raw: string): FrontmatterValue {
  const trimmed = raw.trim()
  if (trimmed === '') return ''

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : raw
}

function parseNewValue(rawValue: string): FrontmatterValue {
  if (!rawValue.includes(',')) return rawValue.trim() || ''
  const items = rawValue.split(',').map(s => s.trim()).filter(s => s)
  return items.length === 1 ? items[0] : items
}

function reconcileListUpdate(
  newItems: string[],
  onUpdate: (key: string, value: FrontmatterValue) => void,
  onDelete: ((key: string) => void) | undefined,
  key: string,
) {
  if (newItems.length === 0) onDelete?.(key)
  else if (newItems.length === 1) onUpdate(key, newItems[0])
  else onUpdate(key, newItems)
}

function deriveTypeInfo(entries: VaultEntry[] | undefined, entryIsA: string | null) {
  const typeEntries = (entries ?? []).filter(e => e.isA === 'Type')
  const typeColorKeys: Record<string, string | null> = {}
  const typeIconKeys: Record<string, string | null> = {}
  for (const e of typeEntries) {
    typeColorKeys[e.title] = e.color ?? null
    typeIconKeys[e.title] = e.icon ?? null
  }
  return {
    availableTypes: typeEntries.map(e => e.title).sort((a, b) => a.localeCompare(b)),
    customColorKey: entryIsA ? (typeColorKeys[entryIsA] ?? null) : null,
    typeColorKeys,
    typeIconKeys,
  }
}

function collectVaultStatuses(entries: VaultEntry[] | undefined): string[] {
  const seen = new Set<string>()
  for (const e of entries ?? []) {
    if (e.status) seen.add(e.status)
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b))
}

function collectAllVaultTags(entries: VaultEntry[] | undefined): Record<string, string[]> {
  if (!entries) return {}
  const tagsByKey = new Map<string, Set<string>>()
  for (const entry of entries) {
    if (!entry.properties) continue
    for (const [key, value] of Object.entries(entry.properties)) {
      addTagValues(tagsByKey, key, value)
    }
  }
  return toSortedTagRecord(tagsByKey)
}

function isVisibleProperty([key, value]: [string, FrontmatterValue]): boolean {
  return !isHiddenPropertyKey(key) && !containsWikilinks(value)
}

function buildVisiblePropertyEntries(frontmatter: ParsedFrontmatter): PropertyEntry[] {
  const result: PropertyEntry[] = []
  const seen = new Set<string>()

  for (const [key, value] of Object.entries(frontmatter)) {
    if (!isVisibleProperty([key, value])) continue

    const canonicalKey = canonicalSystemMetadataKey(key)
    if (seen.has(canonicalKey)) continue
    seen.add(canonicalKey)
    result.push([key, value])
  }

  return result
}

function findTypeEntry(entries: VaultEntry[] | undefined, entryIsA: string | null): VaultEntry | undefined {
  if (!entryIsA || entryIsA === 'Type') return undefined
  return entries?.find((entry) => entry.isA === 'Type' && entry.title === entryIsA)
}

function isRelationshipSchemaKey(key: string): boolean {
  return RELATIONSHIP_SCHEMA_KEYS.has(canonicalFrontmatterKey(key))
}

function buildExistingFrontmatterKeys(frontmatter: ParsedFrontmatter): Set<string> {
  return new Set(Object.keys(frontmatter).map(canonicalFrontmatterKey))
}

function buildTypeDerivedPropertyEntries({
  entries,
  entryIsA,
  frontmatter,
}: {
  entries: VaultEntry[] | undefined
  entryIsA: string | null
  frontmatter: ParsedFrontmatter
}): PropertyEntry[] {
  const typeEntry = findTypeEntry(entries, entryIsA)
  if (!typeEntry) return []

  const existingKeys = buildExistingFrontmatterKeys(frontmatter)
  const result: PropertyEntry[] = []
  const seen = new Set<string>()

  for (const [key, value] of Object.entries(typeEntry.properties ?? {})) {
    const canonicalKey = canonicalFrontmatterKey(key)
    if (existingKeys.has(canonicalKey) || seen.has(canonicalKey) || isRelationshipSchemaKey(key)) continue
    if (!isVisibleProperty([key, value])) continue
    seen.add(canonicalKey)
    result.push([key, value])
  }

  return result
}

function addTagValues(tagsByKey: Map<string, Set<string>>, key: string, value: unknown) {
  if (!Array.isArray(value)) return

  let set = tagsByKey.get(key)
  if (!set) {
    set = new Set()
    tagsByKey.set(key, set)
  }

  for (const tag of value) {
    set.add(String(tag))
  }
}

function toSortedTagRecord(tagsByKey: Map<string, Set<string>>): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const [key, set] of tagsByKey) {
    result[key] = Array.from(set).sort((a, b) => a.localeCompare(b))
  }
  return result
}

function isHiddenPropertyKey(key: string): boolean {
  const canonicalKey = canonicalSystemMetadataKey(key)
  if (canonicalKey === '_icon') return false
  return SKIP_KEYS.has(key.toLowerCase()) || isSystemMetadataKey(key)
}

function parseAddedValue(rawValue: string, mode: PropertyDisplayMode): FrontmatterValue {
  if (mode === 'boolean') return rawValue.toLowerCase() === 'true'
  if (mode === 'number') return coerceNumberValue(rawValue)
  if (mode === 'tags') {
    const items = rawValue.split(',').map(s => s.trim()).filter(s => s)
    return items
  }
  return parseNewValue(rawValue)
}

function persistModeOverride(key: string, mode: PropertyDisplayMode | null) {
  if (mode === null) removeDisplayModeOverride(key)
  else saveDisplayModeOverride(key, mode)
}

function saveScalarProperty({
  key,
  newValue,
  frontmatter,
  displayOverrides,
  onUpdateProperty,
  onDeleteProperty,
}: {
  key: string
  newValue: string
  frontmatter: ParsedFrontmatter
  displayOverrides: Record<string, PropertyDisplayMode>
  onUpdateProperty: (key: string, value: FrontmatterValue) => void
  onDeleteProperty?: (key: string) => void
}) {
  const currentValue = frontmatter[key] ?? null
  const displayMode = getEffectiveDisplayMode(key, currentValue, displayOverrides)
  if (displayMode !== 'number') {
    onUpdateProperty(key, coerceValue(newValue))
    return
  }

  const trimmed = newValue.trim()
  if (trimmed === '') {
    onDeleteProperty?.(key)
    return
  }

  onUpdateProperty(key, coerceNumberValue(newValue))
}

export interface PropertyPanelDeps {
  entries: VaultEntry[] | undefined
  entryIsA: string | null
  frontmatter: ParsedFrontmatter
  onUpdateProperty?: (key: string, value: FrontmatterValue) => void
  onDeleteProperty?: (key: string) => void
  onAddProperty?: (key: string, value: FrontmatterValue) => void
}

export function usePropertyPanelState(deps: PropertyPanelDeps) {
  const { entries, entryIsA, frontmatter, onUpdateProperty, onDeleteProperty, onAddProperty } = deps
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [displayOverrides, setDisplayOverrides] = useState(() => loadDisplayModeOverrides())

  const { availableTypes, customColorKey, typeColorKeys, typeIconKeys } = useMemo(() => deriveTypeInfo(entries, entryIsA), [entries, entryIsA])
  const vaultStatuses = useMemo(() => collectVaultStatuses(entries), [entries])
  const vaultTagsByKey = useMemo(() => collectAllVaultTags(entries), [entries])
  const propertyEntries = useMemo(() => buildVisiblePropertyEntries(frontmatter), [frontmatter])
  const typeDerivedPropertyEntries = useMemo(
    () => buildTypeDerivedPropertyEntries({ entries, entryIsA, frontmatter }),
    [entries, entryIsA, frontmatter],
  )

  const handleSaveValue = useCallback((key: string, newValue: string) => {
    setEditingKey(null)
    if (!onUpdateProperty) return
    saveScalarProperty({ key, newValue, frontmatter, displayOverrides, onUpdateProperty, onDeleteProperty })
  }, [displayOverrides, frontmatter, onDeleteProperty, onUpdateProperty])

  const handleSaveTypeDerivedValue = useCallback((key: string, newValue: string) => {
    setEditingKey(null)
    if (!onUpdateProperty || newValue.trim() === '') return
    saveScalarProperty({ key, newValue, frontmatter, displayOverrides, onUpdateProperty, onDeleteProperty })
  }, [displayOverrides, frontmatter, onDeleteProperty, onUpdateProperty])

  const handleSaveList = useCallback((key: string, newItems: string[]) => {
    if (!onUpdateProperty) return
    reconcileListUpdate(newItems, onUpdateProperty, onDeleteProperty, key)
  }, [onUpdateProperty, onDeleteProperty])

  const handleAdd = useCallback((rawKey: string, rawValue: string, mode: PropertyDisplayMode) => {
    if (!rawKey.trim() || !onAddProperty) return
    onAddProperty(rawKey.trim(), parseAddedValue(rawValue, mode))
    if (mode !== 'text') {
      persistModeOverride(rawKey.trim(), mode)
      setDisplayOverrides(loadDisplayModeOverrides())
    }
    setShowAddDialog(false)
  }, [onAddProperty])

  const handleDisplayModeChange = useCallback((key: string, mode: PropertyDisplayMode | null) => {
    persistModeOverride(key, mode)
    setDisplayOverrides(loadDisplayModeOverrides())
  }, [])

  return {
    editingKey, setEditingKey, showAddDialog, setShowAddDialog, displayOverrides,
    availableTypes, customColorKey, typeColorKeys, typeIconKeys, vaultStatuses, vaultTagsByKey, propertyEntries, typeDerivedPropertyEntries,
    handleSaveValue, handleSaveTypeDerivedValue, handleSaveList, handleAdd, handleDisplayModeChange,
  }
}
