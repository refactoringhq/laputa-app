import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { VaultEntry } from '../../types'
import type { SortOption, SortDirection, SortConfig, RelationshipGroup } from '../../utils/noteListHelpers'
import { translate, type AppLocale } from '../../lib/i18n'
import { PinnedCard } from './PinnedCard'
import { RelationshipGroupSection } from './RelationshipGroupSection'
import { NoteCardView } from './NoteCardView'
import { EmptyMessage } from './TrashWarningBanner'

function resolveEmptyText({
  isChangesView,
  changesError,
  isArchivedView,
  isInboxView,
  query,
  locale,
}: {
  isChangesView: boolean
  changesError: string | null | undefined
  isArchivedView: boolean
  isInboxView: boolean
  query: string
  locale: AppLocale
}): string {
  if (isChangesView && changesError) return translate(locale, 'noteList.empty.changesError', { error: changesError })
  if (isChangesView) return translate(locale, 'noteList.empty.noChanges')
  if (isArchivedView) return translate(locale, 'noteList.empty.noArchived')
  if (isInboxView) return query ? translate(locale, 'noteList.empty.noMatching') : translate(locale, 'noteList.empty.allOrganized')
  return query ? translate(locale, 'noteList.empty.noMatching') : translate(locale, 'noteList.empty.noNotes')
}

export function EntityView({ entity, groups, query, collapsedGroups, sortPrefs, onToggleGroup, onSortChange, renderItem, locale = 'en' }: {
  entity: VaultEntry; groups: RelationshipGroup[]; query: string
  collapsedGroups: Set<string>; sortPrefs: Record<string, SortConfig>
  onToggleGroup: (label: string) => void; onSortChange: (label: string, opt: SortOption, dir: SortDirection) => void
  renderItem: (entry: VaultEntry, options?: { forceSelected?: boolean }) => React.ReactNode
  locale?: AppLocale
}) {
  return (
    <div className="h-full overflow-y-auto">
      <PinnedCard entry={entity} renderItem={renderItem} />
      {groups.length === 0
        ? <EmptyMessage text={query ? translate(locale, 'noteList.empty.noMatchingItems') : translate(locale, 'noteList.empty.noRelatedItems')} />
        : groups.map((group) => (
          <RelationshipGroupSection key={group.label} group={group} isCollapsed={collapsedGroups.has(group.label)} sortPrefs={sortPrefs} locale={locale} onToggle={() => onToggleGroup(group.label)} handleSortChange={onSortChange} renderItem={renderItem} />
        ))
      }
    </div>
  )
}

type ListViewProps = {
  isArchivedView?: boolean; isChangesView?: boolean; isInboxView?: boolean; changesError?: string | null
  searched: VaultEntry[]; query: string
  renderItem: (entry: VaultEntry) => React.ReactNode
  virtuosoRef?: React.RefObject<VirtuosoHandle | null>
  locale?: AppLocale
  useCardView?: boolean
  vaultPath?: string
  selectedNotePath?: string | null
  onSelectNote?: (entry: VaultEntry) => void
}

export function ListView(props: ListViewProps) {
  const { isArchivedView, isChangesView, isInboxView, changesError, searched, query, renderItem, virtuosoRef, locale = 'en', useCardView, vaultPath, selectedNotePath, onSelectNote } = props
  const emptyText = resolveEmptyText({
    isChangesView: !!isChangesView,
    changesError: changesError ?? null,
    isArchivedView: !!isArchivedView,
    isInboxView: !!isInboxView,
    query,
    locale,
  })

  if (searched.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        <EmptyMessage text={emptyText} />
      </div>
    )
  }

  if (useCardView && onSelectNote) {
    return (
      <NoteCardView
        entries={searched}
        vaultPath={vaultPath}
        selectedNotePath={selectedNotePath ?? null}
        onSelectNote={onSelectNote}
      />
    )
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      style={{ height: '100%' }}
      data={searched}
      overscan={200}
      itemContent={(_index, entry) => renderItem(entry)}
    />
  )
}
