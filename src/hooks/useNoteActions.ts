import { useCallback, useEffect } from 'react'
import type { VaultEntry } from '../types'
import type { FrontmatterValue } from '../components/Inspector'
import { useTabManagement } from './useTabManagement'
import {
  GITIGNORED_VISIBILITY_APPLIED_EVENT,
  type GitignoredVisibilityAppliedEvent,
} from '../lib/gitignoredVisibilityEvents'
import { resolveEntry } from '../utils/wikilink'
import { useNoteCreation } from './useNoteCreation'
import {
  useNoteRename,
  performRename, loadNoteContent, renameToastMessage, reloadTabsAfterRename, reloadVaultAfterRename,
} from './useNoteRename'
import { runFrontmatterAndApply, type FrontmatterOpOptions } from './frontmatterOps'
import { findByNotePath, notePathFilename, notePathsMatch } from '../utils/notePathIdentity'

export interface NoteActionsConfig {
  addEntry: (entry: VaultEntry) => void
  removeEntry: (path: string) => void
  entries: VaultEntry[]
  flushBeforeNoteSwitch?: (path: string) => Promise<void>
  flushBeforeNoteMutation?: (path: string) => Promise<void>
  reloadVault?: () => Promise<unknown>
  setToastMessage: (msg: string | null) => void
  updateEntry: (path: string, patch: Partial<VaultEntry>) => void
  vaultPath: string
  addPendingSave?: (path: string) => void
  removePendingSave?: (path: string) => void
  trackUnsaved?: (path: string) => void
  clearUnsaved?: (path: string) => void
  unsavedPaths?: Set<string>
  markContentPending?: (path: string, content: string) => void
  onNewNotePersisted?: (path: string) => void
  replaceEntry?: (oldPath: string, patch: Partial<VaultEntry> & { path: string }) => void
  onPathRenamed?: (oldPath: string, newPath: string) => void
  /** Called when note loading proves the active vault path is no longer usable. */
  onMissingActiveVault?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  /** Called after frontmatter is written to disk — used for live-reloading theme CSS vars. */
  onFrontmatterContentChanged?: (path: string, content: string) => void
  /** Called after a frontmatter mutation is fully persisted, including follow-up renames. */
  onFrontmatterPersisted?: () => void
  /** Called after type files or type assignments change, so derived type surfaces can reload. */
  onTypeStateChanged?: () => void | Promise<void>
}

