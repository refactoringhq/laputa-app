import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react'
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d'
import type { VaultEntry } from '../../types'
import { buildTypeEntryMap, getTypeColor } from '../../utils/typeColors'
import type { GraphData, GraphLink, GraphNode } from './useGraphData'
import type { GraphTheme } from './useGraphTheme'

export interface GraphCanvasHandle {
  zoomToFit: (durationMs?: number) => void
  zoomBy: (factor: number) => void
}

interface GraphCanvasProps {
  data: GraphData
  entries: VaultEntry[]
  width: number
  height: number
  theme: GraphTheme
  selectedId?: string | null
  onNodeClick: (node: GraphNode) => void
  onNodeRightClick?: (node: GraphNode, event: MouseEvent) => void
}

type CanvasNode = NodeObject<GraphNode>
type CanvasLink = LinkObject<GraphNode, GraphLink>

function resolveCssColor(value: string): string {
  if (!value.startsWith('var(')) return value
  const match = value.match(/^var\((--[^)]+)\)$/)
  if (!match) return value
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim()
  return resolved || '#999999'
}

function buildTypeColorResolver(entries: VaultEntry[]): (isA: string | null, colorKey: string | null) => string {
  const typeMap = buildTypeEntryMap(entries)
  const cache = new Map<string, string>()
  return (isA, colorKey) => {
    const key = `${isA ?? ''}|${colorKey ?? ''}`
    const cached = cache.get(key)
    if (cached) return cached
    const typeEntry = isA ? typeMap[isA] ?? typeMap[isA.toLowerCase()] : undefined
    const colorVar = getTypeColor(isA, colorKey ?? typeEntry?.color ?? null)
    const resolved = resolveCssColor(colorVar)
    cache.set(key, resolved)
    return resolved
  }
}

const NODE_RADIUS = 4
const FOCUS_RADIUS = 6

function nodeRadius(node: GraphNode): number {
  return node.isFocus ? FOCUS_RADIUS : NODE_RADIUS
}

function paintNode(
  node: CanvasNode,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  theme: GraphTheme,
  resolveTypeColor: (isA: string | null, colorKey: string | null) => string,
  isSelected: boolean,
): void {
  if (node.x === undefined || node.y === undefined) return
  const radius = nodeRadius(node)
  const fill = node.archived ? theme.nodeArchived : resolveTypeColor(node.isA, node.colorKey)
  const emphasized = node.isFocus || isSelected

  ctx.beginPath()
  ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false)
  ctx.fillStyle = fill
  ctx.fill()

  if (emphasized) {
    ctx.lineWidth = 0.75
    ctx.strokeStyle = node.isFocus ? theme.nodeFocus : theme.nodeSelected
    ctx.globalAlpha = node.isFocus ? 1 : 0.7
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  if (globalScale > 1.4) {
    const fontSize = 11 / globalScale
    ctx.font = `${fontSize}px Inter, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = theme.label
    ctx.fillText(node.title, node.x, node.y + radius + 2)
  }
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvas(
  { data, entries, width, height, theme, selectedId, onNodeClick, onNodeRightClick },
  ref,
) {
  const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined)
  const resolveTypeColor = useMemo(() => buildTypeColorResolver(entries), [entries])

  useImperativeHandle(ref, () => ({
    zoomToFit: (durationMs = 400) => {
      fgRef.current?.zoomToFit(durationMs, 60)
    },
    zoomBy: (factor: number) => {
      const current = fgRef.current?.zoom() ?? 1
      fgRef.current?.zoom(current * factor, 200)
    },
  }), [])

  const handleNodeClick = useCallback((node: CanvasNode) => {
    onNodeClick(node)
  }, [onNodeClick])

  const handleNodeRightClick = useCallback(
    (node: CanvasNode, event: MouseEvent) => {
      onNodeRightClick?.(node, event)
    },
    [onNodeRightClick],
  )

  const nodeCanvasObject = useCallback(
    (node: CanvasNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      paintNode(node, ctx, globalScale, theme, resolveTypeColor, node.id === selectedId)
    },
    [theme, resolveTypeColor, selectedId],
  )

  return (
    <ForceGraph2D<GraphNode, GraphLink>
      ref={fgRef}
      graphData={data}
      width={width}
      height={height}
      backgroundColor={theme.background}
      nodeRelSize={3}
      nodeLabel={(node: CanvasNode) => node.title}
      nodeCanvasObjectMode={() => 'replace'}
      nodeCanvasObject={nodeCanvasObject}
      nodePointerAreaPaint={(node: CanvasNode, color: string, ctx: CanvasRenderingContext2D) => {
        if (node.x === undefined || node.y === undefined) return
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(node.x, node.y, nodeRadius(node) + 2, 0, 2 * Math.PI, false)
        ctx.fill()
      }}
      linkColor={() => theme.link}
      linkWidth={(link: CanvasLink) => (link.bidirectional ? 1.5 : 1)}
      linkDirectionalArrowLength={(link: CanvasLink) => (link.bidirectional ? 0 : 4)}
      linkDirectionalArrowRelPos={1}
      linkDirectionalArrowColor={() => theme.link}
      cooldownTicks={120}
      onNodeClick={handleNodeClick}
      onNodeRightClick={handleNodeRightClick}
    />
  )
})
