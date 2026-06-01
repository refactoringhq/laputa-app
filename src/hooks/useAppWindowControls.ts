import { useCallback, useRef } from 'react'
import type { MutableRefObject } from 'react'
import {
  applyMainWindowSizeConstraints,
  getMainWindowMinWidth,
  useMainWindowSizeConstraints,
} from './useMainWindowSizeConstraints'
import { useViewMode, type ViewMode } from './useViewMode'
import { useZoom } from './useZoom'
import { useBuildNumber } from './useBuildNumber'
import type { useLayoutPanels } from './useLayoutPanels'
import type { NotePdfExportSource } from '../utils/notePdfExport'
import { isWindows } from '../utils/platform'

interface UseAppWindowControlsParams {
  layout: ReturnType<typeof useLayoutPanels>
  windowMode: boolean
}

interface AppWindowControls {
  buildNumber: string | undefined
  diffToggleRef: MutableRefObject<() => void>
  findInNoteRef: MutableRefObject<((options?: { replace?: boolean }) => void) | null>
  handleCollapseSidebar: () => void
  handleSetViewMode: (mode: ViewMode) => void
  handleToggleInspector: () => void
  noteListVisible: boolean
  pdfExportRef: MutableRefObject<((source?: NotePdfExportSource) => void) | null>
  rawToggleRef: MutableRefObject<() => void>
  sidebarVisible: boolean
  tableOfContentsToggleRef: MutableRefObject<() => void>
  zoom: ReturnType<typeof useZoom>
}

export function useAppWindowControls({
  layout,
  windowMode,
}: UseAppWindowControlsParams): AppWindowControls {
  const rawToggleRef = useRef<() => void>(() => {})
  const tableOfContentsToggleRef = useRef<() => void>(() => {})
  const diffToggleRef = useRef<() => void>(() => {})
  const findInNoteRef = useRef<((options?: { replace?: boolean }) => void) | null>(null)
  const pdfExportRef = useRef<((source?: NotePdfExportSource) => void) | null>(null)

  const { setViewMode, sidebarVisible, noteListVisible } = useViewMode(
    windowMode ? 'editor-only' : undefined,
  )
  const zoom = useZoom()
  const buildNumber = useBuildNumber()

  const updateMainWindowConstraints = useCallback((
    nextSidebarVisible: boolean,
    nextNoteListVisible: boolean,
    nextInspectorCollapsed: boolean = layout.inspectorCollapsed,
  ) => {
    if (windowMode) return

    const minWidth = getMainWindowMinWidth({
      sidebarVisible: nextSidebarVisible,
      noteListVisible: nextNoteListVisible,
      inspectorCollapsed: nextInspectorCollapsed,
      sidebarWidth: layout.sidebarWidth,
      noteListWidth: layout.noteListWidth,
      inspectorWidth: layout.inspectorWidth,
    })

    void applyMainWindowSizeConstraints(minWidth, { growToFit: !isWindows() })
      .catch((err) => console.warn('[window] Size constraints failed:', err))
  }, [
    layout.inspectorCollapsed,
    layout.inspectorWidth,
    layout.noteListWidth,
    layout.sidebarWidth,
    windowMode,
  ])

  const handleSetViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode)
    updateMainWindowConstraints(mode === 'all', mode !== 'editor-only')
  }, [setViewMode, updateMainWindowConstraints])

  const handleCollapseSidebar = useCallback(() => {
    handleSetViewMode('editor-list')
  }, [handleSetViewMode])

  const handleToggleInspector = useCallback(() => {
    const nextInspectorCollapsed = !layout.inspectorCollapsed
    layout.setInspectorCollapsed(nextInspectorCollapsed)
    updateMainWindowConstraints(sidebarVisible, noteListVisible, nextInspectorCollapsed)
  }, [
    layout,
    noteListVisible,
    sidebarVisible,
    updateMainWindowConstraints,
  ])

  useMainWindowSizeConstraints({
    enabled: !windowMode,
    sidebarVisible,
    noteListVisible,
    inspectorCollapsed: layout.inspectorCollapsed,
    sidebarWidth: layout.sidebarWidth,
    noteListWidth: layout.noteListWidth,
    inspectorWidth: layout.inspectorWidth,
  })

  return {
    buildNumber,
    diffToggleRef,
    findInNoteRef,
    handleCollapseSidebar,
    handleSetViewMode,
    handleToggleInspector,
    noteListVisible,
    pdfExportRef,
    rawToggleRef,
    sidebarVisible,
    tableOfContentsToggleRef,
    zoom,
  }
}
