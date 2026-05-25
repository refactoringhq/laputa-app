import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import ForceGraph2D, {
  type ForceGraphMethods,
  type NodeObject,
  type LinkObject,
  type GraphData as ForceGraphData,
} from 'react-force-graph-2d'
import type { GraphNode, GraphData } from './useGraphData'
import { filterByDepth } from './useGraphData'

interface GraphViewProps {
  data: GraphData
  onNodeClick: (nodeTitle: string) => void
  focusNodeId?: string | null
  depth?: number
  isDarkMode?: boolean
}

function getNodeId(nodeOrId: string | number | NodeObject<GraphNode> | undefined): string | null {
  if (typeof nodeOrId === 'string') return nodeOrId
  if (typeof nodeOrId === 'number') return String(nodeOrId)
  if (nodeOrId && typeof nodeOrId === 'object' && nodeOrId.id !== undefined) {
    return String(nodeOrId.id)
  }
  return null
}

function drawGhostNode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  isDarkMode: boolean
) {
  // Ghost Node: Muted dashed circle
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.strokeStyle = isDarkMode ? 'rgba(156, 163, 175, 0.7)' : 'rgba(107, 114, 128, 0.7)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([3, 3])
  ctx.stroke()
  ctx.setLineDash([]) // reset

  // Light background fill inside ghost circle
  ctx.fillStyle = isDarkMode ? 'rgba(31, 41, 55, 0.3)' : 'rgba(243, 244, 246, 0.5)'
  ctx.fill()
}

