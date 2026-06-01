import type { VaultEntry } from '../../types'
import type { DateDisplayFormat } from '../../utils/dateDisplay'
import type { RelationshipGroup } from '../../utils/noteListHelpers'
import { resolvePropertyChipLabels } from '../note-item/propertyChipValues'

interface NoteListSearchContext {
  allEntries: VaultEntry[]
  typeEntryMap: Record<string, VaultEntry>
  displayPropsOverride?: string[] | null
  dateDisplayFormat?: DateDisplayFormat
  fullTextResultPaths?: Set<string>
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

function searchableString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function resolveDisplayProps(
  entry: VaultEntry,
  typeEntryMap: Record<string, VaultEntry>,
  displayPropsOverride?: string[] | null,
): string[] {
  if (displayPropsOverride && displayPropsOverride.length > 0) return displayPropsOverride
  return typeEntryMap[entry.isA ?? '']?.listPropertiesDisplay ?? []
}

function resolveSearchableText(entry: VaultEntry, context: NoteListSearchContext): string[] {
  return [
    searchableString(entry.title),
    searchableString(entry.snippet),
    ...resolvePropertyChipLabels(
      entry,
      resolveDisplayProps(entry, context.typeEntryMap, context.displayPropsOverride),
      {
        allEntries: context.allEntries,
        typeEntryMap: context.typeEntryMap,
        dateDisplayFormat: context.dateDisplayFormat,
      },
    ),
  ]
}

export function matchesNoteListQuery(
  entry: VaultEntry,
  query: string,
  context: NoteListSearchContext,
): boolean {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) return true
  if (context.fullTextResultPaths?.has(entry.path)) return true
  return resolveSearchableText(entry, context).some((value) => value.toLowerCase().includes(normalizedQuery))
}

export function filterEntriesByNoteListQuery(
  entries: VaultEntry[],
  query: string,
  context: NoteListSearchContext,
): VaultEntry[] {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) return entries
  return entries.filter((entry) => matchesNoteListQuery(entry, normalizedQuery, context))
}

export function filterGroupsByNoteListQuery(
  groups: RelationshipGroup[],
  query: string,
  context: NoteListSearchContext,
): RelationshipGroup[] {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) return groups
  return groups
    .map((group) => ({
      ...group,
      entries: filterEntriesByNoteListQuery(group.entries, normalizedQuery, context),
    }))
}
