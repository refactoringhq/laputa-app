import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { VaultEntry, VaultPropertyValue } from '../types'
import type { FrontmatterValue } from '../components/Inspector'
import { cacheNoteContent, useTabManagement } from './useTabManagement'
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
import type { VaultOption } from '../components/status-bar/types'
import { canonicalFrontmatterKey } from '../utils/systemMetadata'
import { useActionHistory, type ActionHistoryController, type ActionHistoryEntry } from './useActionHistory'

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
  defaultWorkspacePath?: string | null
  vaults?: readonly VaultOption[]
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
  onFrontmatterPersisted?: () => void | Promise<void>
  /** Called for note-action owned disk writes so file watchers can ignore app-originated changes. */
  onInternalVaultWrite?: (path: string) => void
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

type RenamedPathMap = Map<string, string>

interface RenamedPathLookup {
  renamedPaths: RenamedPathMap
  path: string
}

interface RenamedPathUpdate {
  renamedPaths: RenamedPathMap
  oldPath: string
  newPath: string
}

interface FrontmatterSnapshotMutation {
  entries: readonly VaultEntry[]
  path: string
  key: string
}

function resolveLatestNotePath({ renamedPaths, path }: RenamedPathLookup): string {
  let current = path
  const visited = new Set<string>()

  while (!visited.has(current)) {
    visited.add(current)
    const next = renamedPaths.get(current)
    if (!next || next === current) return current
    current = next
  }

  return current
}

