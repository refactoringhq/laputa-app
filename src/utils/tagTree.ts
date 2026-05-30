import type { VaultEntry } from '../types'

const TAG_KEY_PATTERNS = ['tags', 'keywords', 'categories', 'labels']

export interface TagTreeNode {
  name: string
  fullPath: string
  children: TagTreeNode[]
  count: number
}

function matchesTagKey(key: string): boolean {
  const lower = key.toLowerCase()
  return TAG_KEY_PATTERNS.some((p) => lower === p || lower.includes(p))
}

/** Collect all unique tag values from tag-like properties across all entries. */
export function collectVaultTags(entries: VaultEntry[]): string[] {
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!entry.properties) continue
    for (const [key, value] of Object.entries(entry.properties)) {
      if (!matchesTagKey(key)) continue
      if (Array.isArray(value)) {
        for (const v of value) {
          seen.add(String(v))
        }
      } else if (typeof value === 'string') {
        seen.add(value)
      }
    }
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b))
}

/** Count entries that have the given tag in a tag-like property. */
export function countTagEntries(entries: VaultEntry[], tag: string): number {
  let count = 0
  for (const entry of entries) {
    if (entryHasTag(entry, tag)) count++
  }
  return count
}

/** Check whether an entry has a specific tag value in any tag-like property. */
export function entryHasTag(entry: VaultEntry, tag: string): boolean {
  if (!entry.properties) return false
  for (const [key, value] of Object.entries(entry.properties)) {
    if (!matchesTagKey(key)) continue
    if (Array.isArray(value) && value.includes(tag)) return true
    if (typeof value === 'string' && value === tag) return true
  }
  return false
}

/**
 * Build a tag tree from flat tag strings.
 * Tags with `/` separators are nested into a tree hierarchy.
 */
export function buildTagTree(
  tags: string[],
  getCount: (tag: string) => number,
): TagTreeNode[] {
  type NodeMap = Map<string, { node: TagTreeNode; children: NodeMap }>

  const tagSet = new Set(tags)
  const root = new Map<string, { node: TagTreeNode; children: NodeMap }>()

  // Build tree structure
  for (const tag of tags) {
    const segments = tag.split('/').filter((s) => s.length > 0)
    if (segments.length === 0) continue
    let current = root
    let path = ''

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      path = path ? `${path}/${seg}` : seg

      if (!current.has(seg)) {
        current.set(seg, {
          node: { name: seg, fullPath: path, children: [], count: 0 },
          children: new Map(),
        })
      }
      current = current.get(seg)!.children
    }
  }

  // Convert nested maps to tree nodes with computed counts
  function mapToNodes(map: NodeMap): TagTreeNode[] {
    const result: TagTreeNode[] = []
    for (const [, entry] of map) {
      const childNodes = mapToNodes(entry.children)
      let ownCount = 0
      if (tagSet.has(entry.node.fullPath)) {
        ownCount = getCount(entry.node.fullPath)
      }
      const childCount = childNodes.reduce((sum, c) => sum + c.count, 0)

      result.push({
        ...entry.node,
        children: childNodes,
        count: ownCount + childCount,
      })
    }
    result.sort((a, b) => a.name.localeCompare(b.name))
    return result
  }

  return mapToNodes(root).filter((n) => n.count > 0)
}
