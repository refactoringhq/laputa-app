import type { VaultEntry, VaultPropertyValue } from '../../types'
import { resolveEntry } from '../../utils/wikilink'
import type {
  DemoGraphEdge, DemoGraphNode, DemoGraphPayload, DemoGraphStats, GraphEdgeKind,
} from './graphTypes'

function stringValues(value: VaultPropertyValue | undefined): string[] {
  if (typeof value === 'string') return value.split(',').map((part) => part.trim()).filter(Boolean)
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
}

function tagsForEntry(entry: VaultEntry): string[] {
  return [...new Set([
    ...stringValues(entry.properties.tags),
    ...stringValues(entry.properties.Tags),
  ].map((tag) => tag.replace(/^#/, '')))]
}

function workspaceFor(entry: VaultEntry) {
  return {
    id: entry.workspace?.id ?? entry.workspace?.path ?? 'workspace',
    label: entry.workspace?.label ?? 'Workspace',
    color: entry.workspace?.color ?? null,
  }
}

function ghostId(source: VaultEntry, target: string): string {
  return `ghost:${workspaceFor(source).id}:${target.trim().toLowerCase()}`
}

function addAdjacency(adjacency: Map<string, Set<string>>, source: string, target: string) {
  const sourceSet = adjacency.get(source) ?? new Set<string>()
  const targetSet = adjacency.get(target) ?? new Set<string>()
  sourceSet.add(target)
  targetSet.add(source)
  adjacency.set(source, sourceSet)
  adjacency.set(target, targetSet)
}

function connectedCommunities(nodes: DemoGraphNode[], edges: DemoGraphEdge[]): Map<string, number> {
  const adjacency = new Map<string, Set<string>>()
  for (const edge of edges) addAdjacency(adjacency, edge.source, edge.target)
  const communities = new Map<string, number>()
  let community = 0
  for (const node of nodes) {
    if (communities.has(node.id)) continue
    const queue = [node.id]
    communities.set(node.id, community)
    for (const queuedNode of queue) {
      for (const neighbor of adjacency.get(queuedNode) ?? []) {
        if (communities.has(neighbor)) continue
        communities.set(neighbor, community)
        queue.push(neighbor)
      }
    }
    community++
  }
  return communities
}

function pageRank(nodes: DemoGraphNode[], edges: DemoGraphEdge[]): Map<string, number> {
  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, number>()
  for (const node of nodes) incoming.set(node.id, [])
  for (const edge of edges) {
    incoming.get(edge.target)?.push(edge.source)
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1)
  }
  const count = Math.max(nodes.length, 1)
  let ranks = new Map(nodes.map((node) => [node.id, 1 / count]))
  for (let iteration = 0; iteration < 12; iteration++) {
    const next = new Map<string, number>()
    for (const node of nodes) {
      const score = (incoming.get(node.id) ?? []).reduce(
        (sum, source) => sum + (ranks.get(source) ?? 0) / Math.max(outgoing.get(source) ?? 0, 1),
        0,
      )
      next.set(node.id, 0.15 / count + 0.85 * score)
    }
    ranks = next
  }
  return ranks
}

export function buildGraphPayload(entries: VaultEntry[]): DemoGraphPayload {
  const markdownEntries = entries.filter((entry) => (entry.fileKind ?? 'markdown') === 'markdown')
  const nodes = new Map<string, DemoGraphNode>()
  const edges: DemoGraphEdge[] = []
  const edgeKeys = new Set<string>()

  for (const entry of markdownEntries) {
    const workspace = workspaceFor(entry)
    nodes.set(entry.path, {
      id: entry.path, kind: 'note', label: entry.title, type: entry.isA, status: entry.status,
      tags: tagsForEntry(entry), workspace: workspace.id, workspaceLabel: workspace.label,
      path: entry.path, exists: true, icon: entry.icon, color: entry.color,
      degree: 0, inDegree: 0, outDegree: 0, pagerank: 0, community: -1,
    })
  }

  const addEdge = (sourceEntry: VaultEntry, rawTarget: string, kind: GraphEdgeKind, label: string | null) => {
    const target = rawTarget.trim()
    if (!target) return
    const resolved = resolveEntry(markdownEntries, target, sourceEntry)
    const targetId = resolved?.path ?? ghostId(sourceEntry, target)
    if (sourceEntry.path === targetId) return
    if (!resolved && !nodes.has(targetId)) {
      const workspace = workspaceFor(sourceEntry)
      nodes.set(targetId, {
        id: targetId, kind: 'note', label: target, type: null, status: null, tags: [],
        workspace: workspace.id, workspaceLabel: workspace.label, path: null, exists: false,
        icon: null, color: null, degree: 0, inDegree: 0, outDegree: 0, pagerank: 0, community: -1,
      })
    }
    const key = `${sourceEntry.path}\u0000${targetId}\u0000${kind}\u0000${label ?? ''}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({
      id: `edge:${edges.length}`, source: sourceEntry.path, target: targetId, kind, label,
      ...(kind === 'relationship' && label ? { propertyKey: label } : {}),
    })
  }

  for (const entry of markdownEntries) {
    for (const target of entry.outgoingLinks) addEdge(entry, target, 'body-link', null)
    for (const [field, targets] of Object.entries(entry.relationships)) {
      for (const target of targets) addEdge(entry, target, 'relationship', field)
    }
  }

  const typeCounts = new Map<string, number>()
  const tagCounts = new Map<string, number>()
  const workspaceCounts = new Map<string, { label: string; color: string | null; count: number }>()
  for (const entry of markdownEntries) {
    if (entry.isA) typeCounts.set(entry.isA, (typeCounts.get(entry.isA) ?? 0) + 1)
    for (const tag of tagsForEntry(entry)) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    const workspace = workspaceFor(entry)
    const current = workspaceCounts.get(workspace.id) ?? { label: workspace.label, color: workspace.color, count: 0 }
    current.count++
    workspaceCounts.set(workspace.id, current)
  }

  const nodeList = [...nodes.values()]
  const neighbors = new Map<string, Set<string>>()
  for (const edge of edges) addAdjacency(neighbors, edge.source, edge.target)
  const ranks = pageRank(nodeList, edges)
  const communities = connectedCommunities(nodeList, edges)
  const incomingCounts = new Map<string, number>()
  const outgoingCounts = new Map<string, number>()
  for (const edge of edges) {
    outgoingCounts.set(edge.source, (outgoingCounts.get(edge.source) ?? 0) + 1)
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1)
  }
  for (const node of nodeList) {
    node.degree = neighbors.get(node.id)?.size ?? 0
    node.inDegree = incomingCounts.get(node.id) ?? 0
    node.outDegree = outgoingCounts.get(node.id) ?? 0
    node.pagerank = ranks.get(node.id) ?? 0
    node.community = communities.get(node.id) ?? -1
  }

  const componentCount = new Set(communities.values()).size
  const stats: DemoGraphStats = {
    nodeCount: nodeList.length, edgeCount: edges.length,
    noteCount: nodeList.filter((node) => node.kind === 'note').length,
    tagCount: nodeList.filter((node) => node.kind === 'tag').length,
    ghostCount: nodeList.filter((node) => !node.exists).length,
    density: nodeList.length > 1 ? edges.length / (nodeList.length * (nodeList.length - 1)) : 0,
    componentCount, communityCount: componentCount,
    workspaces: [...workspaceCounts].map(([id, value]) => ({ id, label: value.label, color: value.color, noteCount: value.count })),
    types: [...typeCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    tags: [...tagCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  }
  return { nodes: nodeList, edges, stats }
}
