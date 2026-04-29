import { useCallback, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { SidebarSelection, ViewFile } from '../types'
import { createTranslator, type AppLocale } from '../lib/i18n'
import {
  buildViewOrderUpdates,
  canMoveView,
  moveView,
  orderViewsByFilename,
  type ViewMoveDirection,
  type ViewMoveHandler,
  type ViewReorderHandler,
} from '../utils/viewOrdering'

interface SavedViewOrderingConfig {
  views: ViewFile[]
  selection: SidebarSelection
  vaultPath: string
  reloadViews: () => Promise<unknown>
  loadModifiedFiles: () => Promise<void>
  onToast: (message: string) => void
  locale?: AppLocale
}

interface SavedViewOrdering {
  onReorderViews: ViewReorderHandler
  onMoveView: ViewMoveHandler
  selectedViewName?: string
  selectedViewFilename: string | null
  onMoveSelectedViewUp?: () => void
  onMoveSelectedViewDown?: () => void
  canMoveSelectedViewUp: boolean
  canMoveSelectedViewDown: boolean
}

function selectedSavedView(views: ViewFile[], selection: SidebarSelection): ViewFile | null {
  if (selection.kind !== 'view') return null
  return views.find((view) => view.filename === selection.filename) ?? null
}

function viewMoveCommand(
  view: ViewFile | null,
  direction: ViewMoveDirection,
  onMoveView: ViewMoveHandler,
): (() => void) | undefined {
  if (!view) return undefined
  const { filename } = view
  return () => { void onMoveView(filename, direction) }
}

export function useSavedViewOrdering({
  views,
  selection,
  vaultPath,
  reloadViews,
  loadModifiedFiles,
  onToast,
  locale = 'en',
}: SavedViewOrderingConfig): SavedViewOrdering {
  const t = useMemo(() => createTranslator(locale), [locale])

  const persistViewOrder = useCallback(async (orderedViews: ViewFile[]) => {
    const target = isTauri() ? invoke : mockInvoke
    await Promise.all(buildViewOrderUpdates(orderedViews).map(({ filename, definition }) => (
      target('save_view_cmd', { vaultPath, filename, definition })
    )))
    await reloadViews()
    await loadModifiedFiles()
    onToast(t('savedViews.reordered'))
  }, [loadModifiedFiles, onToast, reloadViews, t, vaultPath])

  const onReorderViews = useCallback<ViewReorderHandler>(async (orderedFilenames) => {
    const orderedViews = orderViewsByFilename(views, orderedFilenames)
    if (!orderedViews) return
    await persistViewOrder(orderedViews)
  }, [persistViewOrder, views])

  const onMoveView = useCallback<ViewMoveHandler>(async (filename, direction) => {
    const orderedViews = moveView(views, filename, direction)
    if (!orderedViews) return
    await persistViewOrder(orderedViews)
  }, [persistViewOrder, views])

  const selectedView = useMemo(
    () => selectedSavedView(views, selection),
    [selection, views],
  )
  const selectedViewFilename = selectedView?.filename ?? null

  return {
    onReorderViews,
    onMoveView,
    selectedViewName: selectedView?.definition.name,
    selectedViewFilename,
    onMoveSelectedViewUp: viewMoveCommand(selectedView, 'up', onMoveView),
    onMoveSelectedViewDown: viewMoveCommand(selectedView, 'down', onMoveView),
    canMoveSelectedViewUp: selectedViewFilename ? canMoveView(views, selectedViewFilename, 'up') : false,
    canMoveSelectedViewDown: selectedViewFilename ? canMoveView(views, selectedViewFilename, 'down') : false,
  }
}
