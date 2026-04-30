import { memo } from 'react'
import { MagnifyingGlass, Plus, Minus, ArrowsOut } from '@phosphor-icons/react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Slider } from '../ui/slider'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { translate, type AppLocale, type TranslationKey } from '../../lib/i18n'
import type { GraphMode } from '../../types'

interface GraphControlsProps {
  mode: GraphMode
  canSwitchToLocal: boolean
  depth: number
  query: string
  showArchived: boolean
  showOrphans: boolean
  onModeChange: (mode: GraphMode) => void
  onDepthChange: (depth: number) => void
  onQueryChange: (query: string) => void
  onToggleArchived: () => void
  onToggleOrphans: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  locale: AppLocale
}

function GraphControlsImpl(props: GraphControlsProps) {
  const t = (key: TranslationKey) => translate(props.locale, key)
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card">
      <ToggleGroup
        type="single"
        value={props.mode}
        onValueChange={(value) => {
          if (value === 'global' || value === 'local') props.onModeChange(value)
        }}
      >
        <ToggleGroupItem value="global" aria-label={t('graph.mode.global')}>
          {t('graph.mode.global')}
        </ToggleGroupItem>
        <ToggleGroupItem
          value="local"
          aria-label={t('graph.mode.local')}
          disabled={!props.canSwitchToLocal}
        >
          {t('graph.mode.local')}
        </ToggleGroupItem>
      </ToggleGroup>

      {props.mode === 'local' && (
        <div className="flex items-center gap-2 min-w-[140px]">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {t('graph.depth.label')}
          </span>
          <Slider
            min={1}
            max={3}
            step={1}
            value={[props.depth]}
            onValueChange={(values) => props.onDepthChange(values[0] ?? 1)}
            className="w-20"
          />
          <span className="text-xs text-muted-foreground tabular-nums w-3">{props.depth}</span>
        </div>
      )}

      <div className="relative flex-1 min-w-[180px] max-w-[260px]">
        <MagnifyingGlass
          size={14}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder={t('graph.search.placeholder')}
          className="h-7 pl-7 text-xs"
        />
      </div>

      <ToggleGroup type="multiple" value={[
        ...(props.showArchived ? ['archived'] : []),
        ...(props.showOrphans ? ['orphans'] : []),
      ]}>
        <ToggleGroupItem
          value="archived"
          aria-label={t('graph.toggle.archived')}
          onClick={props.onToggleArchived}
        >
          {t('graph.toggle.archived')}
        </ToggleGroupItem>
        <ToggleGroupItem
          value="orphans"
          aria-label={t('graph.toggle.orphans')}
          onClick={props.onToggleOrphans}
        >
          {t('graph.toggle.orphans')}
        </ToggleGroupItem>
      </ToggleGroup>

      <div className="flex items-center gap-1 ml-auto">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={props.onZoomOut}
          aria-label={t('graph.zoom.out')}
        >
          <Minus size={14} />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={props.onZoomIn}
          aria-label={t('graph.zoom.in')}
        >
          <Plus size={14} />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={props.onFit}
          aria-label={t('graph.zoom.fit')}
        >
          <ArrowsOut size={14} />
        </Button>
      </div>
    </div>
  )
}

export const GraphControls = memo(GraphControlsImpl)
