import { useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import { slugify } from './useNoteCreation'

interface RenameResult {
  new_path: string
  updated_files: number
  failed_updates?: number
}

export { slugify }

interface RenameRequest {
  path: string
  newTitle: string
  vaultPath: string
  oldTitle?: string
}

interface FilenameRenameRequest {
  path: string
  newFilenameStem: string
  vaultPath: string
}

interface FolderMoveRequest {
  path: string
  folderPath: string
  vaultPath: string
}

interface LoadNoteContentRequest {
  path: string
}

interface ReloadTabsAfterRenameRequest {
  tabPaths: string[]
  updateTabContent: (path: string, content: string) => void
}

type RenameCommand = 'rename_note' | 'rename_note_filename' | 'move_note_to_folder'

/** Check if a note's filename doesn't match the slug of its current title. */
export function needsRenameOnSave(title: string, filename: string): boolean {
  if (!filename.toLowerCase().endsWith('.md')) return false
  return `${slugify(title)}.md` !== filename
}

export async function performRename({
  path,
  newTitle,
  vaultPath,
  oldTitle,
}: RenameRequest): Promise<RenameResult> {
  return invokeRenameCommand({
    command: 'rename_note',
    tauriArgs: { vaultPath, oldPath: path, newTitle, oldTitle: oldTitle ?? null },
    mockArgs: { vault_path: vaultPath, old_path: path, new_title: newTitle, old_title: oldTitle ?? null },
  })
}

function invokeRenameCommand(
  params: {
    command: RenameCommand
    tauriArgs: Record<string, unknown>
    mockArgs: Record<string, unknown>
  },
): Promise<RenameResult> {
  return isTauri()
    ? invoke<RenameResult>(params.command, params.tauriArgs)
    : mockInvoke<RenameResult>(params.command, params.mockArgs)
}

export async function performFilenameRename({
  path,
  newFilenameStem,
  vaultPath,
}: FilenameRenameRequest): Promise<RenameResult> {
  return invokeRenameCommand({
    command: 'rename_note_filename',
    tauriArgs: { vaultPath, oldPath: path, newFilenameStem },
    mockArgs: { vault_path: vaultPath, old_path: path, new_filename_stem: newFilenameStem },
  })
}

export async function performMoveNoteToFolder({
  path,
  folderPath,
  vaultPath,
}: FolderMoveRequest): Promise<RenameResult> {
  return invokeRenameCommand({
    command: 'move_note_to_folder',
    tauriArgs: { vaultPath, oldPath: path, folderPath },
    mockArgs: { vault_path: vaultPath, old_path: path, folder_path: folderPath },
  })
}

export function buildRenamedEntry(entry: VaultEntry, newTitle: string, newPath: string): VaultEntry {
  const filename = newPath.split('/').pop() ?? entry.filename
  return { ...entry, path: newPath, filename, title: newTitle }
}

export function buildFilenameRenamedEntry(entry: VaultEntry, newPath: string): VaultEntry {
  const filename = newPath.split('/').pop() ?? entry.filename
  return { ...entry, path: newPath, filename }
}

export async function loadNoteContent({ path }: LoadNoteContentRequest): Promise<string> {
  return isTauri()
    ? invoke<string>('get_note_content', { path })
    : mockInvoke<string>('get_note_content', { path })
}

function rewriteSummaryLabel(params: { updatedFiles: number }): string {
  return params.updatedFiles === 1 ? 'Updated 1 note' : `Updated ${params.updatedFiles} notes`
}

function manualUpdateWarning(params: { failedUpdates: number }): string {
  const { failedUpdates } = params
  return `${failedUpdates} linked note${failedUpdates > 1 ? 's' : ''} need${failedUpdates === 1 ? 's' : ''} manual updates`
}

function formatRewriteToast(
  params: {
    action: string
    updatedFiles: number
    failedUpdates?: number
    preferBareUpdate?: boolean
  },
): string {
  const {
    action,
    updatedFiles,
    failedUpdates = 0,
    preferBareUpdate = false,
  } = params
  if (failedUpdates > 0) {
    if (updatedFiles === 0) {
      return `${action}, but ${manualUpdateWarning({ failedUpdates })}`
    }
    if (preferBareUpdate) {
      return `${rewriteSummaryLabel({ updatedFiles })}, but ${manualUpdateWarning({ failedUpdates })}`
    }
    return `${action} and ${rewriteSummaryLabel({ updatedFiles }).toLowerCase()}, but ${manualUpdateWarning({ failedUpdates })}`
  }
  if (updatedFiles === 0) return action
  return preferBareUpdate
    ? rewriteSummaryLabel({ updatedFiles })
    : `${action} and ${rewriteSummaryLabel({ updatedFiles }).toLowerCase()}`
}

export function renameToastMessage(updatedFiles: number, failedUpdates = 0): string {
  return formatRewriteToast({ action: 'Renamed', updatedFiles, failedUpdates, preferBareUpdate: true })
}

function folderLabel(params: { folderPath: string }): string {
  const trimmed = params.folderPath.trim().replace(/^\/+|\/+$/g, '')
  return trimmed.split('/').filter(Boolean).at(-1) ?? trimmed
}

function moveToastMessage(folderPath: string, updatedFiles: number, failedUpdates = 0): string {
  return formatRewriteToast({
    action: `Moved to "${folderLabel({ folderPath })}"`,
    updatedFiles,
    failedUpdates,
  })
}

export async function reloadVaultAfterRename(reloadVault?: () => Promise<unknown>): Promise<void> {
  if (!reloadVault) return
  try {
    await reloadVault()
  } catch (err) {
    console.warn('Failed to reload vault after rename:', err)
  }
}

/** Reload content for open tabs whose wikilinks may have changed after a rename. */
export async function reloadTabsAfterRename({
  tabPaths,
  updateTabContent,
}: ReloadTabsAfterRenameRequest): Promise<void> {
  for (const tabPath of tabPaths) {
    try {
      updateTabContent(tabPath, await loadNoteContent({ path: tabPath }))
    } catch { /* skip tabs that fail to reload */ }
  }
}

interface Tab {
  entry: VaultEntry
  content: string
}

function findRenameEntry(entries: VaultEntry[], tabs: Tab[], path: string): VaultEntry | undefined {
  return entries.find((entry) => entry.path === path)
    ?? tabs.find((tab) => tab.entry.path === path)?.entry
}

function renameErrorMessage(err: unknown): string {
  const message = typeof err === 'string'
    ? err.trim()
    : err instanceof Error
      ? err.message.trim()
      : ''
  if (message === 'A note with that name already exists' || message === 'Invalid filename') {
    return message
  }
  return 'Failed to rename note'
}

function moveNoteErrorMessage(err: unknown): string {
  const message = typeof err === 'string'
    ? err.trim()
    : err instanceof Error
      ? err.message.trim()
      : ''
  return message || 'Failed to move note'
}

export interface NoteRenameConfig {
  entries: VaultEntry[]
  setToastMessage: (msg: string | null) => void
  reloadVault?: () => Promise<unknown>
}

interface RenameTabDeps {
  tabs: Tab[]
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  activeTabPathRef: React.MutableRefObject<string | null>
  handleSwitchTab: (path: string) => void
  updateTabContent: (path: string, content: string) => void
}

interface ApplyRenameOptions {
  successMessage?: (result: RenameResult) => string
}

function useRenameResultApplier(
  config: NoteRenameConfig,
  tabDeps: RenameTabDeps,
) {
  const { entries, setToastMessage, reloadVault } = config
  const { setTabs, activeTabPathRef, handleSwitchTab, updateTabContent } = tabDeps

  const tabsRef = useRef(tabDeps.tabs)
  // eslint-disable-next-line react-hooks/refs
  tabsRef.current = tabDeps.tabs

  const applyRenameResult = useCallback(async (
    oldPath: string,
    result: RenameResult,
    buildEntry: (entry: VaultEntry | undefined, newPath: string) => VaultEntry,
    onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void,
    options?: ApplyRenameOptions,
  ) => {
    const currentTabs = tabsRef.current
    const entry = findRenameEntry(entries, currentTabs, oldPath)
    const newContent = await loadNoteContent({ path: result.new_path })
    const newEntry = buildEntry(entry, result.new_path)
    const otherTabPaths = currentTabs.filter((tab) => tab.entry.path !== oldPath).map((tab) => tab.entry.path)
    setTabs((prev) => prev.map((tab) => tab.entry.path === oldPath ? { entry: newEntry, content: newContent } : tab))
    if (activeTabPathRef.current === oldPath) handleSwitchTab(result.new_path)
    onEntryRenamed(oldPath, newEntry, newContent)
    await reloadTabsAfterRename({ tabPaths: otherTabPaths, updateTabContent })
    await reloadVaultAfterRename(reloadVault)
    const successMessage = options?.successMessage
      ? options.successMessage(result)
      : renameToastMessage(result.updated_files, result.failed_updates ?? 0)
    setToastMessage(successMessage)
    return result
  }, [entries, setTabs, activeTabPathRef, handleSwitchTab, updateTabContent, reloadVault, setToastMessage])

  return {
    tabsRef,
    applyRenameResult,
  }
}

async function runRenameAction({
  path,
  perform,
  applyRenameResult,
  buildEntry,
  onEntryRenamed,
  setToastMessage,
  errorMessage,
  logLabel,
  successMessage,
  allowUnchangedResult = false,
}: {
  path: string
  perform: () => Promise<RenameResult>
  applyRenameResult: (
    oldPath: string,
    result: RenameResult,
    buildEntry: (entry: VaultEntry | undefined, newPath: string) => VaultEntry,
    onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void,
    options?: ApplyRenameOptions,
  ) => Promise<RenameResult>
  buildEntry: (entry: VaultEntry | undefined, newPath: string) => VaultEntry
  onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void
  setToastMessage: (message: string | null) => void
  errorMessage: (err: unknown) => string
  logLabel: string
  successMessage?: (result: RenameResult) => string
  allowUnchangedResult?: boolean
}): Promise<RenameResult | null> {
  try {
    const result = await perform()
    if (allowUnchangedResult && result.new_path === path) return result
    await applyRenameResult(path, result, buildEntry, onEntryRenamed, { successMessage })
    return result
  } catch (err) {
    console.error(`${logLabel}:`, err)
    setToastMessage(errorMessage(err))
    return null
  }
}

export function useNoteRename(config: NoteRenameConfig, tabDeps: RenameTabDeps) {
  const { entries, setToastMessage } = config
  const { tabsRef, applyRenameResult } = useRenameResultApplier(config, tabDeps)

  const handleRenameNote = useCallback(async (
    path: string, newTitle: string, vaultPath: string,
    onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void,
  ) => {
    const entry = findRenameEntry(entries, tabsRef.current, path)
    await runRenameAction({
      path,
      perform: () => performRename({ path, newTitle, vaultPath, oldTitle: entry?.title }),
      applyRenameResult,
      buildEntry: (currentEntry, newPath) => buildRenamedEntry(currentEntry ?? {} as VaultEntry, newTitle, newPath),
      onEntryRenamed,
      setToastMessage,
      errorMessage: renameErrorMessage,
      logLabel: 'Failed to rename note',
    })
  }, [entries, tabsRef, applyRenameResult, setToastMessage])

  const handleRenameFilename = useCallback(async (
    path: string,
    newFilenameStem: string,
    vaultPath: string,
    onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void,
  ) => {
    await runRenameAction({
      path,
      perform: () => performFilenameRename({ path, newFilenameStem, vaultPath }),
      applyRenameResult,
      buildEntry: (currentEntry, newPath) => buildFilenameRenamedEntry(currentEntry ?? {} as VaultEntry, newPath),
      onEntryRenamed,
      setToastMessage,
      errorMessage: renameErrorMessage,
      logLabel: 'Failed to rename note filename',
    })
  }, [applyRenameResult, setToastMessage])

  const handleMoveNoteToFolder = useCallback(async (
    path: string,
    folderPath: string,
    vaultPath: string,
    onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void,
  ) => {
    const normalizedFolderPath = folderPath.trim().replace(/^\/+|\/+$/g, '')
    return runRenameAction({
      path,
      perform: () => performMoveNoteToFolder({ path, folderPath: normalizedFolderPath, vaultPath }),
      applyRenameResult,
      buildEntry: (currentEntry, newPath) => buildFilenameRenamedEntry(currentEntry ?? {} as VaultEntry, newPath),
      onEntryRenamed,
      setToastMessage,
      errorMessage: moveNoteErrorMessage,
      logLabel: 'Failed to move note to folder',
      successMessage: (result) => moveToastMessage(
        normalizedFolderPath,
        result.updated_files,
        result.failed_updates ?? 0,
      ),
      allowUnchangedResult: true,
    })
  }, [applyRenameResult, setToastMessage])

  return { handleRenameNote, handleRenameFilename, handleMoveNoteToFolder, tabsRef }
}
