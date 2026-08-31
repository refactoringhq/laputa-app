import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, {
  type ForceGraphMethods as ForceGraph2DMethods,
  type LinkObject as LinkObject2D,
  type NodeObject as NodeObject2D,
} from 'react-force-graph-2d'
import ForceGraph3D, {
  type ForceGraphMethods as ForceGraph3DMethods,
  type NodeObject as NodeObject3D,
} from 'react-force-graph-3d'
import { graphEdgeColor, type GraphColorizer } from './graphColors'
import type { DemoGraphEdge, DemoGraphNode, GraphColorMode, GraphRenderer, GraphSizeMode } from './graphTypes'

interface DemoGraphCanvasProps {
  renderer: Exclude<GraphRenderer, 'cyto'>
  nodes: DemoGraphNode[]
  edges: DemoGraphEdge[]
  colorizer: GraphColorizer
  colorMode: GraphColorMode
  sizeMode: GraphSizeMode
  dark: boolean
  onSelect: (node: DemoGraphNode | null) => void
  focusId: string | null
}

interface RenderNode extends DemoGraphNode {
  x?: number
  y?: number
  z?: number
  val: number
  renderColor: string
}

interface RenderEdge extends DemoGraphEdge {
  renderColor: string
  renderWidth: number
}

function canvasColor(variable: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || fallback
}

function nodeId(value: string | number | NodeObject2D<RenderNode> | undefined): string | null {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return value?.id === undefined ? null : String(value.id)
}

type PositionedRenderNode = NodeObject2D<RenderNode> & { x: number; y: number }

function isPositionedNode(value: unknown): value is PositionedRenderNode {
  return typeof value === 'object'
    && value !== null
    && 'x' in value
    && typeof value.x === 'number'
    && 'y' in value
    && typeof value.y === 'number'
}

