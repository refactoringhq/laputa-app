import { useState, useMemo, useCallback, useEffect } from 'react'
import type { VaultEntry } from '../types'
import { fuzzyMatch } from '../utils/fuzzyMatch'
import { getTypeColor, getTypeLightColor, buildTypeEntryMap } from '../utils/typeColors'
import { getTypeIcon } from '../components/NoteItem'
import type { NoteSearchResultItem } from '../components/NoteSearchList'
import { slugifyNoteStem } from '../utils/noteSlug'

const DEFAULT_MAX_RESULTS = 20

export interface NoteSearchResult extends NoteSearchResultItem {
  entry: VaultEntry
}

interface CandidateMatch {
  match: boolean
  rank: number
  score: number
}

interface SearchCandidate {
  value: string
  exactRank: number
  prefixRank: number
  fuzzyRank: number
}

interface SearchTextInput {
  value: string
}

interface SearchFormsInput {
  value: string
}

interface UniqueValuesInput {
  values: string[]
}

interface EntrySearchInput {
  entry: VaultEntry
}

interface CandidateSearchInput {
  queryForms: string[]
  targetForms: string[]
  candidate: SearchCandidate
}

interface RankedEntryInput {
  query: string
  entry: VaultEntry
}

interface TypePresentationInput {
  noteType: string | undefined
  typeEntry: VaultEntry | undefined
}

interface WorkspacePresentationInput {
  entry: VaultEntry
  showWorkspace: boolean
}

interface ResultInput {
  entry: VaultEntry
  typeEntryMap: Record<string, VaultEntry>
  showWorkspace: boolean
}

const NO_MATCH: CandidateMatch = { match: false, rank: Number.POSITIVE_INFINITY, score: 0 }

function compactUnique({ values }: UniqueValuesInput): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function removeDiacritics({ value }: SearchTextInput): string {
  return value.normalize('NFKD').replace(/\p{Mark}/gu, '')
}

function stripMarkdownExtension({ value }: SearchTextInput): string {
  return value.replace(/\.md$/iu, '')
}

function normalizeSearchText({ value }: SearchTextInput): string {
  return removeDiacritics({ value }).toLocaleLowerCase().trim()
}

function hasSearchToken({ value }: SearchTextInput): boolean {
  return /\p{Letter}|\p{Number}/u.test(value)
}

function searchForms({ value }: SearchFormsInput): string[] {
  const normalized = normalizeSearchText({ value })
  const withoutExtension = stripMarkdownExtension({ value: normalized })
  const slug = hasSearchToken({ value: withoutExtension }) ? slugifyNoteStem(withoutExtension) : ''
  return compactUnique({ values: [
    normalized,
    withoutExtension,
    slug,
  ] })
}

function filenameStem({ value }: SearchTextInput): string {
  return stripMarkdownExtension({ value })
}

function searchCandidatesForEntry({ entry }: EntrySearchInput): SearchCandidate[] {
  return [
    { value: entry.title, exactRank: 0, prefixRank: 2, fuzzyRank: 4 },
    ...entry.aliases.map((value) => ({ value, exactRank: 1, prefixRank: 3, fuzzyRank: 4 })),
    { value: entry.filename, exactRank: 1, prefixRank: 3, fuzzyRank: 4 },
    { value: filenameStem({ value: entry.filename }), exactRank: 1, prefixRank: 3, fuzzyRank: 4 },
  ]
}

function betterMatch(left: CandidateMatch, right: CandidateMatch): CandidateMatch {
  if (!right.match) return left
  if (!left.match) return right
  if (right.rank !== left.rank) return right.rank < left.rank ? right : left
  return right.score > left.score ? right : left
}

function matchSearchForms({ queryForms, targetForms, candidate }: CandidateSearchInput): CandidateMatch {
  let best = NO_MATCH
  for (const queryForm of queryForms) {
    for (const targetForm of targetForms) {
      if (queryForm === targetForm) {
        best = betterMatch(best, { match: true, rank: candidate.exactRank, score: Number.MAX_SAFE_INTEGER })
        continue
      }
      if (targetForm.startsWith(queryForm)) {
        best = betterMatch(best, { match: true, rank: candidate.prefixRank, score: -targetForm.length })
        continue
      }
      const fuzzy = fuzzyMatch(queryForm, targetForm)
      best = betterMatch(best, { ...fuzzy, rank: candidate.fuzzyRank })
    }
  }
  return best
}

function rankSearchEntry({ query, entry }: RankedEntryInput): CandidateMatch {
  const queryForms = searchForms({ value: query })
  return searchCandidatesForEntry({ entry }).reduce((best, candidate) => (
    betterMatch(best, matchSearchForms({
      queryForms,
      targetForms: searchForms({ value: candidate.value }),
      candidate,
    }))
  ), NO_MATCH)
}

function typePresentation({ noteType, typeEntry }: TypePresentationInput) {
  if (!noteType) return {}
  return {
    noteType,
    typeColor: getTypeColor(noteType, typeEntry?.color),
    typeLightColor: getTypeLightColor(noteType, typeEntry?.color),
    TypeIcon: getTypeIcon(noteType, typeEntry?.icon),
  }
}

function workspacePresentation({ entry, showWorkspace }: WorkspacePresentationInput) {
  return showWorkspace ? entry.workspace ?? null : null
}

function toResult({ entry, typeEntryMap, showWorkspace }: ResultInput): NoteSearchResult {
  const noteType = entry.isA || undefined
  const te = noteType ? typeEntryMap[noteType] : undefined
  return {
    entry,
    title: entry.title,
    noteIcon: entry.icon,
    ...typePresentation({ noteType, typeEntry: te }),
    workspace: workspacePresentation({ entry, showWorkspace }),
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
    const mapResult = (entry: VaultEntry) => toResult({ entry, typeEntryMap, showWorkspace })
    if (!query.trim()) {
      return [...searchableEntries]
        .sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0))
        .slice(0, maxResults)
        .map(mapResult)
    }
    return searchableEntries
      .map((e) => ({
        entry: e,
        ...rankSearchEntry({ query, entry: e }),
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
