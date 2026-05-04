import { useCallback } from 'react'
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

function findTypeEntry(entries: VaultEntry[], typeName: string): VaultEntry | undefined {
  return entries.find((e) => e.isA === 'Type' && e.title === typeName)
}

async function findOrCreateType(
  entries: VaultEntry[], typeName: string, create: (name: string) => Promise<VaultEntry>,
): Promise<VaultEntry> {
  return findTypeEntry(entries, typeName) ?? await create(typeName)
}

export function useEntryActions({
  entries, updateEntry, handleUpdateFrontmatter, handleDeleteProperty, setToastMessage, createTypeEntry, onFrontmatterPersisted, onBeforeAction,
}: EntryActionsConfig) {
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

  const handleCustomizeType = useCallback(async (typeName: string, icon: string, color: string) => {
    const typeEntry = await findOrCreateType(entries, typeName, createTypeEntry)
    await handleUpdateFrontmatter(typeEntry.path, 'icon', icon)
    await handleUpdateFrontmatter(typeEntry.path, 'color', color)
    updateEntry(typeEntry.path, { icon, color })
    onFrontmatterPersisted?.()
  }, [entries, handleUpdateFrontmatter, updateEntry, createTypeEntry, onFrontmatterPersisted])

  const handleReorderSections = useCallback(async (orderedTypes: { typeName: string; order: number }[]) => {
    for (const { typeName, order } of orderedTypes) {
      const typeEntry = await findOrCreateType(entries, typeName, createTypeEntry)
      await handleUpdateFrontmatter(typeEntry.path, 'order', order)
      updateEntry(typeEntry.path, { order })
    }
    onFrontmatterPersisted?.()
  }, [entries, handleUpdateFrontmatter, updateEntry, createTypeEntry, onFrontmatterPersisted])

  const handleUpdateTypeTemplate = useCallback(async (typeName: string, template: string) => {
    const typeEntry = await findOrCreateType(entries, typeName, createTypeEntry)
    await handleUpdateFrontmatter(typeEntry.path, 'template', template)
    updateEntry(typeEntry.path, { template: template || null })
    onFrontmatterPersisted?.()
  }, [entries, handleUpdateFrontmatter, updateEntry, createTypeEntry, onFrontmatterPersisted])

  const handleUpdateTypeDefaultFolder = useCallback(async (typeName: string, folder: string | null) => {
    const typeEntry = await findOrCreateType(entries, typeName, createTypeEntry)
    if (folder) {
      await handleUpdateFrontmatter(typeEntry.path, '_default_folder', folder)
    } else {
      await handleDeleteProperty(typeEntry.path, '_default_folder')
    }
    updateEntry(typeEntry.path, { defaultFolder: folder })
    onFrontmatterPersisted?.()
  }, [entries, handleUpdateFrontmatter, handleDeleteProperty, updateEntry, createTypeEntry, onFrontmatterPersisted])

  const handleRenameSection = useCallback(async (typeName: string, label: string) => {
    const typeEntry = await findOrCreateType(entries, typeName, createTypeEntry)
    const trimmed = label.trim()
    if (trimmed) {
      await handleUpdateFrontmatter(typeEntry.path, 'sidebar label', trimmed)
    } else {
      await handleDeleteProperty(typeEntry.path, 'sidebar label')
    }
    updateEntry(typeEntry.path, { sidebarLabel: trimmed || null })
    onFrontmatterPersisted?.()
  }, [entries, handleUpdateFrontmatter, handleDeleteProperty, updateEntry, createTypeEntry, onFrontmatterPersisted])

  const handleToggleFavorite = useCallback(async (path: string) => {
    const entry = entries.find((e) => e.path === path)
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
      const maxIndex = entries.filter((e) => e.favorite).reduce((max, e) => Math.max(max, e.favoriteIndex ?? 0), 0)
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

  const handleToggleOrganized = useCallback(async (path: string) => {
    const entry = entries.find((e) => e.path === path)
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
    } else {
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
    }
  }, [entries, updateEntry, handleUpdateFrontmatter, handleDeleteProperty, setToastMessage, onFrontmatterPersisted])

  const handleReorderFavorites = useCallback(async (orderedPaths: string[]) => {
    for (let i = 0; i < orderedPaths.length; i++) {
      updateEntry(orderedPaths[i], { favoriteIndex: i })
      await handleUpdateFrontmatter(orderedPaths[i], '_favorite_index', i, { silent: true })
    }
    onFrontmatterPersisted?.()
  }, [updateEntry, handleUpdateFrontmatter, onFrontmatterPersisted])

  const handleToggleTypeVisibility = useCallback(async (typeName: string) => {
    const typeEntry = await findOrCreateType(entries, typeName, createTypeEntry)
    if (typeEntry.visible === false) {
      await handleDeleteProperty(typeEntry.path, 'visible')
      updateEntry(typeEntry.path, { visible: null })
    } else {
      await handleUpdateFrontmatter(typeEntry.path, 'visible', false)
      updateEntry(typeEntry.path, { visible: false })
    }
    onFrontmatterPersisted?.()
  }, [entries, handleUpdateFrontmatter, handleDeleteProperty, updateEntry, createTypeEntry, onFrontmatterPersisted])

  return { handleArchiveNote, handleUnarchiveNote, handleCustomizeType, handleReorderSections, handleUpdateTypeTemplate, handleUpdateTypeDefaultFolder, handleRenameSection, handleToggleTypeVisibility, handleToggleFavorite, handleToggleOrganized, handleReorderFavorites }
}