function trackRenamedNotePath({ renamedPaths, oldPath, newPath }: RenamedPathUpdate): void {
  if (notePathsMatch(oldPath, newPath)) return
  const latestPath = resolveLatestNotePath({ renamedPaths, path: newPath })
  for (const [trackedOldPath, trackedNewPath] of renamedPaths) {
    if (trackedNewPath === oldPath) renamedPaths.set(trackedOldPath, latestPath)
  }
  renamedPaths.set(oldPath, latestPath)
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
  onInternalVaultWrite?: (path: string) => void
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

interface ApplyTitleRenamePathChangeParams {
  deps: TitleRenameDeps
  newPath: string
  newTitle: string
  path: string
}

function tabPathsExceptRenamed(
  tabs: { entry: VaultEntry; content: string }[],
  path: string,
  newPath: string,
): string[] {
  return tabs
    .filter(t => !notePathsMatch(t.entry.path, path) && !notePathsMatch(t.entry.path, newPath))
    .map(t => t.entry.path)
}

async function applyTitleRenamePathChange({
  deps,
  newPath,
  newTitle,
  path,
}: ApplyTitleRenamePathChangeParams): Promise<void> {
  const newFilename = notePathFilename(newPath)
  deps.onInternalVaultWrite?.(newPath)
  deps.onPathRenamed?.(path, newPath)
  deps.replaceEntry?.(path, { path: newPath, filename: newFilename, title: newTitle } as Partial<VaultEntry> & { path: string })
  const newContent = await loadNoteContent({ path: newPath })
  deps.setTabs(prev => prev.map(t => notePathsMatch(t.entry.path, path)
    ? { entry: { ...t.entry, path: newPath, filename: newFilename, title: newTitle }, content: newContent }
    : t))
  if (notePathsMatch(deps.activeTabPathRef.current, path)) deps.handleSwitchTab(newPath)
  await reloadTabsAfterRename({
    tabPaths: tabPathsExceptRenamed(deps.tabsRef.current, path, newPath),
    updateTabContent: deps.updateTabContent,
  })
}

async function renameAfterTitleChange({ path, newTitle, deps }: RenameAfterTitleChangeParams): Promise<void> {
  const oldTitle = deps.tabsRef.current.find(t => notePathsMatch(t.entry.path, path))?.entry.title
  deps.onInternalVaultWrite?.(path)
  const result = await performRename({ path, newTitle, vaultPath: deps.vaultPath, oldTitle })
  if (!notePathsMatch(result.new_path, path)) {
    await applyTitleRenamePathChange({ path, newPath: result.new_path, newTitle, deps })
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
  await config.onFrontmatterPersisted?.()
  if (isTypeFieldKey(key)) {
    await config.onTypeStateChanged?.()
  }
}

interface NavigateWikilinkParams {
  entries: VaultEntry[]
  sourceEntry?: VaultEntry
  target: string
  selectNote: (entry: VaultEntry) => void
}

function navigateWikilink({ entries, sourceEntry, target, selectNote }: NavigateWikilinkParams): void {
  const found = resolveEntry(entries, target, sourceEntry)
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

function activePathGuardAllowsMutation(
  path: string,
  activeTabPathRef: MutableRefObject<string | null>,
  options?: FrontmatterOpOptions,
): boolean {
  const requiredPath = options?.requireActivePath
  if (!requiredPath) return true
  return notePathsMatch(path, requiredPath) && notePathsMatch(activeTabPathRef.current, requiredPath)
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
  runFrontmatterOp: RunFrontmatterOp
  value: FrontmatterValue
}

type RunFrontmatterOp = (
  op: 'update' | 'delete',
  path: string,
  key: string,
  value?: FrontmatterValue,
  options?: FrontmatterOpOptions,
) => Promise<string | undefined>

async function updateFrontmatterAndMaybeRename({
  config,
  deps,
  key,
  options,
  path,
  runFrontmatterOp,
  value,
}: UpdateFrontmatterAndMaybeRenameParams): Promise<boolean> {
  if (!activePathGuardAllowsMutation(path, deps.activeTabPathRef, options)) return false
  const canFlush = await flushBeforeNoteMutation(path, config.flushBeforeNoteMutation)
  if (!canFlush) return false
  if (!activePathGuardAllowsMutation(path, deps.activeTabPathRef, options)) return false

  config.onInternalVaultWrite?.(path)
  const newContent = await runFrontmatterOp('update', path, key, value, options)
  if (!applyFrontmatterCallbacks({ config, path, newContent })) return false

  await maybeRenameAfterFrontmatterUpdate({ path, key, value, deps })
  await notifyFrontmatterPersisted(config, key)
  return true
}

interface FrontmatterSnapshot {
  exists: boolean
  value?: FrontmatterValue
}

const ABSENT_FRONTMATTER: FrontmatterSnapshot = { exists: false }

function presentFrontmatter(value: FrontmatterValue | undefined): FrontmatterSnapshot {
  return value === undefined ? ABSENT_FRONTMATTER : { exists: true, value }
}

function propertyFrontmatterValue(value: VaultPropertyValue | undefined): FrontmatterValue | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value)) return value.map(String)
  return value
}

function presentStringList(values: readonly string[]): FrontmatterSnapshot {
  return values.length > 0 ? { exists: true, value: [...values] } : ABSENT_FRONTMATTER
}

function presentNullable(value: string | number | boolean | null | undefined): FrontmatterSnapshot {
  return value === null || value === undefined ? ABSENT_FRONTMATTER : { exists: true, value }
}

function presentNonEmptyString(value: string): FrontmatterSnapshot {
  return value ? { exists: true, value } : ABSENT_FRONTMATTER
}

function presentBooleanFlag(value: boolean): FrontmatterSnapshot {
  return value ? { exists: true, value: true } : ABSENT_FRONTMATTER
}

type FrontmatterSnapshotReader = (entry: VaultEntry) => FrontmatterSnapshot

