import { useCallback, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { SidebarSelection, VaultEntry, ViewDefinition, ViewFile } from '../types'
import { planNewTypeCreation } from './useNoteCreation'
import { createViewFilename } from '../utils/viewFilename'
import { nextViewOrder } from '../utils/viewOrdering'
import { viewMatchesSelection, viewVaultPath } from '../utils/viewIdentity'
import { viewCreationVaultPath } from '../utils/viewTargetVault'
import { isActiveVaultUnavailableError } from '../utils/vaultErrors'
import { trackEvent } from '../lib/telemetry'

interface EditingViewState {
  definition: ViewDefinition
  filename: string
  rootPath?: string
}

interface AppViewNoteActions {
  createTypeEntrySilent: (name: string) => Promise<VaultEntry>
  handleCreateType: (name: string) => Promise<boolean>
  handleUpdateFrontmatter: (path: string, key: string, value: string) => Promise<unknown>
}

interface AppViewVaultActions {
  markVaultUnavailable: (vaultPath: string) => void
  reloadFolders: () => unknown
  reloadVault: () => Promise<unknown>
  reloadViews: () => Promise<unknown>
  views: ViewFile[]
}

interface UseAppViewActionsParams {
  editingView: EditingViewState | null
  graphDefaultWorkspacePath: string
  handleSetSelection: (selection: SidebarSelection) => void
  multiWorkspaceEnabled: boolean
  notes: AppViewNoteActions
  onOpenEditView: (filename: string, definition: ViewDefinition, rootPath?: string) => void
  resolvedPath: string
  selection: SidebarSelection
  setToastMessage: (message: string) => void
  vault: AppViewVaultActions
  visibleEntries: VaultEntry[]
}

function viewsForVault(views: ViewFile[], vaultPath: string): ViewFile[] {
  return views.filter((view) => !view.rootPath || view.rootPath === vaultPath)
}

function viewSelection(filename: string, rootPath?: string): SidebarSelection {
  return rootPath
    ? { kind: 'view', filename, rootPath }
    : { kind: 'view', filename }
}

function savedViewFilename(
  definition: ViewDefinition,
  editingView: { filename: string } | null,
  existingViews: ViewFile[],
): string {
  return editingView
    ? editingView.filename
    : createViewFilename(definition.name, existingViews.map((view) => view.filename))
}

function savedViewDefinition(
  definition: ViewDefinition,
  editingView: { definition: ViewDefinition } | null,
  existingViews: ViewFile[],
): ViewDefinition {
  return editingView
    ? { ...editingView.definition, ...definition }
    : { ...definition, order: nextViewOrder(existingViews) }
}

function shouldPreserveViewRootPath(views: ViewFile[], editingRootPath?: string): boolean {
  return Boolean(editingRootPath) || views.some((view) => view.rootPath)
}

export function useAppViewActions({
  editingView,
  graphDefaultWorkspacePath,
  handleSetSelection,
  multiWorkspaceEnabled,
  notes,
  onOpenEditView,
  resolvedPath,
  selection,
  setToastMessage,
  vault,
  visibleEntries,
}: UseAppViewActionsParams) {
  const handleCreateType = useCallback(async (name: string) => {
    const created = await notes.handleCreateType(name)
    if (created) setToastMessage(`Type "${name}" created`)
    return created
  }, [notes, setToastMessage])

  const handleCreateMissingType = useCallback(async (path: string, missingType: string, nextTypeName: string) => {
    const trimmed = nextTypeName.trim()
    if (!trimmed) return false

    const plan = planNewTypeCreation({ entries: visibleEntries, typeName: trimmed, vaultPath: resolvedPath })
    if (plan.status === 'blocked') {
      setToastMessage(plan.message)
      return false
    }

    let resolvedTypeName = plan.status === 'existing' ? plan.entry.title : trimmed

    if (plan.status === 'create') {
      try {
        resolvedTypeName = (await notes.createTypeEntrySilent(trimmed)).title
      } catch {
        return false
      }
    }

    await notes.handleUpdateFrontmatter(path, 'type', resolvedTypeName)
    setToastMessage(
      plan.status === 'create' && resolvedTypeName === missingType
        ? `Type "${resolvedTypeName}" created`
        : `Type set to "${resolvedTypeName}"`,
    )
    return true
  }, [notes, resolvedPath, setToastMessage, visibleEntries])

  const handleCreateOrUpdateView = useCallback(async (definition: ViewDefinition) => {
    const targetVaultPath = viewCreationVaultPath({
      editingRootPath: editingView?.rootPath,
      fallbackVaultPath: resolvedPath,
      graphDefaultWorkspacePath,
      multiWorkspaceEnabled,
    })
    const activeVaultViews = viewsForVault(vault.views, targetVaultPath)
    const filename = savedViewFilename(definition, editingView, activeVaultViews)
    const nextDefinition = savedViewDefinition(definition, editingView, activeVaultViews)
    const target = isTauri() ? invoke : mockInvoke
    try {
      await target('save_view_cmd', { vaultPath: targetVaultPath, filename, definition: nextDefinition })
      trackEvent(editingView ? 'view_updated' : 'view_created')
      await vault.reloadViews()
      await vault.reloadVault()
      vault.reloadFolders()
      setToastMessage(editingView ? `View "${nextDefinition.name}" updated` : `View "${nextDefinition.name}" created`)
      handleSetSelection(viewSelection(
        filename,
        shouldPreserveViewRootPath(vault.views, editingView?.rootPath) ? targetVaultPath : undefined,
      ))
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setToastMessage(`Could not save view: ${message}`)
      return false
    }
  }, [
    editingView,
    graphDefaultWorkspacePath,
    handleSetSelection,
    multiWorkspaceEnabled,
    resolvedPath,
    setToastMessage,
    vault,
  ])

  const handleUpdateViewDefinition = useCallback(async (filename: string, patch: Partial<ViewDefinition>, rootPath?: string) => {
    const existing = vault.views.find((view) => viewMatchesSelection(view, viewSelection(filename, rootPath)))
    if (!existing) return

    const targetVaultPath = viewVaultPath(existing, resolvedPath)
    const target = isTauri() ? invoke : mockInvoke
    await target('save_view_cmd', {
      vaultPath: targetVaultPath,
      filename,
      definition: { ...existing.definition, ...patch },
    })
    await vault.reloadViews()
  }, [resolvedPath, vault])

  const handleSidebarUpdateViewDefinition = useCallback((filename: string, patch: Partial<ViewDefinition>, rootPath?: string) => {
    void handleUpdateViewDefinition(filename, patch, rootPath)
      .then(() => {
        trackEvent('view_updated', { source: 'sidebar_view_actions' })
        if (typeof patch.name === 'string') setToastMessage(`View "${patch.name}" renamed`)
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        setToastMessage(`Could not save view: ${message}`)
      })
  }, [handleUpdateViewDefinition, setToastMessage])

  const handleEditView = useCallback((filename: string, rootPath?: string) => {
    const view = vault.views.find((candidate) => viewMatchesSelection(candidate, viewSelection(filename, rootPath)))
    if (view) onOpenEditView(filename, view.definition, view.rootPath)
  }, [onOpenEditView, vault.views])

  const handleDeleteView = useCallback(async (filename: string, rootPath?: string) => {
    const existing = vault.views.find((view) => viewMatchesSelection(view, viewSelection(filename, rootPath)))
    if (!existing) return

    const targetVaultPath = viewVaultPath(existing, resolvedPath)
    const target = isTauri() ? invoke : mockInvoke
    try {
      await target('delete_view_cmd', { vaultPath: targetVaultPath, filename })
    } catch (err) {
      if (isActiveVaultUnavailableError(err)) {
        vault.markVaultUnavailable(targetVaultPath)
        return
      }
      throw err
    }
    await vault.reloadViews()
    await vault.reloadVault()
    vault.reloadFolders()
    if (selection.kind === 'view' && viewMatchesSelection(existing, selection)) {
      handleSetSelection({ kind: 'filter', filter: 'all' })
    }
    setToastMessage('View deleted')
  }, [handleSetSelection, resolvedPath, selection, setToastMessage, vault])

  const availableFields = useMemo(() => {
    const builtIn = ['type', 'status', 'title', 'favorite', 'body']
    if (!visibleEntries?.length) return builtIn
    const customFields = new Set<string>()
    for (const entry of visibleEntries) {
      if (entry.properties) {
        for (const key of Object.keys(entry.properties)) customFields.add(key)
      }
      if (entry.relationships) {
        for (const key of Object.keys(entry.relationships)) customFields.add(key)
      }
    }
    return [...builtIn, ...Array.from(customFields).sort()]
  }, [visibleEntries])

  return {
    availableFields,
    handleCreateMissingType,
    handleCreateOrUpdateView,
    handleCreateType,
    handleDeleteView,
    handleEditView,
    handleSidebarUpdateViewDefinition,
    handleUpdateViewDefinition,
  }
}