function isTitleKey(key: string): boolean {
  return key.toLowerCase().replace(/\s+/g, '_') === 'title'
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function entryDisplayLabel(entry: VaultEntry): string {
  return safeString(entry.title).trim()
    || safeString(entry.filename).trim()
    || 'Note'
}

interface TitleRenameDeps {
  vaultPath: string
  tabsRef: React.MutableRefObject<{ entry: VaultEntry; content: string }[]>
  reloadVault?: () => Promise<unknown>
  replaceEntry?: (oldPath: string, patch: Partial<VaultEntry> & { path: string }) => void
  onPathRenamed?: (oldPath: string, newPath: string) => void
  setTabs: React.Dispatch<React.SetStateAction<{ entry: VaultEntry; content: string }[]>>
  activeTabPathRef: React.MutableRefObject<string | null>
  handleSwitchTab: (path: string) => void
  setToastMessage: (msg: string | null) => void
  updateTabContent: (path: string, content: string) => void
}

interface FrontmatterCallbackParams {
  config: NoteActionsConfig
  path: string
  newContent: string | undefined
}

function applyFrontmatterCallbacks({ config, path, newContent }: FrontmatterCallbackParams): boolean {
  if (!newContent) return false
  config.onFrontmatterContentChanged?.(path, newContent)
  return true
}

interface RenameAfterTitleChangeParams {
  path: string
  newTitle: string
  deps: TitleRenameDeps
}

async function renameAfterTitleChange({ path, newTitle, deps }: RenameAfterTitleChangeParams): Promise<void> {
  const oldTitle = deps.tabsRef.current.find(t => notePathsMatch(t.entry.path, path))?.entry.title
  const result = await performRename({ path, newTitle, vaultPath: deps.vaultPath, oldTitle })
  if (!notePathsMatch(result.new_path, path)) {
    const newFilename = notePathFilename(result.new_path)
    deps.onPathRenamed?.(path, result.new_path)
    deps.replaceEntry?.(path, { path: result.new_path, filename: newFilename, title: newTitle } as Partial<VaultEntry> & { path: string })
    const newContent = await loadNoteContent({ path: result.new_path })
    deps.setTabs(prev => prev.map(t => notePathsMatch(t.entry.path, path)
      ? { entry: { ...t.entry, path: result.new_path, filename: newFilename, title: newTitle }, content: newContent }
      : t))
    if (notePathsMatch(deps.activeTabPathRef.current, path)) deps.handleSwitchTab(result.new_path)
    const otherTabPaths = deps.tabsRef.current
      .filter(t => !notePathsMatch(t.entry.path, path) && !notePathsMatch(t.entry.path, result.new_path))
      .map(t => t.entry.path)
    await reloadTabsAfterRename({ tabPaths: otherTabPaths, updateTabContent: deps.updateTabContent })
  }
  await reloadVaultAfterRename(deps.reloadVault)
  deps.setToastMessage(renameToastMessage(result.updated_files, result.failed_updates ?? 0))
}

function shouldRenameOnTitleUpdate(key: string, value: FrontmatterValue): value is string {
  return isTitleKey(key) && typeof value === 'string' && value !== ''
}

function isTypeFieldKey(key: string): boolean {
  const normalized = key.trim().toLowerCase().replace(/\s+/g, '_')
  return normalized === 'type' || normalized === 'is_a'
}

async function notifyFrontmatterPersisted(config: NoteActionsConfig, key: string): Promise<void> {
  config.onFrontmatterPersisted?.()
  if (isTypeFieldKey(key)) {
    await config.onTypeStateChanged?.()
  }
}

interface NavigateWikilinkParams {
  entries: VaultEntry[]
  target: string
  selectNote: (entry: VaultEntry) => void
}

function navigateWikilink({ entries, target, selectNote }: NavigateWikilinkParams): void {
  const found = resolveEntry(entries, target)
  if (found) selectNote(found)
  else console.warn(`Navigation target not found: ${target}`)
}

interface MaybeRenameAfterFrontmatterUpdateParams {
  path: string
  key: string
  value: FrontmatterValue
  deps: TitleRenameDeps
}

async function flushBeforeNoteMutation(
  path: string,
  flushBeforeMutation?: (path: string) => Promise<void>,
): Promise<boolean> {
  if (!flushBeforeMutation) return true

  try {
    await flushBeforeMutation(path)
    return true
  } catch {
    return false
  }
}

async function maybeRenameAfterFrontmatterUpdate({
  path,
  key,
  value,
  deps,
}: MaybeRenameAfterFrontmatterUpdateParams): Promise<void> {
  if (!shouldRenameOnTitleUpdate(key, value)) return
  try {
    await renameAfterTitleChange({ path, newTitle: value, deps })
  } catch (err) {
    console.error('Failed to rename note after title change:', err)
  }
}

interface UpdateFrontmatterAndMaybeRenameParams {
  config: NoteActionsConfig
  deps: TitleRenameDeps
  key: string
  options?: FrontmatterOpOptions
  path: string
  runFrontmatterOp: (
    op: 'update' | 'delete',
    path: string,
    key: string,
    value?: FrontmatterValue,
    options?: FrontmatterOpOptions,
  ) => Promise<string | undefined>
  value: FrontmatterValue
}

async function updateFrontmatterAndMaybeRename({
  config,
  deps,
  key,
  options,
  path,
  runFrontmatterOp,
  value,
}: UpdateFrontmatterAndMaybeRenameParams): Promise<void> {
  const canFlush = await flushBeforeNoteMutation(path, config.flushBeforeNoteMutation)
  if (!canFlush) return

  const newContent = await runFrontmatterOp('update', path, key, value, options)
  if (!applyFrontmatterCallbacks({ config, path, newContent })) return

  await maybeRenameAfterFrontmatterUpdate({ path, key, value, deps })
  await notifyFrontmatterPersisted(config, key)
}

function buildTabManagementOptions(
  config: Pick<NoteActionsConfig, 'flushBeforeNoteSwitch' | 'onMissingActiveVault' | 'reloadVault' | 'setToastMessage' | 'unsavedPaths'>,
) {
  const options: {
    beforeNavigate?: (fromPath: string, toPath: string) => Promise<void>
    hasUnsavedChanges: (path: string) => boolean
    onMissingActiveVault: (entry: VaultEntry, error: unknown) => void | Promise<void>
    onMissingNotePath: (entry: VaultEntry) => void
    onUnreadableNoteContent: (entry: VaultEntry) => void
  } = {
    hasUnsavedChanges: (path) => config.unsavedPaths?.has(path) ?? false,
    onMissingActiveVault: (entry, error) => {
      void config.onMissingActiveVault?.(entry, error)
    },
    onMissingNotePath: (entry) => {
      const label = entryDisplayLabel(entry)
      config.setToastMessage(`"${label}" could not be opened because its file is missing or moved.`)
      void config.reloadVault?.()
    },
    onUnreadableNoteContent: (entry) => {
      const label = entryDisplayLabel(entry)
      config.setToastMessage(`"${label}" could not be opened because it is not valid UTF-8 text.`)
    },
  }

  if (config.flushBeforeNoteSwitch) {
    options.beforeNavigate = (fromPath: string) => config.flushBeforeNoteSwitch!(fromPath)
  }

  return options
}

function useGitignoredVisibilityTabCleanup({
  activeTabPathRef,
  closeAllTabs,
  setToastMessage,
}: {
  activeTabPathRef: React.MutableRefObject<string | null>
  closeAllTabs: () => void
  setToastMessage: (msg: string | null) => void
}) {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleVisibilityApplied = (event: Event) => {
      const { hide, visiblePaths } = (event as GitignoredVisibilityAppliedEvent).detail
      const activePath = activeTabPathRef.current
      if (!hide || !activePath || visiblePaths.some((path) => notePathsMatch(path, activePath))) return
      closeAllTabs()
      setToastMessage('Closed hidden Gitignored file')
    }

    window.addEventListener(GITIGNORED_VISIBILITY_APPLIED_EVENT, handleVisibilityApplied)
    return () => {
      window.removeEventListener(GITIGNORED_VISIBILITY_APPLIED_EVENT, handleVisibilityApplied)
    }
  }, [activeTabPathRef, closeAllTabs, setToastMessage])
}

