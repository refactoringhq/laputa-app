import { useCallback, useState } from 'react'

export const COLUMN_MIN_WIDTHS = {
  sidebar: 180,
  noteList: 220,
  editor: 800,
  inspector: 240,
  graphPane: 320,
  graphEditor: 360,
} as const

export function useLayoutPanels(options?: { initialInspectorCollapsed?: boolean }) {
  const [sidebarWidth, setSidebarWidth] = useState(250)
  const [noteListWidth, setNoteListWidth] = useState(300)
  const [inspectorWidth, setInspectorWidth] = useState(280)
  const [graphEditorWidth, setGraphEditorWidth] = useState(560)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(options?.initialInspectorCollapsed ?? true)
  const handleSidebarResize = useCallback((delta: number) => setSidebarWidth((w) => Math.max(COLUMN_MIN_WIDTHS.sidebar, Math.min(400, w + delta))), [])
  const handleNoteListResize = useCallback((delta: number) => setNoteListWidth((w) => Math.max(COLUMN_MIN_WIDTHS.noteList, Math.min(500, w + delta))), [])
  const handleInspectorResize = useCallback((delta: number) => setInspectorWidth((w) => Math.max(COLUMN_MIN_WIDTHS.inspector, Math.min(500, w - delta))), [])
  const handleGraphEditorResize = useCallback((delta: number) => setGraphEditorWidth((w) => Math.max(COLUMN_MIN_WIDTHS.graphEditor, Math.min(1100, w - delta))), [])
  return { sidebarWidth, noteListWidth, inspectorWidth, graphEditorWidth, inspectorCollapsed, setInspectorCollapsed, handleSidebarResize, handleNoteListResize, handleInspectorResize, handleGraphEditorResize }
}
