import { useCallback, useMemo } from 'react'
import type { VaultEntry } from '../types'
import { isMissingFrontmatterTargetError, type FrontmatterOpOptions } from './frontmatterOps'
import { trackEvent } from '../lib/telemetry'
import { findTypeDefinition, normalizeTypeName } from '../utils/typeDefinitions'
import type { ActionHistoryController, ActionHistoryEntry } from './useActionHistory'

interface EntryActionsConfig {
  entries: VaultEntry[]
  updateEntry: (path: string, updates: Partial<VaultEntry>) => void
  handleUpdateFrontmatter: (path: string, key: string, value: string | number | boolean | string[], options?: FrontmatterOpOptions) => Promise<void>
  handleDeleteProperty: (path: string, key: string, options?: FrontmatterOpOptions) => Promise<void>
  setToastMessage: (msg: string | null) => void
  createTypeEntry: (typeName: string) => Promise<VaultEntry>
  renameTypeEntry?: (typeEntry: VaultEntry, newTypeName: string) => Promise<void>
  onFrontmatterPersisted?: () => void
  /** Called before trash/archive to flush unsaved editor content to disk. */
  onBeforeAction?: (path: string) => Promise<void>
  actionHistory?: ActionHistoryController
}

type ArchiveActionDeps = Pick<EntryActionsConfig,
  'entries' | 'updateEntry' | 'handleUpdateFrontmatter' | 'handleDeleteProperty' | 'setToastMessage' | 'onFrontmatterPersisted' | 'onBeforeAction' | 'actionHistory'
>

type TypeActionDeps = Pick<EntryActionsConfig,
  'entries' | 'updateEntry' | 'handleUpdateFrontmatter' | 'handleDeleteProperty' | 'createTypeEntry' | 'renameTypeEntry' | 'onFrontmatterPersisted'
>

type EntryStateActionDeps = Pick<EntryActionsConfig,
  'entries' | 'updateEntry' | 'handleUpdateFrontmatter' | 'handleDeleteProperty' | 'setToastMessage' | 'onFrontmatterPersisted' | 'actionHistory'
>
type FavoriteActionDeps = Pick<EntryActionsConfig,
  'updateEntry' | 'handleUpdateFrontmatter' | 'handleDeleteProperty' | 'setToastMessage' | 'onFrontmatterPersisted' | 'actionHistory'
>

type ReorderFavoritesDeps = Pick<EntryActionsConfig, 'updateEntry' | 'handleUpdateFrontmatter' | 'onFrontmatterPersisted'>
type FavoriteState = Pick<VaultEntry, 'favorite' | 'favoriteIndex'>
type FavoriteReplay = (path: string, favorite: boolean, favoriteIndex: number | null) => Promise<void>

interface ArchiveTransition {
  path: string
  before: boolean
  after: boolean
  eventName: string
  label: string
  toast: string
  rollbackToast: string
  rollbackLog: string
}

interface FavoriteTransition {
  path: string
  action: 'favorite' | 'unfavorite'
  eventName: string
  label: string
  before: FavoriteState
  after: FavoriteState
  rollback: FavoriteState
  rollbackToast: string
}

interface StateTransitionInput {
  path: string
  before: boolean
  after: boolean
}

interface CustomizeTypeArgs {
  typeName: string
  icon: string
  color: string
}

interface ReorderTypeSectionsArgs {
  orderedTypes: { typeName: string; order: number }[]
}

interface UpdateTypeTemplateArgs {
  typeName: string
  template: string
}

interface RenameTypeSectionArgs {
  typeName: string
  label: string
}

interface TypeNameComparison {
  left: string
  right: string
}

interface TypeEntryQuery {
  entries: VaultEntry[]
  typeEntry: VaultEntry
  typeName: string
}

interface TypeRenameConflictQuery {
  entries: VaultEntry[]
  typeEntry: VaultEntry
  newTypeName: string
}

interface RenameAssignedEntriesInput {
  deps: TypeActionDeps
  entries: VaultEntry[]
  newTypeName: string
}

interface RenameTypeNameInput {
  deps: TypeActionDeps
  typeEntry: VaultEntry
  oldTypeName: string
  newTypeName: string
}

interface RenameSidebarLabelInput {
  deps: TypeActionDeps
  typeEntry: VaultEntry
  label: string
}

