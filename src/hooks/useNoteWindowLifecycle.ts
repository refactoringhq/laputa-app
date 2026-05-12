import { useEffect, useRef, type RefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import {
  getNoteWindowPathCandidates,
  type NoteWindowParams,
} from '../utils/windowMode'

interface NoteWindowActions {
  handleSelectNote: (entry: VaultEntry) => unknown
  openTabWithContent: (entry: VaultEntry, content: string) => unknown
}

interface UseNoteWindowLifecycleArgs extends NoteWindowActions {
  activeTabPath: string | null
  noteWindowParams: NoteWindowParams | null
  setToastMessage: (message: string) => void
  tabs: Array<{ entry: VaultEntry }>
}

interface OpenNoteWindowArgs {
  actionsRef: RefObject<NoteWindowActions>
  missingPathRef: RefObject<string | null>
  noteWindowParams: NoteWindowParams
  openedRef: RefObject<boolean>
  setToastMessage: (message: string) => void
}

interface OpenResolvedNoteWindowEntryArgs extends Omit<OpenNoteWindowArgs, 'setToastMessage'> {
  entry: VaultEntry
}

async function resolveNoteWindowEntry(noteWindowParams: NoteWindowParams): Promise<VaultEntry | undefined> {
  for (const path of getNoteWindowPathCandidates(noteWindowParams)) {
    try {
      const request = { path, vaultPath: noteWindowParams.vaultPath }
      const entry = isTauri()
        ? await invoke<VaultEntry | null>('reload_vault_entry', request)
        : await mockInvoke<VaultEntry | null>('reload_vault_entry', request)
      if (entry) return entry
    } catch {
      // Try the next normalized candidate before reporting the note as unavailable.
    }
  }
}

async function loadNoteWindowContent(path: string, vaultPath: string): Promise<string> {
  const request = { path, vaultPath }
  if (!isTauri()) return mockInvoke<string>('get_note_content', request)

  await syncVaultAssetScope(vaultPath)
  return invoke<string>('get_note_content', request)
}

export async function syncVaultAssetScope(vaultPath: string): Promise<void> {
  if (!isTauri() || !vaultPath.trim()) return
  await invoke('sync_vault_asset_scope_for_window', { vaultPath })
}

async function openNoteWindowEntry({
  actionsRef,
  entry,
  missingPathRef,
  noteWindowParams,
  openedRef,
}: OpenResolvedNoteWindowEntryArgs): Promise<void> {
  try {
    const content = await loadNoteWindowContent(entry.path, noteWindowParams.vaultPath)
    if (openedRef.current) return
    openedRef.current = true
    missingPathRef.current = null
    actionsRef.current.openTabWithContent(entry, content)
  } catch {
    if (openedRef.current) return
    openedRef.current = true
    missingPathRef.current = null
    void actionsRef.current.handleSelectNote(entry)
  }
}

function reportMissingNoteWindowPath({
  missingPathRef,
  noteWindowParams,
  setToastMessage,
}: Pick<OpenNoteWindowArgs, 'missingPathRef' | 'noteWindowParams' | 'setToastMessage'>): void {
  if (missingPathRef.current === noteWindowParams.notePath) return
  missingPathRef.current = noteWindowParams.notePath
  setToastMessage(`Could not open "${noteWindowParams.noteTitle}" in this window`)
}

async function resolveAndOpenNoteWindow({
  actionsRef,
  missingPathRef,
  noteWindowParams,
  openedRef,
  setToastMessage,
}: OpenNoteWindowArgs): Promise<void> {
  const entry = await resolveNoteWindowEntry(noteWindowParams)
  if (openedRef.current) return
  if (!entry) {
    reportMissingNoteWindowPath({ missingPathRef, noteWindowParams, setToastMessage })
    return
  }

  await openNoteWindowEntry({
    actionsRef,
    entry,
    missingPathRef,
    noteWindowParams,
    openedRef,
  })
}

function useNoteWindowActionsRef({
  handleSelectNote,
  openTabWithContent,
}: NoteWindowActions): RefObject<NoteWindowActions> {
  const actionsRef = useRef<NoteWindowActions>({ handleSelectNote, openTabWithContent })

  useEffect(() => {
    actionsRef.current = { handleSelectNote, openTabWithContent }
  }, [handleSelectNote, openTabWithContent])

  return actionsRef
}

function useOpenNoteWindowOnMount(
  noteWindowParams: NoteWindowParams | null,
  actionsRef: RefObject<NoteWindowActions>,
  setToastMessage: (message: string) => void,
): void {
  const openedRef = useRef(false)
  const missingPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!noteWindowParams || openedRef.current) return

    void resolveAndOpenNoteWindow({
      actionsRef,
      missingPathRef,
      noteWindowParams,
      openedRef,
      setToastMessage,
    })
  }, [actionsRef, noteWindowParams, setToastMessage])
}

function useNoteWindowTitle(
  noteWindowParams: NoteWindowParams | null,
  tabs: Array<{ entry: VaultEntry }>,
  activeTabPath: string | null,
): void {
  useEffect(() => {
    if (!noteWindowParams) return

    const activeEntry = tabs.find((tab) => tab.entry.path === activeTabPath)?.entry
    const title = activeEntry?.title ?? noteWindowParams.noteTitle
    if (!isTauri()) {
      document.title = title
      return
    }

    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        getCurrentWindow().setTitle(title)
      })
      .catch((err) => console.warn('[window] Failed to update note window title:', err))
  }, [activeTabPath, noteWindowParams, tabs])
}

export function useNoteWindowLifecycle({
  activeTabPath,
  handleSelectNote,
  noteWindowParams,
  openTabWithContent,
  setToastMessage,
  tabs,
}: UseNoteWindowLifecycleArgs): void {
  const actionsRef = useNoteWindowActionsRef({ handleSelectNote, openTabWithContent })

  useOpenNoteWindowOnMount(noteWindowParams, actionsRef, setToastMessage)
  useNoteWindowTitle(noteWindowParams, tabs, activeTabPath)
}
