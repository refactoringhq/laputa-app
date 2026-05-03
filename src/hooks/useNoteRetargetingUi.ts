import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { RetargetOption } from '../components/note-retargeting/RetargetNoteDialog'
import type { FolderNode, SidebarSelection, VaultEntry } from '../types'
import type { FrontmatterOpOptions } from './frontmatterOps'
import { useNoteRetargeting } from './useNoteRetargeting'

type DialogState =
  | { kind: 'type'; notePath: string }
  | { kind: 'folder'; notePath: string }
  | null

interface NoteRetargetingUiInput {
  activeEntry: VaultEntry | null
  activeNoteBlocked: boolean
  entries: VaultEntry[]
  folders: FolderNode[]
  selection: SidebarSelection
  setSelection: (selection: SidebarSelection) => void
  setToastMessage: (message: string | null) => void
  vaultPath: string
  updateFrontmatter: (
    path: string,
    key: string,
    value: string,
    options?: FrontmatterOpOptions,
  ) => Promise<void>
  moveNoteToFolder: (
    path: string,
    folderPath: string,
    vaultPath: string,
    onEntryRenamed: (
      oldPath: string,
      newEntry: Partial<VaultEntry> & { path: string },
      newContent: string,
    ) => void,
  ) => Promise<{ new_path: string } | null>
}

function folderPathForNote(notePath: string, vaultPath: string): string {
  const normalizedVaultPath = vaultPath.replace(/\/+$/, '')
  const relativePath = notePath.startsWith(`${normalizedVaultPath}/`)
    ? notePath.slice(normalizedVaultPath.length + 1)
    : notePath
  const lastSlashIndex = relativePath.lastIndexOf('/')
  return lastSlashIndex >= 0 ? relativePath.slice(0, lastSlashIndex) : ''
}

function buildTypeOptions(types: string[], entry: VaultEntry | null): RetargetOption[] {
  if (!entry) return []
  return types.map((type) => ({
    id: type,
    label: type,
    current: entry.isA === type,
  }))
}

function buildFolderOptions(
  folders: Array<{ path: string; label: string }>,
  entry: VaultEntry | null,
  vaultPath: string,
): RetargetOption[] {
  if (!entry) return []

  const currentFolderPath = folderPathForNote(entry.path, vaultPath)
  return folders.map((folder) => ({
    id: folder.path,
    label: folder.label,
    detail: folder.path === folder.label ? undefined : folder.path,
    current: folder.path === currentFolderPath,
  }))
}

function resolveDialogEntry(
  dialogState: DialogState,
  entries: VaultEntry[],
  activeEntry: VaultEntry | null,
): VaultEntry | null {
  if (!dialogState) return null
  return entries.find((entry) => entry.path === dialogState.notePath)
    ?? (activeEntry?.path === dialogState.notePath ? activeEntry : null)
}

function hasTypeRetargetDestination(activeEntry: VaultEntry | null, activeNoteBlocked: boolean, types: string[]): boolean {
  return !!activeEntry && !activeNoteBlocked && types.some((type) => type !== activeEntry.isA)
}

function hasFolderRetargetDestination(
  activeEntry: VaultEntry | null,
  activeNoteBlocked: boolean,
  folders: Array<{ path: string; label: string }>,
  canDropNoteOnFolder: (notePath: string, folderPath: string) => boolean,
): boolean {
  return !!activeEntry
    && !activeNoteBlocked
    && folders.some((folder) => canDropNoteOnFolder(activeEntry.path, folder.path))
}

function openDialogForActiveEntry(
  setDialogState: Dispatch<SetStateAction<DialogState>>,
  activeEntry: VaultEntry | null,
  enabled: boolean,
  kind: 'type' | 'folder',
) {
  if (!activeEntry || !enabled) return
  setDialogState({ kind, notePath: activeEntry.path })
}

async function selectFromDialogState(
  dialogState: DialogState,
  kind: 'type' | 'folder',
  value: string,
  runSelection: (notePath: string, value: string) => Promise<'updated' | 'noop' | 'error'>,
): Promise<boolean> {
  if (!dialogState || dialogState.kind !== kind) return false
  const result = await runSelection(dialogState.notePath, value)
  return result !== 'error'
}

