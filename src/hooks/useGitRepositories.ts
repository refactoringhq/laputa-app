import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { GitRemoteStatus, ModifiedFile } from '../types'
import type { GitRepositoryOption } from '../utils/gitRepositories'
import { validGitRepositoryPath } from '../utils/gitRepositories'

interface RepositoryModifiedFiles {
  error: string | null
  files: ModifiedFile[]
}

interface RepositoryRemoteStatus {
  error: string | null
  status: GitRemoteStatus | null
}

interface UseGitRepositoriesOptions {
  defaultVaultPath: string
  repositories: GitRepositoryOption[]
}

interface RepositorySelectionConfig {
  fallbackPath: string
  repositories: GitRepositoryOption[]
}

interface RepositoryStateLookup<T> {
  byRepository: ReadonlyMap<string, T>
  fallback: T
  path: string
}

interface RepositoryLoadState {
  loadIds: RepositoryLoadIds
  path: string
}

interface RepositoryLoadCompletion extends RepositoryLoadState {
  id: number
}

interface RepositoryFilesArgs {
  files: ModifiedFile[]
  vaultPath: string
}

export interface LoadModifiedFilesOptions {
  includeStats?: boolean
}

const EMPTY_MODIFIED_FILES: RepositoryModifiedFiles = {
  error: null,
  files: [],
}

const EMPTY_REMOTE_STATUS: RepositoryRemoteStatus = {
  error: null,
  status: null,
}

type RepositoryLoadIds = Map<string, number>

function tauriCall<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

function withRepositoryPath({ files, vaultPath }: RepositoryFilesArgs): ModifiedFile[] {
  return files.map((file) => ({ ...file, vaultPath }))
}

function repositoryState<T>({ byRepository, fallback, path }: RepositoryStateLookup<T>): T {
  return byRepository.get(path) ?? fallback
}

function nextRepositoryLoadId({ loadIds, path }: RepositoryLoadState): number {
  const nextId = (loadIds.get(path) ?? 0) + 1
  loadIds.set(path, nextId)
  return nextId
}

function isLatestRepositoryLoad({ loadIds, path, id }: RepositoryLoadCompletion): boolean {
  return loadIds.get(path) === id
}

function repositoryErrorMessage(error: unknown, fallback: string): string {
  return typeof error === 'string' ? error : fallback
}

function useValidatedRepositoryPath({
  repositories,
  fallbackPath,
}: RepositorySelectionConfig) {
  const [requestedPath, setRequestedPath] = useState(fallbackPath)
  const selectedPath = validGitRepositoryPath(requestedPath, repositories, fallbackPath)

  const setRepositoryPath = useCallback((path: string) => {
    setRequestedPath(path)
  }, [])

  return [selectedPath, setRepositoryPath] as const
}

function useRepositoryModifiedFiles(repositories: GitRepositoryOption[]) {
  const [byRepository, setByRepository] = useState<ReadonlyMap<string, RepositoryModifiedFiles>>(() => new Map())
  const loadIdsRef = useRef<RepositoryLoadIds>(new Map())

  const loadModifiedFilesForRepository = useCallback(async (
    vaultPath: string,
    options: LoadModifiedFilesOptions = {},
  ) => {
    if (!vaultPath.trim()) return [] as ModifiedFile[]
    const loadId = nextRepositoryLoadId({ loadIds: loadIdsRef.current, path: vaultPath })
    const includeStats = options.includeStats === true

    try {
      const files = withRepositoryPath({
        files: await tauriCall<ModifiedFile[]>('get_modified_files', { vaultPath, includeStats }),
        vaultPath,
      })
      if (isLatestRepositoryLoad({ loadIds: loadIdsRef.current, path: vaultPath, id: loadId })) {
        setByRepository((current) => new Map(current).set(vaultPath, { error: null, files }))
      }
      return files
    } catch (error) {
      const message = repositoryErrorMessage(error, 'Failed to load changes')
      if (isLatestRepositoryLoad({ loadIds: loadIdsRef.current, path: vaultPath, id: loadId })) {
        setByRepository((current) => new Map(current).set(vaultPath, { error: message, files: [] }))
      }
      return [] as ModifiedFile[]
    }
  }, [])

  const loadAllModifiedFiles = useCallback(async (options: LoadModifiedFilesOptions = {}) => {
    await Promise.all(repositories.map((repository) => loadModifiedFilesForRepository(repository.path, options)))
  }, [loadModifiedFilesForRepository, repositories])

  useEffect(() => {
    if (repositories.length === 0) return
    void loadAllModifiedFiles()
  }, [loadAllModifiedFiles, repositories.length])

  return { byRepository, loadAllModifiedFiles, loadModifiedFilesForRepository }
}

