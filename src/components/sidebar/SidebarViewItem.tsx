import { useMemo, type HTMLAttributes } from 'react'
import type { VaultEntry, ViewDefinition, ViewFile } from '../../types'
import { evaluateView } from '../../utils/viewFilters'
import { Funnel } from '@phosphor-icons/react'
import { NoteTitleIcon } from '../NoteTitleIcon'
import { SidebarCountPill } from '../SidebarParts'
import { SIDEBAR_ITEM_PADDING } from './sidebarStyles'
import type { AppLocale } from '../../lib/i18n'
import { ACCENT_COLORS } from '../../utils/typeColors'
import { ViewContextMenu, ViewCustomizePanel, ViewRenameInput } from './SidebarViewActions'
import { useSidebarViewItemInteractions } from './useSidebarViewItemInteractions'

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
  onUpdateViewDefinition?: (filename: string, patch: Partial<ViewDefinition>) => void
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
      className="text-muted-foreground"
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
  onUpdateViewDefinition,
  dragHandleProps,
  entries,
  locale = 'en',
}: SidebarViewItemProps) {
  const count = useMemo(() => evaluateView(view.definition, entries).length, [view.definition, entries])
  const showCount = count > 0
  const accent = resolveViewAccent(view.definition.color)
  const interactions = useSidebarViewItemInteractions({
    view,
    onSelect,
    onEditView,
    onDeleteView,
    onUpdateViewDefinition,
  })
  const {
    closeCustomize,
    contextMenuPos,
    contextMenuRef,
    customizePos,
    customizeRef,
    handleContextMenu,
    handleCustomize,
    handleDelete,
    handleEdit,
    handleRenameSubmit,
    handleRowKeyDown,
    isRenaming,
    rowRef,
    setIsRenaming,
    startRename,
  } = interactions

  return (
    <div className="relative">
      <div
        ref={rowRef}
        role="button"
        tabIndex={0}
        className={`flex cursor-pointer select-none items-center gap-2 rounded transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent'}`}
        style={getViewRowStyle(showCount, isActive, accent)}
        aria-label={view.definition.name}
        {...(isRenaming ? undefined : dragHandleProps)}
        onClick={isRenaming ? undefined : onSelect}
        onContextMenu={isRenaming ? undefined : handleContextMenu}
        onDoubleClick={isRenaming ? undefined : startRename}
        onKeyDown={handleRowKeyDown}
      >
        <ViewIcon icon={view.definition.icon} isActive={isActive} accent={accent} />
        {isRenaming ? (
          <ViewRenameInput
            initialValue={view.definition.name}
            locale={locale}
            onCancel={() => setIsRenaming(false)}
            onSubmit={handleRenameSubmit}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{view.definition.name}</span>
        )}
        {!isRenaming && <ViewCountChip count={count} isActive={isActive} accent={accent} />}
      </div>
      <ViewContextMenu
        pos={contextMenuPos}
        canCustomize={!!onUpdateViewDefinition}
        canDelete={!!onDeleteView}
        canEdit={!!onEditView}
        innerRef={contextMenuRef}
        locale={locale}
        onCustomize={handleCustomize}
        onDelete={handleDelete}
        onEdit={handleEdit}
        onRename={startRename}
      />
      <ViewCustomizePanel
        pos={customizePos}
        view={view}
        innerRef={customizeRef}
        locale={locale}
        onClose={closeCustomize}
        onUpdateViewDefinition={onUpdateViewDefinition}
      />
    </div>
  )
}