function drawNormalNode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  glowColor: string,
  isActive: boolean,
  isHovered: boolean,
  isDarkMode: boolean
) {
  // Normal Node: Soft glow halo (Dark mode only)
  if (isDarkMode && isActive) {
    ctx.beginPath()
    ctx.arc(x, y, radius + 4.5, 0, Math.PI * 2)
    ctx.shadowColor = glowColor
    ctx.shadowBlur = isHovered ? 24 : 14
    ctx.fillStyle = glowColor + '26' // ~15% opacity fill
    ctx.fill()
  }

  // Node core
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.shadowColor = glowColor
  ctx.shadowBlur = isDarkMode ? (isHovered ? 18 : 8) : 0
  ctx.fillStyle = glowColor
  ctx.fill()

  // Crisp solid border in light mode or for contrast
  if (!isDarkMode) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

function drawNodeLabel(
  ctx: CanvasRenderingContext2D,
  node: GraphNode,
  globalScale: number,
  isDarkMode: boolean,
  focusNodeId: string | null | undefined,
  hoveredNode: string | null,
  radius: number,
  x: number,
  y: number
) {
  const isHovered = node.id === hoveredNode
  const isHighDegree = node.val > 3
  const showLabel = globalScale > 1.1 || isHovered || isHighDegree
  if (!showLabel) return

  const fontSize = Math.max(7, Math.min(11, 11 / globalScale))
  ctx.font = `${node.id === focusNodeId ? 'bold ' : ''}${fontSize}px Inter, -apple-system, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.shadowBlur = 0
  ctx.fillStyle = isDarkMode ? '#f3f4f6' : '#1f2937'

  let labelText = node.title
  if (labelText.length > 20 && !isHovered) {
    labelText = labelText.substring(0, 17) + '...'
  }
  ctx.fillText(labelText, x, y + radius + 3)
}

interface ValidLinkEndpoints {
  sourceId: string
  targetId: string
  sx: number
  sy: number
  tx: number
  ty: number
}

function getLinkEndpoints(link: LinkObject<GraphNode, unknown>): ValidLinkEndpoints | null {
  if (typeof link.source !== 'object' || typeof link.target !== 'object') return null
  const s = link.source
  const t = link.target
  if (
    s.id === undefined ||
    t.id === undefined ||
    s.x === undefined ||
    s.y === undefined ||
    t.x === undefined ||
    t.y === undefined
  ) {
    return null
  }
  return {
    sourceId: String(s.id),
    targetId: String(t.id),
    sx: s.x,
    sy: s.y,
    tx: t.x,
    ty: t.y,
  }
}

export function GraphView({
  data,
  onNodeClick,
  focusNodeId,
  depth = 2,
  isDarkMode = true,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<
    ForceGraphMethods<NodeObject<GraphNode>, LinkObject<GraphNode, unknown>> | undefined
  >(undefined)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)

  // Responsive sizing via ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return
      const { width, height } = entries[0].contentRect
      setDimensions({ width: width || 800, height: height || 600 })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // Apply depth filter when focus node is set
  const displayData = useMemo(() => {
    if (!focusNodeId) return data
    return filterByDepth(data, focusNodeId, depth)
  }, [data, focusNodeId, depth])

  // Center camera on focused node
  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return

    if (focusNodeId) {
      // Find the node coordinate after simulation warm-up/cool down
      setTimeout(() => {
        const node = displayData.nodes.find((n) => n.id === focusNodeId)
        if (node && node.x !== undefined && node.y !== undefined) {
          graph.centerAt(node.x, node.y, 800) // 800ms pan transition
          graph.zoom(2.2, 800)               // 2.2x zoom transition
        }
      }, 50)
    } else {
      // Reset view to fit all nodes
      setTimeout(() => {
        if (displayData.nodes.length > 0) {
          graph.zoomToFit(800, 40) // fit within 40px padding
        }
      }, 50)
    }
  }, [focusNodeId, displayData])

  // Build neighbor map for hover highlighting (handles simulated object links)
  const neighborMap = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const link of displayData.links) {
      const s = getNodeId(link.source)
      const t = getNodeId(link.target)
      if (!s || !t) continue
      
      let sSet = map.get(s)
      if (!sSet) {
        sSet = new Set()
        map.set(s, sSet)
      }
      let tSet = map.get(t)
      if (!tSet) {
        tSet = new Set()
        map.set(t, tSet)
      }
      sSet.add(t)
      tSet.add(s)
    }
    return map
  }, [displayData])

  // Helper to determine active status
  const isNeighborOrSelf = useCallback(
    (nodeId: string) => {
      if (!hoveredNode) return true
      return nodeId === hoveredNode || !!neighborMap.get(hoveredNode)?.has(nodeId)
    },
    [hoveredNode, neighborMap]
  )

  const handleNodeClick = useCallback(
    (node: NodeObject<GraphNode>) => {
      onNodeClick(String(node.id))
    },
    [onNodeClick]
  )

  // Custom node renderer
  const drawNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (node.x === undefined || node.y === undefined) return

      const isActive = isNeighborOrSelf(node.id)
      const radius = Math.sqrt(node.val) * 3 + 2.5
      const alpha = isActive ? 1.0 : 0.15
      const glowColor = node.color || '#6b7280'
      const isHovered = node.id === hoveredNode

      ctx.save()
      ctx.globalAlpha = alpha

      if (node.isGhost) {
        drawGhostNode(ctx, node.x, node.y, radius, isDarkMode)
      } else {
        drawNormalNode(ctx, node.x, node.y, radius, glowColor, isActive, isHovered, isDarkMode)
      }

      drawNodeLabel(ctx, node, globalScale, isDarkMode, focusNodeId, hoveredNode, radius, node.x, node.y)

      ctx.restore()
    },
    [hoveredNode, isNeighborOrSelf, isDarkMode, focusNodeId]
  )

  // Custom link renderer
  const drawLink = useCallback(
    (link: LinkObject<GraphNode, unknown>, ctx: CanvasRenderingContext2D) => {
      const endpoints = getLinkEndpoints(link)
      if (!endpoints) return

      const { sourceId, targetId, sx, sy, tx, ty } = endpoints
      const sActive = isNeighborOrSelf(sourceId)
      const tActive = isNeighborOrSelf(targetId)
      const isActive = sActive && tActive

      ctx.save()
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.lineTo(tx, ty)

      if (isDarkMode) {
        ctx.strokeStyle = isActive
          ? 'rgba(147, 197, 253, 0.45)' // nice glowing blue for active links
          : 'rgba(75, 85, 99, 0.08)'
        ctx.lineWidth = isActive ? 1.5 : 0.6
      } else {
        ctx.strokeStyle = isActive
          ? 'rgba(59, 130, 246, 0.4)'
          : 'rgba(209, 213, 219, 0.12)'
        ctx.lineWidth = isActive ? 1.2 : 0.5
      }

      ctx.stroke()
      ctx.restore()
      ctx.restore()
    },
    [isNeighborOrSelf, isDarkMode]
  )

  const forceGraphData = useMemo(
    () =>
      displayData as unknown as ForceGraphData<
        NodeObject<GraphNode>,
        LinkObject<GraphNode, unknown>
      >,
    [displayData]
  )

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden transition-colors duration-300"
      style={{ background: isDarkMode ? '#0b0f19' : '#f8fafc' }}
      data-testid="graph-view-canvas"
    >
      <ForceGraph2D
        ref={graphRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={forceGraphData}
        backgroundColor="transparent"
        nodeCanvasObject={drawNode}
        linkCanvasObject={drawLink}
        nodePointerAreaPaint={(node: GraphNode, color, ctx) => {
          if (node.x === undefined || node.y === undefined) return
          // Increase pointer footprint to make clicking small nodes easier
          const radius = Math.sqrt(node.val) * 3 + 8.5
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(node.x, node.y, radius, 0, Math.PI * 2)
          ctx.fill()
        }}
        onNodeHover={(node: NodeObject<GraphNode> | null) =>
          setHoveredNode(node ? String(node.id) : null)
        }
        onNodeClick={handleNodeClick}
        onNodeDragEnd={(node) => {
          // Keep nodes pinned where dragged if desired, or let physics take back
          node.fx = node.x
          node.fy = node.y
        }}
        onBackgroundClick={() => {
          if (hoveredNode) setHoveredNode(null)
        }}
        // Physics tuning for beautiful slow-settle animation
        d3AlphaDecay={0.022}
        d3VelocityDecay={0.36}
        cooldownTicks={160}
        // Enable zoom/pan
        enableZoomInteraction
        enablePanInteraction
        minZoom={0.15}
        maxZoom={7}
      />
    </div>
  )
}
