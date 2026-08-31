export type GraphNodeKind = 'note' | 'tag'
export type GraphEdgeKind = 'body-link' | 'relationship' | 'tag'
export type GraphRenderer = '2d' | '3d' | 'cyto'
export type GraphColorMode = 'workspace' | 'type' | 'community' | 'tag'
export type GraphSizeMode = 'degree' | 'pagerank' | 'uniform'
export type GraphViewMode = 'global' | 'local'

export interface DemoGraphNode {
  id: string
  kind: GraphNodeKind
  label: string
  type: string | null
  status: string | null
  tags: string[]
  workspace: string
  workspaceLabel: string
  path: string | null
  exists: boolean
  icon: string | null
  color: string | null
  degree: number
  inDegree: number
  outDegree: number
  pagerank: number
  community: number
}

export interface DemoGraphEdge {
  id: string
  source: string
  target: string
  kind: GraphEdgeKind
  label: string | null
  propertyKey?: string
}

export interface DemoGraphStats {
  nodeCount: number
  edgeCount: number
  noteCount: number
  tagCount: number
  ghostCount: number
  density: number
  componentCount: number
  communityCount: number
  workspaces: Array<{ id: string; label: string; color: string | null; noteCount: number }>
  types: Array<{ name: string; count: number }>
  tags: Array<{ name: string; count: number }>
}

export interface DemoGraphPayload {
  nodes: DemoGraphNode[]
  edges: DemoGraphEdge[]
  stats: DemoGraphStats
}

export interface DemoGraphFilters {
  workspaces: Set<string>
  types: Set<string>
  tags: Set<string>
  edgeKinds: Set<GraphEdgeKind>
  showGhosts: boolean
  showOrphans: boolean
  search: string
  localRoot: string | null
  localDepth: number
}