function logOptimisticRollback(label: string, error: unknown): void {
  if (isMissingFrontmatterTargetError(error)) {
    console.warn(label, error)
    return
  }
  console.error(label, error)
}

function recordEntryActionHistory(
  actionHistory: ActionHistoryController | undefined,
  entry: ActionHistoryEntry,
): (() => void) | void {
  return actionHistory?.record(entry)
}

async function persistBooleanProperty(
  deps: Pick<EntryStateActionDeps, 'handleUpdateFrontmatter' | 'handleDeleteProperty' | 'onFrontmatterPersisted'>,
  path: string,
  key: string,
  enabled: boolean,
): Promise<void> {
  if (enabled) {
    await deps.handleUpdateFrontmatter(path, key, true, { silent: true })
  } else {
    await deps.handleDeleteProperty(path, key, { silent: true })
  }
  deps.onFrontmatterPersisted?.()
}

async function applyEntryBooleanState(
  deps: Pick<EntryStateActionDeps, 'updateEntry' | 'handleUpdateFrontmatter' | 'handleDeleteProperty' | 'onFrontmatterPersisted'>,
  path: string,
  key: string,
  patchKey: keyof Pick<VaultEntry, 'archived' | 'organized'>,
  enabled: boolean,
): Promise<void> {
  await persistBooleanProperty(deps, path, key, enabled)
  deps.updateEntry(path, { [patchKey]: enabled })
}

function recordBooleanStateHistory(
  deps: Pick<EntryStateActionDeps, 'actionHistory' | 'updateEntry' | 'handleUpdateFrontmatter' | 'handleDeleteProperty' | 'onFrontmatterPersisted'>,
  params: {
    id: string
    label: string
    path: string
    key: string
    patchKey: keyof Pick<VaultEntry, 'archived' | 'organized'>
    before: boolean
    after: boolean
    waitForPersist?: Promise<void>
  },
): (() => void) | void {
  const applyState = async (enabled: boolean) => {
    await params.waitForPersist
    await applyEntryBooleanState(deps, params.path, params.key, params.patchKey, enabled)
  }

  return recordEntryActionHistory(deps.actionHistory, {
    id: params.id,
    label: params.label,
    path: params.path,
    undo: () => applyState(params.before),
    redo: () => applyState(params.after),
  })
}

async function findOrCreateType(
  deps: Pick<TypeActionDeps, 'entries' | 'createTypeEntry'>,
  typeName: string,
  typeEntryPath?: string,
): Promise<VaultEntry | null> {
  const existingType = findTypeDefinition({ entries: deps.entries, type: typeName, typeEntryPath })
  if (existingType) return existingType
  if (typeEntryPath) return null
  try {
    return await deps.createTypeEntry(typeName)
  } catch {
    return null
  }
}

async function customizeTypeEntry(deps: TypeActionDeps, args: CustomizeTypeArgs): Promise<void> {
  const typeEntry = await findOrCreateType(deps, args.typeName)
  if (!typeEntry) return
  await deps.handleUpdateFrontmatter(typeEntry.path, 'icon', args.icon)
  await deps.handleUpdateFrontmatter(typeEntry.path, 'color', args.color)
  deps.updateEntry(typeEntry.path, { icon: args.icon, color: args.color })
  deps.onFrontmatterPersisted?.()
}

async function reorderTypeSections(deps: TypeActionDeps, args: ReorderTypeSectionsArgs): Promise<void> {
  for (const { typeName, order } of args.orderedTypes) {
    const typeEntry = await findOrCreateType(deps, typeName)
    if (!typeEntry) return
    await deps.handleUpdateFrontmatter(typeEntry.path, 'order', order)
    deps.updateEntry(typeEntry.path, { order })
  }
  deps.onFrontmatterPersisted?.()
}

async function updateTypeTemplate(deps: TypeActionDeps, args: UpdateTypeTemplateArgs): Promise<void> {
  const typeEntry = await findOrCreateType(deps, args.typeName)
  if (!typeEntry) return
  await deps.handleUpdateFrontmatter(typeEntry.path, 'template', args.template)
  deps.updateEntry(typeEntry.path, { template: args.template || null })
  deps.onFrontmatterPersisted?.()
}

function typeNamesMatch({ left, right }: TypeNameComparison): boolean {
  return normalizeTypeName({ type: left }) === normalizeTypeName({ type: right })
}

