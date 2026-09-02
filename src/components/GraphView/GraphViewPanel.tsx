import { useEffect, useMemo, useState } from 'react'
import { createTranslator, type AppLocale } from '../../lib/i18n'
import { trackEvent } from '../../lib/telemetry'
import type { VaultEntry } from '../../types'
import { DemoCytoView } from './DemoCytoView'
import { DemoGraphCanvas } from './DemoGraphCanvas'
import { DemoGraphSidebar, type CytoLayout } from './DemoGraphSidebar'
import { DemoNodeDetail } from './DemoNodeDetail'
import { GraphColorizer } from './graphColors'
import { applyGraphFilters, createDefaultGraphFilters } from './graphFilters'
import { buildGraphPayload } from './graphModel'
import type {
  DemoGraphFilters, DemoGraphNode, GraphColorMode, GraphRenderer, GraphSizeMode, GraphViewMode,
} from './graphTypes'

interface GraphViewPanelProps {
  entries: VaultEntry[]
  locale: AppLocale
  onNavigate: (entry: VaultEntry) => void
  onCreateNote?: (title: string) => void
}

function readDarkMode() {
  return document.documentElement.classList.contains('dark')
    || document.documentElement.dataset.theme === 'dark'
}

function useIsDarkMode() {
  const [dark, setDark] = useState(readDarkMode)
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(readDarkMode()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

export function GraphViewPanel({ entries, locale, onNavigate }: GraphViewPanelProps) {
  const [filters, setFilters] = useState<DemoGraphFilters>(createDefaultGraphFilters)
  const [renderer, setRenderer] = useState<GraphRenderer>('2d')
  const [colorMode, setColorMode] = useState<GraphColorMode>('workspace')
  const [sizeMode, setSizeMode] = useState<GraphSizeMode>('degree')
  const [viewMode, setViewMode] = useState<GraphViewMode>('global')
  const [cytoLayout, setCytoLayout] = useState<CytoLayout>('cose')
  const [selected, setSelected] = useState<DemoGraphNode | null>(null)
  const dark = useIsDarkMode()
  const t = useMemo(() => createTranslator(locale), [locale])

  const payload = useMemo(() => buildGraphPayload(entries), [entries])
  const colorizer = useMemo(() => new GraphColorizer(payload.stats), [payload.stats])
  const visible = useMemo(() => applyGraphFilters(payload, filters), [payload, filters])
  const entriesByPath = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries])

  useEffect(() => {
    trackEvent('graph_presentation_opened', { node_count: payload.stats.nodeCount })
  }, [payload.stats.nodeCount])

  const updateFilters = (changes: Partial<DemoGraphFilters>) => {
    setFilters((current) => ({ ...current, ...changes }))
  }
  const handleSelect = (node: DemoGraphNode | null) => {
    setSelected(node)
    if (viewMode === 'local' && node) updateFilters({ localRoot: node.id })
  }
  const explore = (nodeId: string) => {
    trackEvent('graph_neighborhood_opened', { depth: filters.localDepth })
    setViewMode('local')
    updateFilters({ localRoot: nodeId })
  }
  const navigate = (entry: VaultEntry) => {
    trackEvent('graph_node_opened', { renderer })
    onNavigate(entry)
  }

  return (
    <div className="flex h-full w-full bg-background text-foreground" data-testid="tolaria-demo-graph">
      <DemoGraphSidebar
        stats={payload.stats}
        colorizer={colorizer}
        filters={filters}
        onFilters={updateFilters}
        renderer={renderer}
        onRenderer={setRenderer}
        colorMode={colorMode}
        onColorMode={setColorMode}
        sizeMode={sizeMode}
        onSizeMode={setSizeMode}
        viewMode={viewMode}
        onViewMode={setViewMode}
        cytoLayout={cytoLayout}
        onCytoLayout={setCytoLayout}
        visibleCount={{ nodes: visible.nodes.length, edges: visible.edges.length }}
        t={t}
      />
      <main className="relative min-w-0 flex-1">
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-md border border-border bg-background/85 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
          {renderer.toUpperCase()} · {t('graph.colorBy')}: {t(`graph.option.${colorMode}`)} · {t('graph.sizeBy')}: {t(`graph.option.${sizeMode}`)}
          {viewMode === 'local' && filters.localRoot ? ` · ${t('graph.localSummary', { count: filters.localDepth })}` : ''}
        </div>
        {renderer === 'cyto' ? (
          <DemoCytoView
            nodes={visible.nodes}
            edges={visible.edges}
            colorizer={colorizer}
            colorMode={colorMode}
            sizeMode={sizeMode}
            dark={dark}
            layout={cytoLayout}
            onSelect={handleSelect}
          />
        ) : (
          <DemoGraphCanvas
            renderer={renderer}
            nodes={visible.nodes}
            edges={visible.edges}
            colorizer={colorizer}
            colorMode={colorMode}
            sizeMode={sizeMode}
            dark={dark}
            onSelect={handleSelect}
            focusId={selected?.id ?? null}
          />
        )}
        {selected && (
          <DemoNodeDetail
            node={selected}
            payload={payload}
            entriesByPath={entriesByPath}
            colorizer={colorizer}
            onClose={() => setSelected(null)}
            onNavigate={navigate}
            onExplore={explore}
            t={t}
          />
        )}
      </main>
    </div>
  )
}

export default GraphViewPanel
