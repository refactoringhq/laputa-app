/**
 * Pure functions for building sidebar section groups from vault entries.
 * Extracted from Sidebar.tsx for testability.
 */

import type { VaultEntry } from '../types'
import type { SectionGroup } from '../components/SidebarParts'
import { resolveIcon } from './iconRegistry'
import { pluralizeType } from '../hooks/useCommandRegistry'
import { isLegacyJournalingType } from './legacyTypes'
import { canonicalizeTypeName } from './vaultTypes'
import {
  Wrench, Flask, Target, ArrowsClockwise,
  Users, CalendarBlank, Tag, StackSimple,
} from '@phosphor-icons/react'

const BUILT_IN_SECTION_GROUPS: SectionGroup[] = [
  { label: 'Projects', type: 'Project', Icon: Wrench },
  { label: 'Experiments', type: 'Experiment', Icon: Flask },
  { label: 'Responsibilities', type: 'Responsibility', Icon: Target },
  { label: 'Procedures', type: 'Procedure', Icon: ArrowsClockwise },
  { label: 'People', type: 'Person', Icon: Users },
  { label: 'Events', type: 'Event', Icon: CalendarBlank },
  { label: 'Topics', type: 'Topic', Icon: Tag },
  { label: 'Types', type: 'Type', Icon: StackSimple },
]

/** Metadata lookup for well-known types (icon/label only — NOT used to determine which sections to show) */
const BUILT_IN_TYPE_MAP = new Map(BUILT_IN_SECTION_GROUPS.map((sg) => [sg.type, sg]))

const isMarkdown = (e: VaultEntry) => e.fileKind === 'markdown' || !e.fileKind
const isActive = (e: VaultEntry) => !e.archived

function shouldCollectActiveType(entry: VaultEntry): boolean {
  if (!isActive(entry) || !isMarkdown(entry)) return false
  return Boolean(entry.isA)
}

function shouldIncludeTypeDefinition(name: string, entry: VaultEntry): boolean {
  return name === entry.title && isActive(entry)
}

function resolveTypeEntry(type: string, typeEntryMap: Record<string, VaultEntry>): VaultEntry | undefined {
  return typeEntryMap[type] ?? typeEntryMap[type.toLowerCase()]
}

function hasExplicitTypeDefinition(type: string, typeEntryMap: Record<string, VaultEntry>): boolean {
  const typeEntry = resolveTypeEntry(type, typeEntryMap)
  return Boolean(typeEntry && typeEntry.title.trim().toLowerCase() === type.trim().toLowerCase() && isActive(typeEntry))
}

function shouldIncludeSectionType(type: string, typeEntryMap: Record<string, VaultEntry>): boolean {
  if (!isLegacyJournalingType(type)) return true
  return hasExplicitTypeDefinition(type, typeEntryMap)
}

function canonicalizeSectionType(type: string, typeEntryMap: Record<string, VaultEntry>): string | null {
  const trimmedType = type.trim()
  if (!trimmedType) return null
  return resolveTypeEntry(trimmedType, typeEntryMap)?.title ?? canonicalizeTypeName(trimmedType)
}

function addSectionType(typeMap: Map<string, string>, rawType: string, typeEntryMap: Record<string, VaultEntry>): void {
  const canonicalType = canonicalizeSectionType(rawType, typeEntryMap)
  if (!canonicalType) return

  const typeKey = canonicalType.toLowerCase()
  if (!typeMap.has(typeKey)) {
    typeMap.set(typeKey, canonicalType)
  }
}

/** Collect unique explicit isA values from active (non-archived) markdown entries. */
export function collectActiveTypes(entries: VaultEntry[]): Set<string> {
  const types = new Set<string>()
  for (const e of entries) {
    if (!shouldCollectActiveType(e)) continue
    types.add(e.isA!)
  }
  return types
}

function resolveLabel(
  type: string,
  typeEntry: VaultEntry | undefined,
  builtIn: SectionGroup | undefined,
  pluralizeTypeLabel: boolean,
): string {
  if (typeEntry?.sidebarLabel) return typeEntry.sidebarLabel
  if (!pluralizeTypeLabel) return type
  return builtIn?.label || pluralizeType(type)
}

/** Build a single SectionGroup for a type, using built-in metadata or Type entry for icon/label */
export function buildSectionGroup(
  type: string,
  typeEntryMap: Record<string, VaultEntry>,
  pluralizeTypeLabel = true,
): SectionGroup {
  const builtIn = BUILT_IN_TYPE_MAP.get(type)
  const typeEntry = typeEntryMap[type]
  const customColor = typeEntry?.color ?? null
  const label = resolveLabel(type, typeEntry, builtIn, pluralizeTypeLabel)
  const icon = resolveIcon(typeEntry?.icon ?? null)
  if (builtIn) {
    return { ...builtIn, label, Icon: typeEntry?.icon ? icon : builtIn.Icon, customColor }
  }
  return { label, type, Icon: icon, customColor }
}

/** Build sections dynamically from vault entries and defined types — types with 0 notes still appear */
export function buildDynamicSections(
  entries: VaultEntry[],
  typeEntryMap: Record<string, VaultEntry>,
  pluralizeTypeLabels = true,
): SectionGroup[] {
  const activeTypes = new Map<string, string>()
  for (const type of collectActiveTypes(entries)) {
    addSectionType(activeTypes, type, typeEntryMap)
  }
  for (const [name, entry] of Object.entries(typeEntryMap)) {
    if (!shouldIncludeTypeDefinition(name, entry)) continue
    addSectionType(activeTypes, name, typeEntryMap)
  }
  return Array.from(activeTypes.values())
    .filter((type) => shouldIncludeSectionType(type, typeEntryMap))
    .map((type) => buildSectionGroup(type, typeEntryMap, pluralizeTypeLabels))
}

export function sortSections(groups: SectionGroup[], typeEntryMap: Record<string, VaultEntry>): SectionGroup[] {
  return [...groups].sort((a, b) => {
    const orderA = typeEntryMap[a.type]?.order ?? Infinity
    const orderB = typeEntryMap[b.type]?.order ?? Infinity
    return orderA !== orderB ? orderA - orderB : a.label.localeCompare(b.label)
  })
}

export { BUILT_IN_SECTION_GROUPS }