function assignedEntriesForType({ entries, typeEntry, typeName }: TypeEntryQuery): VaultEntry[] {
  return entries.filter((entry) => (
    entry.path !== typeEntry.path
    && entry.isA !== null
    && entry.isA !== 'Type'
    && typeNamesMatch({ left: entry.isA, right: typeName })
  ))
}

function hasTypeRenameConflict({ entries, typeEntry, newTypeName }: TypeRenameConflictQuery): boolean {
  return entries.some((entry) => (
    entry.path !== typeEntry.path
    && entry.isA === 'Type'
    && typeNamesMatch({ left: entry.title, right: newTypeName })
  ))
}

async function clearSidebarLabel(deps: TypeActionDeps, typeEntry: VaultEntry): Promise<void> {
  if (!typeEntry.sidebarLabel) return
  await deps.handleDeleteProperty(typeEntry.path, 'sidebar label')
}

async function renameAssignedEntries({ deps, entries, newTypeName }: RenameAssignedEntriesInput): Promise<void> {
  for (const entry of entries) {
    await deps.handleUpdateFrontmatter(entry.path, 'type', newTypeName)
  }
}

async function renameTypeName({ deps, typeEntry, oldTypeName, newTypeName }: RenameTypeNameInput): Promise<void> {
  if (!newTypeName || typeNamesMatch({ left: oldTypeName, right: newTypeName })) return
  if (!deps.renameTypeEntry || hasTypeRenameConflict({ entries: deps.entries, typeEntry, newTypeName })) return

  const assignedEntries = assignedEntriesForType({ entries: deps.entries, typeEntry, typeName: oldTypeName })
  await clearSidebarLabel(deps, typeEntry)
  await renameAssignedEntries({ deps, entries: assignedEntries, newTypeName })
  await deps.renameTypeEntry(typeEntry, newTypeName)
  trackEvent('sidebar_type_renamed', { affected_notes: assignedEntries.length })
  deps.onFrontmatterPersisted?.()
}

async function renameTypeSidebarLabel({ deps, typeEntry, label }: RenameSidebarLabelInput): Promise<void> {
  if (label) {
    await deps.handleUpdateFrontmatter(typeEntry.path, 'sidebar label', label)
  } else {
    await deps.handleDeleteProperty(typeEntry.path, 'sidebar label')
  }
  deps.updateEntry(typeEntry.path, { sidebarLabel: label || null })
  deps.onFrontmatterPersisted?.()
}

async function renameTypeSection(deps: TypeActionDeps, args: RenameTypeSectionArgs): Promise<void> {
  const typeEntry = await findOrCreateType(deps, args.typeName)
  if (!typeEntry) return
  const trimmed = args.label.trim()
  if (deps.renameTypeEntry) {
    await renameTypeName({ deps, typeEntry, oldTypeName: args.typeName, newTypeName: trimmed })
    return
  }
  await renameTypeSidebarLabel({ deps, typeEntry, label: trimmed })
}

async function toggleTypeVisibility(deps: TypeActionDeps, typeName: string, typeEntryPath?: string): Promise<void> {
  const typeEntry = await findOrCreateType(deps, typeName, typeEntryPath)
  if (!typeEntry) return
  if (typeEntry.visible === false) {
    await deps.handleDeleteProperty(typeEntry.path, 'visible')
    deps.updateEntry(typeEntry.path, { visible: null })
  } else {
    await deps.handleUpdateFrontmatter(typeEntry.path, 'visible', false)
    deps.updateEntry(typeEntry.path, { visible: false })
  }
  deps.onFrontmatterPersisted?.()
}

function useArchiveActions({
  entries,
  updateEntry,
  handleUpdateFrontmatter,
  handleDeleteProperty,
  setToastMessage,
  onFrontmatterPersisted,
  onBeforeAction,
  actionHistory,
}: ArchiveActionDeps) {
  const handleArchiveNote = useCallback((path: string) => archiveNote({
    entries,
    updateEntry,
    handleUpdateFrontmatter,
    handleDeleteProperty,
    setToastMessage,
    onFrontmatterPersisted,
    onBeforeAction,
    actionHistory,
  }, path), [
    actionHistory,
    entries,
    handleDeleteProperty,
    handleUpdateFrontmatter,
    onBeforeAction,
    onFrontmatterPersisted,
    setToastMessage,
    updateEntry,
  ])
  const handleUnarchiveNote = useCallback((path: string) => unarchiveNote({
    entries,
    updateEntry,
    handleUpdateFrontmatter,
    handleDeleteProperty,
    setToastMessage,
    onFrontmatterPersisted,
    onBeforeAction,
    actionHistory,
  }, path), [
    actionHistory,
    entries,
    handleDeleteProperty,
    handleUpdateFrontmatter,
    onBeforeAction,
    onFrontmatterPersisted,
    setToastMessage,
    updateEntry,
  ])

  return { handleArchiveNote, handleUnarchiveNote }
}

