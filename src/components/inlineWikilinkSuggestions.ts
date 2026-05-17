import type { VaultEntry } from '../types'
import {
  MAX_RESULTS,
  deduplicateByPath,
  disambiguateTitles,
  preFilterWikilinks,
  type WikilinkBaseItem,
} from '../utils/wikilinkSuggestions'
import { toInlineWikilinkTarget } from './inlineWikilinkTokens'

export interface InlineWikilinkSuggestion {
  entry: VaultEntry
  target: string
  title: string
}

interface SuggestionItem extends WikilinkBaseItem {
  entry: VaultEntry
  target: string
}

function toSuggestionItems(entries: VaultEntry[]): SuggestionItem[] {
  return entries
    .filter((entry) => !entry.archived)
    .map((entry) => ({
      entry,
      target: toInlineWikilinkTarget(entry),
      title: entry.title,
      aliases: entry.aliases,
      group: entry.isA ?? 'Note',
      entryTitle: entry.title,
      path: entry.path,
    }))
}

function toSuggestion(item: SuggestionItem): InlineWikilinkSuggestion {
  return {
    entry: item.entry,
    target: item.target,
    title: item.title,
  }
}

function matchSingleCharacterQuery(
  items: SuggestionItem[],
  query: string,
): SuggestionItem[] {
  const lowerQuery = query.toLowerCase()
  return items.filter((item) =>
    item.title.toLowerCase().includes(lowerQuery) ||
    item.aliases.some((alias) => alias.toLowerCase().includes(lowerQuery)) ||
    item.group.toLowerCase().includes(lowerQuery) ||
    item.path.toLowerCase().includes(lowerQuery),
  )
}

function buildTopSuggestions(items: SuggestionItem[]): InlineWikilinkSuggestion[] {
  return disambiguateTitles(deduplicateByPath([...items]))
    .sort((left, right) => left.title.localeCompare(right.title))
    .slice(0, MAX_RESULTS)
    .map(toSuggestion)
}

export function buildInlineWikilinkSuggestions(
  entries: VaultEntry[],
  query: string,
): InlineWikilinkSuggestion[] {
  const items = toSuggestionItems(entries)
  if (query.length === 0) return buildTopSuggestions(items)

  const matchedItems = query.length === 1
    ? matchSingleCharacterQuery(items, query)
    : preFilterWikilinks(items, query)

  return disambiguateTitles(deduplicateByPath(matchedItems))
    .slice(0, MAX_RESULTS)
    .map(toSuggestion)
}
