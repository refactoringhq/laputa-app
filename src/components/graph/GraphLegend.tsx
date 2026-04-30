import { memo, useMemo } from 'react'
import type { VaultEntry } from '../../types'
import { buildTypeEntryMap, getTypeColor } from '../../utils/typeColors'
import { translate, type AppLocale } from '../../lib/i18n'
import type { GraphNode } from './useGraphData'

interface GraphLegendProps {
  nodes: GraphNode[]
  entries: VaultEntry[]
  locale: AppLocale
}

interface LegendItem {
  label: string
  color: string
  count: number
}

function buildLegendItems(nodes: GraphNode[], entries: VaultEntry[], unknownLabel: string): LegendItem[] {
  const typeMap = buildTypeEntryMap(entries)
  const counts = new Map<string, { color: string; count: number }>()
  for (const node of nodes) {
    const label = node.isA ?? unknownLabel
    const typeEntry = node.isA ? typeMap[node.isA] : undefined
    const color = getTypeColor(node.isA, node.colorKey ?? typeEntry?.color ?? null)
    const existing = counts.get(label)
    if (existing) {
      existing.count += 1
    } else {
      counts.set(label, { color, count: 1 })
    }
  }
  return [...counts.entries()]
    .map(([label, { color, count }]) => ({ label, color, count }))
    .sort((a, b) => b.count - a.count)
}

function GraphLegendImpl({ nodes, entries, locale }: GraphLegendProps) {
  const unknownLabel = translate(locale, 'graph.legend.untyped')
  const items = useMemo(() => buildLegendItems(nodes, entries, unknownLabel), [nodes, entries, unknownLabel])
  if (items.length === 0) return null
  return (
    <div className="absolute bottom-3 left-3 flex items-center gap-3 px-3 py-1.5 rounded-md bg-card/90 backdrop-blur-sm border border-border shadow-sm pointer-events-none max-w-[calc(100%-1.5rem)] overflow-hidden">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
        {translate(locale, 'graph.legend.title')}
      </span>
      <ul className="flex items-center gap-3 overflow-x-auto">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-1.5 text-xs text-foreground whitespace-nowrap">
            <span
              aria-hidden
              className="inline-block size-2.5 rounded-full flex-shrink-0"
              style={{ background: item.color }}
            />
            <span>{item.label}</span>
            <span className="text-muted-foreground tabular-nums">{item.count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export const GraphLegend = memo(GraphLegendImpl)
