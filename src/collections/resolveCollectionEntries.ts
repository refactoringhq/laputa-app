import type { VaultEntry } from '../types'
import {
  type FilterEntriesOptions,
  type RelationshipGroup,
  buildRelationshipGroups,
  filterEntries,
} from '../utils/noteListHelpers'
import type { CollectionDefinition } from './collectionTypes'

interface ResolveCollectionEntriesOptions extends FilterEntriesOptions {
  changesEntries?: VaultEntry[]
  inboxEntries?: VaultEntry[]
}

export interface ResolvedCollectionEntries {
  entries: VaultEntry[]
  entityEntry: VaultEntry | null
  relationshipGroups: RelationshipGroup[]
}

function specialFilterEntries(
  collection: CollectionDefinition,
  options: ResolveCollectionEntriesOptions,
): VaultEntry[] | null {
  const selection = collection.selection
  if (selection.kind !== 'filter') return null
  if (selection.filter === 'changes') return options.changesEntries ?? []
  if (selection.filter === 'inbox') return options.inboxEntries ?? []
  return null
}

function currentEntityEntry(collection: CollectionDefinition, entries: VaultEntry[]): VaultEntry | null {
  if (collection.selection.kind !== 'entity') return null
  const selectedEntry = collection.selection.entry
  return entries.find((entry) => entry.path === selectedEntry.path) ?? selectedEntry
}

export function resolveCollectionEntries(
  collection: CollectionDefinition,
  entries: VaultEntry[],
  options: ResolveCollectionEntriesOptions = {},
): ResolvedCollectionEntries {
  const entityEntry = currentEntityEntry(collection, entries)
  if (entityEntry) {
    return {
      entries: [],
      entityEntry,
      relationshipGroups: buildRelationshipGroups(entityEntry, entries),
    }
  }

  return {
    entries: specialFilterEntries(collection, options) ?? filterEntries(entries, collection.selection, options),
    entityEntry: null,
    relationshipGroups: [],
  }
}
