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

type TypeCreationActionParams = Pick<
  UseAppViewActionsParams,
  'notes' | 'resolvedPath' | 'setToastMessage' | 'visibleEntries'
>

type SavedViewActionParams = Pick<
  UseAppViewActionsParams,
  | 'editingView'
  | 'graphDefaultWorkspacePath'
  | 'handleSetSelection'
  | 'multiWorkspaceEnabled'
  | 'resolvedPath'
  | 'setToastMessage'
  | 'vault'
>

type ViewMutationActionParams = Pick<
  UseAppViewActionsParams,
  'handleSetSelection' | 'onOpenEditView' | 'resolvedPath' | 'selection' | 'setToastMessage' | 'vault'
>

interface CreateMissingTypeContext extends TypeCreationActionParams {
  missingType: string
  nextTypeName: string
  path: string
}

interface SaveViewContext extends SavedViewActionParams {
  definition: ViewDefinition
}

interface UpdateViewContext {
  filename: string
  patch: Partial<ViewDefinition>
  resolvedPath: string
  rootPath?: string
  vault: AppViewVaultActions
}

interface DeleteViewContext extends Pick<
  ViewMutationActionParams,
  'handleSetSelection' | 'resolvedPath' | 'selection' | 'setToastMessage' | 'vault'
> {
  filename: string
  rootPath?: string
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function savedViewEvent(editingView: EditingViewState | null): 'view_created' | 'view_updated' {
  return editingView ? 'view_updated' : 'view_created'
}

function savedViewMessage(editingView: EditingViewState | null, name: string): string {
  return editingView ? `View "${name}" updated` : `View "${name}" created`
}

function preservedSelectionRootPath(
  views: ViewFile[],
  editingRootPath: string | undefined,
  targetVaultPath: string,
): string | undefined {
  return shouldPreserveViewRootPath(views, editingRootPath) ? targetVaultPath : undefined
}

async function createMissingType(context: CreateMissingTypeContext): Promise<boolean> {
  const { missingType, nextTypeName, notes, path, resolvedPath, setToastMessage, visibleEntries } = context
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
}

async function saveCreatedOrUpdatedView(context: SaveViewContext): Promise<boolean> {
  const {
    definition,
    editingView,
    graphDefaultWorkspacePath,
    handleSetSelection,
    multiWorkspaceEnabled,
    resolvedPath,
    setToastMessage,
    vault,
  } = context
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
    trackEvent(savedViewEvent(editingView))
    await vault.reloadViews()
    await vault.reloadVault()
    vault.reloadFolders()
    setToastMessage(savedViewMessage(editingView, nextDefinition.name))
    handleSetSelection(viewSelection(
      filename,
      preservedSelectionRootPath(vault.views, editingView?.rootPath, targetVaultPath),
    ))
    return true
  } catch (err) {
    setToastMessage(`Could not save view: ${errorMessage(err)}`)
    return false
  }
}

async function updateExistingViewDefinition(context: UpdateViewContext): Promise<void> {
  const { filename, patch, resolvedPath, rootPath, vault } = context
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
}

async function deleteExistingView(context: DeleteViewContext): Promise<void> {
  const { filename, handleSetSelection, resolvedPath, rootPath, selection, setToastMessage, vault } = context
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
}

function availableViewFields(visibleEntries: VaultEntry[]): string[] {
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
}

function useTypeCreationActions(params: TypeCreationActionParams) {
  const { notes, resolvedPath, setToastMessage, visibleEntries } = params

  const handleCreateType = useCallback(async (name: string) => {
    const created = await notes.handleCreateType(name)
    if (created) setToastMessage(`Type "${name}" created`)
    return created
  }, [notes, setToastMessage])

  const handleCreateMissingType = useCallback(async (path: string, missingType: string, nextTypeName: string) => {
    return createMissingType({ missingType, nextTypeName, notes, path, resolvedPath, setToastMessage, visibleEntries })
  }, [notes, resolvedPath, setToastMessage, visibleEntries])

  return { handleCreateMissingType, handleCreateType }
}

function useSavedViewActions(params: SavedViewActionParams) {
  const {
    editingView,
    graphDefaultWorkspacePath,
    handleSetSelection,
    multiWorkspaceEnabled,
    resolvedPath,
    setToastMessage,
    vault,
  } = params

  const handleCreateOrUpdateView = useCallback(async (definition: ViewDefinition) => {
    return saveCreatedOrUpdatedView({
      definition,
      editingView,
      graphDefaultWorkspacePath,
      handleSetSelection,
      multiWorkspaceEnabled,
      resolvedPath,
      setToastMessage,
      vault,
    })
  }, [
    editingView,
    graphDefaultWorkspacePath,
    handleSetSelection,
    multiWorkspaceEnabled,
    resolvedPath,
    setToastMessage,
    vault,
  ])

  return { handleCreateOrUpdateView }
}

function useViewMutationActions(params: ViewMutationActionParams) {
  const { handleSetSelection, onOpenEditView, resolvedPath, selection, setToastMessage, vault } = params

  const handleUpdateViewDefinition = useCallback(async (filename: string, patch: Partial<ViewDefinition>, rootPath?: string) => {
    await updateExistingViewDefinition({ filename, patch, resolvedPath, rootPath, vault })
  }, [resolvedPath, vault])

  const handleSidebarUpdateViewDefinition = useCallback((filename: string, patch: Partial<ViewDefinition>, rootPath?: string) => {
    void handleUpdateViewDefinition(filename, patch, rootPath)
      .then(() => {
        trackEvent('view_updated', { source: 'sidebar_view_actions' })
        if (typeof patch.name === 'string') setToastMessage(`View "${patch.name}" renamed`)
      })
      .catch((err) => {
        setToastMessage(`Could not save view: ${errorMessage(err)}`)
      })
  }, [handleUpdateViewDefinition, setToastMessage])

  const handleEditView = useCallback((filename: string, rootPath?: string) => {
    const view = vault.views.find((candidate) => viewMatchesSelection(candidate, viewSelection(filename, rootPath)))
    if (view) onOpenEditView(filename, view.definition, view.rootPath)
  }, [onOpenEditView, vault.views])

  const handleDeleteView = useCallback(async (filename: string, rootPath?: string) => {
    await deleteExistingView({ filename, handleSetSelection, resolvedPath, rootPath, selection, setToastMessage, vault })
  }, [handleSetSelection, resolvedPath, selection, setToastMessage, vault])

  return {
    handleDeleteView,
    handleEditView,
    handleSidebarUpdateViewDefinition,
    handleUpdateViewDefinition,
  }
}

export function useAppViewActions(params: UseAppViewActionsParams) {
  const typeActions = useTypeCreationActions(params)
  const savedViewActions = useSavedViewActions(params)
  const viewMutationActions = useViewMutationActions(params)
  const availableFields = useMemo(() => availableViewFields(params.visibleEntries), [params.visibleEntries])

  return {
    availableFields,
    ...typeActions,
    ...savedViewActions,
    ...viewMutationActions,
  }
}