function useFrontmatterActionHandlers({
  config,
  renameTabsRef,
  setTabs,
  activeTabPathRef,
  handleSwitchTab,
  setToastMessage,
  updateTabContent,
  runFrontmatterOp,
}: {
  config: NoteActionsConfig
  renameTabsRef: TitleRenameDeps['tabsRef']
  setTabs: React.Dispatch<React.SetStateAction<{ entry: VaultEntry; content: string }[]>>
  activeTabPathRef: React.MutableRefObject<string | null>
  handleSwitchTab: (path: string) => void
  setToastMessage: (msg: string | null) => void
  updateTabContent: (path: string, newContent: string) => void
  runFrontmatterOp: (
    op: 'update' | 'delete',
    path: string,
    key: string,
    value?: FrontmatterValue,
    options?: FrontmatterOpOptions,
  ) => Promise<string | undefined>
}) {
  const handleUpdateFrontmatter = useCallback(async (
    path: string,
    key: string,
    value: FrontmatterValue,
    options?: FrontmatterOpOptions,
  ) => {
    await updateFrontmatterAndMaybeRename({
      config,
      deps: {
        vaultPath: config.vaultPath,
        tabsRef: renameTabsRef,
        reloadVault: config.reloadVault,
        replaceEntry: config.replaceEntry,
        onPathRenamed: config.onPathRenamed,
        setTabs,
        activeTabPathRef,
        handleSwitchTab,
        setToastMessage,
        updateTabContent,
      },
      path,
      key,
      value,
      options,
      runFrontmatterOp,
    })
  }, [activeTabPathRef, config, handleSwitchTab, renameTabsRef, runFrontmatterOp, setTabs, setToastMessage, updateTabContent])

  const handleDeleteProperty = useCallback(async (path: string, key: string, options?: FrontmatterOpOptions) => {
    const canFlush = await flushBeforeNoteMutation(path, config.flushBeforeNoteMutation)
    if (!canFlush) return

    const newContent = await runFrontmatterOp('delete', path, key, undefined, options)
    if (!applyFrontmatterCallbacks({ config, path, newContent })) return
    await notifyFrontmatterPersisted(config, key)
  }, [config, runFrontmatterOp])

  const handleAddProperty = useCallback(async (path: string, key: string, value: FrontmatterValue) => {
    const canFlush = await flushBeforeNoteMutation(path, config.flushBeforeNoteMutation)
    if (!canFlush) return

    const newContent = await runFrontmatterOp('update', path, key, value)
    if (!applyFrontmatterCallbacks({ config, path, newContent })) return
    await notifyFrontmatterPersisted(config, key)
  }, [config, runFrontmatterOp])

  return {
    handleUpdateFrontmatter,
    handleDeleteProperty,
    handleAddProperty,
  }
}

