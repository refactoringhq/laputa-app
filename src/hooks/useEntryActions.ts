import { useCallback, useMemo } from 'react'
import type { VaultEntry } from '../types'
import type { FrontmatterOpOptions } from './frontmatterOps'
import { trackEvent } from '../lib/telemetry'

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

function findTypeEntry(entries: VaultEntry[], typeName: string): VaultEntry | undefined {
  return entries.find((entry) => entry.isA === 'Type' && entry.title === typeName)
}

async function findOrCreateType(
  deps: Pick<TypeActionDeps, 'entries' | 'createTypeEntry'>,
  typeName: string,
): Promise<VaultEntry | null> {
  const existingType = findTypeEntry(deps.entries, typeName)
  if (existingType) return existingType
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

async function toggleTypeVisibility(deps: TypeActionDeps, typeName: string): Promise<void> {
  const typeEntry = await findOrCreateType(deps, typeName)
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
      console.error('Optimistic archive rollback:', err)
    }
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
      console.error('Optimistic unarchive rollback:', err)
    }
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

  const handleToggleTypeVisibility = useCallback(async (typeName: string) => {
    await toggleTypeVisibility(typeActionDeps, typeName)
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
  return useCallback(async (path: string) => {
    const entry = entries.find((candidate) => candidate.path === path)
    if (!entry) return
    if (entry.favorite) {
      trackEvent('note_unfavorited')
      updateEntry(path, { favorite: false, favoriteIndex: null })
      try {
        await handleDeleteProperty(path, '_favorite', { silent: true })
        await handleDeleteProperty(path, '_favorite_index', { silent: true })
        onFrontmatterPersisted?.()
      } catch {
        updateEntry(path, { favorite: true, favoriteIndex: entry.favoriteIndex })
        setToastMessage('Failed to unfavorite — rolled back')
      }
    } else {
      trackEvent('note_favorited')
      const maxIndex = entries.filter((candidate) => candidate.favorite).reduce((max, candidate) => Math.max(max, candidate.favoriteIndex ?? 0), 0)
      const newIndex = maxIndex + 1
      updateEntry(path, { favorite: true, favoriteIndex: newIndex })
      try {
        await handleUpdateFrontmatter(path, '_favorite', true, { silent: true })
        await handleUpdateFrontmatter(path, '_favorite_index', newIndex, { silent: true })
        onFrontmatterPersisted?.()
      } catch {
        updateEntry(path, { favorite: false, favoriteIndex: null })
        setToastMessage('Failed to favorite — rolled back')
      }
    }
  }, [entries, updateEntry, handleUpdateFrontmatter, handleDeleteProperty, setToastMessage, onFrontmatterPersisted])
}

function useOrganizedAction({
  entries,
  updateEntry,
  handleUpdateFrontmatter,
  handleDeleteProperty,
  setToastMessage,
  onFrontmatterPersisted,
}: EntryStateActionDeps) {
  return useCallback(async (path: string) => {
    const entry = entries.find((candidate) => candidate.path === path)
    if (!entry) return false
    if (entry.organized) {
      trackEvent('note_unorganized')
      updateEntry(path, { organized: false })
      try {
        await handleDeleteProperty(path, '_organized', { silent: true })
        onFrontmatterPersisted?.()
        return true
      } catch {
        updateEntry(path, { organized: true })
        setToastMessage('Failed to unorganize — rolled back')
        return false
      }
    }

    trackEvent('note_organized')
    updateEntry(path, { organized: true })
    try {
      await handleUpdateFrontmatter(path, '_organized', true, { silent: true })
      onFrontmatterPersisted?.()
      return true
    } catch {
      updateEntry(path, { organized: false })
      setToastMessage('Failed to organize — rolled back')
      return false
    }
  }, [entries, updateEntry, handleUpdateFrontmatter, handleDeleteProperty, setToastMessage, onFrontmatterPersisted])
}

function useReorderFavoritesAction({ updateEntry, handleUpdateFrontmatter, onFrontmatterPersisted }: ReorderFavoritesDeps) {
  return useCallback(async (orderedPaths: string[]) => {
    for (let i = 0; i < orderedPaths.length; i++) {
      updateEntry(orderedPaths[i], { favoriteIndex: i })
      await handleUpdateFrontmatter(orderedPaths[i], '_favorite_index', i, { silent: true })
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