async function archiveNote(deps: ArchiveActionDeps, path: string): Promise<void> {
  const entry = deps.entries.find((candidate) => candidate.path === path)
  await deps.onBeforeAction?.(path)
  await runArchiveTransition(deps, createArchiveTransition({ path, before: entry?.archived ?? false, after: true }))
}

async function unarchiveNote(deps: ArchiveActionDeps, path: string): Promise<void> {
  const entry = deps.entries.find((candidate) => candidate.path === path)
  await runArchiveTransition(deps, createArchiveTransition({ path, before: entry?.archived ?? true, after: false }))
}

function createArchiveTransition(input: StateTransitionInput): ArchiveTransition {
  if (input.after) {
    return {
      path: input.path,
      before: input.before,
      after: input.after,
      eventName: 'note_archived',
      label: 'Archive Note',
      toast: 'Note archived',
      rollbackToast: 'Failed to archive note — rolled back',
      rollbackLog: 'Optimistic archive rollback:',
    }
  }

  return {
    path: input.path,
    before: input.before,
    after: input.after,
    eventName: 'note_unarchived',
    label: 'Unarchive Note',
    toast: 'Note unarchived',
    rollbackToast: 'Failed to unarchive note — rolled back',
    rollbackLog: 'Optimistic unarchive rollback:',
  }
}

async function runArchiveTransition(deps: ArchiveActionDeps, transition: ArchiveTransition): Promise<void> {
  deps.updateEntry(transition.path, { archived: transition.after })
  trackEvent(transition.eventName)
  deps.setToastMessage(transition.toast)
  const persistPromise = persistBooleanProperty(deps, transition.path, '_archived', transition.after)
  const cleanupHistory = recordArchiveHistory(deps, transition, persistPromise)
  try {
    await persistPromise
  } catch (err) {
    cleanupHistory?.()
    deps.updateEntry(transition.path, { archived: transition.before })
    deps.setToastMessage(transition.rollbackToast)
    logOptimisticRollback(transition.rollbackLog, err)
  }
}

function recordArchiveHistory(
  deps: ArchiveActionDeps,
  transition: ArchiveTransition,
  waitForPersist: Promise<void>,
): (() => void) | void {
  return recordBooleanStateHistory(deps, {
    id: `${transition.after ? 'archive' : 'unarchive'}:${transition.path}:${Date.now()}`,
    label: transition.label,
    path: transition.path,
    key: '_archived',
    patchKey: 'archived',
    before: transition.before,
    after: transition.after,
    waitForPersist,
  })
}

function useTypeActions(deps: TypeActionDeps) {
  const {
    entries,
    updateEntry,
    handleUpdateFrontmatter,
    handleDeleteProperty,
    createTypeEntry,
    renameTypeEntry,
    onFrontmatterPersisted,
  } = deps
  const typeActionDeps = useMemo(() => ({
    entries,
    updateEntry,
    handleUpdateFrontmatter,
    handleDeleteProperty,
    createTypeEntry,
    renameTypeEntry,
    onFrontmatterPersisted,
  }), [entries, updateEntry, handleUpdateFrontmatter, handleDeleteProperty, createTypeEntry, renameTypeEntry, onFrontmatterPersisted])

  const handleCustomizeType = useCallback(async (typeName: string, icon: string, color: string) => {
    await customizeTypeEntry(typeActionDeps, { typeName, icon, color })
  }, [typeActionDeps])

  const handleReorderSections = useCallback(async (orderedTypes: { typeName: string; order: number }[]) => {
    await reorderTypeSections(typeActionDeps, { orderedTypes })
  }, [typeActionDeps])

  const handleUpdateTypeTemplate = useCallback(async (typeName: string, template: string) => {
    await updateTypeTemplate(typeActionDeps, { typeName, template })
  }, [typeActionDeps])

  const handleRenameSection = useCallback(async (typeName: string, label: string) => {
    await renameTypeSection(typeActionDeps, { typeName, label })
  }, [typeActionDeps])

  const handleToggleTypeVisibility = useCallback(async (typeName: string, typeEntryPath?: string) => {
    await toggleTypeVisibility(typeActionDeps, typeName, typeEntryPath)
  }, [typeActionDeps])

  return { handleCustomizeType, handleReorderSections, handleUpdateTypeTemplate, handleRenameSection, handleToggleTypeVisibility }
}

