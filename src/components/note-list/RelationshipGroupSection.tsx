import { useMemo } from 'react'
import { CaretDown, CaretRight } from '@phosphor-icons/react'
import type { VaultEntry } from '../../types'
import {
  type SortOption, type SortDirection, type SortConfig, type RelationshipGroup,
  getSortComparator, extractSortableProperties,
} from '../../utils/noteListHelpers'
import { humanizePropertyKey } from '../../utils/propertyLabels'
import { SortDropdown } from '../SortDropdown'
import { Button } from '../ui/button'
import type { AppLocale } from '../../lib/i18n'

export function RelationshipGroupSection({ group, isCollapsed, sortPrefs, locale = 'en', onToggle, handleSortChange, renderItem }: {
  group: RelationshipGroup
  isCollapsed: boolean
  sortPrefs: Record<string, SortConfig>
  locale?: AppLocale
  onToggle: () => void
  handleSortChange: (groupLabel: string, option: SortOption, direction: SortDirection) => void
  renderItem: (entry: VaultEntry, options?: { forceSelected?: boolean }) => React.ReactNode
}) {
  const groupConfig = sortPrefs[group.label] ?? { option: 'modified' as SortOption, direction: 'desc' as SortDirection }
  const sortedEntries = [...group.entries].sort(getSortComparator(groupConfig.option, groupConfig.direction))
  const customProperties = useMemo(() => extractSortableProperties(group.entries), [group.entries])
  const contentId = `relationship-group-${group.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <div>
      <div className="flex w-full items-center justify-between bg-muted" style={{ minHeight: 32, paddingRight: 16 }}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 flex-1 justify-start gap-1.5 rounded-none px-4 hover:bg-muted"
          onClick={onToggle}
          aria-controls={contentId}
          aria-expanded={!isCollapsed}
        >
          {isCollapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
          <span className="font-mono-label text-muted-foreground">{humanizePropertyKey(group.label)}</span>
          <span className="font-mono-label text-muted-foreground" style={{ fontWeight: 400 }}>{group.entries.length}</span>
        </Button>
        <span className="flex items-center gap-1.5">
          <SortDropdown groupLabel={group.label} current={groupConfig.option} direction={groupConfig.direction} customProperties={customProperties} locale={locale} onChange={handleSortChange} />
        </span>
      </div>
      {!isCollapsed && (
        <div id={contentId}>
          {sortedEntries.map((entry) => renderItem(entry))}
        </div>
      )}
    </div>
  )
}
