import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Graph } from '@phosphor-icons/react'
import { GraphCanvas, type GraphCanvasHandle } from './graph/GraphCanvas'
import { GraphControls } from './graph/GraphControls'
import { GraphLegend } from './graph/GraphLegend'
import { useGraphData } from './graph/useGraphData'
import { useGraphTheme } from './graph/useGraphTheme'
import { ResizeHandle } from './ResizeHandle'
import type { GraphMode, SidebarSelection, VaultEntry } from '../types'
import { translate, type AppLocale } from '../lib/i18n'
import { trackEvent } from '../lib/telemetry'

interface GraphViewProps {
  entries: VaultEntry[]
  selection: SidebarSelection & { kind: 'graph' }
  selectedPath: string | null
  onSelectNote: (entry: VaultEntry) => void
  onSetSelection: (selection: SidebarSelection) => void
  locale: AppLocale
  /** Right-hand pane content (typically a live editor for the selected node). When omitted, the graph fills the available width. */
  rightPane?: ReactNode
  rightPaneWidth?: number
  onRightPaneResize?: (delta: number) => void
}

interface PaneSize {
  width: number
  height: number
}

function useElementSize(): [React.RefObject<HTMLDivElement | null>, PaneSize] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<PaneSize>({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, size]
}

function emptyMessage(entryCount: number, mode: GraphMode, locale: AppLocale): string | null {
  if (entryCount < 2) return translate(locale, 'graph.empty.notEnough')
  if (mode === 'local') return translate(locale, 'graph.empty.localIsolated')
  return null
}

export function GraphView({
  entries,
  selection,
  selectedPath,
  onSelectNote,
  onSetSelection,
  locale,
  rightPane,
  rightPaneWidth,
  onRightPaneResize,
}: GraphViewProps) {
  const focusEntry = selection.mode === 'local' ? selection.focus : null
  const depth = selection.mode === 'local' ? selection.depth : 1

  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [showOrphans, setShowOrphans] = useState(true)

  const [paneRef, size] = useElementSize()
  const canvasRef = useRef<GraphCanvasHandle | null>(null)
  const theme = useGraphTheme()

  const data = useGraphData(
    entries,
    selection.mode,
    focusEntry,
    depth,
    showArchived,
    showOrphans,
    query,
  )

  const focusPath = focusEntry?.path
  useEffect(() => {
    trackEvent('graph_view_opened', { mode: selection.mode })
  }, [selection.mode, focusPath])

  const visibleSelectedPath = selectedPath && data.nodes.some((node) => node.id === selectedPath)
    ? selectedPath
    : null

  const handleModeChange = useCallback((nextMode: GraphMode) => {
    if (nextMode === selection.mode) return
    if (nextMode === 'global') {
      onSetSelection({ kind: 'graph', mode: 'global' })
      return
    }
    if (focusEntry) {
      onSetSelection({ kind: 'graph', mode: 'local', focus: focusEntry, depth })
    }
  }, [selection.mode, focusEntry, depth, onSetSelection])

  const handleDepthChange = useCallback((nextDepth: number) => {
    if (focusEntry) {
      onSetSelection({ kind: 'graph', mode: 'local', focus: focusEntry, depth: nextDepth })
    }
  }, [focusEntry, onSetSelection])

  const handleNodeClick = useCallback((nodeId: string) => {
    const target = entries.find((entry) => entry.path === nodeId)
    if (!target) return
    trackEvent('graph_node_opened', { mode: selection.mode })
    onSelectNote(target)
  }, [entries, onSelectNote, selection.mode])

  const handleNodeRightClick = useCallback((nodeId: string) => {
    const target = entries.find((entry) => entry.path === nodeId)
    if (!target) return
    trackEvent('graph_pivot', { mode: selection.mode })
    onSetSelection({ kind: 'graph', mode: 'local', focus: target, depth })
  }, [entries, onSetSelection, selection.mode, depth])

  const empty = emptyMessage(entries.length, selection.mode, locale)
  const showEmpty = empty !== null && data.nodes.length === 0

  return (
    <div className="flex flex-col h-full bg-card">
      <GraphControls
        mode={selection.mode}
        canSwitchToLocal={focusEntry !== null}
        depth={depth}
        query={query}
        showArchived={showArchived}
        showOrphans={showOrphans}
        onModeChange={handleModeChange}
        onDepthChange={handleDepthChange}
        onQueryChange={setQuery}
        onToggleArchived={() => setShowArchived((value) => !value)}
        onToggleOrphans={() => setShowOrphans((value) => !value)}
        onZoomIn={() => canvasRef.current?.zoomBy(1.4)}
        onZoomOut={() => canvasRef.current?.zoomBy(1 / 1.4)}
        onFit={() => canvasRef.current?.zoomToFit()}
        locale={locale}
      />

      <div className="flex flex-1 min-h-0">
        <div
          ref={paneRef}
          className="relative flex-1 min-w-0 overflow-hidden"
          onContextMenu={(event) => event.preventDefault()}
        >
          {showEmpty ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
              <Graph size={32} />
              <p className="text-sm">{empty}</p>
            </div>
          ) : size.width > 0 && size.height > 0 ? (
            <>
              <GraphCanvas
                ref={canvasRef}
                data={data}
                entries={entries}
                width={size.width}
                height={size.height}
                theme={theme}
                selectedId={visibleSelectedPath}
                onNodeClick={(node) => handleNodeClick(node.id)}
                onNodeRightClick={(node) => handleNodeRightClick(node.id)}
              />
              <GraphLegend nodes={data.nodes} entries={entries} locale={locale} />
            </>
          ) : null}
        </div>

        {rightPane && rightPaneWidth !== undefined && onRightPaneResize && (
          <>
            <ResizeHandle onResize={onRightPaneResize} />
            <div
              className="flex flex-col h-full min-h-0 flex-shrink-0 border-l border-border overflow-hidden [&>*]:flex-1 [&>*]:min-h-0"
              style={{ width: rightPaneWidth }}
            >
              {rightPane}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-3 px-3 py-1.5 border-t border-border bg-card text-xs text-muted-foreground tabular-nums">
        <span>{translate(locale, 'graph.stats.nodes', { count: String(data.nodes.length) })}</span>
        <span>·</span>
        <span>{translate(locale, 'graph.stats.links', { count: String(data.links.length) })}</span>
        {selection.mode === 'local' && focusEntry && (
          <>
            <span>·</span>
            <span className="truncate">{translate(locale, 'graph.stats.focus', { title: focusEntry.title || focusEntry.filename })}</span>
          </>
        )}
      </div>
    </div>
  )
}
