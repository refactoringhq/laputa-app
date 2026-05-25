import type { VaultEntry } from '../../types'

export interface GraphNode {
  id: string           // entry.title or target title
  title: string
  val: number          // node size = degree (connections count)
  color: string | null // from entry.color or default
  archived: boolean
  icon: string | null
  isGhost?: boolean    // true if unresolved/dangling wikilink target
  x?: number
  y?: number
}

export interface GraphLink {
  source: string
  target: string
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

export interface BuildGraphOptions {
  showOrphans: boolean
  showGhosts: boolean
  searchFilter: string
}

const ACCENT_COLORS: Record<string, string> = {
  red: '#ef4444',
  purple: '#a855f7',
  blue: '#3b82f6',
  green: '#22c55e',
  yellow: '#eab308',
  orange: '#f97316',
}

function resolveNodeColor(entry: VaultEntry): string {
  if (entry.color && ACCENT_COLORS[entry.color]) {
    return ACCENT_COLORS[entry.color]
  }
  return '#6b7280' // default neutral gray
}

export function buildGraphData(
  entries: VaultEntry[],
  opts: BuildGraphOptions
): GraphData {
  const byTitle = new Map<string, VaultEntry>()
  const byPath = new Map<string, VaultEntry>()

  for (const e of entries) {
    byTitle.set(e.title.toLowerCase(), e)
    byPath.set(e.path.toLowerCase(), e)
    if (e.aliases) {
      for (const alias of e.aliases) {
        byTitle.set(alias.toLowerCase(), e)
      }
    }
  }

  const links: GraphLink[] = []
  const degreeMap = new Map<string, number>()
  const ghostSet = new Set<string>()
  const ghostOrigins = new Map<string, string>() // target title -> original casing

  // Initialize degrees for existing entries
  for (const entry of entries) {
    degreeMap.set(entry.title, 0)
  }

  // Build edges
  for (const entry of entries) {
    if (!entry.outgoingLinks) continue

    for (const target of entry.outgoingLinks) {
      if (!target.trim()) continue
      const resolved = byTitle.get(target.toLowerCase()) || byPath.get(target.toLowerCase())

      if (resolved) {
        // Prevent duplicate link entries in undirected graph visualization to keep simulation stable
        const linkExists = links.some(
          l =>
            (l.source === entry.title && l.target === resolved.title) ||
            (l.source === resolved.title && l.target === entry.title)
        )
        if (!linkExists) {
          links.push({ source: entry.title, target: resolved.title })
        }
        degreeMap.set(entry.title, (degreeMap.get(entry.title) ?? 0) + 1)
        degreeMap.set(resolved.title, (degreeMap.get(resolved.title) ?? 0) + 1)
      } else if (opts.showGhosts) {
        // Unresolved/ghost node link
        const ghostId = target // Canonical target string serves as ID
        ghostSet.add(ghostId.toLowerCase())
        ghostOrigins.set(ghostId.toLowerCase(), ghostId)

        const linkExists = links.some(
          l =>
            (l.source === entry.title && l.target === ghostId) ||
            (l.source === ghostId && l.target === entry.title)
        )
        if (!linkExists) {
          links.push({ source: entry.title, target: ghostId })
        }
        degreeMap.set(entry.title, (degreeMap.get(entry.title) ?? 0) + 1)
        degreeMap.set(ghostId, (degreeMap.get(ghostId) ?? 0) + 1)
      }
    }
  }

  // Map entries to nodes
  let filteredEntries = entries
  if (!opts.showOrphans) {
    filteredEntries = entries.filter(e => (degreeMap.get(e.title) ?? 0) > 0)
  }

  // Apply search filter to nodes
  if (opts.searchFilter.trim()) {
    const q = opts.searchFilter.toLowerCase()
    filteredEntries = filteredEntries.filter(e => e.title.toLowerCase().includes(q))
  }

  const activeNodesSet = new Set(filteredEntries.map(e => e.title))
  const nodes: GraphNode[] = filteredEntries.map(entry => ({
    id: entry.title,
    title: entry.title,
    val: Math.max(1, degreeMap.get(entry.title) ?? 1),
    color: resolveNodeColor(entry),
    archived: entry.archived,
    icon: entry.icon,
    isGhost: false,
  }))

  // Add ghost nodes if options allow and search filter matches (or search is empty)
  if (opts.showGhosts) {
    for (const ghostKey of ghostSet) {
      const originalTitle = ghostOrigins.get(ghostKey) || ghostKey
      const matchSearch =
        !opts.searchFilter.trim() ||
        originalTitle.toLowerCase().includes(opts.searchFilter.toLowerCase())
      
      const isOrphan = (degreeMap.get(originalTitle) ?? 0) === 0
      const shouldInclude = matchSearch && (opts.showOrphans || !isOrphan)

      if (shouldInclude) {
        nodes.push({
          id: originalTitle,
          title: originalTitle,
          val: Math.max(1, degreeMap.get(originalTitle) ?? 1),
          color: '#9ca3af', // gray color for ghost nodes
          archived: false,
          icon: null,
          isGhost: true,
        })
        activeNodesSet.add(originalTitle)
      }
    }
  }

  // Filter links so they only connect active nodes
  const filteredLinks = links.filter(
    l => activeNodesSet.has(l.source) && activeNodesSet.has(l.target)
  )

  return { nodes, links: filteredLinks }
}

function buildAdjacency(links: GraphLink[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>()
  for (const link of links) {
    const s = link.source
    const t = link.target
    
    let sSet = adjacency.get(s)
    if (!sSet) {
      sSet = new Set()
      adjacency.set(s, sSet)
    }
    
    let tSet = adjacency.get(t)
    if (!tSet) {
      tSet = new Set()
      adjacency.set(t, tSet)
    }
    
    sSet.add(t)
    tSet.add(s)
  }
  return adjacency
}

export function filterByDepth(
  data: GraphData,
  focusNodeId: string,
  maxDepth: number
): GraphData {
  const adjacency = buildAdjacency(data.links)

  const visited = new Set<string>()
  let frontier = [focusNodeId]

  for (let d = 0; d <= maxDepth; d++) {
    const next: string[] = []
    for (const nodeId of frontier) {
      if (visited.has(nodeId)) continue
      visited.add(nodeId)
      
      const neighbors = adjacency.get(nodeId)
      if (neighbors) {
        for (const neighbor of neighbors) {
          next.push(neighbor)
        }
      }
    }
    frontier = next
  }

  const nodes = data.nodes.filter(n => visited.has(n.id))
  const nodeSet = new Set(nodes.map(n => n.id))
  
  const links = data.links.filter(
    l => nodeSet.has(l.source) && nodeSet.has(l.target)
  )

  return { nodes, links }
}
