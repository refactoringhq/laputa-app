import { useCallback, useMemo } from 'react'
import type { VaultEntry, SidebarSelection } from '../../types'
import {
  DndContext, PointerSensor, closestCenter, type DragEndEvent, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { buildTypeEntryMap, getTypeColor, getTypeLightColor } from '../../utils/typeColors'
import { NoteTitleIcon } from '../NoteTitleIcon'
import { isSelectionActive } from '../SidebarParts'
import { SidebarGroupHeader } from './SidebarGroupHeader'
import { SIDEBAR_ITEM_PADDING, SIDEBAR_SECTION_CONTENT_PADDING_BOTTOM } from './sidebarStyles'
import { translate, type AppLocale } from '../../lib/i18n'

const FAVORITE_TYPE_ICON_MAP: Record<string, string> = {
  Project: 'wrench',
  project: 'wrench',
  Experiment: 'flask',
  experiment: 'flask',
  Responsibility: 'target',
  responsibility: 'target',
  Procedure: 'arrows-clockwise',
  procedure: 'arrows-clockwise',
  Person: 'users',
  person: 'users',
  Event: 'calendar-blank',
  event: 'calendar-blank',
  Topic: 'tag',
  topic: 'tag',
  Type: 'stack-simple',
  type: 'stack-simple',
}

function getFavoriteIcon(entry: VaultEntry, typeEntryMap: Record<string, VaultEntry>) {
  const typeEntry = entry.isA ? typeEntryMap[entry.isA] : undefined
  return entry.icon ?? typeEntry?.icon ?? FAVORITE_TYPE_ICON_MAP[entry.isA ?? ''] ?? 'file-text'
}

function SortableFavoriteItem({
  entry,
  isActive,
  onSelect,
  typeEntryMap,
}: {
  entry: VaultEntry
  isActive: boolean
  onSelect: () => void
  typeEntryMap: Record<string, VaultEntry>
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.path })
  const typeEntry = entry.isA ? typeEntryMap[entry.isA] : undefined
  const icon = getFavoriteIcon(entry, typeEntryMap)
  const typeColor = getTypeColor(entry.isA ?? null, typeEntry?.color)
  const typeLightColor = getTypeLightColor(entry.isA ?? null, typeEntry?.color)

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      {...attributes}
      {...listeners}
    >
      <div
        className={`group/section flex cursor-pointer select-none items-center justify-between rounded transition-colors ${isActive ? '' : 'hover:bg-accent'}`}
        style={{ padding: SIDEBAR_ITEM_PADDING.withCount, borderRadius: 4, gap: 4, ...(isActive ? { background: typeLightColor } : {}) }}
        onClick={onSelect}
      >
        <div className="flex min-w-0 flex-1 items-center" style={{ gap: 4 }}>
          <NoteTitleIcon icon={icon} size={16} color={typeColor} />
          <span className="min-w-0 truncate text-[13px] font-medium" style={{ marginLeft: 4, color: isActive ? typeColor : undefined }}>
            {entry.title}
          </span>
        </div>
      </div>
    </div>
  )
}

function sortFavorites(entries: VaultEntry[]) {
  return entries
    .filter((entry) => entry.favorite && !entry.archived)
    .sort((a, b) => (a.favoriteIndex ?? Infinity) - (b.favoriteIndex ?? Infinity))
}

function reorderFavoriteIds(favoriteIds: string[], event: DragEndEvent) {
  const { active, over } = event
  if (!over || active.id === over.id) return null
  const oldIndex = favoriteIds.indexOf(active.id as string)
  const newIndex = favoriteIds.indexOf(over.id as string)
  if (oldIndex === -1 || newIndex === -1) return null
  return arrayMove(favoriteIds, oldIndex, newIndex)
}

interface FavoritesSectionProps {
  entries: VaultEntry[]
  selection: SidebarSelection
  onSelect: (selection: SidebarSelection) => void
  onSelectNote?: (entry: VaultEntry) => void
  onReorder?: (orderedPaths: string[]) => void
  collapsed: boolean
  locale?: AppLocale
  onToggle: () => void
}

export function FavoritesSection({
  entries,
  selection,
  onSelect,
  onSelectNote,
  onReorder,
  collapsed,
  locale = 'en',
  onToggle,
}: FavoritesSectionProps) {
  const favorites = useMemo(() => sortFavorites(entries), [entries])
  const favoriteIds = useMemo(() => favorites.map((entry) => entry.path), [favorites])
  const typeEntryMap = useMemo(() => buildTypeEntryMap(entries), [entries])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const reordered = reorderFavoriteIds(favoriteIds, event)
    if (reordered) onReorder?.(reordered)
  }, [favoriteIds, onReorder])

  const handleFavoriteSelect = useCallback((entry: VaultEntry) => {
    if (onSelectNote) {
      void onSelectNote(entry)
      return
    }

    onSelect({ kind: 'filter', filter: 'favorites' })
  }, [onSelect, onSelectNote])

  if (favorites.length === 0) return null

  return (
    <div style={{ padding: '0 6px' }}>
      <SidebarGroupHeader label={translate(locale, 'sidebar.group.favorites')} collapsed={collapsed} onToggle={onToggle} count={favorites.length} />
      {!collapsed && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={favoriteIds} strategy={verticalListSortingStrategy}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: SIDEBAR_SECTION_CONTENT_PADDING_BOTTOM }}>
              {favorites.map((entry) => (
                <SortableFavoriteItem
                  key={entry.path}
                  entry={entry}
                  isActive={isSelectionActive(selection, { kind: 'entity', entry })}
                  typeEntryMap={typeEntryMap}
                  onSelect={() => handleFavoriteSelect(entry)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
