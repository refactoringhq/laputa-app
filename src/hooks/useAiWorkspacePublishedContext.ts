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

  const noteList = useMemo<NoteListItem[]>(() => {
    const isInbox = effectiveSelection.kind === 'filter' && effectiveSelection.filter === 'inbox'
    const filtered = isInbox
      ? filterInboxEntries(entries, inboxPeriod)
      : filterEntries(entries, effectiveSelection, {
        views,
        allNotesFileVisibility,
      })
    return filtered.map((entry) => ({
      path: entry.path,
      title: entry.title,
      type: entry.isA ?? 'Note',
    }))
  }, [allNotesFileVisibility, effectiveSelection, entries, inboxPeriod, views])

  const noteListFilter = useMemo(() => {
    if (effectiveSelection.kind === 'sectionGroup') return { type: effectiveSelection.type, query: '' }
    if (effectiveSelection.kind === 'entity') return { type: null, query: effectiveSelection.entry.title }
    return { type: null, query: '' }
  }, [effectiveSelection])

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
