import { useCallback, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { NoteWidthMode, Settings, VaultEntry } from '../types'
import type { FrontmatterValue } from '../components/Inspector'
import type { FrontmatterOpOptions } from './frontmatterOps'
import { trackEvent } from '../lib/telemetry'
import { canPersistNoteWidthMode, resolveNoteWidthMode, toggleNoteWidthMode } from '../utils/noteWidth'

type VaultPath = VaultEntry['path']
type MarkdownContent = string
type ToastMessage = string | null

interface EditorTab {
  entry: VaultEntry
  content: MarkdownContent
}

interface ReadWidthContentRequest {
  path: VaultPath
  fallbackContent: MarkdownContent
}

interface ActiveTabRequest {
  tabs: EditorTab[]
  activeTabPath: VaultPath | null
}

interface CurrentWidthRequest {
  activeTab: EditorTab | null
  defaultNoteWidth: NoteWidthMode
  transientNoteWidths: Record<VaultPath, NoteWidthMode>
}

interface UseNoteWidthModeOptions {
  tabs: EditorTab[]
  activeTabPath: VaultPath | null
  settings: Settings
  saveSettings: (settings: Settings) => Promise<void>
  updateFrontmatter: (
    path: VaultPath,
    key: string,
    value: FrontmatterValue,
    options?: FrontmatterOpOptions,
  ) => Promise<void>
  setToastMessage: (message: ToastMessage) => void
}

interface PersistWidthRequest {
  activeTab: EditorTab | null
  mode: NoteWidthMode
  updateFrontmatter: UseNoteWidthModeOptions['updateFrontmatter']
  rememberTransientWidth: (path: VaultPath, mode: NoteWidthMode) => void
  setToastMessage: (message: ToastMessage) => void
}

function resolveActiveTab({ tabs, activeTabPath }: ActiveTabRequest): EditorTab | null {
  return tabs.find((tab) => tab.entry.path === activeTabPath) ?? null
}

function resolveCurrentWidth({
  activeTab,
  defaultNoteWidth,
  transientNoteWidths,
}: CurrentWidthRequest): NoteWidthMode {
  const path = activeTab?.entry.path
  if (!path) return defaultNoteWidth
  return resolveNoteWidthMode(transientNoteWidths[path] ?? activeTab.entry.noteWidth, defaultNoteWidth)
}

async function readNoteContentForWidthPersistence({
  path,
  fallbackContent,
}: ReadWidthContentRequest): Promise<MarkdownContent> {
  try {
    return isTauri()
      ? await invoke<MarkdownContent>('get_note_content', { path })
      : await mockInvoke<MarkdownContent>('get_note_content', { path })
  } catch {
    return fallbackContent
  }
}

async function persistOrRememberNoteWidth({
  activeTab,
  mode,
  updateFrontmatter,
  rememberTransientWidth,
  setToastMessage,
}: PersistWidthRequest): Promise<void> {
  const path = activeTab?.entry.path
  if (!path) return

  const persistedContent = await readNoteContentForWidthPersistence({
    path,
    fallbackContent: activeTab.content,
  })
  if (!canPersistNoteWidthMode(persistedContent)) {
    rememberTransientWidth(path, mode)
    trackEvent('note_width_mode_changed', { mode, scope: 'transient' })
    return
  }

  try {
    await updateFrontmatter(path, '_width', mode, { silent: true })
    rememberTransientWidth(path, mode)
    trackEvent('note_width_mode_changed', { mode, scope: 'note' })
  } catch (err) {
    setToastMessage(`Failed to update note width: ${err}`)
  }
}

export function useNoteWidthMode({
  tabs,
  activeTabPath,
  settings,
  saveSettings,
  updateFrontmatter,
  setToastMessage,
}: UseNoteWidthModeOptions) {
  const [transientNoteWidths, setTransientNoteWidths] = useState<Record<VaultPath, NoteWidthMode>>({})
  const activeTab = useMemo(
    () => resolveActiveTab({ tabs, activeTabPath }),
    [activeTabPath, tabs],
  )
  const defaultNoteWidth = useMemo(
    () => resolveNoteWidthMode(settings.note_width_mode, null),
    [settings.note_width_mode],
  )
  const noteWidth = useMemo(() => {
    return resolveCurrentWidth({ activeTab, defaultNoteWidth, transientNoteWidths })
  }, [activeTab, defaultNoteWidth, transientNoteWidths])

  const rememberTransientWidth = useCallback((path: VaultPath, mode: NoteWidthMode) => {
    setTransientNoteWidths((previous) => (
      previous[path] === mode ? previous : { ...previous, [path]: mode }
    ))
  }, [])

  const setNoteWidth = useCallback((mode: NoteWidthMode) => persistOrRememberNoteWidth({
    activeTab,
    mode,
    updateFrontmatter,
    rememberTransientWidth,
    setToastMessage,
  }), [activeTab, rememberTransientWidth, setToastMessage, updateFrontmatter])

  const toggleNoteWidth = useCallback(() => {
    void setNoteWidth(toggleNoteWidthMode(noteWidth))
  }, [noteWidth, setNoteWidth])

  const setDefaultNoteWidth = useCallback(async (mode: NoteWidthMode) => {
    await saveSettings({ ...settings, note_width_mode: mode })
    trackEvent('note_width_default_changed', { mode })
  }, [saveSettings, settings])

  return {
    activeTab,
    defaultNoteWidth,
    noteWidth,
    setDefaultNoteWidth,
    setNoteWidth,
    toggleNoteWidth,
  }
}
