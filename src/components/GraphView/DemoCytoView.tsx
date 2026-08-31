import { useEffect, useRef } from 'react'
import cytoscape from 'cytoscape'
import type { GraphColorizer } from './graphColors'
import type { CytoLayout } from './DemoGraphSidebar'
import type { DemoGraphEdge, DemoGraphNode, GraphColorMode, GraphSizeMode } from './graphTypes'

interface DemoCytoViewProps {
  nodes: DemoGraphNode[]
  edges: DemoGraphEdge[]
  colorizer: GraphColorizer
  colorMode: GraphColorMode
  sizeMode: GraphSizeMode
  dark: boolean
  layout: CytoLayout
  onSelect: (node: DemoGraphNode | null) => void
}

export function DemoCytoView(props: DemoCytoViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const nodesById = new Map(props.nodes.map((node) => [node.id, node]))
    const foreground = props.dark ? '#e5e7eb' : '#1f2937'
    const background = props.dark ? '#111827' : '#ffffff'
    const muted = props.dark ? '#6b7280' : '#94a3b8'
    const maxDegree = props.nodes.reduce((maximum, node) => Math.max(maximum, node.degree), 0)
    const labelThreshold = Math.max(3, Math.floor(maxDegree * 0.45))
    const sizeFor = (node: DemoGraphNode) => {
      if (props.sizeMode === 'uniform') return 14
      if (props.sizeMode === 'pagerank') return 10 + Math.sqrt(Math.max(0, node.pagerank)) * 160
      return 10 + Math.sqrt(node.degree) * 7
    }

    const graph = cytoscape({
      container,
      elements: [
        ...props.nodes.map((node) => ({ data: {
          id: node.id, label: node.label, color: props.colorizer.node(node, props.colorMode),
          size: sizeFor(node), ghost: !node.exists, showLabel: node.degree >= labelThreshold,
        } })),
        ...props.edges.map((edge) => ({ data: {
          id: edge.id, source: edge.source, target: edge.target, kind: edge.kind, label: edge.label ?? '',
        } })),
      ],
      style: [
        { selector: 'node', style: {
          'background-color': 'data(color)', width: 'data(size)', height: 'data(size)', label: 'data(label)',
          'font-size': 9, color: foreground, 'text-valign': 'bottom', 'text-margin-y': 4,
          'text-opacity': 0, 'text-background-color': background, 'text-background-opacity': 0.86,
          'text-background-padding': '2',
        } },
        { selector: 'node[?showLabel]', style: { 'text-opacity': 0.92 } },
        { selector: 'node[ghost]', style: {
          'background-opacity': 0.12, 'border-width': 1.5, 'border-color': muted, 'border-style': 'dashed',
        } },
        { selector: 'node.highlighted, node:selected', style: {
          'text-opacity': 1, 'border-width': 3, 'border-color': '#2563eb', 'font-size': 11, 'z-index': 999,
        } },
        { selector: '.faded', style: { opacity: 0.1 } },
        { selector: 'edge', style: {
          width: 1, 'line-color': muted, opacity: 0.3, 'curve-style': 'bezier', 'target-arrow-shape': 'none',
          'text-opacity': 0,
        } },
        { selector: 'edge[kind = "relationship"]', style: {
          width: 1.6, opacity: 0.55, 'target-arrow-shape': 'triangle', 'arrow-scale': 0.7,
          label: 'data(label)', 'font-size': 8, 'text-rotation': 'autorotate', color: foreground,
          'text-background-color': background, 'text-background-opacity': 0.86,
        } },
        { selector: 'edge.highlighted[kind = "relationship"]', style: { 'text-opacity': 1 } },
      ],
      layout: { name: props.layout, animate: false, fit: true, padding: 36 },
    })

    const clearHighlight = () => graph.elements().removeClass('highlighted faded')
    graph.on('mouseover', 'node', (event) => {
      const node = event.target
      const neighborhood = node.closedNeighborhood()
      graph.elements().not(neighborhood).addClass('faded')
      neighborhood.addClass('highlighted')
    })
    graph.on('mouseout', 'node', clearHighlight)
    graph.on('tap', 'node', (event) => props.onSelect(nodesById.get(event.target.id()) ?? null))
    graph.on('tap', (event) => {
      if (event.target === graph) {
        clearHighlight()
        props.onSelect(null)
      }
    })
    return () => graph.destroy()
  }, [props])

  return <div ref={containerRef} className="h-full w-full" data-testid="demo-cyto-canvas" />
}