const ENTRY_FRONTMATTER_SNAPSHOT_READERS = new Map<string, FrontmatterSnapshotReader>([
  ['title', (entry) => presentNonEmptyString(entry.title)],
  ['type', (entry) => presentNullable(entry.isA)],
  ['is_a', (entry) => presentNullable(entry.isA)],
  ['status', (entry) => presentNullable(entry.status)],
  ['color', (entry) => presentNullable(entry.color)],
  ['_icon', (entry) => presentNullable(entry.icon)],
  ['_sidebar_label', (entry) => presentNullable(entry.sidebarLabel)],
  ['aliases', (entry) => presentStringList(entry.aliases)],
  ['belongs_to', (entry) => presentStringList(entry.belongsTo)],
  ['related_to', (entry) => presentStringList(entry.relatedTo)],
  ['_archived', (entry) => presentBooleanFlag(entry.archived)],
  ['_order', (entry) => presentNullable(entry.order)],
  ['template', (entry) => presentNullable(entry.template)],
  ['_sort', (entry) => presentNullable(entry.sort)],
  ['view', (entry) => presentNullable(entry.view)],
  ['_width', (entry) => presentNullable(entry.noteWidth)],
  ['visible', (entry) => entry.visible === false ? { exists: true, value: false } : ABSENT_FRONTMATTER],
  ['_organized', (entry) => presentBooleanFlag(entry.organized)],
  ['_favorite', (entry) => presentBooleanFlag(entry.favorite)],
  ['_favorite_index', (entry) => presentNullable(entry.favoriteIndex)],
  ['_list_properties_display', (entry) => presentStringList(entry.listPropertiesDisplay)],
])

function frontmatterSnapshotFromProperties(
  properties: VaultEntry['properties'],
  canonicalKey: string,
): FrontmatterSnapshot {
  const propertyKey = Object.keys(properties).find((candidate) => canonicalFrontmatterKey(candidate) === canonicalKey)
  return presentFrontmatter(propertyFrontmatterValue(propertyKey ? properties[propertyKey] : undefined))
}

function frontmatterSnapshotFromEntry(entry: VaultEntry, key: string): FrontmatterSnapshot {
  const canonicalKey = canonicalFrontmatterKey(key)
  const readSnapshot = ENTRY_FRONTMATTER_SNAPSHOT_READERS.get(canonicalKey)
  return readSnapshot ? readSnapshot(entry) : frontmatterSnapshotFromProperties(entry.properties, canonicalKey)
}

function frontmatterSnapshotForMutation({ entries, path, key }: FrontmatterSnapshotMutation): FrontmatterSnapshot {
  const entry = findByNotePath(entries, path)
  return entry ? frontmatterSnapshotFromEntry(entry, key) : ABSENT_FRONTMATTER
}

