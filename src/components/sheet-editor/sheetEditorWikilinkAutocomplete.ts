import {
  attachClickHandlers,
  enrichSuggestionItems,
  hasMultipleSuggestionWorkspaces,
} from '../../utils/suggestionEnrichment'
import type { buildRawEditorBaseItems } from '../../utils/rawEditorUtils'
import { MIN_QUERY_LENGTH, preFilterWikilinks } from '../../utils/wikilinkSuggestions'
import type { WikilinkSuggestionItem } from '../WikilinkSuggestionMenu'
import type { VaultEntry } from '../../types'

type RawEditorBaseItems = ReturnType<typeof buildRawEditorBaseItems>

function sheetWikilinkCandidates(
  baseItems: RawEditorBaseItems,
  query: string,
) {
  return query.length >= MIN_QUERY_LENGTH ? preFilterWikilinks(baseItems, query) : baseItems
}

export function sheetWikilinkAutocompleteItems({
  baseItems,
  insertWikilink,
  query,
  sourceEntry,
  typeEntryMap,
  vaultPath,
}: {
  baseItems: RawEditorBaseItems
  insertWikilink: (target: string) => void
  query: string
  sourceEntry?: VaultEntry
  typeEntryMap: Record<string, VaultEntry>
  vaultPath: string
}): WikilinkSuggestionItem[] {
  const candidates = sheetWikilinkCandidates(baseItems, query)
  const withHandlers = attachClickHandlers(candidates, insertWikilink, vaultPath, sourceEntry)
  return enrichSuggestionItems(withHandlers, query, typeEntryMap, {
    showWorkspace: hasMultipleSuggestionWorkspaces(baseItems),
  })
}