function useFavoriteAction({
  entries,
  updateEntry,
  handleUpdateFrontmatter,
  handleDeleteProperty,
  setToastMessage,
  onFrontmatterPersisted,
  actionHistory,
}: EntryStateActionDeps) {
  const applyFavoriteState = useCallback(async (path: string, favorite: boolean, favoriteIndex: number | null) => {
    if (favorite) {
      await handleUpdateFrontmatter(path, '_favorite', true, { silent: true })
      await handleUpdateFrontmatter(path, '_favorite_index', favoriteIndex ?? 1, { silent: true })
    } else {
      await handleDeleteProperty(path, '_favorite', { silent: true })
      await handleDeleteProperty(path, '_favorite_index', { silent: true })
    }
    onFrontmatterPersisted?.()
    updateEntry(path, { favorite, favoriteIndex })
  }, [handleDeleteProperty, handleUpdateFrontmatter, onFrontmatterPersisted, updateEntry])

  return useCallback(async (path: string) => {
    const entry = entries.find((candidate) => candidate.path === path)
    if (!entry) return
    const before = { favorite: entry.favorite, favoriteIndex: entry.favoriteIndex }
    if (entry.favorite) {
      await runFavoriteTransition({
        handleUpdateFrontmatter,
        handleDeleteProperty,
        onFrontmatterPersisted,
        updateEntry,
        setToastMessage,
        actionHistory,
      }, {
        path,
        action: 'unfavorite',
        eventName: 'note_unfavorited',
        label: 'Remove from Favorites',
        before,
        after: { favorite: false, favoriteIndex: null },
        rollback: { favorite: true, favoriteIndex: entry.favoriteIndex },
        rollbackToast: 'Failed to unfavorite — rolled back',
      }, applyFavoriteState)
      return
    }
    const newIndex = nextFavoriteIndex(entries)
    await runFavoriteTransition({
      handleUpdateFrontmatter,
      handleDeleteProperty,
      onFrontmatterPersisted,
      updateEntry,
      setToastMessage,
      actionHistory,
    }, {
      path,
      action: 'favorite',
      eventName: 'note_favorited',
      label: 'Add to Favorites',
      before,
      after: { favorite: true, favoriteIndex: newIndex },
      rollback: { favorite: false, favoriteIndex: null },
      rollbackToast: 'Failed to favorite — rolled back',
    }, applyFavoriteState)
  }, [applyFavoriteState, entries, updateEntry, handleUpdateFrontmatter, handleDeleteProperty, setToastMessage, onFrontmatterPersisted, actionHistory])
}

function nextFavoriteIndex(entries: VaultEntry[]): number {
  return entries
    .filter((candidate) => candidate.favorite)
    .reduce((max, candidate) => Math.max(max, candidate.favoriteIndex ?? 0), 0) + 1
}

async function runFavoriteTransition(
  deps: FavoriteActionDeps,
  transition: FavoriteTransition,
  applyFavoriteState: FavoriteReplay,
): Promise<void> {
  trackEvent(transition.eventName)
  deps.updateEntry(transition.path, transition.after)
  const persistPromise = persistFavoriteFrontmatter(deps, transition.path, transition.after)
  const cleanupHistory = recordFavoriteHistory(deps, transition, applyFavoriteState, persistPromise)
  try {
    await persistPromise
  } catch {
    cleanupHistory?.()
    deps.updateEntry(transition.path, transition.rollback)
    deps.setToastMessage(transition.rollbackToast)
  }
}

async function persistFavoriteFrontmatter(
  deps: FavoriteActionDeps,
  path: string,
  state: FavoriteState,
): Promise<void> {
  if (state.favorite) {
    await deps.handleUpdateFrontmatter(path, '_favorite', true, { silent: true })
    await deps.handleUpdateFrontmatter(path, '_favorite_index', state.favoriteIndex ?? 1, { silent: true })
  } else {
    await deps.handleDeleteProperty(path, '_favorite', { silent: true })
    await deps.handleDeleteProperty(path, '_favorite_index', { silent: true })
  }
  deps.onFrontmatterPersisted?.()
}

