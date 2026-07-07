import { useCallback, useMemo } from 'react'
import type { FolderNode, SidebarSelection, VaultEntry } from '../types'
import type { FrontmatterOpOptions } from './frontmatterOps'
import { extractVaultTypes } from '../utils/vaultTypes'
import { trackNoteRetargeted } from '../lib/productAnalytics'
import {
  flattenRetargetFolders,
  folderPathForRetargetEntry,
  normalizeRetargetFolderPath,
} from '../utils/noteRetargetingPaths'

type RetargetResult = 'updated' | 'noop' | 'error'

export type { RetargetFolderOption } from '../utils/noteRetargetingPaths'

interface NoteRetargetingInput {
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

function entryByPath(params: { entries: VaultEntry[]; notePath: string }): VaultEntry | undefined {
  return params.entries.find((entry) => entry.path === params.notePath)
}

function canRetargetEntryToType(params: { entry: VaultEntry | undefined; type: string }): boolean {
  return !!params.entry && params.entry.isA !== params.type
}

function canRetargetEntryToFolder(
  params: {
    entry: VaultEntry | undefined
    folderPath: string
    vaultPath: string
  },
): boolean {
  if (!params.entry) return false
  return folderPathForRetargetEntry({ entry: params.entry, vaultPath: params.vaultPath })
    !== normalizeRetargetFolderPath(params.folderPath)
}

function updateEntitySelection(
  selection: SidebarSelection,
  setSelection: (selection: SidebarSelection) => void,
  notePath: string,
  patch: Partial<VaultEntry> & { path: string },
) {
  if (selection.kind !== 'entity' || selection.entry.path !== notePath) return
  setSelection({
    kind: 'entity',
    entry: {
      ...selection.entry,
      ...patch,
    },
  })
}

async function changeEntryType({
  entry,
  notePath,
  nextType,
  selection,
  setSelection,
  setToastMessage,
  updateFrontmatter,
}: {
  entry: VaultEntry | undefined
  notePath: string
  nextType: string
  selection: SidebarSelection
  setSelection: (selection: SidebarSelection) => void
  setToastMessage: (message: string | null) => void
  updateFrontmatter: (
    path: string,
    key: string,
    value: string,
    options?: FrontmatterOpOptions,
  ) => Promise<void>
}): Promise<RetargetResult> {
  const normalizedType = nextType.trim()
  if (!entry || !normalizedType) return 'error'
  if (entry.isA === normalizedType) return 'noop'

  try {
    await updateFrontmatter(notePath, 'type', normalizedType, { silent: true })
    updateEntitySelection(selection, setSelection, notePath, { path: notePath, isA: normalizedType })
    trackNoteRetargeted({ targetKind: 'type' })
    setToastMessage(`Type set to "${normalizedType}"`)
    return 'updated'
  } catch (error) {
    console.error('Failed to change note type:', error)
    setToastMessage(typeof error === 'string' ? error : 'Failed to change note type')
    return 'error'
  }
}

async function moveEntryToFolder({
  entry,
  notePath,
  folderPath,
  vaultPath,
  selection,
  setSelection,
  moveNoteToFolder,
}: {
  entry: VaultEntry | undefined
  notePath: string
  folderPath: string
  vaultPath: string
  selection: SidebarSelection
  setSelection: (selection: SidebarSelection) => void
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
}): Promise<RetargetResult> {
  const normalizedFolderPath = normalizeRetargetFolderPath(folderPath)
  if (!entry) return 'error'
  if (folderPathForRetargetEntry({ entry, vaultPath }) === normalizedFolderPath) return 'noop'

  const result = await moveNoteToFolder(
    notePath,
    normalizedFolderPath,
    vaultPath,
    (oldPath, newEntry) => updateEntitySelection(selection, setSelection, oldPath, newEntry),
  )
  if (!result) return 'error'
  if (result.new_path === notePath) return 'noop'
  trackNoteRetargeted({
    targetKind: 'folder',
    folderDestination: normalizedFolderPath ? 'folder' : 'root',
  })
  return 'updated'
}

export function useNoteRetargeting({
  entries,
  folders,
  selection,
  setSelection,
  setToastMessage,
  vaultPath,
  updateFrontmatter,
  moveNoteToFolder,
}: NoteRetargetingInput) {
  const availableTypes = useMemo(
    () => extractVaultTypes(entries).sort((left, right) => left.localeCompare(right)),
    [entries],
  )
  const availableFolders = useMemo(() => flattenRetargetFolders(folders), [folders])

  const canDropNoteOnType = useCallback((notePath: string, type: string) => {
    return canRetargetEntryToType({
      entry: entryByPath({ entries, notePath }),
      type,
    })
  }, [entries])

  const canDropNoteOnFolder = useCallback((notePath: string, folderPath: string) => {
    return canRetargetEntryToFolder({
      entry: entryByPath({ entries, notePath }),
      folderPath,
      vaultPath,
    })
  }, [entries, vaultPath])

  const changeNoteType = useCallback(async (
    notePath: string,
    nextType: string,
  ): Promise<RetargetResult> => {
    return changeEntryType({
      entry: entryByPath({ entries, notePath }),
      notePath,
      nextType,
      selection,
      setSelection,
      setToastMessage,
      updateFrontmatter,
    })
  }, [entries, selection, setSelection, setToastMessage, updateFrontmatter])

  const moveIntoFolder = useCallback(async (
    notePath: string,
    folderPath: string,
  ): Promise<RetargetResult> => {
    return moveEntryToFolder({
      entry: entryByPath({ entries, notePath }),
      notePath,
      folderPath,
      vaultPath,
      selection,
      setSelection,
      moveNoteToFolder,
    })
  }, [entries, moveNoteToFolder, selection, setSelection, vaultPath])

  return {
    availableTypes,
    availableFolders,
    canDropNoteOnType,
    canDropNoteOnFolder,
    changeNoteType,
    moveIntoFolder,
  }
}