export function DemoGraphCanvas(props: DemoGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graph2DRef = useRef<ForceGraph2DMethods<NodeObject2D<RenderNode>, LinkObject2D<RenderNode, RenderEdge>> | undefined>(undefined)
  const graph3DRef = useRef<ForceGraph3DMethods<NodeObject3D<RenderNode>, RenderEdge> | undefined>(undefined)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [hovered, setHovered] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setDimensions({ width: Math.max(240, entry.contentRect.width), height: Math.max(240, entry.contentRect.height) })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const neighbors = useMemo(() => {
    const result = new Map<string, Set<string>>()
    for (const edge of props.edges) {
      const source = result.get(edge.source) ?? new Set<string>()
      const target = result.get(edge.target) ?? new Set<string>()
      source.add(edge.target)
      target.add(edge.source)
      result.set(edge.source, source)
      result.set(edge.target, target)
    }
    return result
  }, [props.edges])

  const sizeFor = useCallback((node: DemoGraphNode) => {
    if (props.sizeMode === 'uniform') return 3
    if (props.sizeMode === 'pagerank') return 2 + Math.sqrt(Math.max(0, node.pagerank)) * 32
    return 2 + Math.sqrt(node.degree) * 2.2
  }, [props.sizeMode])

  const graphData = useMemo(() => ({
    nodes: props.nodes.map((node): RenderNode => ({
      ...node, val: sizeFor(node), renderColor: props.colorizer.node(node, props.colorMode),
    })),
    links: props.edges.map((edge): RenderEdge => ({
      ...edge,
      renderColor: graphEdgeColor(edge.kind, props.dark),
      renderWidth: edge.kind === 'relationship' ? 1.6 : edge.kind === 'tag' ? 0.5 : 1,
    })),
  }), [props.nodes, props.edges, props.colorizer, props.colorMode, props.dark, sizeFor])

  const highlighted = useCallback((id: string) => (
    !hovered || id === hovered || neighbors.get(hovered)?.has(id) === true
  ), [hovered, neighbors])

  const drawNode = useCallback((node: NodeObject2D<RenderNode>, context: CanvasRenderingContext2D, scale: number) => {
    if (node.x === undefined || node.y === undefined) return
    const radius = node.val
    context.save()
    if (!highlighted(node.id)) context.globalAlpha = 0.12
    if (!node.exists) {
      context.beginPath()
      context.setLineDash([3, 3])
      context.strokeStyle = canvasColor('--muted-foreground', '#94a3b8')
      context.lineWidth = 1.2 / scale + 0.6
      context.arc(node.x, node.y, radius, 0, Math.PI * 2)
      context.stroke()
      context.setLineDash([])
    } else {
      if (props.dark && highlighted(node.id)) {
        context.shadowColor = node.renderColor
        context.shadowBlur = 12
      }
      context.beginPath()
      context.fillStyle = node.renderColor
      context.arc(node.x, node.y, radius, 0, Math.PI * 2)
      context.fill()
      context.shadowBlur = 0
    }
    if (hovered === node.id || node.id === props.focusId) {
      const fontSize = Math.max(3, 12 / scale)
      context.font = `${node.id === props.focusId ? '600 ' : ''}${fontSize}px Inter, system-ui, sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'top'
      context.fillStyle = canvasColor('--foreground', props.dark ? '#f8fafc' : '#0f172a')
      context.fillText(node.label, node.x, node.y + radius + 2)
    }
    context.restore()
  }, [highlighted, hovered, props.dark, props.focusId])

  const drawLink = useCallback((link: LinkObject2D<RenderNode, RenderEdge>, context: CanvasRenderingContext2D) => {
    const sourceId = nodeId(link.source)
    const targetId = nodeId(link.target)
    if (!sourceId || !targetId || !isPositionedNode(link.source) || !isPositionedNode(link.target)) return
    context.save()
    if (!highlighted(sourceId) || !highlighted(targetId)) context.globalAlpha = 0.08
    context.beginPath()
    context.moveTo(link.source.x, link.source.y)
    context.lineTo(link.target.x, link.target.y)
    context.strokeStyle = link.renderColor
    context.lineWidth = link.renderWidth
    context.stroke()
    context.restore()
  }, [highlighted])

  useEffect(() => {
    if (!props.focusId) return
    const node = graphData.nodes.find((candidate) => candidate.id === props.focusId)
    if (!node || node.x === undefined || node.y === undefined) return
    graph2DRef.current?.centerAt(node.x, node.y, 500)
    graph2DRef.current?.zoom(3, 500)
    if (node.z !== undefined) graph3DRef.current?.cameraPosition({ x: node.x, y: node.y, z: node.z + 90 }, { x: node.x, y: node.y, z: node.z }, 700)
  }, [props.focusId, graphData.nodes])

  const background = canvasColor('--background', props.dark ? '#111827' : '#ffffff')
  return (
    <div ref={containerRef} className="h-full w-full overflow-hidden" data-testid="demo-graph-canvas">
      {props.renderer === '2d' ? (
        <ForceGraph2D<RenderNode, RenderEdge>
          ref={graph2DRef}
          width={dimensions.width}
          height={dimensions.height}
          graphData={graphData}
          nodeId="id"
          linkSource="source"
          linkTarget="target"
          nodeCanvasObject={drawNode}
          linkCanvasObject={drawLink}
          nodePointerAreaPaint={(node, color, context) => {
            if (node.x === undefined || node.y === undefined) return
            context.fillStyle = color
            context.beginPath()
            context.arc(node.x, node.y, node.val + 4, 0, Math.PI * 2)
            context.fill()
          }}
          onNodeClick={(node) => props.onSelect(node)}
          onNodeHover={(node) => setHovered(node ? node.id : null)}
          onBackgroundClick={() => props.onSelect(null)}
          backgroundColor={background}
          cooldownTicks={120}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          onEngineStop={() => graph2DRef.current?.zoomToFit(500, 48)}
        />
      ) : (
        <ForceGraph3D<RenderNode, RenderEdge>
          ref={graph3DRef}
          width={dimensions.width}
          height={dimensions.height}
          graphData={graphData}
          nodeId="id"
          linkSource="source"
          linkTarget="target"
          nodeVal="val"
          nodeColor="renderColor"
          nodeLabel={(node) => `${node.label}${node.type ? ` · ${node.type}` : ''}`}
          linkColor="renderColor"
          linkWidth="renderWidth"
          linkLabel={(edge) => edge.label ?? edge.kind}
          onNodeClick={(node) => props.onSelect(node)}
          onNodeHover={(node) => setHovered(node ? node.id : null)}
          onBackgroundClick={() => props.onSelect(null)}
          backgroundColor={background}
          nodeOpacity={0.92}
          nodeResolution={12}
          linkOpacity={0.38}
          showNavInfo={false}
          cooldownTicks={120}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          onEngineStop={() => graph3DRef.current?.zoomToFit(500, 48)}
        />
      )}
    </div>
  )
}
