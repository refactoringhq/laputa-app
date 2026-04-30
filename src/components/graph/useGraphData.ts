import { useMemo } from 'react'
import type { GraphMode, VaultEntry } from '../../types'
import { wikilinkTarget } from '../../utils/wikilink'
import {
  buildEntryLookup,
  findMatchedEntries,
  type EntryLookup,
} from '../inspector/useInspectorData'

export interface GraphNode {
  id: string
  title: string
  isA: string | null
  archived: boolean
  degree: number
  isFocus: boolean
  colorKey: string | null
}

export interface GraphLink {
  source: string
  target: string
  bidirectional: boolean
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

export interface UseGraphDataOptions {
  entries: VaultEntry[]
  mode: GraphMode
  focus?: VaultEntry | null
  depth?: number
  showArchived: boolean
  showOrphans: boolean
  query: string
}

interface DirectedAdjacency {
  outgoing: Map<string, Set<string>>
}

function collectOutgoingTargets(entry: VaultEntry): string[] {
  const targets: string[] = []
  for (const raw of entry.outgoingLinks) targets.push(raw)
  for (const refs of Object.values(entry.relationships)) {
    for (const ref of refs) targets.push(wikilinkTarget(ref))
  }
  for (const ref of entry.belongsTo) targets.push(wikilinkTarget(ref))
  for (const ref of entry.relatedTo) targets.push(wikilinkTarget(ref))
  return targets
}

function buildAdjacency(entries: VaultEntry[], lookup: EntryLookup): DirectedAdjacency {
  const outgoing = new Map<string, Set<string>>()
  for (const entry of entries) {
    const neighbors = new Set<string>()
    for (const target of collectOutgoingTargets(entry)) {
      for (const matched of findMatchedEntries(target, lookup)) {
        if (matched.path !== entry.path) neighbors.add(matched.path)
      }
    }
    outgoing.set(entry.path, neighbors)
  }
  return { outgoing }
}

function expandNeighborhood(
  focusPath: string,
  depth: number,
  adjacency: DirectedAdjacency,
): Set<string> {
  const reachable = new Set<string>([focusPath])
  let frontier = new Set<string>([focusPath])
  for (let hop = 0; hop < depth; hop += 1) {
    const next = new Set<string>()
    for (const nodePath of frontier) {
      for (const neighbor of adjacency.outgoing.get(nodePath) ?? []) {
        if (!reachable.has(neighbor)) {
          reachable.add(neighbor)
          next.add(neighbor)
        }
      }
      // walk inbound edges too
      for (const [otherPath, neighbors] of adjacency.outgoing) {
        if (neighbors.has(nodePath) && !reachable.has(otherPath)) {
          reachable.add(otherPath)
          next.add(otherPath)
        }
      }
    }
    frontier = next
  }
  return reachable
}

function buildLinks(
  visiblePaths: Set<string>,
  adjacency: DirectedAdjacency,
): GraphLink[] {
  const seen = new Map<string, GraphLink>()
  for (const sourcePath of visiblePaths) {
    for (const targetPath of adjacency.outgoing.get(sourcePath) ?? []) {
      if (!visiblePaths.has(targetPath)) continue
      const forwardKey = `${sourcePath}→${targetPath}`
      const reverseKey = `${targetPath}→${sourcePath}`
      const existing = seen.get(reverseKey)
      if (existing) {
        existing.bidirectional = true
        continue
      }
      seen.set(forwardKey, { source: sourcePath, target: targetPath, bidirectional: false })
    }
  }
  return [...seen.values()]
}

function computeDegree(path: string, links: GraphLink[]): number {
  let count = 0
  for (const link of links) {
    if (link.source === path || link.target === path) count += 1
  }
  return count
}

function matchesQuery(entry: VaultEntry, query: string): boolean {
  if (!query) return true
  const needle = query.toLowerCase()
  if (entry.title.toLowerCase().includes(needle)) return true
  for (const alias of entry.aliases) {
    if (alias.toLowerCase().includes(needle)) return true
  }
  return false
}

function filterEntries(options: UseGraphDataOptions, entries: VaultEntry[]): VaultEntry[] {
  return entries.filter((entry) => {
    if (entry.fileKind === 'binary') return false
    if (!options.showArchived && entry.archived) return false
    return matchesQuery(entry, options.query)
  })
}

function buildVisiblePaths(
  options: UseGraphDataOptions,
  candidates: VaultEntry[],
  adjacency: DirectedAdjacency,
): Set<string> {
  if (options.mode === 'local' && options.focus) {
    const depth = Math.max(1, Math.min(3, options.depth ?? 1))
    const reachable = expandNeighborhood(options.focus.path, depth, adjacency)
    const candidatePaths = new Set(candidates.map((e) => e.path))
    return new Set([...reachable].filter((p) => candidatePaths.has(p)))
  }
  return new Set(candidates.map((e) => e.path))
}

export function buildGraphData(options: UseGraphDataOptions): GraphData {
  const lookup = buildEntryLookup(options.entries)
  const adjacency = buildAdjacency(options.entries, lookup)
  const candidates = filterEntries(options, options.entries)
  const visiblePaths = buildVisiblePaths(options, candidates, adjacency)
  const links = buildLinks(visiblePaths, adjacency)

  const focusPath = options.mode === 'local' && options.focus ? options.focus.path : null
  const candidateMap = new Map(candidates.map((e) => [e.path, e]))

  const nodes: GraphNode[] = []
  for (const path of visiblePaths) {
    const entry = candidateMap.get(path)
    if (!entry) continue
    const degree = computeDegree(path, links)
    if (!options.showOrphans && degree === 0 && path !== focusPath) continue
    nodes.push({
      id: path,
      title: entry.title || entry.filename,
      isA: entry.isA,
      archived: entry.archived,
      degree,
      isFocus: path === focusPath,
      colorKey: entry.color,
    })
  }

  const visibleIds = new Set(nodes.map((n) => n.id))
  return {
    nodes,
    links: links.filter((l) => visibleIds.has(l.source) && visibleIds.has(l.target)),
  }
}

/**
 * Stable graph data: memoized so repaints from unrelated parent state changes
 * don't reheat the force simulation and visually jump nodes.
 */
export function useGraphData(
  entries: VaultEntry[],
  mode: GraphMode,
  focus: VaultEntry | null,
  depth: number,
  showArchived: boolean,
  showOrphans: boolean,
  query: string,
): GraphData {
  return useMemo(
    () => buildGraphData({ entries, mode, focus, depth, showArchived, showOrphans, query }),
    [entries, mode, focus, depth, showArchived, showOrphans, query],
  )
}
