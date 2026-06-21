import type { NoteStatus, VaultEntry } from '../../types'
import { extractH1TitleFromContent } from '../../utils/noteTitle'
import { noteDisplaysAsSheet } from '../../utils/noteFormat'
import { countWords } from '../../utils/wikilinks'

export interface EditorContentTab {
  entry: VaultEntry
  content: string
}

interface EditorContentStateInput {
  activeTab: EditorContentTab | null
  entries: VaultEntry[]
  rawMode: boolean
  activeStatus: NoteStatus
}

interface VisibilityState {
  effectiveRawMode: boolean
  isDeletedPreview: boolean
  isNonMarkdownText: boolean
  isSheet: boolean
  showEditor: boolean
}

const entryLookupCache = new WeakMap<VaultEntry[], Map<string, VaultEntry>>()

function getEntryLookup(entries: VaultEntry[]): Map<string, VaultEntry> {
  const cached = entryLookupCache.get(entries)
  if (cached) return cached

  const lookup = new Map<string, VaultEntry>()
  for (const entry of entries) {
    lookup.set(entry.path, entry)
  }

  entryLookupCache.set(entries, lookup)
  return lookup
}

export interface EditorContentState {
  freshEntry: VaultEntry | undefined
  isArchived: boolean
  hasH1: boolean
  isDeletedPreview: boolean
  isNonMarkdownText: boolean
  isSheet: boolean
  effectiveRawMode: boolean
  showEditor: boolean
  path: string
  wordCount: number
}

function findFreshEntry(activeTab: EditorContentTab | null, entries: VaultEntry[]): VaultEntry | undefined {
  if (!activeTab) return undefined
  return getEntryLookup(entries).get(activeTab.entry.path)
}

function contentHasTopLevelH1(activeTab: EditorContentTab | null): boolean {
  return activeTab ? extractH1TitleFromContent(activeTab.content) !== null : false
}

function resolveHasH1(activeTab: EditorContentTab | null, freshEntry: VaultEntry | undefined): boolean {
  return contentHasTopLevelH1(activeTab) || freshEntry?.hasH1 === true || activeTab?.entry.hasH1 === true
}

function resolveIsSheet(activeTab: EditorContentTab | null, freshEntry: VaultEntry | undefined): boolean {
  if (!activeTab) return false
  return noteDisplaysAsSheet({
    content: activeTab.content,
    display: freshEntry?.display ?? activeTab.entry.display,
    fileKind: activeTab.entry.fileKind,
  })
}

function deriveVisibilityState(input: {
  activeTab: EditorContentTab | null
  freshEntry: VaultEntry | undefined
  rawMode: boolean
}): VisibilityState {
  const {
    activeTab,
    freshEntry,
    rawMode,
  } = input
  const isDeletedPreview = !!activeTab && !freshEntry
  const isSheet = resolveIsSheet(activeTab, freshEntry)
  const isNonMarkdownText = activeTab?.entry.fileKind === 'text' && !isSheet
  const effectiveRawMode = rawMode || isNonMarkdownText

  return {
    isDeletedPreview,
    isNonMarkdownText,
    isSheet,
    effectiveRawMode,
    showEditor: !effectiveRawMode,
  }
}

export function deriveEditorContentState(input: EditorContentStateInput): EditorContentState {
  const { activeTab, entries, rawMode } = input
  const freshEntry = findFreshEntry(activeTab, entries)
  const hasH1 = resolveHasH1(activeTab, freshEntry)
  const visibilityState = deriveVisibilityState({
    activeTab,
    freshEntry,
    rawMode,
  })

  return {
    freshEntry,
    isArchived: freshEntry?.archived ?? activeTab?.entry.archived ?? false,
    hasH1,
    ...visibilityState,
    path: activeTab?.entry.path ?? '',
    wordCount: activeTab ? countWords(activeTab.content) : 0,
  }
}
