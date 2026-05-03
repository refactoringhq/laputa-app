import { memo } from 'react'
import { translate, type AppLocale, type TranslationKey } from '../../lib/i18n'
import type { NoteListFilter } from '../../utils/noteListHelpers'

interface FilterPillsProps {
  active: NoteListFilter
  counts: Record<NoteListFilter, number>
  onChange: (filter: NoteListFilter) => void
  position?: 'top' | 'bottom'
  locale?: AppLocale
}

const PILLS: { value: NoteListFilter; labelKey: TranslationKey }[] = [
  { value: 'open', labelKey: 'noteList.filter.open' },
  { value: 'archived', labelKey: 'noteList.filter.archived' },
]

const BOTTOM_GRADIENT = 'linear-gradient(to bottom, transparent 0%, var(--card) 30%, var(--card) 100%)'

function FilterPillsInner({ active, counts, onChange, position = 'top', locale = 'en' }: FilterPillsProps) {
  const isBottom = position === 'bottom'
  return (
    <div
      className={isBottom
        ? 'absolute bottom-0 left-0 right-0 z-10 flex flex-wrap items-center justify-center gap-2 px-4 py-3'
        : 'flex h-auto min-h-[45px] shrink-0 flex-wrap items-center gap-1 border-b border-border px-4 py-1.5'}
      style={isBottom ? { background: BOTTOM_GRADIENT } : undefined}
      data-testid="filter-pills"
    >
      {PILLS.map(({ value, labelKey }) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={active === value}
          className={`inline-flex whitespace-nowrap items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
            active === value
              ? 'border-foreground/20 bg-foreground/10 text-foreground'
              : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
          onClick={() => onChange(value)}
          data-testid={`filter-pill-${value}`}
        >
          {translate(locale, labelKey)}
          <span className={`text-[10px] tabular-nums ${active === value ? 'text-foreground/70' : 'text-muted-foreground/70'}`}>
            {counts[value]}
          </span>
        </button>
      ))}
    </div>
  )
}

export const FilterPills = memo(FilterPillsInner)
