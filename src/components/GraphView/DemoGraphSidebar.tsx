import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { ScrollArea } from '../ui/scroll-area'
import type { createTranslator } from '../../lib/i18n'
import type { GraphColorizer } from './graphColors'
import type {
  DemoGraphFilters, DemoGraphStats, GraphColorMode, GraphEdgeKind, GraphRenderer,
  GraphSizeMode, GraphViewMode,
} from './graphTypes'

export type CytoLayout = 'cose' | 'circle' | 'concentric' | 'breadthfirst' | 'grid'

interface DemoGraphSidebarProps {
  t: ReturnType<typeof createTranslator>
  stats: DemoGraphStats
  colorizer: GraphColorizer
  filters: DemoGraphFilters
  onFilters: (changes: Partial<DemoGraphFilters>) => void
  renderer: GraphRenderer
  onRenderer: (renderer: GraphRenderer) => void
  colorMode: GraphColorMode
  onColorMode: (mode: GraphColorMode) => void
  sizeMode: GraphSizeMode
  onSizeMode: (mode: GraphSizeMode) => void
  viewMode: GraphViewMode
  onViewMode: (mode: GraphViewMode) => void
  cytoLayout: CytoLayout
  onCytoLayout: (layout: CytoLayout) => void
  visibleCount: { nodes: number; edges: number }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border px-3 py-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function Choice({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <Button size="xs" variant={active ? 'default' : 'outline'} onClick={onClick}>{children}</Button>
}

function FilterToggle({ checked, label, color, onChange }: {
  checked: boolean; label: string; color?: string; onChange: () => void
}) {
  return (
    <button type="button" className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-accent" onClick={onChange}>
      <Checkbox checked={checked} tabIndex={-1} />
      {color && <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
      <span className="truncate">{label}</span>
    </button>
  )
}

function toggled<T>(current: Set<T>, item: T): Set<T> {
  const next = new Set(current)
  if (next.has(item)) next.delete(item)
  else next.add(item)
  return next
}

export function DemoGraphSidebar(props: DemoGraphSidebarProps) {
  const { filters, stats } = props
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-muted/20">
      <div className="border-b border-border px-3 py-3">
        <h2 className="text-sm font-semibold">{props.t('graph.title')}</h2>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {props.t('graph.stats', { visibleNodes: props.visibleCount.nodes, nodes: stats.nodeCount, visibleEdges: props.visibleCount.edges, edges: stats.edgeCount })}
        </p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <Section title={props.t('graph.search')}>
          <Input
            aria-label={props.t('graph.searchAria')}
            value={filters.search}
            onChange={(event) => props.onFilters({ search: event.target.value })}
            placeholder={props.t('graph.searchPlaceholder')}
            className="h-8 text-xs"
          />
        </Section>
        <Section title={props.t('graph.renderer')}>
          <div className="flex flex-wrap gap-1.5">
            <Choice active={props.renderer === '2d'} onClick={() => props.onRenderer('2d')}>2D</Choice>
            <Choice active={props.renderer === '3d'} onClick={() => props.onRenderer('3d')}>3D</Choice>
            <Choice active={props.renderer === 'cyto'} onClick={() => props.onRenderer('cyto')}>{props.t('graph.analyze')}</Choice>
          </div>
          {props.renderer === 'cyto' && (
            <div className="mt-2 flex flex-wrap gap-1">
              {(['cose', 'concentric', 'circle', 'breadthfirst', 'grid'] as CytoLayout[]).map((layout) => (
                <Choice key={layout} active={props.cytoLayout === layout} onClick={() => props.onCytoLayout(layout)}>{layout}</Choice>
              ))}
            </div>
          )}
        </Section>
        <Section title={props.t('graph.view')}>
          <div className="flex gap-1.5">
            <Choice active={props.viewMode === 'global'} onClick={() => { props.onViewMode('global'); props.onFilters({ localRoot: null }) }}>{props.t('graph.global')}</Choice>
            <Choice active={props.viewMode === 'local'} onClick={() => props.onViewMode('local')}>{props.t('graph.local')}</Choice>
          </div>
          {props.viewMode === 'local' && (
            <div className="mt-2">
              <p className="mb-1.5 text-[10px] text-muted-foreground">{props.t('graph.localHint')}</p>
              <div className="flex gap-1">
                {[1, 2, 3].map((depth) => (
                  <Choice key={depth} active={filters.localDepth === depth} onClick={() => props.onFilters({ localDepth: depth })}>{props.t('graph.hops', { count: depth })}</Choice>
                ))}
              </div>
            </div>
          )}
        </Section>
        <Section title={props.t('graph.colorBy')}>
          <div className="flex flex-wrap gap-1.5">
            {(['workspace', 'type', 'community', 'tag'] as GraphColorMode[]).map((mode) => (
              <Choice key={mode} active={props.colorMode === mode} onClick={() => props.onColorMode(mode)}>{props.t(`graph.option.${mode}`)}</Choice>
            ))}
          </div>
          <h3 className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{props.t('graph.sizeBy')}</h3>
          <div className="flex flex-wrap gap-1.5">
            {(['degree', 'pagerank', 'uniform'] as GraphSizeMode[]).map((mode) => (
              <Choice key={mode} active={props.sizeMode === mode} onClick={() => props.onSizeMode(mode)}>{props.t(`graph.option.${mode}`)}</Choice>
            ))}
          </div>
        </Section>
        <Section title={props.t('graph.edges')}>
          {(['body-link', 'relationship'] as GraphEdgeKind[]).map((kind) => (
            <FilterToggle key={kind} label={props.t(`graph.edge.${kind}`)} checked={filters.edgeKinds.has(kind)} onChange={() => props.onFilters({ edgeKinds: toggled(filters.edgeKinds, kind) })} />
          ))}
          <FilterToggle label={props.t('graph.ghostNotes')} checked={filters.showGhosts} onChange={() => props.onFilters({ showGhosts: !filters.showGhosts })} />
          <FilterToggle label={props.t('graph.orphans')} checked={filters.showOrphans} onChange={() => props.onFilters({ showOrphans: !filters.showOrphans })} />
        </Section>
        <Section title={props.t('graph.workspaces', { count: stats.workspaces.length })}>
          {stats.workspaces.map((workspace) => (
            <FilterToggle
              key={workspace.id}
              label={`${workspace.label} (${workspace.noteCount})`}
              color={props.colorizer.workspace(workspace.id)}
              checked={filters.workspaces.size === 0 || filters.workspaces.has(workspace.id)}
              onChange={() => {
                const base = filters.workspaces.size === 0 ? new Set(stats.workspaces.map((item) => item.id)) : filters.workspaces
                const next = toggled(base, workspace.id)
                props.onFilters({ workspaces: next.size === stats.workspaces.length ? new Set() : next })
              }}
            />
          ))}
        </Section>
        <Section title={props.t('graph.types', { count: stats.types.length })}>
          {stats.types.map((type) => (
            <FilterToggle
              key={type.name}
              label={`${type.name} (${type.count})`}
              color={props.colorizer.type(type.name)}
              checked={filters.types.size === 0 || filters.types.has(type.name)}
              onChange={() => {
                const base = filters.types.size === 0 ? new Set(stats.types.map((item) => item.name)) : filters.types
                const next = toggled(base, type.name)
                props.onFilters({ types: next.size === stats.types.length ? new Set() : next })
              }}
            />
          ))}
        </Section>
        {stats.tags.length > 0 && (
          <Section title={props.t('graph.tags', { count: stats.tags.length })}>
            {stats.tags.slice(0, 60).map((tag) => (
              <FilterToggle
                key={tag.name}
                label={`#${tag.name} (${tag.count})`}
                color={props.colorizer.tag(tag.name)}
                checked={filters.tags.size === 0 || filters.tags.has(tag.name)}
                onChange={() => {
                  const base = filters.tags.size === 0 ? new Set(stats.tags.map((item) => item.name)) : filters.tags
                  const next = toggled(base, tag.name)
                  props.onFilters({ tags: next.size === stats.tags.length ? new Set() : next })
                }}
              />
            ))}
          </Section>
        )}
      </ScrollArea>
    </aside>
  )
}
