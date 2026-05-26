import { useCallback, useMemo } from 'react'
import type { VaultEntry } from '../types'
import { isMissingFrontmatterTargetError, type FrontmatterOpOptions } from './frontmatterOps'
import { trackEvent } from '../lib/telemetry'
import { findTypeDefinition } from '../utils/typeDefinitions'
import type { ActionHistoryController, ActionHistoryEntry } from './useActionHistory'

interface EntryActionsConfig {
  entries: VaultEntry[]
  updateEntry: (path: string, updates: Partial<VaultEntry>) => void
  handleUpdateFrontmatter: (path: string, key: string, value: string | number | boolean | string[], options?: FrontmatterOpOptions) => Promise<void>
  handleDeleteProperty: (path: string, key: string, options?: FrontmatterOpOptions) => Promise<void>
  setToastMessage: (msg: string | null) => void
  createTypeEntry: (typeName: string) => Promise<VaultEntry>
  onFrontmatterPersisted?: () => void
  /** Called before trash/archive to flush unsaved editor content to disk. */
  onBeforeAction?: (path: string) => Promise<void>
  actionHistory?: ActionHistoryController
}

type ArchiveActionDeps = Pick<EntryActionsConfig,
  'updateEntry' | 'handleUpdateFrontmatter' | 'handleDeleteProperty' | 'setToastMessage' | 'onFrontmatterPersisted' | 'onBeforeAction'
>

type TypeActionDeps = Pick<EntryActionsConfig,
  'entries' | 'updateEntry' | 'handleUpdateFrontmatter' | 'handleDeleteProperty' | 'createTypeEntry' | 'onFrontmatterPersisted'
>

type EntryStateActionDeps = Pick<EntryActionsConfig,
  'entries' | 'updateEntry' | 'handleUpdateFrontmatter' | 'handleDeleteProperty' | 'setToastMessage' | 'onFrontmatterPersisted'
>

type ReorderFavoritesDeps = Pick<EntryActionsConfig, 'updateEntry' | 'handleUpdateFrontmatter' | 'onFrontmatterPersisted'>

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

interface FavoriteState {
  favorite: boolean
  favoriteIndex: number | null
}

interface FavoriteToggleResult {
  before: FavoriteState
  after: FavoriteState
}

type FavoritePersistenceDeps = Pick<EntryStateActionDeps, 'handleUpdateFrontmatter' | 'handleDeleteProperty'>
type SetFavoriteState = (path: string, state: FavoriteState) => Promise<boolean>
type SetOrganizedState = (path: string, organized: boolean) => Promise<boolean>

function recordEntryActionHistory(
  actionHistory: EntryActionsConfig['actionHistory'],
  entry: ActionHistoryEntry,
): void {
  if (!actionHistory || actionHistory.isReplaying()) return
  actionHistory.record(entry)
}

function recordAppliedEntryActionHistory(
  applied: boolean,
  actionHistory: EntryActionsConfig['actionHistory'],
  entry: ActionHistoryEntry,
): void {
  if (!applied) return
  recordEntryActionHistory(actionHistory, entry)
}

function recordFavoriteEntryHistory(
  actionHistory: EntryActionsConfig['actionHistory'],
  path: string,
  result: FavoriteToggleResult | null,
  setFavoriteState: SetFavoriteState,
): void {
  if (!result) return
  recordEntryActionHistory(actionHistory, {
    label: 'Favorite',
    undo: async () => { await setFavoriteState(path, result.before) },
    redo: async () => { await setFavoriteState(path, result.after) },
  })
}

function recordOrganizedEntryHistory(
  actionHistory: EntryActionsConfig['actionHistory'],
  path: string,
  toggled: boolean,
  before: boolean,
  setOrganizedState: SetOrganizedState,
): void {
  if (!toggled) return
  recordEntryActionHistory(actionHistory, {
    label: 'Organized',
    undo: async () => { await setOrganizedState(path, before) },
    redo: async () => { await setOrganizedState(path, !before) },
  })
}

function favoriteRollbackState(entry: VaultEntry): FavoriteState {
  return { favorite: entry.favorite, favoriteIndex: entry.favoriteIndex }
}

function maxFavoriteIndex(entries: readonly VaultEntry[]): number {
  return entries
    .filter((candidate) => candidate.favorite)
    .reduce((max, candidate) => Math.max(max, candidate.favoriteIndex ?? 0), 0)
}