function shouldRecordFrontmatterHistory(actionHistory: ActionHistoryController, options?: FrontmatterOpOptions): boolean {
  return !options?.silent && !actionHistory.isReplaying()
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

function handleMissingFrontmatterTarget({
  activeTabPathRef,
  closeAllTabs,
  entries,
  path,
  reloadVault,
  setToastMessage,
}: {
  activeTabPathRef: MutableRefObject<string | null>
  closeAllTabs: () => void
  entries: VaultEntry[]
  path: string
  reloadVault?: () => Promise<unknown>
  setToastMessage: NoteActionsConfig['setToastMessage']
}) {
  const entry = findByNotePath(entries, path)
  const label = entry ? entryDisplayLabel(entry) : notePathFilename(path) || 'Note'
  if (notePathsMatch(activeTabPathRef.current, path)) closeAllTabs()
  setToastMessage(`"${label}" could not be opened because its file is missing or moved.`)
  void reloadVault?.()
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
  onPathRenamed,
  resolvePath,
  renameTabsRef,
  setTabs,
  activeTabPathRef,
  handleSwitchTab,
  setToastMessage,
  updateTabContent,
  runFrontmatterOp,
  actionHistory,
}: {
  config: NoteActionsConfig
  onPathRenamed?: (oldPath: string, newPath: string) => void
  resolvePath: (path: string) => string
  renameTabsRef: TitleRenameDeps['tabsRef']
  setTabs: React.Dispatch<React.SetStateAction<{ entry: VaultEntry; content: string }[]>>
  activeTabPathRef: React.MutableRefObject<string | null>
  handleSwitchTab: (path: string) => void
  setToastMessage: (msg: string | null) => void
  updateTabContent: (path: string, newContent: string) => void
  runFrontmatterOp: RunFrontmatterOp
  actionHistory: ActionHistoryController
}) {
  const applySnapshot = useCallback(async (
    path: string,
    key: string,
    snapshot: FrontmatterSnapshot,
    options?: FrontmatterOpOptions,
  ) => {
    const currentPath = resolvePath(path)
    if (snapshot.exists) {
      await updateFrontmatterAndMaybeRename({
        config,
        deps: {
          vaultPath: config.vaultPath,
          tabsRef: renameTabsRef,
          reloadVault: config.reloadVault,
          replaceEntry: config.replaceEntry,
          onPathRenamed,
          setTabs,
          activeTabPathRef,
          handleSwitchTab,
          setToastMessage,
          updateTabContent,
          onInternalVaultWrite: config.onInternalVaultWrite,
        },
        path: currentPath,
        key,
        value: snapshot.value ?? null,
        options: { ...options, silent: true },
        runFrontmatterOp,
      })
      return
    }

    config.onInternalVaultWrite?.(currentPath)
    const newContent = await runFrontmatterOp('delete', currentPath, key, undefined, { ...options, silent: true })
    if (!applyFrontmatterCallbacks({ config, path: currentPath, newContent })) return
    await notifyFrontmatterPersisted(config, key)
  }, [
    activeTabPathRef,
    config,
    handleSwitchTab,
    onPathRenamed,
    renameTabsRef,
    resolvePath,
    runFrontmatterOp,
    setTabs,
    setToastMessage,
    updateTabContent,
  ])

  const recordFrontmatterHistory = useCallback((
    path: string,
    key: string,
    before: FrontmatterSnapshot,
    after: FrontmatterSnapshot,
    label: string,
    options?: FrontmatterOpOptions,
  ) => {
    actionHistory.record({
      label,
      path,
      undo: () => applySnapshot(path, key, before, options),
      redo: () => applySnapshot(path, key, after, options),
    })
  }, [actionHistory, applySnapshot])

  const handleUpdateFrontmatter = useCallback(async (
    path: string,
    key: string,
    value: FrontmatterValue,
    options?: FrontmatterOpOptions,
  ) => {
    const currentPath = resolvePath(path)
    const shouldRecordHistory = shouldRecordFrontmatterHistory(actionHistory, options)
    const before = shouldRecordHistory
      ? frontmatterSnapshotForMutation({ entries: config.entries, path: currentPath, key })
      : ABSENT_FRONTMATTER
    const updated = await updateFrontmatterAndMaybeRename({
      config,
      deps: {
        vaultPath: config.vaultPath,
        tabsRef: renameTabsRef,
        reloadVault: config.reloadVault,
        replaceEntry: config.replaceEntry,
        onPathRenamed,
        setTabs,
        activeTabPathRef,
        handleSwitchTab,
        setToastMessage,
        updateTabContent,
        onInternalVaultWrite: config.onInternalVaultWrite,
      },
      path: currentPath,
      key,
      value,
      options,
      runFrontmatterOp,
    })
    if (updated && shouldRecordHistory) {
      recordFrontmatterHistory(currentPath, key, before, { exists: true, value }, `Update ${key}`, options)
    }
  }, [actionHistory, activeTabPathRef, config, handleSwitchTab, onPathRenamed, recordFrontmatterHistory, renameTabsRef, resolvePath, runFrontmatterOp, setTabs, setToastMessage, updateTabContent])

  const handleDeleteProperty = useCallback(async (path: string, key: string, options?: FrontmatterOpOptions) => {
    const currentPath = resolvePath(path)
    const shouldRecordHistory = shouldRecordFrontmatterHistory(actionHistory, options)
    const before = shouldRecordHistory
      ? frontmatterSnapshotForMutation({ entries: config.entries, path: currentPath, key })
      : ABSENT_FRONTMATTER
    if (!activePathGuardAllowsMutation(currentPath, activeTabPathRef, options)) return
    const canFlush = await flushBeforeNoteMutation(currentPath, config.flushBeforeNoteMutation)
    if (!canFlush) return
    if (!activePathGuardAllowsMutation(currentPath, activeTabPathRef, options)) return

    config.onInternalVaultWrite?.(currentPath)
    const newContent = await runFrontmatterOp('delete', currentPath, key, undefined, options)
    if (!applyFrontmatterCallbacks({ config, path: currentPath, newContent })) return
    await notifyFrontmatterPersisted(config, key)
    if (shouldRecordHistory) {
      recordFrontmatterHistory(currentPath, key, before, ABSENT_FRONTMATTER, `Delete ${key}`, options)
    }
  }, [actionHistory, activeTabPathRef, config, recordFrontmatterHistory, resolvePath, runFrontmatterOp])

  const handleAddProperty = useCallback(async (path: string, key: string, value: FrontmatterValue, options?: FrontmatterOpOptions) => {
    const currentPath = resolvePath(path)
    const shouldRecordHistory = shouldRecordFrontmatterHistory(actionHistory, options)
    const before = shouldRecordHistory
      ? frontmatterSnapshotForMutation({ entries: config.entries, path: currentPath, key })
      : ABSENT_FRONTMATTER
    if (!activePathGuardAllowsMutation(currentPath, activeTabPathRef, options)) return
    const canFlush = await flushBeforeNoteMutation(currentPath, config.flushBeforeNoteMutation)
    if (!canFlush) return
    if (!activePathGuardAllowsMutation(currentPath, activeTabPathRef, options)) return

    config.onInternalVaultWrite?.(currentPath)
    const newContent = await runFrontmatterOp('update', currentPath, key, value, options)
    if (!applyFrontmatterCallbacks({ config, path: currentPath, newContent })) return
    await notifyFrontmatterPersisted(config, key)
    if (shouldRecordHistory) {
      recordFrontmatterHistory(currentPath, key, before, { exists: true, value }, `Update ${key}`, options)
    }
  }, [actionHistory, activeTabPathRef, config, recordFrontmatterHistory, resolvePath, runFrontmatterOp])

  return {
    handleUpdateFrontmatter,
    handleDeleteProperty,
    handleAddProperty,
  }
}

