import { useCallback, useEffect, useState } from 'react'
import { APP_STORAGE_KEYS, LEGACY_APP_STORAGE_KEYS, getAppStorageItem } from '../constants/appStorage'

export const COLUMN_MIN_WIDTHS = {
  sidebar: 220,
  noteList: 220,
  editor: 800,
  inspector: 240,
} as const

const COLUMN_MAX_WIDTHS = {
  sidebar: 400,
  noteList: 500,
  inspector: 500,
} as const

const DEFAULT_PANEL_WIDTHS = {
  sidebar: 250,
  noteList: 300,
  inspector: 280,
} as const

type PanelWidthKey = keyof typeof DEFAULT_PANEL_WIDTHS
type PanelWidths = Record<PanelWidthKey, number>

function defaultPanelWidths(): PanelWidths {
  return { ...DEFAULT_PANEL_WIDTHS }
}

function clampPanelWidth(key: PanelWidthKey, value: number): number {
  const minWidth = Reflect.get(COLUMN_MIN_WIDTHS, key) as number
  const maxWidth = Reflect.get(COLUMN_MAX_WIDTHS, key) as number
  return Math.max(minWidth, Math.min(maxWidth, value))
}

function isPanelWidthRecord(value: unknown): value is Partial<Record<PanelWidthKey, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPanelWidth(source: Partial<Record<PanelWidthKey, unknown>>, key: PanelWidthKey): number {
  const value = Reflect.get(source, key)
  return typeof value === 'number' && Number.isFinite(value)
    ? clampPanelWidth(key, value)
    : Reflect.get(DEFAULT_PANEL_WIDTHS, key) as number
}

function normalizePanelWidths(value: unknown): PanelWidths {
  if (!isPanelWidthRecord(value)) return defaultPanelWidths()
  return {
    sidebar: readPanelWidth(value, 'sidebar'),
    noteList: readPanelWidth(value, 'noteList'),
    inspector: readPanelWidth(value, 'inspector'),
  }
}

function loadPanelWidths(): PanelWidths {
  const raw = getAppStorageItem('layoutPanels')
  if (!raw) return defaultPanelWidths()

  try {
    return normalizePanelWidths(JSON.parse(raw))
  } catch {
    return defaultPanelWidths()
  }
}

function savePanelWidths(widths: PanelWidths): void {
  try {
    localStorage.setItem(APP_STORAGE_KEYS.layoutPanels, JSON.stringify(widths))
    localStorage.removeItem(LEGACY_APP_STORAGE_KEYS.layoutPanels)
  } catch {
    // Ignore unavailable or restricted localStorage implementations.
  }
}

function loadInspectorCollapsed(): boolean {
  try {
    return localStorage.getItem(APP_STORAGE_KEYS.rightPanelCollapsed) !== 'false'
  } catch {
    return true
  }
}

function saveInspectorCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(APP_STORAGE_KEYS.rightPanelCollapsed, String(collapsed))
  } catch {
    // Ignore unavailable or restricted localStorage implementations.
  }
}

export function useLayoutPanels(options?: { initialInspectorCollapsed?: boolean }) {
  const [panelWidths, setPanelWidths] = useState(loadPanelWidths)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(
    () => options?.initialInspectorCollapsed ?? loadInspectorCollapsed(),
  )
  const persistInspectorCollapsed = options?.initialInspectorCollapsed === undefined

  useEffect(() => {
    savePanelWidths(panelWidths)
  }, [panelWidths])

  useEffect(() => {
    if (persistInspectorCollapsed) saveInspectorCollapsed(inspectorCollapsed)
  }, [inspectorCollapsed, persistInspectorCollapsed])

  const resizePanel = useCallback((key: PanelWidthKey, delta: number) => {
    setPanelWidths((widths) => {
      const nextWidths = { ...widths }
      const currentWidth = Reflect.get(widths, key) as number
      Reflect.set(nextWidths, key, clampPanelWidth(key, currentWidth + delta))
      return nextWidths
    })
  }, [])

  const handleSidebarResize = useCallback((delta: number) => resizePanel('sidebar', delta), [resizePanel])
  const handleNoteListResize = useCallback((delta: number) => resizePanel('noteList', delta), [resizePanel])
  const handleInspectorResize = useCallback((delta: number) => resizePanel('inspector', -delta), [resizePanel])

  return {
    sidebarWidth: panelWidths.sidebar,
    noteListWidth: panelWidths.noteList,
    inspectorWidth: panelWidths.inspector,
    inspectorCollapsed,
    setInspectorCollapsed,
    handleSidebarResize,
    handleNoteListResize,
    handleInspectorResize,
  }
}
