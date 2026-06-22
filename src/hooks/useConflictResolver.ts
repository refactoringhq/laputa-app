import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'

function tauriCall<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(cmd, args) : mockInvoke<T>(cmd, args)
}

export type FileResolution = 'ours' | 'theirs' | 'manual' | null

export interface ConflictFileState {
  file: string
  resolution: FileResolution
  resolving: boolean
}

type ConflictStrategy = Exclude<FileResolution, 'manual' | null>
type SetConflictFileStates = Dispatch<SetStateAction<ConflictFileState[]>>
type SetConflictError = Dispatch<SetStateAction<string | null>>

interface UseConflictResolverConfig {
  vaultPath: string
  onResolved: () => void
  onToast: (msg: string) => void
  onOpenFile: (relativePath: string) => void
}

function initialConflictFileState(file: string): ConflictFileState {
  return { file, resolution: null, resolving: false }
}

function updateConflictFile(
  states: ConflictFileState[],
  file: string,
  patch: Partial<ConflictFileState>,
): ConflictFileState[] {
  return states.map((state) => state.file === file ? { ...state, ...patch } : state)
}

function useResolveConflictFile(
  vaultPath: string,
  setFileStates: SetConflictFileStates,
  setError: SetConflictError,
): (file: string, strategy: ConflictStrategy) => Promise<void> {
  return useCallback(async (file: string, strategy: ConflictStrategy) => {
    setFileStates((prev) => updateConflictFile(prev, file, { resolving: true }))
    setError(null)

    try {
      await tauriCall<void>('git_resolve_conflict', { vaultPath, file, strategy })
      setFileStates((prev) => updateConflictFile(prev, file, { resolution: strategy, resolving: false }))
    } catch (err) {
      setFileStates((prev) => updateConflictFile(prev, file, { resolving: false }))
      setError(`Failed to resolve ${file}: ${err}`)
    }
  }, [setError, setFileStates, vaultPath])
}

function useOpenConflictFile(
  onOpenFile: UseConflictResolverConfig['onOpenFile'],
  setFileStates: SetConflictFileStates,
): (file: string) => void {
  return useCallback((file: string) => {
    onOpenFile(file)
    setFileStates((prev) => updateConflictFile(prev, file, { resolution: 'manual' }))
  }, [onOpenFile, setFileStates])
}

function useCommitConflictResolution({
  allResolved,
  committing,
  onResolved,
  onToast,
  setCommitting,
  setError,
  vaultPath,
}: {
  allResolved: boolean
  committing: boolean
  onResolved: UseConflictResolverConfig['onResolved']
  onToast: UseConflictResolverConfig['onToast']
  setCommitting: Dispatch<SetStateAction<boolean>>
  setError: SetConflictError
  vaultPath: string
}): () => Promise<void> {
  return useCallback(async () => {
    if (!allResolved || committing) return
    setCommitting(true)
    setError(null)

    try {
      await tauriCall<string>('git_commit_conflict_resolution', { vaultPath })
      onResolved()
      onToast('Conflicts resolved — sync resumed')
    } catch (err) {
      setError(`Commit failed: ${err}`)
    } finally {
      setCommitting(false)
    }
  }, [allResolved, committing, onResolved, onToast, setCommitting, setError, vaultPath])
}

export function useConflictResolver({
  vaultPath,
  onResolved,
  onToast,
  onOpenFile,
}: UseConflictResolverConfig) {
  const [fileStates, setFileStates] = useState<ConflictFileState[]>([])
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initFiles = useCallback((files: string[]) => {
    setFileStates(files.map(initialConflictFileState))
    setError(null)
    setCommitting(false)
  }, [])

  const resolveFile = useResolveConflictFile(vaultPath, setFileStates, setError)
  const openInEditor = useOpenConflictFile(onOpenFile, setFileStates)

  const allResolved = fileStates.length > 0 && fileStates.every(f => f.resolution !== null)
  const anyResolving = fileStates.some(f => f.resolving)
  const commitResolution = useCommitConflictResolution({
    allResolved,
    committing,
    onResolved,
    onToast,
    setCommitting,
    setError,
    vaultPath,
  })

  return {
    fileStates,
    committing,
    error,
    allResolved,
    anyResolving,
    initFiles,
    resolveFile,
    openInEditor,
    commitResolution,
  }
}
