import { useState, useMemo, useCallback, useEffect } from 'react'
import type { VaultEntry } from '../types'
import { fuzzyMatch, bestSearchRank } from '../utils/fuzzyMatch'
import { getTypeColor, getTypeLightColor, buildTypeEntryMap } from '../utils/typeColors'
import { getTypeIcon } from '../components/NoteItem'
import type { NoteSearchResultItem } from '../components/NoteSearchList'

const DEFAULT_MAX_RESULTS = 20

export interface NoteSearchResult extends NoteSearchResultItem {
  entry: VaultEntry
}

function toResult(e: VaultEntry, typeEntryMap: Record<string, VaultEntry>, showWorkspace: boolean): NoteSearchResult {
  const noteType = e.isA || undefined
  const te = typeEntryMap[e.isA ?? '']
  return {
    entry: e,
    title: e.title,
    noteIcon: e.icon,
    noteType,
    typeColor: noteType ? getTypeColor(e.isA, te?.color) : undefined,
    typeLightColor: noteType ? getTypeLightColor(e.isA, te?.color) : undefined,
    TypeIcon: noteType ? getTypeIcon(e.isA, te?.icon) : undefined,
    workspace: showWorkspace ? e.workspace ?? null : null,
  }
}

/** Types excluded from note search results (internal infrastructure). */
const SEARCH_EXCLUDED_TYPES = new Set(['Config'])

export function useNoteSearch(entries: VaultEntry[], query: string, maxResults = DEFAULT_MAX_RESULTS) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const typeEntryMap = useMemo(() => buildTypeEntryMap(entries), [entries])

  const searchableEntries = useMemo(
    () => entries.filter((e) => !SEARCH_EXCLUDED_TYPES.has(e.isA ?? '')),
    [entries],
  )
  const showWorkspace = useMemo(
    () => new Set(entries.map((entry) => entry.workspace?.alias).filter(Boolean)).size > 1,
    [entries],
  )

  const results: NoteSearchResult[] = useMemo(() => {
    const mapResult = (e: VaultEntry) => toResult(e, typeEntryMap, showWorkspace)
    if (!query.trim()) {
      return [...searchableEntries]
        .sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0))
        .slice(0, maxResults)
        .map(mapResult)
    }
    return searchableEntries
      .map((e) => ({
        entry: e,
        ...fuzzyMatch(query, e.title),
        rank: bestSearchRank(query, e.title, e.aliases),
      }))
      .filter((r) => r.match)
      .sort((a, b) => a.rank - b.rank || b.score - a.score)
      .slice(0, maxResults)
      .map((r) => mapResult(r.entry))
  }, [searchableEntries, query, maxResults, typeEntryMap, showWorkspace])

  useEffect(() => {
    void query
    setSelectedIndex(0) // eslint-disable-line react-hooks/set-state-in-effect -- reset on query change
  }, [query])

  const selectedEntry = results.at(selectedIndex)?.entry ?? null

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent | KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      }
    },
    [results.length],
  )

  return { results, selectedIndex, setSelectedIndex, selectedEntry, handleKeyDown }
}