function nextFavoriteState(entry: VaultEntry, entries: readonly VaultEntry[]): FavoriteState {
  return entry.favorite
    ? { favorite: false, favoriteIndex: null }
    : { favorite: true, favoriteIndex: maxFavoriteIndex(entries) + 1 }
}

function trackFavoriteState(state: FavoriteState): void {
  trackEvent(state.favorite ? 'note_favorited' : 'note_unfavorited')
}

async function persistFavoriteIndex(
  path: string,
  favoriteIndex: number | null,
  deps: FavoritePersistenceDeps,
): Promise<void> {
  if (favoriteIndex === null) {
    await deps.handleDeleteProperty(path, '_favorite_index', { silent: true })
    return
  }
  await deps.handleUpdateFrontmatter(path, '_favorite_index', favoriteIndex, { silent: true })
}

async function persistFavoriteState(
  path: string,
  state: FavoriteState,
  deps: FavoritePersistenceDeps,
): Promise<void> {
  if (!state.favorite) {
    await deps.handleDeleteProperty(path, '_favorite', { silent: true })
    await deps.handleDeleteProperty(path, '_favorite_index', { silent: true })
    return
  }

  await deps.handleUpdateFrontmatter(path, '_favorite', true, { silent: true })
  await persistFavoriteIndex(path, state.favoriteIndex, deps)
}

function logOptimisticRollback(label: string, error: unknown): void {
  if (isMissingFrontmatterTargetError(error)) {
    console.warn(label, error)
    return
  }
  console.error(label, error)
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

async function renameTypeSection(deps: TypeActionDeps, args: RenameTypeSectionArgs): Promise<void> {
  const typeEntry = await findOrCreateType(deps, args.typeName)
  if (!typeEntry) return
  const trimmed = args.label.trim()
  if (trimmed) {
    await deps.handleUpdateFrontmatter(typeEntry.path, 'sidebar label', trimmed)
  } else {
    await deps.handleDeleteProperty(typeEntry.path, 'sidebar label')
  }
  deps.updateEntry(typeEntry.path, { sidebarLabel: trimmed || null })
  deps.onFrontmatterPersisted?.()
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
  updateEntry,
  handleUpdateFrontmatter,
  handleDeleteProperty,
  setToastMessage,
  onFrontmatterPersisted,
  onBeforeAction,
}: ArchiveActionDeps) {
  const handleArchiveNote = useCallback(async (path: string) => {
    await onBeforeAction?.(path)
    // Optimistic: update UI immediately, write to disk async with rollback on failure
    updateEntry(path, { archived: true })
    trackEvent('note_archived')
    setToastMessage('Note archived')
    try {
      await handleUpdateFrontmatter(path, '_archived', true, { silent: true })
      onFrontmatterPersisted?.()
    } catch (err) {
      updateEntry(path, { archived: false })
      setToastMessage('Failed to archive note — rolled back')
      logOptimisticRollback('Optimistic archive rollback:', err)
      return false
    }
    return true
  }, [onBeforeAction, handleUpdateFrontmatter, updateEntry, setToastMessage, onFrontmatterPersisted])

  const handleUnarchiveNote = useCallback(async (path: string) => {
    // Optimistic: update UI immediately
    updateEntry(path, { archived: false })
    setToastMessage('Note unarchived')
    try {
      await handleDeleteProperty(path, '_archived', { silent: true })
      onFrontmatterPersisted?.()
    } catch (err) {
      updateEntry(path, { archived: true })
      setToastMessage('Failed to unarchive note — rolled back')
      logOptimisticRollback('Optimistic unarchive rollback:', err)
      return false
    }
    return true
  }, [handleDeleteProperty, updateEntry, setToastMessage, onFrontmatterPersisted])

  return { handleArchiveNote, handleUnarchiveNote }
}

