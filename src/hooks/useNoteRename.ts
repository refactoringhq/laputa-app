import { useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry, WorkspaceIdentity } from '../types'
import { slugify } from './useNoteCreation'
import {
  findByNotePath,
  normalizeVaultRelativePath,
  notePathFilename,
  notePathsMatch,
  vaultRelativePathLabel,
} from '../utils/notePathIdentity'
import { filenameStemToTitle } from '../utils/noteTitle'
import { vaultPathForEntry } from '../utils/workspaces'
import { relativePathStem } from '../utils/wikilink'

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

interface WorkspaceMoveRequest {
  path: string
  sourceVaultPath: string
  destinationVaultPath: string
  replacementTarget?: string
}

interface LoadNoteContentRequest {
  path: string
}

interface ReloadTabsAfterRenameRequest {
  tabPaths: string[]
  updateTabContent: (path: string, content: string) => void
}

type RenameCommand = 'rename_note' | 'rename_note_filename' | 'move_note_to_folder' | 'move_note_to_workspace'
type NoteCommandExtra = Record<string, unknown>

interface NoteCommandRequest {
  command: RenameCommand
  mockExtra: NoteCommandExtra
  path: string
  tauriExtra: NoteCommandExtra
  vaultPath: string
}

interface SingleValueNoteCommand {
  command: RenameCommand
  mockKey: string
  tauriKey: string
}

const FILENAME_RENAME_COMMAND: SingleValueNoteCommand = {
  command: 'rename_note_filename',
  mockKey: 'new_filename_stem',
  tauriKey: 'newFilenameStem',
}