function useNoteRetargetDialogState({
  activeEntry,
  canChangeActiveNoteType,
  canMoveActiveNoteToFolder,
  changeNoteType,
  moveIntoFolder,
}: {
  activeEntry: VaultEntry | null
  canChangeActiveNoteType: boolean
  canMoveActiveNoteToFolder: boolean
  changeNoteType: (notePath: string, type: string) => Promise<'updated' | 'noop' | 'error'>
  moveIntoFolder: (notePath: string, folderPath: string) => Promise<'updated' | 'noop' | 'error'>
}) {
  const [dialogState, setDialogState] = useState<DialogState>(null)

  const openChangeNoteTypeDialog = useCallback(() => {
    openDialogForActiveEntry(setDialogState, activeEntry, canChangeActiveNoteType, 'type')
  }, [activeEntry, canChangeActiveNoteType])

  const openMoveNoteToFolderDialog = useCallback(() => {
    openDialogForActiveEntry(setDialogState, activeEntry, canMoveActiveNoteToFolder, 'folder')
  }, [activeEntry, canMoveActiveNoteToFolder])

  const closeDialog = useCallback(() => {
    setDialogState(null)
  }, [])

  const selectType = useCallback(async (type: string) => {
    return selectFromDialogState(dialogState, 'type', type, changeNoteType)
  }, [changeNoteType, dialogState])

  const selectFolder = useCallback(async (folderPath: string) => {
    return selectFromDialogState(dialogState, 'folder', folderPath, moveIntoFolder)
  }, [dialogState, moveIntoFolder])

  return {
    dialogState,
    openChangeNoteTypeDialog,
    openMoveNoteToFolderDialog,
    closeDialog,
    selectType,
    selectFolder,
  }
}

function buildDialogOptions(
  availableTypes: string[],
  availableFolders: Array<{ path: string; label: string }>,
  dialogEntry: VaultEntry | null,
  vaultPath: string,
) {
  return {
    typeOptions: buildTypeOptions(availableTypes, dialogEntry),
    folderOptions: buildFolderOptions(availableFolders, dialogEntry, vaultPath),
  }
}

function buildNoteRetargetingUiState(params: {
  dialogState: DialogState
  dialogEntry: VaultEntry | null
  canChangeActiveNoteType: boolean
  canMoveActiveNoteToFolder: boolean
  openChangeNoteTypeDialog: () => void
  openMoveNoteToFolderDialog: () => void
  typeOptions: RetargetOption[]
  folderOptions: RetargetOption[]
  closeDialog: () => void
  selectType: (type: string) => Promise<boolean>
  selectFolder: (folderPath: string) => Promise<boolean>
}) {
  return {
    isDialogOpen: params.dialogState !== null,
    dialogState: params.dialogState,
    dialogEntry: params.dialogEntry,
    canChangeActiveNoteType: params.canChangeActiveNoteType,
    canMoveActiveNoteToFolder: params.canMoveActiveNoteToFolder,
    openChangeNoteTypeDialog: params.openChangeNoteTypeDialog,
    openMoveNoteToFolderDialog: params.openMoveNoteToFolderDialog,
    typeOptions: params.typeOptions,
    folderOptions: params.folderOptions,
    closeDialog: params.closeDialog,
    selectType: params.selectType,
    selectFolder: params.selectFolder,
  }
}

export function useNoteRetargetingUi({
  activeEntry, activeNoteBlocked, entries, folders, selection, setSelection, setToastMessage, vaultPath, updateFrontmatter, moveNoteToFolder,
}: NoteRetargetingUiInput) {
  const {
    availableTypes, availableFolders, canDropNoteOnFolder, changeNoteType, moveIntoFolder,
  } = useNoteRetargeting({ entries, folders, selection, setSelection, setToastMessage, vaultPath, updateFrontmatter, moveNoteToFolder })
  const canChangeActiveNoteType = hasTypeRetargetDestination(activeEntry, activeNoteBlocked, availableTypes)
  const canMoveActiveNoteToFolder = hasFolderRetargetDestination(activeEntry, activeNoteBlocked, availableFolders, canDropNoteOnFolder)
  const { dialogState, openChangeNoteTypeDialog, openMoveNoteToFolderDialog, closeDialog, selectType, selectFolder } = useNoteRetargetDialogState({
    activeEntry, canChangeActiveNoteType, canMoveActiveNoteToFolder, changeNoteType, moveIntoFolder,
  })
  const dialogEntry = useMemo(() => resolveDialogEntry(dialogState, entries, activeEntry), [activeEntry, dialogState, entries])
  const { typeOptions, folderOptions } = buildDialogOptions(availableTypes, availableFolders, dialogEntry, vaultPath)
  return buildNoteRetargetingUiState({
    dialogState, dialogEntry, canChangeActiveNoteType, canMoveActiveNoteToFolder,
    openChangeNoteTypeDialog, openMoveNoteToFolderDialog, typeOptions, folderOptions, closeDialog, selectType, selectFolder,
  })
}