function useTypeActions(deps: TypeActionDeps) {
  const {
    entries,
    updateEntry,
    handleUpdateFrontmatter,
    handleDeleteProperty,
    createTypeEntry,
    onFrontmatterPersisted,
  } = deps
  const typeActionDeps = useMemo(() => ({
    entries,
    updateEntry,
    handleUpdateFrontmatter,
    handleDeleteProperty,
    createTypeEntry,
    onFrontmatterPersisted,
  }), [entries, updateEntry, handleUpdateFrontmatter, handleDeleteProperty, createTypeEntry, onFrontmatterPersisted])

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
}: EntryStateActionDeps) {
  const setFavoriteState = useCallback(async (path: string, state: FavoriteState): Promise<boolean> => {
    const entry = entries.find((candidate) => candidate.path === path)
    if (!entry) return false
    const rollback = favoriteRollbackState(entry)
    updateEntry(path, state)
    try {
      await persistFavoriteState(path, state, { handleUpdateFrontmatter, handleDeleteProperty })
      onFrontmatterPersisted?.()
      return true
    } catch {
      updateEntry(path, rollback)
      setToastMessage(`Failed to ${state.favorite ? 'favorite' : 'unfavorite'} — rolled back`)
      return false
    }
  }, [entries, updateEntry, handleUpdateFrontmatter, handleDeleteProperty, setToastMessage, onFrontmatterPersisted])

  const toggleFavorite = useCallback(async (path: string): Promise<FavoriteToggleResult | null> => {
    const entry = entries.find((candidate) => candidate.path === path)
    if (!entry) return null
    const before = favoriteRollbackState(entry)
    const after = nextFavoriteState(entry, entries)
    trackFavoriteState(after)

    return await setFavoriteState(path, after) ? { before, after } : null
  }, [entries, setFavoriteState])

  return { setFavoriteState, toggleFavorite }
}

function useOrganizedAction({
  entries,
  updateEntry,
  handleUpdateFrontmatter,
  handleDeleteProperty,
  setToastMessage,
  onFrontmatterPersisted,
}: EntryStateActionDeps) {
  const setOrganizedState = useCallback(async (path: string, organized: boolean): Promise<boolean> => {
    const entry = entries.find((candidate) => candidate.path === path)
    if (!entry) return false
    updateEntry(path, { organized })
    try {
      if (organized) {
        await handleUpdateFrontmatter(path, '_organized', true, { silent: true })
      } else {
        await handleDeleteProperty(path, '_organized', { silent: true })
      }
      onFrontmatterPersisted?.()
      return true
    } catch {
      updateEntry(path, { organized: entry.organized })
      setToastMessage(`Failed to ${organized ? 'organize' : 'unorganize'} — rolled back`)
      return false
    }
  }, [entries, updateEntry, handleUpdateFrontmatter, handleDeleteProperty, setToastMessage, onFrontmatterPersisted])

  const toggleOrganized = useCallback(async (path: string): Promise<boolean> => {
    const entry = entries.find((candidate) => candidate.path === path)
    if (!entry) return false
    const organized = !entry.organized
    trackEvent(organized ? 'note_organized' : 'note_unorganized')
    return setOrganizedState(path, organized)
  }, [entries, setOrganizedState])

  return { setOrganizedState, toggleOrganized }
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
  const favoriteActions = useFavoriteAction(config)
  const organizedActions = useOrganizedAction(config)
  const handleReorderFavorites = useReorderFavoritesAction(config)
  const handleArchiveNote = useCallback(async (path: string) => {
    const archived = await archiveActions.handleArchiveNote(path)
    recordAppliedEntryActionHistory(archived, config.actionHistory, {
      label: 'Archive Note',
      undo: async () => { await archiveActions.handleUnarchiveNote(path) },
      redo: async () => { await archiveActions.handleArchiveNote(path) },
    })
  }, [archiveActions, config.actionHistory])

  const handleUnarchiveNote = useCallback(async (path: string) => {
    const unarchived = await archiveActions.handleUnarchiveNote(path)
    recordAppliedEntryActionHistory(unarchived, config.actionHistory, {
      label: 'Unarchive Note',
      undo: async () => { await archiveActions.handleArchiveNote(path) },
      redo: async () => { await archiveActions.handleUnarchiveNote(path) },
    })
  }, [archiveActions, config.actionHistory])

  const handleToggleFavorite = useCallback(async (path: string) => {
    const result = await favoriteActions.toggleFavorite(path)
    recordFavoriteEntryHistory(config.actionHistory, path, result, favoriteActions.setFavoriteState)
  }, [config.actionHistory, favoriteActions])

  const handleToggleOrganized = useCallback(async (path: string) => {
    const entry = config.entries.find((candidate) => candidate.path === path)
    const before = entry?.organized ?? false
    const toggled = await organizedActions.toggleOrganized(path)
    recordOrganizedEntryHistory(config.actionHistory, path, toggled, before, organizedActions.setOrganizedState)
    return toggled
  }, [config.actionHistory, config.entries, organizedActions])

  return {
    ...typeActions,
    handleArchiveNote,
    handleUnarchiveNote,
    handleToggleFavorite,
    handleToggleOrganized,
    handleReorderFavorites,
  }
}