function useFrontmatterRunner({
  activeTabPathRef,
  closeAllTabs,
  entries,
  reloadVault,
  setToastMessage,
  updateEntry,
  updateTabContent,
}: {
  activeTabPathRef: MutableRefObject<string | null>
  closeAllTabs: () => void
  entries: VaultEntry[]
  reloadVault?: () => Promise<unknown>
  setToastMessage: NoteActionsConfig['setToastMessage']
  updateEntry: NoteActionsConfig['updateEntry']
  updateTabContent: (path: string, newContent: string) => void
}): RunFrontmatterOp {
  return useCallback(
    (op, path, key, value, options) => runFrontmatterAndApply({
      op,
      path,
      key,
      value,
      callbacks: {
        cacheContent: cacheNoteContent,
        updateTab: updateTabContent,
        updateEntry,
        toast: setToastMessage,
        getEntry: (p) => findByNotePath(entries, p),
        onMissingNotePath: (p) => handleMissingFrontmatterTarget({
          activeTabPathRef,
          closeAllTabs,
          entries,
          path: p,
          reloadVault,
          setToastMessage,
        }),
        shouldApply: (p) => activePathGuardAllowsMutation(p, activeTabPathRef, options),
      },
      options,
    }),
    [activeTabPathRef, closeAllTabs, entries, reloadVault, setToastMessage, updateEntry, updateTabContent],
  )
}