function useRepositoryRemoteStatuses(repositories: GitRepositoryOption[]) {
  const [byRepository, setByRepository] = useState<ReadonlyMap<string, RepositoryRemoteStatus>>(() => new Map())
  const loadIdsRef = useRef<RepositoryLoadIds>(new Map())

  const refreshRemoteStatusForRepository = useCallback(async (vaultPath: string) => {
    if (!vaultPath.trim()) return null
    const loadId = nextRepositoryLoadId({ loadIds: loadIdsRef.current, path: vaultPath })

    try {
      const status = await tauriCall<GitRemoteStatus>('git_remote_status', { vaultPath })
      if (isLatestRepositoryLoad({ loadIds: loadIdsRef.current, path: vaultPath, id: loadId })) {
        setByRepository((current) => new Map(current).set(vaultPath, { error: null, status }))
      }
      return status
    } catch (error) {
      const message = repositoryErrorMessage(error, 'Failed to load remote status')
      if (isLatestRepositoryLoad({ loadIds: loadIdsRef.current, path: vaultPath, id: loadId })) {
        setByRepository((current) => new Map(current).set(vaultPath, { error: message, status: null }))
      }
      return null
    }
  }, [])

  const refreshAllRemoteStatuses = useCallback(async () => {
    await Promise.all(repositories.map((repository) => refreshRemoteStatusForRepository(repository.path)))
  }, [refreshRemoteStatusForRepository, repositories])

  return { byRepository, refreshAllRemoteStatuses, refreshRemoteStatusForRepository }
}

export function useGitRepositories({
  defaultVaultPath,
  repositories,
}: UseGitRepositoriesOptions) {
  const selectionConfig = { fallbackPath: defaultVaultPath, repositories }
  const [changesRepositoryPath, setChangesRepositoryPath] = useValidatedRepositoryPath(selectionConfig)
  const [historyRepositoryPath, setHistoryRepositoryPath] = useValidatedRepositoryPath(selectionConfig)
  const [commitRepositoryPath, setCommitRepositoryPath] = useValidatedRepositoryPath(selectionConfig)
  const [syncRepositoryPath, setSyncRepositoryPath] = useValidatedRepositoryPath(selectionConfig)
  const { byRepository, loadAllModifiedFiles, loadModifiedFilesForRepository } = useRepositoryModifiedFiles(repositories)
  const {
    byRepository: remoteStatusByRepository,
    refreshAllRemoteStatuses,
    refreshRemoteStatusForRepository,
  } = useRepositoryRemoteStatuses(repositories)

  const allModifiedFiles = useMemo(
    () => repositories.flatMap((repository) => repositoryState({
      byRepository,
      fallback: EMPTY_MODIFIED_FILES,
      path: repository.path,
    }).files),
    [byRepository, repositories],
  )
  const changesState = repositoryState({
    byRepository,
    fallback: EMPTY_MODIFIED_FILES,
    path: changesRepositoryPath,
  })
  const commitState = repositoryState({
    byRepository,
    fallback: EMPTY_MODIFIED_FILES,
    path: commitRepositoryPath,
  })
  const remoteStatusForRepository = useCallback((path: string) => repositoryState({
    byRepository: remoteStatusByRepository,
    fallback: EMPTY_REMOTE_STATUS,
    path,
  }).status, [remoteStatusByRepository])
  const remoteStatusErrorForRepository = useCallback((path: string) => repositoryState({
    byRepository: remoteStatusByRepository,
    fallback: EMPTY_REMOTE_STATUS,
    path,
  }).error, [remoteStatusByRepository])

  return {
    allModifiedFiles,
    changesModifiedFiles: changesState.files,
    changesModifiedFilesError: changesState.error,
    changesRepositoryPath,
    commitModifiedFiles: commitState.files,
    commitRepositoryPath,
    historyRepositoryPath,
    loadAllModifiedFiles,
    loadModifiedFilesForRepository,
    refreshAllRemoteStatuses,
    refreshRemoteStatusForRepository,
    remoteStatusErrorForRepository,
    remoteStatusForRepository,
    setChangesRepositoryPath,
    setCommitRepositoryPath,
    setHistoryRepositoryPath,
    setSyncRepositoryPath,
    syncRepositoryPath,
    totalModifiedCount: allModifiedFiles.length,
  }
}
