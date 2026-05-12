import { useCallback, type RefObject } from 'react'
import type { SidebarSelection, VaultEntry } from '../types'

interface UseInboxOrganizeAdvanceOptions {
  activeTabPath: string | null
  activeTabPathRef: RefObject<string | null>
  autoAdvanceEnabled: boolean
  entries: VaultEntry[]
  onSelectNote: (entry: VaultEntry) => void | Promise<void>
  onToggleOrganized: (path: string) => Promise<boolean>
  requestedActiveTabPathRef: RefObject<string | null>
  selection: SidebarSelection
  visibleNotesRef: RefObject<VaultEntry[]>
}

function nextVisibleEntryAfter(entries: VaultEntry[], currentPath: string): VaultEntry | null {
  const currentIndex = entries.findIndex((entry) => entry.path === currentPath)
  const nextEntry = entries[currentIndex + 1]
  return currentIndex >= 0 && nextEntry ? nextEntry : null
}

function shouldAdvanceAfterOrganize(
  entry: VaultEntry,
  path: string,
  options: Pick<UseInboxOrganizeAdvanceOptions, 'activeTabPath' | 'autoAdvanceEnabled' | 'selection'>,
): boolean {
  return options.autoAdvanceEnabled
    && !entry.organized
    && options.activeTabPath === path
    && options.selection.kind === 'filter'
    && options.selection.filter === 'inbox'
}

function isStillFocusedOnPath(
  path: string,
  activeTabPathRef: RefObject<string | null>,
  requestedActiveTabPathRef: RefObject<string | null>,
): boolean {
  return activeTabPathRef.current === path
    && requestedActiveTabPathRef.current === path
}

export function useInboxOrganizeAdvance(options: UseInboxOrganizeAdvanceOptions): (path: string) => Promise<void> {
  const {
    activeTabPath,
    activeTabPathRef,
    autoAdvanceEnabled,
    entries,
    onSelectNote,
    onToggleOrganized,
    requestedActiveTabPathRef,
    selection,
    visibleNotesRef,
  } = options

  return useCallback(async (path: string) => {
    const entry = entries.find((candidate) => candidate.path === path)
    if (!entry) return

    const nextEntry = shouldAdvanceAfterOrganize(entry, path, {
      activeTabPath,
      autoAdvanceEnabled,
      selection,
    })
      ? nextVisibleEntryAfter(visibleNotesRef.current, path)
      : null

    const organized = await onToggleOrganized(path)
    if (!organized || !nextEntry) return
    if (!isStillFocusedOnPath(path, activeTabPathRef, requestedActiveTabPathRef)) return

    void onSelectNote(nextEntry)
  }, [
    activeTabPath,
    activeTabPathRef,
    autoAdvanceEnabled,
    entries,
    onSelectNote,
    onToggleOrganized,
    requestedActiveTabPathRef,
    selection,
    visibleNotesRef,
  ])
}