function useRenamedNotePathResolver(onPathRenamed?: (oldPath: string, newPath: string) => void) {
  const renamedPathsRef = useRef<RenamedPathMap>(new Map())
  const handlePathRenamed = useCallback((oldPath: string, newPath: string) => {
    trackRenamedNotePath({ renamedPaths: renamedPathsRef.current, oldPath, newPath })
    onPathRenamed?.(oldPath, newPath)
  }, [onPathRenamed])
  const resolveActionPath = useCallback((path: string) => resolveLatestNotePath({
    renamedPaths: renamedPathsRef.current,
    path,
  }), [])

  return { handlePathRenamed, resolveActionPath }
}

interface NoteActionsResultParts {
  actionHistory: ActionHistoryController
  creation: ReturnType<typeof useNoteCreation>
  frontmatterActions: ReturnType<typeof useFrontmatterActionHandlers>
  handleNavigateWikilink: (target: string) => void
  rename: ReturnType<typeof useNoteRename>
  tabMgmt: ReturnType<typeof useTabManagement>
}

function buildNoteActionsResult({
  actionHistory,
  creation,
  frontmatterActions,
  handleNavigateWikilink,
  rename,
  tabMgmt,
}: NoteActionsResultParts) {
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
    handleMoveNoteToWorkspace: rename.handleMoveNoteToWorkspace,
    actionHistory,
    canUndo: actionHistory.canUndo,
    canRedo: actionHistory.canRedo,
    undoLabel: actionHistory.undoLabel,
    redoLabel: actionHistory.redoLabel,
    handleUndo: actionHistory.undo,
    handleRedo: actionHistory.redo,
  }
}

export function useNoteActions(config: NoteActionsConfig) {
  const { entries, setToastMessage, updateEntry } = config
  const { handlePathRenamed, resolveActionPath } = useRenamedNotePathResolver(config.onPathRenamed)
  const tabMgmt = useTabManagement(buildTabManagementOptions(config))
  const { setTabs, handleSelectNote, openTabWithContent, activeTabPathRef, handleSwitchTab } = tabMgmt
  const revealActionHistoryTarget = useCallback(async (item: ActionHistoryEntry) => {
    const { path } = item
    if (!path) return
    if (activeTabPathRef.current === path) return
    const entry = entries.find((candidate) => notePathsMatch(candidate.path, path))
    if (!entry) {
      setToastMessage('Cannot undo action because the note is no longer available')
      throw new Error(`Action history target is unavailable: ${path}`)
    }
    await handleSelectNote(entry)
  }, [activeTabPathRef, entries, handleSelectNote, setToastMessage])
  const actionHistory = useActionHistory({
    onRevealTarget: revealActionHistoryTarget,
    onToast: setToastMessage,
  })
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
    { entries, setToastMessage, reloadVault: config.reloadVault, onPathRenamed: handlePathRenamed },
    { tabs: tabMgmt.tabs, setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
  )

  const handleNavigateWikilink = useCallback(
    (target: string) => navigateWikilink({
      entries,
      sourceEntry: tabMgmt.tabs.find((tab) => notePathsMatch(tab.entry.path, tabMgmt.activeTabPath))?.entry,
      target,
      selectNote: handleSelectNote,
    }),
    [entries, handleSelectNote, tabMgmt.activeTabPath, tabMgmt.tabs],
  )

  const runFrontmatterOp = useFrontmatterRunner({
    activeTabPathRef,
    closeAllTabs: tabMgmt.closeAllTabs,
    entries,
    reloadVault: config.reloadVault,
    setToastMessage,
    updateEntry,
    updateTabContent,
  })
  const frontmatterActions = useFrontmatterActionHandlers({
    config,
    onPathRenamed: handlePathRenamed,
    resolvePath: resolveActionPath,
    renameTabsRef: rename.tabsRef,
    setTabs,
    activeTabPathRef,
    handleSwitchTab,
    setToastMessage,
    updateTabContent,
    runFrontmatterOp,
    actionHistory,
  })

  return buildNoteActionsResult({
    actionHistory,
    creation,
    frontmatterActions,
    handleNavigateWikilink,
    rename,
    tabMgmt,
  })
}