function recordFavoriteHistory(
  deps: Pick<EntryStateActionDeps, 'actionHistory'>,
  transition: FavoriteTransition,
  applyFavoriteState: FavoriteReplay,
  waitForPersist: Promise<void>,
): (() => void) | void {
  const replay = async (state: FavoriteState) => {
    await waitForPersist
    await applyFavoriteState(transition.path, state.favorite, state.favoriteIndex)
  }

  return recordEntryActionHistory(deps.actionHistory, {
    id: `${transition.action}:${transition.path}:${Date.now()}`,
    label: transition.label,
    path: transition.path,
    undo: () => replay(transition.before),
    redo: () => replay(transition.after),
  })
}

function useOrganizedAction({
  entries,
  updateEntry,
  handleUpdateFrontmatter,
  handleDeleteProperty,
  setToastMessage,
  onFrontmatterPersisted,
  actionHistory,
}: EntryStateActionDeps) {
  return useCallback(async (path: string) => {
    const entry = entries.find((candidate) => candidate.path === path)
    if (!entry) return false
    return runOrganizedTransition({
      entries,
      updateEntry,
      handleUpdateFrontmatter,
      handleDeleteProperty,
      setToastMessage,
      onFrontmatterPersisted,
      actionHistory,
    }, { path, before: entry.organized, after: !entry.organized })
  }, [
    entries,
    handleDeleteProperty,
    handleUpdateFrontmatter,
    onFrontmatterPersisted,
    actionHistory,
    setToastMessage,
    updateEntry,
  ])
}

async function runOrganizedTransition(
  deps: EntryStateActionDeps,
  transition: StateTransitionInput,
): Promise<boolean> {
  const action = createOrganizedTransition(transition)
  deps.updateEntry(transition.path, { organized: transition.after })
  trackEvent(action.eventName)
  const persistPromise = persistBooleanProperty(deps, transition.path, '_organized', transition.after)
  const cleanupHistory = recordBooleanStateHistory(deps, {
    id: `${action.idPrefix}:${transition.path}:${Date.now()}`,
    label: action.label,
    path: transition.path,
    key: '_organized',
    patchKey: 'organized',
    before: transition.before,
    after: transition.after,
    waitForPersist: persistPromise,
  })

  try {
    await persistPromise
    return true
  } catch {
    cleanupHistory?.()
    deps.updateEntry(transition.path, { organized: transition.before })
    deps.setToastMessage(action.rollbackToast)
    return false
  }
}

function createOrganizedTransition(transition: StateTransitionInput) {
  return transition.after
    ? {
      idPrefix: 'organize',
      eventName: 'note_organized',
      label: 'Mark as Organized',
      rollbackToast: 'Failed to organize — rolled back',
    }
    : {
      idPrefix: 'unorganize',
      eventName: 'note_unorganized',
      label: 'Mark as Unorganized',
      rollbackToast: 'Failed to unorganize — rolled back',
    }
}

function useReorderFavoritesAction({ updateEntry, handleUpdateFrontmatter, onFrontmatterPersisted }: ReorderFavoritesDeps) {
  return useCallback(async (orderedPaths: string[]) => {
    for (let i = 0; i < orderedPaths.length; i++) {
      const orderedPath = orderedPaths.at(i)
      if (!orderedPath) continue
      updateEntry(orderedPath, { favoriteIndex: i })
      await handleUpdateFrontmatter(orderedPath, '_favorite_index', i, { silent: true })
    }
    onFrontmatterPersisted?.()
  }, [updateEntry, handleUpdateFrontmatter, onFrontmatterPersisted])
}

export function useEntryActions(config: EntryActionsConfig) {
  const archiveActions = useArchiveActions(config)
  const typeActions = useTypeActions(config)
  const handleToggleFavorite = useFavoriteAction(config)
  const handleToggleOrganized = useOrganizedAction(config)
  const handleReorderFavorites = useReorderFavoritesAction(config)

  return {
    ...archiveActions,
    ...typeActions,
    handleToggleFavorite,
    handleToggleOrganized,
    handleReorderFavorites,
  }
}