const FOLDER_MOVE_COMMAND: SingleValueNoteCommand = {
  command: 'move_note_to_folder',
  mockKey: 'folder_path',
  tauriKey: 'folderPath',
}

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
  const oldTitleArg = oldTitle ?? null
  return invokeNoteCommand({
    command: 'rename_note',
    path,
    vaultPath,
    tauriExtra: { newTitle, oldTitle: oldTitleArg },
    mockExtra: { new_title: newTitle, old_title: oldTitleArg },
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

function invokeStructuredRenameCommand(params: {
  command: RenameCommand
  args: Record<string, unknown>
  mockArgs: Record<string, unknown>
}): Promise<RenameResult> {
  return invokeRenameCommand({
    command: params.command,
    tauriArgs: { args: params.args },
    mockArgs: params.mockArgs,
  })
}

function noteCommandArgs({
  mockExtra,
  path,
  style,
  tauriExtra,
  vaultPath,
}: {
  mockExtra: NoteCommandExtra
  path: string
  style: 'mock' | 'tauri'
  tauriExtra: NoteCommandExtra
  vaultPath: string
}) {
  return style === 'tauri'
    ? { vaultPath, oldPath: path, ...tauriExtra }
    : { vault_path: vaultPath, old_path: path, ...mockExtra }
}

function invokeNoteCommand(params: NoteCommandRequest): Promise<RenameResult> {
  return invokeStructuredRenameCommand({
    command: params.command,
    args: noteCommandArgs({ ...params, style: 'tauri' }),
    mockArgs: noteCommandArgs({ ...params, style: 'mock' }),
  })
}

function performSingleValueNoteCommand({
  descriptor,
  path,
  value,
  vaultPath,
}: {
  descriptor: SingleValueNoteCommand
  path: string
  value: string
  vaultPath: string
}) {
  return invokeNoteCommand({
    command: descriptor.command,
    path,
    vaultPath,
    tauriExtra: { [descriptor.tauriKey]: value },
    mockExtra: { [descriptor.mockKey]: value },
  })
}

export async function performFilenameRename({
  path,
  newFilenameStem,
  vaultPath,
}: FilenameRenameRequest): Promise<RenameResult> {
  return performSingleValueNoteCommand({
    descriptor: FILENAME_RENAME_COMMAND,
    path,
    value: newFilenameStem,
    vaultPath,
  })
}

export async function performMoveNoteToFolder({
  path,
  folderPath,
  vaultPath,
}: FolderMoveRequest): Promise<RenameResult> {
  return performSingleValueNoteCommand({
    descriptor: FOLDER_MOVE_COMMAND,
    path,
    value: folderPath,
    vaultPath,
  })
}

export async function performMoveNoteToWorkspace({
  path,
  sourceVaultPath,
  destinationVaultPath,
  replacementTarget,
}: WorkspaceMoveRequest): Promise<RenameResult> {
  const tauriReplacementTarget = replacementTarget ?? null
  return invokeRenameCommand({
    command: 'move_note_to_workspace',
    tauriArgs: {
      args: {
        sourceVaultPath,
        destinationVaultPath,
        oldPath: path,
        replacementTarget: tauriReplacementTarget,
      },
    },
    mockArgs: {
      source_vault_path: sourceVaultPath,
      destination_vault_path: destinationVaultPath,
      old_path: path,
      replacement_target: tauriReplacementTarget,
    },
  })
}

export function buildRenamedEntry(entry: VaultEntry, newTitle: string, newPath: string): VaultEntry {
  const filename = notePathFilename(newPath)
  return { ...entry, path: newPath, filename, title: newTitle }
}

export function buildFilenameRenamedEntry(entry: VaultEntry, newPath: string): VaultEntry {
  const filename = notePathFilename(newPath)
  const oldFallbackTitle = filenameStemToTitle(entry.filename)
  const title = !entry.hasH1 && entry.title === oldFallbackTitle
    ? filenameStemToTitle(filename)
    : entry.title
  return { ...entry, path: newPath, filename, title }
}

export function buildWorkspaceMovedEntry(
  entry: VaultEntry,
  newPath: string,
  workspace: WorkspaceIdentity,
): VaultEntry {
  return {
    ...buildFilenameRenamedEntry(entry, newPath),
    workspace,
  }
}

export function workspaceMoveReplacementTarget({
  entry,
  sourceVaultPath,
  destinationWorkspace,
}: {
  entry: VaultEntry
  sourceVaultPath: string
  destinationWorkspace: WorkspaceIdentity
}): string {
  const localTarget = relativePathStem(entry.path, sourceVaultPath)
  const sourceAlias = entry.workspace?.alias
  return destinationWorkspace.alias && destinationWorkspace.alias !== sourceAlias
    ? `${destinationWorkspace.alias}/${localTarget}`
    : localTarget
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
  return vaultRelativePathLabel(params.folderPath)
}

function moveToastMessage(folderPath: string, updatedFiles: number, failedUpdates = 0): string {
  return formatRewriteToast({
    action: `Moved to "${folderLabel({ folderPath })}"`,
    updatedFiles,
    failedUpdates,
  })
}

function moveWorkspaceToastMessage(workspaceLabel: string, updatedFiles: number, failedUpdates = 0): string {
  return formatRewriteToast({
    action: `Moved to "${workspaceLabel}"`,
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
  return findByNotePath(entries, path)
    ?? tabs.find((tab) => notePathsMatch(tab.entry.path, path))?.entry
}

function resolveRenameVaultPath(entry: VaultEntry | undefined, fallbackVaultPath: string): string {
  return entry ? vaultPathForEntry(entry, fallbackVaultPath) : fallbackVaultPath
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
  onPathRenamed?: (oldPath: string, newPath: string) => void
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
  const { entries, setToastMessage, reloadVault, onPathRenamed } = config
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
    const otherTabPaths = currentTabs
      .filter((tab) => !notePathsMatch(tab.entry.path, oldPath) && !notePathsMatch(tab.entry.path, result.new_path))
      .map((tab) => tab.entry.path)
    if (!notePathsMatch(oldPath, result.new_path)) onPathRenamed?.(oldPath, result.new_path)
    setTabs((prev) => prev.map((tab) => notePathsMatch(tab.entry.path, oldPath) ? { entry: newEntry, content: newContent } : tab))
    if (notePathsMatch(activeTabPathRef.current, oldPath)) handleSwitchTab(result.new_path)
    onEntryRenamed(oldPath, newEntry, newContent)
    await reloadTabsAfterRename({ tabPaths: otherTabPaths, updateTabContent })
    await reloadVaultAfterRename(reloadVault)
    const successMessage = options?.successMessage
      ? options.successMessage(result)
      : renameToastMessage(result.updated_files, result.failed_updates ?? 0)
    setToastMessage(successMessage)
    return result
  }, [entries, setTabs, activeTabPathRef, handleSwitchTab, updateTabContent, reloadVault, setToastMessage, onPathRenamed])

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
    if (allowUnchangedResult && notePathsMatch(result.new_path, path)) return result
    await applyRenameResult(path, result, buildEntry, onEntryRenamed, { successMessage })
    return result
  } catch (err) {
    console.error(`${logLabel}:`, err)
    setToastMessage(errorMessage(err))
    return null
  }
}

type ApplyRenameResult = ReturnType<typeof useRenameResultApplier>['applyRenameResult']

function useWorkspaceMoveHandler({
  applyRenameResult,
  entries,
  setToastMessage,
  tabsRef,
}: {
  applyRenameResult: ApplyRenameResult
  entries: VaultEntry[]
  setToastMessage: (message: string | null) => void
  tabsRef: React.MutableRefObject<Tab[]>
}) {
  return useCallback(async (
    path: string,
    destinationWorkspace: WorkspaceIdentity,
    vaultPath: string,
    onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void,
  ) => {
    const entry = findRenameEntry(entries, tabsRef.current, path)
    if (!entry) {
      setToastMessage('Failed to move note: note not found')
      return null
    }

    const sourceVaultPath = resolveRenameVaultPath(entry, vaultPath)
    if (sourceVaultPath === destinationWorkspace.path) {
      return { new_path: path, updated_files: 0, failed_updates: 0 }
    }

    return runRenameAction({
      path,
      perform: () => performMoveNoteToWorkspace({
        path,
        sourceVaultPath,
        destinationVaultPath: destinationWorkspace.path,
        replacementTarget: workspaceMoveReplacementTarget({ entry, sourceVaultPath, destinationWorkspace }),
      }),
      applyRenameResult,
      buildEntry: (currentEntry, newPath) => buildWorkspaceMovedEntry(currentEntry ?? entry, newPath, destinationWorkspace),
      onEntryRenamed,
      setToastMessage,
      errorMessage: moveNoteErrorMessage,
      logLabel: 'Failed to move note to workspace',
      successMessage: (result) => moveWorkspaceToastMessage(
        destinationWorkspace.label,
        result.updated_files,
        result.failed_updates ?? 0,
      ),
      allowUnchangedResult: true,
    })
  }, [applyRenameResult, entries, setToastMessage, tabsRef])
}

export function useNoteRename(config: NoteRenameConfig, tabDeps: RenameTabDeps) {
  const { entries, setToastMessage } = config
  const { tabsRef, applyRenameResult } = useRenameResultApplier(config, tabDeps)

  const handleRenameNote = useCallback(async (path: string, newTitle: string, vaultPath: string, onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void) => {
    const entry = findRenameEntry(entries, tabsRef.current, path)
    const renameVaultPath = resolveRenameVaultPath(entry, vaultPath)
    await runRenameAction({
      path,
      perform: () => performRename({ path, newTitle, vaultPath: renameVaultPath, oldTitle: entry?.title }),
      applyRenameResult,
      buildEntry: (currentEntry, newPath) => buildRenamedEntry(currentEntry ?? ({} as VaultEntry), newTitle, newPath),
      onEntryRenamed,
      setToastMessage,
      errorMessage: renameErrorMessage,
      logLabel: 'Failed to rename note',
    })
  }, [entries, tabsRef, applyRenameResult, setToastMessage])

  const handleRenameFilename = useCallback(async (path: string, newFilenameStem: string, vaultPath: string, onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void) => {
    const entry = findRenameEntry(entries, tabsRef.current, path)
    const renameVaultPath = resolveRenameVaultPath(entry, vaultPath)
    await runRenameAction({
      path,
      perform: () => performFilenameRename({ path, newFilenameStem, vaultPath: renameVaultPath }),
      applyRenameResult,
      buildEntry: (currentEntry, newPath) => buildFilenameRenamedEntry(currentEntry ?? ({} as VaultEntry), newPath),
      onEntryRenamed,
      setToastMessage,
      errorMessage: renameErrorMessage,
      logLabel: 'Failed to rename note filename',
    })
  }, [entries, tabsRef, applyRenameResult, setToastMessage])

  const handleMoveNoteToFolder = useCallback(async (path: string, folderPath: string, vaultPath: string, onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void) => {
    const normalizedFolderPath = normalizeVaultRelativePath(folderPath)
    const entry = findRenameEntry(entries, tabsRef.current, path)
    const moveVaultPath = resolveRenameVaultPath(entry, vaultPath)
    return runRenameAction({
      path,
      perform: () => performMoveNoteToFolder({ path, folderPath: normalizedFolderPath, vaultPath: moveVaultPath }),
      applyRenameResult,
      buildEntry: (currentEntry, newPath) => buildFilenameRenamedEntry(currentEntry ?? ({} as VaultEntry), newPath),
      onEntryRenamed,
      setToastMessage,
      errorMessage: moveNoteErrorMessage,
      logLabel: 'Failed to move note to folder',
      successMessage: (result) => moveToastMessage(normalizedFolderPath, result.updated_files, result.failed_updates ?? 0),
      allowUnchangedResult: true,
    })
  }, [entries, tabsRef, applyRenameResult, setToastMessage])

  const handleMoveNoteToWorkspace = useWorkspaceMoveHandler({
    applyRenameResult,
    entries,
    setToastMessage,
    tabsRef,
  })

  return { handleRenameNote, handleRenameFilename, handleMoveNoteToFolder, handleMoveNoteToWorkspace, tabsRef }
}
