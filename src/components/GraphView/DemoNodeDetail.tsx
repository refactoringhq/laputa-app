import { X } from '@phosphor-icons/react'
import { Button } from '../ui/button'
import type { createTranslator } from '../../lib/i18n'
import type { VaultEntry } from '../../types'
import type { GraphColorizer } from './graphColors'
import type { DemoGraphNode, DemoGraphPayload } from './graphTypes'

interface DemoNodeDetailProps {
  t: ReturnType<typeof createTranslator>
  node: DemoGraphNode
  payload: DemoGraphPayload
  entriesByPath: Map<string, VaultEntry>
  colorizer: GraphColorizer
  onClose: () => void
  onNavigate: (entry: VaultEntry) => void
  onExplore: (nodeId: string) => void
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-muted/60 py-1.5 text-center">
      <div className="text-xs font-semibold">{value}</div>
      <div className="text-[9px] text-muted-foreground">{label}</div>
    </div>
  )
}

export function DemoNodeDetail(props: DemoNodeDetailProps) {
  const nodesById = new Map(props.payload.nodes.map((node) => [node.id, node]))
  const related = props.payload.edges
    .filter((edge) => edge.source === props.node.id || edge.target === props.node.id)
    .map((edge) => ({
      edge,
      direction: edge.source === props.node.id ? 'out' : 'in',
      other: nodesById.get(edge.source === props.node.id ? edge.target : edge.source),
    }))
    .filter((connection) => connection.other !== undefined)
    .slice(0, 40)
  const entry = props.node.path ? props.entriesByPath.get(props.node.path) : undefined

  return (
    <aside className="absolute right-3 top-12 z-20 w-80 rounded-xl border border-border bg-background/95 p-3 shadow-xl backdrop-blur">
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: props.colorizer.node(props.node, 'type') }} />
            <h2 className="truncate text-sm font-semibold">{props.node.label}</h2>
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{props.node.workspaceLabel}</p>
        </div>
        <Button aria-label={props.t('graph.detail.close')} size="icon-xs" variant="ghost" onClick={props.onClose}><X /></Button>
      </header>
      <div className="mb-2 flex flex-wrap gap-1">
        {props.node.type && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{props.node.type}</span>}
        {props.node.status && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{props.node.status}</span>}
        {!props.node.exists && <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] text-orange-600">{props.t('graph.detail.ghost')}</span>}
      </div>
      {props.node.tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {props.node.tags.map((tag) => <span key={tag} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">#{tag}</span>)}
        </div>
      )}
      <div className="mb-2 grid grid-cols-3 gap-1">
        <Stat label={props.t('graph.detail.degree')} value={props.node.degree} />
        <Stat label={props.t('graph.detail.pagerank')} value={props.node.pagerank.toFixed(4)} />
        <Stat label={props.t('graph.detail.community')} value={props.node.community >= 0 ? props.node.community : '—'} />
      </div>
      <div className="mb-3 grid grid-cols-2 gap-1.5">
        <Button size="sm" variant="outline" onClick={() => props.onExplore(props.node.id)}>{props.t('graph.detail.explore')}</Button>
        <Button size="sm" disabled={!entry} onClick={() => entry && props.onNavigate(entry)}>{props.t('graph.detail.openNote')}</Button>
      </div>
      {related.length > 0 && (
        <div>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{props.t('graph.detail.connections', { count: related.length })}</h3>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {related.map(({ edge, direction, other }) => (
              <div key={edge.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>{direction === 'out' ? '→' : '←'}</span>
                {edge.label && <span className="rounded bg-muted px-1 text-[9px]">{edge.label}</span>}
                <span className="truncate text-foreground">{other?.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
