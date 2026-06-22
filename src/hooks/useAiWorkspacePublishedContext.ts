import { useEffect, useMemo } from 'react'
import type { InboxPeriod, SidebarSelection, VaultEntry, ViewFile } from '../types'
import type { Tab } from './useTabManagement'
import type { NoteListItem } from '../utils/ai-context'
import { filterEntries, filterInboxEntries } from '../utils/noteListHelpers'
import type { AllNotesFileVisibility } from '../utils/allNotesFileVisibility'
import { publishAiWorkspaceWindowSharedContext } from '../lib/aiWorkspaceWindowSharedContext'
import type { AiWorkspaceWindowContext } from '../utils/openAiWorkspaceWindow'

interface UseAiWorkspacePublishedContextParams {
  activeTab: Tab | null
  allNotesFileVisibility: AllNotesFileVisibility
  context: AiWorkspaceWindowContext
  effectiveSelection: SidebarSelection
  entries: VaultEntry[]
  inboxPeriod: InboxPeriod
  tabs: Tab[]
  views: ViewFile[]
}

type NoteListFilter = {
  query: string
  type: string | null
}

function isInboxSelection(selection: SidebarSelection): boolean {
  return selection.kind === 'filter' && selection.filter === 'inbox'
}

function noteListItemsFromEntries(entries: VaultEntry[]): NoteListItem[] {
  return entries.map((entry) => ({
    path: entry.path,
    title: entry.title,
    type: entry.isA ?? 'Note',
  }))
}

function noteListFilterForSelection(selection: SidebarSelection): NoteListFilter {
  if (selection.kind === 'sectionGroup') return { type: selection.type, query: '' }
  if (selection.kind === 'entity') return { type: null, query: selection.entry.title }
  return { type: null, query: '' }
}

function usePublishedNoteList({
  allNotesFileVisibility,
  effectiveSelection,
  entries,
  inboxPeriod,
  views,
}: Pick<
  UseAiWorkspacePublishedContextParams,
  'allNotesFileVisibility' | 'effectiveSelection' | 'entries' | 'inboxPeriod' | 'views'
>): NoteListItem[] {
  return useMemo<NoteListItem[]>(() => {
    const filtered = isInboxSelection(effectiveSelection)
      ? filterInboxEntries(entries, inboxPeriod)
      : filterEntries(entries, effectiveSelection, {
        views,
        allNotesFileVisibility,
      })
    return noteListItemsFromEntries(filtered)
  }, [allNotesFileVisibility, effectiveSelection, entries, inboxPeriod, views])
}

export function useAiWorkspacePublishedContext({
  activeTab,
  allNotesFileVisibility,
  context,
  effectiveSelection,
  entries,
  inboxPeriod,
  tabs,
  views,
}: UseAiWorkspacePublishedContextParams) {
  const inboxCount = useMemo(() => filterInboxEntries(entries, inboxPeriod).length, [entries, inboxPeriod])

  const noteList = usePublishedNoteList({
    allNotesFileVisibility,
    effectiveSelection,
    entries,
    inboxPeriod,
    views,
  })

  const noteListFilter = useMemo(() => noteListFilterForSelection(effectiveSelection), [effectiveSelection])

  useEffect(() => {
    publishAiWorkspaceWindowSharedContext({
      ...context,
      activeEntry: activeTab?.entry ?? null,
      activeNoteContent: activeTab?.content ?? null,
      entries,
      openTabs: tabs.map((tab) => tab.entry),
      noteList,
      noteListFilter,
    })
  }, [
    activeTab?.content,
    activeTab?.entry,
    context,
    entries,
    noteList,
    noteListFilter,
    tabs,
  ])

  return {
    inboxCount,
    noteList,
    noteListFilter,
  }
}
