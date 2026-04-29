import { useCallback, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import { openLocalFile } from '../utils/url'

function tauriCall<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(cmd, args) : mockInvoke<T>(cmd, args)
}

interface ConflictFlowDeps {
  resolvedPath: string
  entries: VaultEntry[]
  conflictFiles: string[]
  pausePull: () => void
  resumePull: () => void
  triggerSync: () => void
  reloadVault: () => Promise<unknown>
  initConflictFiles: (files: string[]) => void
  openConflictResolver: () => void
  closeConflictResolver: () => void
  onSelectNote: (entry: VaultEntry) => void
  activeTabPath: string | null
  setToastMessage: (msg: string | null) => void
}

async function fetchConflictFiles(vaultPath: string): Promise<string[]> {
  return tauriCall<string[]>('get_conflict_files', { vaultPath })
}

async function resolveAndCheck(
  vaultPath: string, filePath: string, strategy: 'ours' | 'theirs',
): Promise<string[]> {
  const relativePath = filePath.replace(vaultPath + '/', '')
  await tauriCall('git_resolve_conflict', { vaultPath, file: relativePath, strategy })
  return fetchConflictFiles(vaultPath)
}

async function commitMergeResolution(vaultPath: string): Promise<void> {
  await tauriCall('git_commit_conflict_resolution', { vaultPath })
}

export function useConflictFlow({
  resolvedPath, entries, conflictFiles,
  pausePull, resumePull, triggerSync, reloadVault,
  initConflictFiles, openConflictResolver, closeConflictResolver,
  onSelectNote, activeTabPath, setToastMessage,
}: ConflictFlowDeps) {
  const openConflictFileRef = useRef<(relativePath: string) => void>(() => {})

  useEffect(() => {
    openConflictFileRef.current = (relativePath: string) => {
      const fullPath = `${resolvedPath}/${relativePath}`
      const entry = entries.find(e => e.path === fullPath)
      if (entry) {
        onSelectNote(entry)
        closeConflictResolver()
      } else {
        openLocalFile(fullPath, resolvedPath)
      }
    }
  }, [resolvedPath, entries, onSelectNote, closeConflictResolver])

  const handleOpenConflictResolver = useCallback(async () => {
    let files = conflictFiles
    if (files.length === 0) {
      try { files = await fetchConflictFiles(resolvedPath) } catch { return }
      if (files.length === 0) {
        setToastMessage('No merge conflicts to resolve')
        return
      }
    }
    pausePull()
    initConflictFiles(files)
    openConflictResolver()
  }, [conflictFiles, resolvedPath, pausePull, initConflictFiles, openConflictResolver, setToastMessage])

  const handleCloseConflictResolver = useCallback(() => {
    resumePull()
    closeConflictResolver()
  }, [resumePull, closeConflictResolver])

  const handleResolveConflictInline = useCallback(async (filePath: string, strategy: 'ours' | 'theirs') => {
    try {
      const remaining = await resolveAndCheck(resolvedPath, filePath, strategy)
      if (remaining.length === 0) {
        await commitMergeResolution(resolvedPath)
        reloadVault()
        triggerSync()
        setToastMessage('All conflicts resolved — merge committed')
      } else {
        reloadVault()
        setToastMessage(`Resolved — ${remaining.length} conflict${remaining.length > 1 ? 's' : ''} remaining`)
      }
    } catch (err) {
      setToastMessage(`Failed to resolve conflict: ${err}`)
    }
  }, [resolvedPath, reloadVault, triggerSync, setToastMessage])

  const handleKeepMine = useCallback((path: string) => handleResolveConflictInline(path, 'ours'), [handleResolveConflictInline])
  const handleKeepTheirs = useCallback((path: string) => handleResolveConflictInline(path, 'theirs'), [handleResolveConflictInline])

  const isConflicted = !!activeTabPath && conflictFiles.some(f => activeTabPath.endsWith(f))

  return {
    openConflictFileRef,
    handleOpenConflictResolver,
    handleCloseConflictResolver,
    handleKeepMine,
    handleKeepTheirs,
    isConflicted,
  }
}
