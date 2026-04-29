import { useMemo, type HTMLAttributes } from 'react'
import type { VaultEntry, ViewFile } from '../../types'
import { evaluateView } from '../../utils/viewFilters'
import { Funnel, PencilSimple, Trash } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { NoteTitleIcon } from '../NoteTitleIcon'
import { SidebarCountPill } from '../SidebarParts'
import { SIDEBAR_ITEM_PADDING } from './sidebarStyles'
import { translate, type AppLocale } from '../../lib/i18n'
import { ACCENT_COLORS } from '../../utils/typeColors'

interface ViewAccent {
  color: string
  background: string
}

interface SidebarViewItemProps {
  view: ViewFile
  isActive: boolean
  onSelect: () => void
  onEditView?: (filename: string) => void
  onDeleteView?: (filename: string) => void
  dragHandleProps?: HTMLAttributes<HTMLDivElement>
  entries: VaultEntry[]
  locale?: AppLocale
}

function resolveViewAccent(color: string | null): ViewAccent | null {
  const colorKey = color?.trim().toLowerCase()
  if (!colorKey) return null
  const accent = ACCENT_COLORS.find((candidate) => candidate.key === colorKey)
  if (!accent) return null
  return {
    color: accent.css,
    background: accent.cssLight,
  }
}

function getViewRowStyle(showCount: boolean, isActive: boolean, accent: ViewAccent | null) {
  return {
    padding: showCount ? SIDEBAR_ITEM_PADDING.withCount : SIDEBAR_ITEM_PADDING.regular,
    borderRadius: 4,
    ...(isActive && accent ? { background: accent.background, color: accent.color } : {}),
  }
}

function ViewIcon({
  icon,
  isActive,
  accent,
}: {
  icon: string | null
  isActive: boolean
  accent: ViewAccent | null
}) {
  if (icon) return <NoteTitleIcon icon={icon} size={16} color={accent?.color} />
  return <Funnel size={16} weight={isActive ? 'fill' : 'regular'} style={accent ? { color: accent.color } : undefined} />
}

function ViewCountChip({
  count,
  isActive,
  accent,
}: {
  count: number
  isActive: boolean
  accent: ViewAccent | null
}) {
  if (count <= 0) return null
  return (
    <SidebarCountPill
      count={count}
      className="text-muted-foreground transition-opacity group-hover:opacity-0 group-focus-within:opacity-0"
      style={isActive && accent ? { background: accent.color, color: 'var(--text-inverse)' } : { background: 'var(--muted)' }}
      testId="view-count-chip"
    />
  )
}

export function SidebarViewItem({
  view,
  isActive,
  onSelect,
  onEditView,
  onDeleteView,
  dragHandleProps,
  entries,
  locale = 'en',
}: SidebarViewItemProps) {
  const count = useMemo(() => evaluateView(view.definition, entries).length, [view.definition, entries])
  const showCount = count > 0
  const accent = resolveViewAccent(view.definition.color)

  return (
    <div className="group relative">
      <div
        className={`flex cursor-pointer select-none items-center gap-2 rounded transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent'}`}
        style={getViewRowStyle(showCount, isActive, accent)}
        onClick={onSelect}
        {...dragHandleProps}
      >
        <ViewIcon icon={view.definition.icon} isActive={isActive} accent={accent} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{view.definition.name}</span>
        <ViewCountChip count={count} isActive={isActive} accent={accent} />
      </div>
      <div className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        {onEditView && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="h-5 w-5 min-w-0 rounded p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={(event) => { event.stopPropagation(); onEditView(view.filename) }}
            title={translate(locale, 'sidebar.action.editView')}
            aria-label={translate(locale, 'sidebar.action.editView')}
          >
            <PencilSimple size={12} />
          </Button>
        )}
        {onDeleteView && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="h-5 w-5 min-w-0 rounded p-0 text-muted-foreground hover:bg-transparent hover:text-destructive"
            onClick={(event) => { event.stopPropagation(); onDeleteView(view.filename) }}
            title={translate(locale, 'sidebar.action.deleteView')}
            aria-label={translate(locale, 'sidebar.action.deleteView')}
          >
            <Trash size={12} />
          </Button>
        )}
      </div>
    </div>
  )
}
