import type { DemoGraphFilters, DemoGraphNode, DemoGraphPayload } from './graphTypes'

export function createDefaultGraphFilters(): DemoGraphFilters {
  return {
    workspaces: new Set(), types: new Set(), tags: new Set(),
    edgeKinds: new Set(['body-link', 'relationship']), showGhosts: true, showOrphans: true,
    search: '', localRoot: null, localDepth: 2,
  }
}

function neighborhood(payload: DemoGraphPayload, root: string, depth: number): Set<string> {
  const adjacency = new Map<string, Set<string>>()
  for (const edge of payload.edges) {
    const source = adjacency.get(edge.source) ?? new Set<string>()
    const target = adjacency.get(edge.target) ?? new Set<string>()
    source.add(edge.target)
    target.add(edge.source)
    adjacency.set(edge.source, source)
    adjacency.set(edge.target, target)
  }
  const seen = new Set([root])
  let frontier = [root]
  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (seen.has(neighbor)) continue
        seen.add(neighbor)
        next.push(neighbor)
      }
    }
    frontier = next
  }
  return seen
}

function matchesNode(node: DemoGraphNode, filters: DemoGraphFilters, allowed: Set<string> | null) {
  if (allowed && !allowed.has(node.id)) return false
  if (!node.exists && !filters.showGhosts) return false
  if (filters.workspaces.size > 0 && !filters.workspaces.has(node.workspace)) return false
  if (filters.types.size > 0 && (!node.type || !filters.types.has(node.type))) return false
  if (filters.tags.size > 0 && !node.tags.some((tag) => filters.tags.has(tag))) return false
  const search = filters.search.trim().toLowerCase()
  if (!search) return true
  return `${node.label} ${node.type ?? ''} ${node.tags.join(' ')} ${node.workspaceLabel}`.toLowerCase().includes(search)
}

export function applyGraphFilters(payload: DemoGraphPayload, filters: DemoGraphFilters) {
  const allowed = filters.localRoot ? neighborhood(payload, filters.localRoot, filters.localDepth) : null
  let nodes = payload.nodes.filter((node) => matchesNode(node, filters, allowed))
  let ids = new Set(nodes.map((node) => node.id))
  let edges = payload.edges.filter(
    (edge) => filters.edgeKinds.has(edge.kind) && ids.has(edge.source) && ids.has(edge.target),
  )
  if (!filters.showOrphans) {
    const connected = new Set(edges.flatMap((edge) => [edge.source, edge.target]))
    nodes = nodes.filter((node) => connected.has(node.id) || node.id === filters.localRoot)
    ids = new Set(nodes.map((node) => node.id))
    edges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))
  }
  return { nodes, edges }
}
