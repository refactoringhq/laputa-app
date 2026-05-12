import { useCallback, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { DeletedNoteEntry } from '../components/note-list/noteListUtils'
import { extractDeletedContentFromDiff } from '../components/note-list/noteListUtils'
import type { CommitDiffRequest } from './useDiffMode'
import type { GitCommit, ModifiedFile, SidebarSelection, VaultEntry } from '../types'
import { filenameStemToTitle } from '../utils/noteTitle'
import { vaultPathForEntry } from '../utils/workspaces'

type AppTab = {
  entry: VaultEntry
  content: string
}

interface GitFileWorkflowParams {
  activeTabPath: string | null
  allGitModifiedFiles: ModifiedFile[]
  changesRepositoryPath: string
  effectiveSelection: SidebarSelection
  entriesByPath: Map<string, VaultEntry>
  historyRepositoryPath: string
  loadModifiedFilesForRepository: (vaultPath: string) => Promise<unknown>
  onCloseAllTabs: () => void
  onOpenTabWithContent: (entry: DeletedNoteEntry, content: string) => void
  onReplaceActiveTab: (entry: VaultEntry) => Promise<unknown> | unknown
  onSelectNote: (entry: VaultEntry) => Promise<unknown> | unknown
  reloadVault: () => Promise<VaultEntry[]>
  resolvedPath: string
  selectedChangesModifiedFiles: ModifiedFile[]
  setToastMessage: (message: string) => void
  tabs: AppTab[]
  vaultEntries: VaultEntry[]
  visibleEntries: VaultEntry[]
}

interface QueuedDiffRequest {
  pendingDiffRequest: CommitDiffRequest | null
  queuePendingDiff: (path: string, commitHash?: string) => void
  handlePendingDiffHandled: (requestId: number) => void
}

const DELETED_NOTE_PREVIEW_DEFAULTS = {
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  archived: false,
  modifiedAt: null,
  createdAt: null,
  fileSize: 0,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  sidebarLabel: null,
  template: null,
  sort: null,
  view: null,
  visible: null,
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  outgoingLinks: [],
  properties: {},
  hasH1: true,
  fileKind: 'markdown',
  __deletedNotePreview: true,
  __changeAddedLines: null,
  __changeDeletedLines: null,
  __changeBinary: false,
} satisfies Omit<DeletedNoteEntry, 'path' | 'filename' | 'title' | '__deletedRelativePath'>

function appTauriCall<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

function createPulseDeletedNoteEntry(fullPath: string, relativePath: string): DeletedNoteEntry {
  const filename = relativePath.split('/').pop() ?? relativePath
  return {
    ...DELETED_NOTE_PREVIEW_DEFAULTS,
    path: fullPath,
    filename,
    title: filenameStemToTitle(filename),
    __deletedRelativePath: relativePath,
  }
}

function useQueuedDiffRequest(): QueuedDiffRequest {
  const pendingDiffRequestIdRef = useRef(0)
  const [pendingDiffRequest, setPendingDiffRequest] = useState<CommitDiffRequest | null>(null)

  const queuePendingDiff = useCallback((path: string, commitHash?: string) => {
    pendingDiffRequestIdRef.current += 1
    setPendingDiffRequest({
      requestId: pendingDiffRequestIdRef.current,
      path,
      commitHash,
    })
  }, [])

  const handlePendingDiffHandled = useCallback((requestId: number) => {
    setPendingDiffRequest((current) =>
      current?.requestId === requestId ? null : current,
    )
  }, [])

  return {
    pendingDiffRequest,
    queuePendingDiff,
    handlePendingDiffHandled,
  }
}

function useVaultPathResolver({
  allGitModifiedFiles,
  resolvedPath,
  tabs,
  vaultEntries,
  visibleEntries,
}: Pick<GitFileWorkflowParams, 'allGitModifiedFiles' | 'resolvedPath' | 'tabs' | 'vaultEntries' | 'visibleEntries'>) {
  const findEntryForPath = useCallback((path: string) => {
    const openTabEntry = tabs.find((tab) => tab.entry.path === path)?.entry
    if (openTabEntry) return openTabEntry

    const visibleEntry = visibleEntries.find((entry) => entry.path === path)
    if (visibleEntry) return visibleEntry

    return vaultEntries.find((entry) => entry.path === path) ?? null
  }, [tabs, vaultEntries, visibleEntries])

  return useCallback((path: string) => {
    const entry = findEntryForPath(path)
    if (entry) return vaultPathForEntry(entry, resolvedPath)

    const modifiedFile = allGitModifiedFiles.find((file) =>
      file.path === path || file.relativePath === path || path.endsWith('/' + file.relativePath),
    )
    return modifiedFile?.vaultPath ?? resolvedPath
  }, [allGitModifiedFiles, findEntryForPath, resolvedPath])
}

function useGitDiffLoaders(vaultPathForNotePath: (path: string) => string) {
  const loadGitHistoryForPath = useCallback(async (path: string): Promise<GitCommit[]> => {
    try {
      return await appTauriCall<GitCommit[]>('get_file_history', {
        vaultPath: vaultPathForNotePath(path),
        path,
      })
    } catch (err) {
      console.warn('Failed to load git history:', err)
      return []
    }
  }, [vaultPathForNotePath])

  const loadDiffForPath = useCallback((path: string): Promise<string> =>
    appTauriCall<string>('get_file_diff', {
      vaultPath: vaultPathForNotePath(path),
      path,
    }), [vaultPathForNotePath])

  const loadDiffAtCommitForPath = useCallback((path: string, commitHash: string): Promise<string> =>
    appTauriCall<string>('get_file_diff_at_commit', {
      vaultPath: vaultPathForNotePath(path),
      path,
      commitHash,
    }), [vaultPathForNotePath])

  return {
    loadGitHistoryForPath,
    loadDiffForPath,
    loadDiffAtCommitForPath,
  }
}

function usePulseNoteOpen({
  entriesByPath,
  historyRepositoryPath,
  onOpenTabWithContent,
  onSelectNote,
  queuePendingDiff,
}: Pick<GitFileWorkflowParams, 'entriesByPath' | 'historyRepositoryPath' | 'onOpenTabWithContent' | 'onSelectNote'> & {
  queuePendingDiff: (path: string, commitHash?: string) => void
}) {
  return useCallback((relativePath: string, commitHash?: string) => {
    const fullPath = `${historyRepositoryPath}/${relativePath}`
    const entry = entriesByPath.get(fullPath) ?? entriesByPath.get(relativePath)

    if (commitHash) {
      const targetPath = entry?.path ?? fullPath
      queuePendingDiff(targetPath, commitHash)
      if (entry) {
        void onSelectNote(entry)
      } else {
        onOpenTabWithContent(createPulseDeletedNoteEntry(fullPath, relativePath), 'Content not available')
      }
      return
    }

    if (entry) {
      void onSelectNote(entry)
    }
  }, [
    entriesByPath,
    historyRepositoryPath,
    onOpenTabWithContent,
    onSelectNote,
    queuePendingDiff,
  ])
}

function isDiscardedFileActive(
  activePath: string | null,
  targetFile: ModifiedFile | undefined,
  relativePath: string,
) {
  return !!activePath
    && (activePath === targetFile?.path || activePath.endsWith('/' + relativePath))
}

function findReloadedDiscardTarget(
  entries: VaultEntry[],
  targetFile: ModifiedFile | undefined,
  relativePath: string,
) {
  return entries.find((entry) =>
    entry.path === targetFile?.path || entry.path.endsWith('/' + relativePath),
  )
}

async function syncActiveTabAfterDiscard({
  activePathBefore,
  onCloseAllTabs,
  onReplaceActiveTab,
  reloadedEntries,
  relativePath,
  targetFile,
}: {
  activePathBefore: string | null
  onCloseAllTabs: () => void
  onReplaceActiveTab: (entry: VaultEntry) => Promise<unknown> | unknown
  reloadedEntries: VaultEntry[]
  relativePath: string
  targetFile: ModifiedFile | undefined
}) {
  if (!isDiscardedFileActive(activePathBefore, targetFile, relativePath)) return

  const refreshedEntry = findReloadedDiscardTarget(reloadedEntries, targetFile, relativePath)
  if (refreshedEntry) {
    await onReplaceActiveTab(refreshedEntry)
  } else {
    onCloseAllTabs()
  }
}

function useDiscardFileAction({
  activeTabPath,
  changesRepositoryPath,
  loadModifiedFilesForRepository,
  onCloseAllTabs,
  onReplaceActiveTab,
  reloadVault,
  selectedChangesModifiedFiles,
  setToastMessage,
}: Pick<GitFileWorkflowParams, 'activeTabPath' | 'changesRepositoryPath' | 'loadModifiedFilesForRepository' | 'onCloseAllTabs' | 'onReplaceActiveTab' | 'reloadVault' | 'selectedChangesModifiedFiles' | 'setToastMessage'>) {
  return useCallback(async (relativePath: string) => {
    const targetFile = selectedChangesModifiedFiles.find((file) => file.relativePath === relativePath)
    try {
      await appTauriCall('git_discard_file', { vaultPath: changesRepositoryPath, relativePath })
      await loadModifiedFilesForRepository(changesRepositoryPath)
      await syncActiveTabAfterDiscard({
        activePathBefore: activeTabPath,
        onCloseAllTabs,
        onReplaceActiveTab,
        reloadedEntries: await reloadVault(),
        relativePath,
        targetFile,
      })
    } catch (err) {
      setToastMessage(typeof err === 'string' ? err : 'Failed to discard changes')
    }
  }, [
    activeTabPath,
    changesRepositoryPath,
    loadModifiedFilesForRepository,
    onCloseAllTabs,
    onReplaceActiveTab,
    reloadVault,
    selectedChangesModifiedFiles,
    setToastMessage,
  ])
}

function useOpenDeletedNoteAction({
  loadDiffForPath,
  onOpenTabWithContent,
  queuePendingDiff,
  setToastMessage,
}: Pick<GitFileWorkflowParams, 'onOpenTabWithContent' | 'setToastMessage'> & {
  loadDiffForPath: (path: string) => Promise<string>
  queuePendingDiff: (path: string, commitHash?: string) => void
}) {
  return useCallback(async (entry: DeletedNoteEntry) => {
    let previewContent = 'Content not available (untracked)'
    let hasDiff = false
    try {
      const diff = await loadDiffForPath(entry.path)
      hasDiff = diff.length > 0
      previewContent = extractDeletedContentFromDiff(diff) ?? previewContent
    } catch (err) {
      console.warn('Failed to load deleted note preview:', err)
    }
    onOpenTabWithContent(entry, previewContent)
    if (hasDiff) {
      queuePendingDiff(entry.path)
    } else {
      setToastMessage('Content not available (untracked)')
    }
  }, [loadDiffForPath, onOpenTabWithContent, queuePendingDiff, setToastMessage])
}

function useDeletedNoteWorkflow({
  activeTabPath,
  changesRepositoryPath,
  loadDiffForPath,
  loadModifiedFilesForRepository,
  onCloseAllTabs,
  onOpenTabWithContent,
  onReplaceActiveTab,
  queuePendingDiff,
  reloadVault,
  selectedChangesModifiedFiles,
  setToastMessage,
}: Pick<GitFileWorkflowParams, 'activeTabPath' | 'changesRepositoryPath' | 'loadModifiedFilesForRepository' | 'onCloseAllTabs' | 'onOpenTabWithContent' | 'onReplaceActiveTab' | 'reloadVault' | 'selectedChangesModifiedFiles' | 'setToastMessage'> & {
  loadDiffForPath: (path: string) => Promise<string>
  queuePendingDiff: (path: string, commitHash?: string) => void
}) {
  const handleDiscardFile = useDiscardFileAction({
    activeTabPath,
    changesRepositoryPath,
    loadModifiedFilesForRepository,
    onCloseAllTabs,
    onReplaceActiveTab,
    reloadVault,
    selectedChangesModifiedFiles,
    setToastMessage,
  })
  const handleOpenDeletedNote = useOpenDeletedNoteAction({
    loadDiffForPath,
    onOpenTabWithContent,
    queuePendingDiff,
    setToastMessage,
  })

  return {
    handleDiscardFile,
    handleOpenDeletedNote,
  }
}

function useReplaceActiveTabWithQueuedDiff({
  effectiveSelection,
  onReplaceActiveTab,
  queuePendingDiff,
}: Pick<GitFileWorkflowParams, 'effectiveSelection' | 'onReplaceActiveTab'> & {
  queuePendingDiff: (path: string, commitHash?: string) => void
}) {
  return useCallback((entry: VaultEntry) => {
    onReplaceActiveTab(entry)
    if (effectiveSelection.kind === 'filter' && effectiveSelection.filter === 'changes') {
      queuePendingDiff(entry.path)
    }
  }, [effectiveSelection, onReplaceActiveTab, queuePendingDiff])
}

function useActiveDeletedFile(activeTabPath: string | null, allGitModifiedFiles: ModifiedFile[]) {
  return useMemo(() => {
    if (!activeTabPath) return null
    return allGitModifiedFiles.find((file) =>
      file.status === 'deleted'
      && (file.path === activeTabPath || activeTabPath.endsWith('/' + file.relativePath)),
    ) ?? null
  }, [activeTabPath, allGitModifiedFiles])
}

function useActiveNoteModified(activeTabPath: string | null, allGitModifiedFiles: ModifiedFile[]) {
  return useMemo(
    () => allGitModifiedFiles.some((file) => file.path === activeTabPath),
    [activeTabPath, allGitModifiedFiles],
  )
}

function useDeletedWorkflowForParams(
  params: GitFileWorkflowParams,
  loadDiffForPath: (path: string) => Promise<string>,
  queuePendingDiff: (path: string, commitHash?: string) => void,
) {
  return useDeletedNoteWorkflow({
    activeTabPath: params.activeTabPath,
    changesRepositoryPath: params.changesRepositoryPath,
    loadDiffForPath,
    loadModifiedFilesForRepository: params.loadModifiedFilesForRepository,
    onCloseAllTabs: params.onCloseAllTabs,
    onOpenTabWithContent: params.onOpenTabWithContent,
    onReplaceActiveTab: params.onReplaceActiveTab,
    queuePendingDiff,
    reloadVault: params.reloadVault,
    selectedChangesModifiedFiles: params.selectedChangesModifiedFiles,
    setToastMessage: params.setToastMessage,
  })
}

export function useGitFileWorkflows(params: GitFileWorkflowParams) {
  const {
    pendingDiffRequest,
    queuePendingDiff,
    handlePendingDiffHandled,
  } = useQueuedDiffRequest()
  const vaultPathForNotePath = useVaultPathResolver(params)
  const {
    loadGitHistoryForPath,
    loadDiffForPath,
    loadDiffAtCommitForPath,
  } = useGitDiffLoaders(vaultPathForNotePath)
  const handlePulseOpenNote = usePulseNoteOpen({
    entriesByPath: params.entriesByPath,
    historyRepositoryPath: params.historyRepositoryPath,
    onOpenTabWithContent: params.onOpenTabWithContent,
    onSelectNote: params.onSelectNote,
    queuePendingDiff,
  })
  const {
    handleDiscardFile,
    handleOpenDeletedNote,
  } = useDeletedWorkflowForParams(params, loadDiffForPath, queuePendingDiff)
  const handleReplaceActiveTabWithQueuedDiff = useReplaceActiveTabWithQueuedDiff({
    effectiveSelection: params.effectiveSelection,
    onReplaceActiveTab: params.onReplaceActiveTab,
    queuePendingDiff,
  })
  const activeDeletedFile = useActiveDeletedFile(params.activeTabPath, params.allGitModifiedFiles)
  const activeNoteModified = useActiveNoteModified(params.activeTabPath, params.allGitModifiedFiles)

  return {
    activeDeletedFile,
    activeNoteModified,
    handleDiscardFile,
    handleOpenDeletedNote,
    handlePendingDiffHandled,
    handlePulseOpenNote,
    handleReplaceActiveTabWithQueuedDiff,
    loadDiffAtCommitForPath,
    loadDiffForPath,
    loadGitHistoryForPath,
    pendingDiffRequest,
  }
}