export function useNoteActions(config: NoteActionsConfig) {
  const { entries, setToastMessage, updateEntry } = config
  const tabMgmt = useTabManagement(buildTabManagementOptions(config))
  const { setTabs, handleSelectNote, openTabWithContent, activeTabPathRef, handleSwitchTab } = tabMgmt
  useGitignoredVisibilityTabCleanup({
    activeTabPathRef,
    closeAllTabs: tabMgmt.closeAllTabs,
    setToastMessage,
  })

  const updateTabContent = useCallback((path: string, newContent: string) => {
    setTabs((prev) => prev.map((t) => notePathsMatch(t.entry.path, path) ? { ...t, content: newContent } : t))
  }, [setTabs])

  const creation = useNoteCreation(config, { openTabWithContent })
  const rename = useNoteRename(
    { entries, setToastMessage, reloadVault: config.reloadVault },
    { tabs: tabMgmt.tabs, setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
  )

  const handleNavigateWikilink = useCallback(
    (target: string) => navigateWikilink({ entries, target, selectNote: handleSelectNote }),
    [entries, handleSelectNote],
  )

  const runFrontmatterOp = useCallback(
    (op: 'update' | 'delete', path: string, key: string, value?: FrontmatterValue, options?: FrontmatterOpOptions) =>
      runFrontmatterAndApply({
        op,
        path,
        key,
        value,
        callbacks: { updateTab: updateTabContent, updateEntry, toast: setToastMessage, getEntry: (p) => findByNotePath(entries, p) },
        options,
      }),
    [updateTabContent, updateEntry, setToastMessage, entries],
  )
  const frontmatterActions = useFrontmatterActionHandlers({
    config,
    renameTabsRef: rename.tabsRef,
    setTabs,
    activeTabPathRef,
    handleSwitchTab,
    setToastMessage,
    updateTabContent,
    runFrontmatterOp,
  })

  return {
    ...tabMgmt,
    handleNavigateWikilink,
    handleCreateNote: creation.handleCreateNote,
    handleCreateNoteImmediate: creation.handleCreateNoteImmediate,
    handleCreateNoteForRelationship: creation.handleCreateNoteForRelationship,
    handleCreateType: creation.handleCreateType,
    createTypeEntrySilent: creation.createTypeEntrySilent,
    handleUpdateFrontmatter: frontmatterActions.handleUpdateFrontmatter,
    handleDeleteProperty: frontmatterActions.handleDeleteProperty,
    handleAddProperty: frontmatterActions.handleAddProperty,
    handleRenameNote: rename.handleRenameNote,
    handleRenameFilename: rename.handleRenameFilename,
    handleMoveNoteToFolder: rename.handleMoveNoteToFolder,
  }
}
