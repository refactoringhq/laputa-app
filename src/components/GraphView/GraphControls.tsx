import { Switch } from '../ui/switch'
import { Input } from '../ui/input'
import { MagnifyingGlass, X } from '@phosphor-icons/react'

interface GraphControlsProps {
  depth: number
  onDepthChange: (depth: number) => void
  showOrphans: boolean
  onShowOrphansChange: (show: boolean) => void
  showGhosts: boolean
  onShowGhostsChange: (show: boolean) => void
  search: string
  onSearchChange: (search: string) => void
  isFocused: boolean
  onClearFocus: () => void
  focusNodeId?: string | null
}

export function GraphControls(props: GraphControlsProps) {
  const {
    depth,
    onDepthChange,
    showOrphans,
    onShowOrphansChange,
    showGhosts,
    onShowGhostsChange,
    search,
    onSearchChange,
    isFocused,
    onClearFocus,
    focusNodeId,
  } = props

  return (
    <div className="absolute bottom-4 left-4 z-20 flex w-64 flex-col gap-4 rounded-xl border border-border bg-background/70 p-4 shadow-2xl backdrop-blur-md transition-all duration-300 ease-in-out select-none">
      {/* Header / Title */}
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Graph Controls
        </span>
        {isFocused && (
          <button
            type="button"
            onClick={onClearFocus}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 active:scale-95 transition-all cursor-pointer"
          >
            <X size={10} />
            Reset Focus
          </button>
        )}
      </div>

      {/* Search Input */}
      <div className="relative flex items-center">
        <MagnifyingGlass
          size={14}
          className="absolute left-2.5 text-muted-foreground/80 pointer-events-none"
        />
        <Input
          placeholder="Search notes..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-8 pl-8 pr-7 text-xs bg-background/50 border-border/60 placeholder:text-muted-foreground/60"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-2 text-muted-foreground/60 hover:text-foreground cursor-pointer"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Focus Mode Node Detail */}
      {isFocused && focusNodeId && (
        <div className="flex flex-col gap-1 rounded-lg bg-accent/40 px-3 py-2 border border-border/30">
          <span className="text-[10px] text-muted-foreground uppercase font-medium tracking-wide">
            Focused Node
          </span>
          <span className="text-xs font-semibold text-foreground truncate">
            {focusNodeId}
          </span>
        </div>
      )}

      {/* Neighborhood Depth Slider */}
      <div className={`flex flex-col gap-1.5 transition-all duration-200 ${isFocused ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-foreground">
            Neighborhood Depth
          </span>
          <span className="text-xs font-mono font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded">
            {depth}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={depth}
            disabled={!isFocused}
            onChange={(e) => onDepthChange(Number(e.target.value))}
            className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary disabled:cursor-not-allowed transition-all"
            style={{
              background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${(depth - 1) * 25}%, var(--muted) ${(depth - 1) * 25}%, var(--muted) 100%)`
            }}
          />
        </div>
        <span className="text-[9px] text-muted-foreground/75 leading-tight">
          Hops visible from focused note
        </span>
      </div>

      {/* Toggle Controls */}
      <div className="flex flex-col gap-2.5 pt-1 border-t border-border/40">
        <div className="flex items-center justify-between hover:bg-accent/20 px-1 py-0.5 rounded transition-colors">
          <span className="text-[11px] font-medium text-foreground">
            Show Orphans
          </span>
          <Switch
            checked={showOrphans}
            onCheckedChange={onShowOrphansChange}
          />
        </div>

        <div className="flex items-center justify-between hover:bg-accent/20 px-1 py-0.5 rounded transition-colors">
          <span className="text-[11px] font-medium text-foreground">
            Show Ghost Notes
          </span>
          <Switch
            checked={showGhosts}
            onCheckedChange={onShowGhostsChange}
          />
        </div>
      </div>
    </div>
  )
}
