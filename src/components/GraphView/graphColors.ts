import type { DemoGraphNode, DemoGraphStats, GraphColorMode } from './graphTypes'

const PALETTE = ['#2563eb', '#8b5cf6', '#0d9488', '#16a34a', '#ea580c', '#db2777', '#ca8a04', '#dc2626', '#64748b']

function colorIndex(value: string): number {
  let hash = 0
  for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return Math.abs(hash) % PALETTE.length
}

export class GraphColorizer {
  private workspaceColors = new Map<string, string>()

  constructor(stats: DemoGraphStats) {
    for (const workspace of stats.workspaces) {
      this.workspaceColors.set(workspace.id, workspace.color ?? PALETTE[colorIndex(workspace.id)])
    }
  }

  node(node: DemoGraphNode, mode: GraphColorMode): string {
    if (!node.exists) return '#94a3b8'
    if (node.kind === 'tag') return this.tag(node.label.replace(/^#/, ''))
    if (mode === 'workspace') return this.workspace(node.workspace)
    if (mode === 'type') return node.type ? this.type(node.type) : '#64748b'
    if (mode === 'tag') return node.tags[0] ? this.tag(node.tags[0]) : '#64748b'
    return node.community >= 0 ? PALETTE[node.community % PALETTE.length] : '#64748b'
  }

  workspace(id: string): string {
    return this.workspaceColors.get(id) ?? PALETTE[colorIndex(id)]
  }

  type(name: string): string {
    return PALETTE[colorIndex(`type:${name}`)]
  }

  tag(name: string): string {
    return PALETTE[colorIndex(`tag:${name}`)]
  }
}

export function graphEdgeColor(kind: string, dark: boolean): string {
  if (kind === 'relationship') return dark ? 'rgba(148,163,184,.56)' : 'rgba(71,85,105,.48)'
  if (kind === 'tag') return dark ? 'rgba(148,163,184,.18)' : 'rgba(71,85,105,.16)'
  return dark ? 'rgba(148,163,184,.34)' : 'rgba(71,85,105,.28)'
}
