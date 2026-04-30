import { startTransition, useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import { trackEvent } from '../lib/telemetry'
import type { VaultEntry } from '../types'

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
  refreshModifiedFiles: () => Promise<unknown> | void
  reloadVault: () => Promise<unknown> | void
  setToastMessage: (msg: string | null) => void
  getEntry?: (path: string) => VaultEntry | undefined
}

function describeNotes(count: number): string {
  return count === 1 ? 'note' : `${count} notes`
}

function buildDeleteProgressMessage(count: number): string {
  return `Deleting ${describeNotes(count)}...`
}

function buildDeleteSuccessMessage(count: number): string {
  return count === 1 ? 'Note permanently deleted' : `${count} notes permanently deleted`
}

function buildDeleteFailureMessage(error: unknown, count: number): string {
  return `Failed to delete ${describeNotes(count)}: ${error}`
}

function buildPartialDeleteMessage(deletedCount: number, requestedCount: number): string {
  if (deletedCount === 0) {
    return `Failed to delete ${describeNotes(requestedCount)}. The note list was reloaded.`
  }
  return `Deleted ${deletedCount} of ${requestedCount} notes. The note list was reloaded to recover failed items.`
}

async function runDeleteCommand(paths: string[]): Promise<string[]> {
  if (isTauri()) return invoke<string[]>('batch_delete_notes_async', { paths })
  return mockInvoke<string[]>('batch_delete_notes', { paths })
}

function useDeleteRunner({
  onDeselectNote,
  removeEntry,
  removeEntries,
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

  const deleteNotesFromDisk = useCallback(async (paths: string[], successMessage?: string) => {
    if (paths.length === 0) return 0

    setPendingDeleteCount((count) => count + paths.length)
    setToastMessage(buildDeleteProgressMessage(paths.length))
    optimisticallyRemoveEntries(paths)

    try {
      const deletedPaths = await runDeleteCommand(paths)
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
      setToastMessage(successMessage ?? buildDeleteSuccessMessage(deletedCount))
      return deletedCount
    } catch (e) {
      await reconcileDeleteFailure()
      setToastMessage(buildDeleteFailureMessage(e, paths.length))
      return 0
    } finally {
      setPendingDeleteCount((count) => Math.max(0, count - paths.length))
    }
  }, [optimisticallyRemoveEntries, reconcileDeleteFailure, refreshModifiedFiles, setToastMessage])

  const deleteNoteFromDisk = useCallback(async (path: string, successMessage?: string) => {
    const deletedCount = await deleteNotesFromDisk([path], successMessage)
    return deletedCount === 1
  }, [deleteNotesFromDisk])

  return {
    deleteNoteFromDisk,
    deleteNotesFromDisk,
    pendingDeleteCount,
  }
}

export function useDeleteActions({
  onDeselectNote,
  removeEntry,
  removeEntries,
  refreshModifiedFiles,
  reloadVault,
  setToastMessage,
  getEntry,
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
    refreshModifiedFiles,
    reloadVault,
    setToastMessage,
  })

  const handleDeleteNote = useCallback(async (path: string) => {
    const successMessage = getEntry?.(path)?.isA === 'Type' ? 'Type permanently deleted' : undefined
    setConfirmDelete({
      title: 'Delete permanently?',
      message: 'Delete permanently? This cannot be undone. You can recover it from Git history.',
      onConfirm: async () => {
        setConfirmDelete(null)
        await deleteNoteFromDisk(path, successMessage)
      },
    })
  }, [deleteNoteFromDisk, getEntry])

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
