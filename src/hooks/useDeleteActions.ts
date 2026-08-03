import { startTransition, useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import { trackEvent } from '../lib/telemetry'

interface ConfirmDeleteState {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
}

interface UseDeleteActionsInput {
  /** Called to deselect the note if it is currently open. */
  onDeselectNote: (path: string) => void
  removeEntry: (path: string) => void
  removeEntries?: (paths: string[]) => void
  resolveVaultPathForPath?: (path: string) => string | null | undefined
  refreshModifiedFiles: () => Promise<unknown> | undefined
  reloadVault: () => Promise<unknown> | undefined
  setToastMessage: (msg: string | null) => void
}

interface DeleteCommandBatch {
  paths: string[]
  vaultPath?: string
}

const describeNotes = (count: number): string => (
  count === 1 ? 'note' : `${count} notes`
)

const buildDeleteProgressMessage = (count: number): string => `Deleting ${describeNotes(count)}...`

const buildDeleteFailureMessage = (error: unknown, count: number): string => (
  `Failed to delete ${describeNotes(count)}: ${error}`
)

const buildPartialDeleteMessage = (deletedCount: number, requestedCount: number): string => {
  if (deletedCount === 0) {
    return `Failed to delete ${describeNotes(requestedCount)}. The note list was reloaded.`
  }
  return `Deleted ${deletedCount} of ${requestedCount} notes. The note list was reloaded to recover failed items.`
}

const deleteCommandArgs = ({ paths, vaultPath }: DeleteCommandBatch): { paths: string[]; vaultPath?: string } => (
  vaultPath ? { paths, vaultPath } : { paths }
)

function groupDeletePathsByVault(
  paths: string[],
  resolveVaultPathForPath?: (path: string) => string | null | undefined,
): DeleteCommandBatch[] {
  if (!resolveVaultPathForPath) return [{ paths }]

  const batches = new Map<string, DeleteCommandBatch>()
  for (const path of paths) {
    const vaultPath = resolveVaultPathForPath(path)?.trim() || undefined
    const key = vaultPath ?? ''
    const batch = batches.get(key)
    if (batch) {
      batch.paths.push(path)
      continue
    }
    batches.set(key, { paths: [path], vaultPath })
  }

  return [...batches.values()]
}

async function runDeleteCommand(
  paths: string[],
  resolveVaultPathForPath?: (path: string) => string | null | undefined,
): Promise<string[]> {
  const batches = groupDeletePathsByVault(paths, resolveVaultPathForPath)
  const deletedGroups = await Promise.all(batches.map((batch) => (
    isTauri()
      ? invoke<string[]>('batch_delete_notes_async', deleteCommandArgs(batch))
      : mockInvoke<string[]>('batch_delete_notes', deleteCommandArgs(batch))
  )))
  return deletedGroups.flat()
}

function useDeleteRunner({
  onDeselectNote,
  removeEntry,
  removeEntries,
  resolveVaultPathForPath,
  refreshModifiedFiles,
  reloadVault,
  setToastMessage,
}: UseDeleteActionsInput) {
  const [pendingDeleteCount, setPendingDeleteCount] = useState(0)

  const reconcileDeleteFailure = useCallback(async () => {
    await Promise.allSettled([
      Promise.resolve(reloadVault()),
      Promise.resolve(refreshModifiedFiles()),
    ])
  }, [refreshModifiedFiles, reloadVault])

  const optimisticallyRemoveEntries = useCallback((paths: string[]) => {
    startTransition(() => {
      for (const path of paths) onDeselectNote(path)
      if (removeEntries) {
        removeEntries(paths)
        return
      }
      for (const path of paths) removeEntry(path)
    })
  }, [onDeselectNote, removeEntries, removeEntry])

  const deleteNotesFromDisk = useCallback(async (paths: string[]) => {
    if (paths.length === 0) return 0

    setPendingDeleteCount((count) => count + paths.length)
    setToastMessage(buildDeleteProgressMessage(paths.length))
    optimisticallyRemoveEntries(paths)

    try {
      const deletedPaths = await runDeleteCommand(paths, resolveVaultPathForPath)
      const deletedCount = deletedPaths.length

      if (deletedCount > 0) {
        trackEvent('note_deleted')
      }

      if (deletedCount !== paths.length) {
        await reconcileDeleteFailure()
        setToastMessage(buildPartialDeleteMessage(deletedCount, paths.length))
        return deletedCount
      }

      await Promise.resolve(refreshModifiedFiles())
      setToastMessage(buildDeleteSuccessMessage(deletedCount))
      return deletedCount
    } catch (e) {
      await reconcileDeleteFailure()
      setToastMessage(buildDeleteFailureMessage(e, paths.length))
      return 0
    } finally {
      setPendingDeleteCount((count) => Math.max(0, count - paths.length))
    }
  }, [optimisticallyRemoveEntries, reconcileDeleteFailure, refreshModifiedFiles, resolveVaultPathForPath, setToastMessage])

  const deleteNoteFromDisk = useCallback(async (path: string) => {
    const deletedCount = await deleteNotesFromDisk([path])
    return deletedCount === 1
  }, [deleteNotesFromDisk])

  return {
    deleteNoteFromDisk,
    deleteNotesFromDisk,
    pendingDeleteCount,
  }
}

function buildDeleteSuccessMessage(count: number): string {
  return count === 1 ? 'Note permanently deleted' : `${count} notes permanently deleted`
}

export function useDeleteActions({
  onDeselectNote,
  removeEntry,
  removeEntries,
  resolveVaultPathForPath,
  refreshModifiedFiles,
  reloadVault,
  setToastMessage,
}: UseDeleteActionsInput) {
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDeleteState | null>(null)
  const {
    deleteNoteFromDisk,
    deleteNotesFromDisk,
    pendingDeleteCount,
  } = useDeleteRunner({
    onDeselectNote,
    removeEntry,
    removeEntries,
    resolveVaultPathForPath,
    refreshModifiedFiles,
    reloadVault,
    setToastMessage,
  })

  const handleDeleteNote = useCallback(async (path: string) => {
    setConfirmDelete({
      title: 'Delete permanently?',
      message: 'Delete permanently? This cannot be undone. You can recover it from Git history.',
      onConfirm: async () => {
        setConfirmDelete(null)
        await deleteNoteFromDisk(path)
      },
    })
  }, [deleteNoteFromDisk])

  const handleBulkDeletePermanently = useCallback((paths: string[]) => {
    const count = paths.length
    setConfirmDelete({
      title: `Delete ${count} ${count === 1 ? 'note' : 'notes'} permanently?`,
      message: `${count === 1 ? 'This note' : `These ${count} notes`} will be permanently deleted. This cannot be undone.`,
      onConfirm: async () => {
        setConfirmDelete(null)
        await deleteNotesFromDisk(paths)
      },
    })
  }, [deleteNotesFromDisk])

  return {
    confirmDelete,
    pendingDeleteCount,
    setConfirmDelete,
    deleteNoteFromDisk,
    handleDeleteNote,
    handleBulkDeletePermanently,
  }
}
