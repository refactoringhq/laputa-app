import { closestCenter, DndContext, type DragEndEvent, type useSensors } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, SlidersHorizontal } from '@phosphor-icons/react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import type { AppLocale } from '../../lib/i18n'
import { translate } from '../../lib/i18n'
import type { SidebarSelection, VaultEntry } from '../../types'
import { countByFilter } from '../../utils/noteListHelpers'
import { SectionContent, type SectionGroup, VisibilityPopover } from '../SidebarParts'
import { SidebarGroupHeader } from './SidebarGroupHeader'
import { SIDEBAR_SECTION_CONTENT_PADDING_BOTTOM } from './sidebarStyles'

export interface SidebarSectionProps {
  entries: VaultEntry[]
  selection: SidebarSelection
  onSelect: (selection: SidebarSelection) => void
  onContextMenu: (event: React.MouseEvent, type: string) => void
  renamingType: string | null
  renameInitialValue: string
  onRenameSubmit: (value: string) => void
  onRenameCancel: () => void
  onStartRename: (type: string) => void
  onSelectTypeNote: (type: string) => void
  locale?: AppLocale
}

const SortableSection = ({ group, sectionProps }: { group: SectionGroup; sectionProps: SidebarSectionProps }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.type })
  const isRenaming = sectionProps.renamingType === group.type

  return (
    <div
      ref={setNodeRef}
      className="rounded data-[note-drop-state=valid]:bg-[var(--accent-blue-light)] data-[note-drop-state=valid]:ring-1 data-[note-drop-state=valid]:ring-[var(--accent-blue)]"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        padding: '0 6px',
      }}
      data-note-drop-type={group.type}
      {...attributes}
    >
      <SectionContent
        group={group}
        itemCount={countByFilter(sectionProps.entries, group.type).open}
        selection={sectionProps.selection}
        onSelect={sectionProps.onSelect}
        onContextMenu={sectionProps.onContextMenu}
        dragHandleProps={listeners}
        isRenaming={isRenaming}
        renameInitialValue={isRenaming ? sectionProps.renameInitialValue : undefined}
        onRenameSubmit={sectionProps.onRenameSubmit}
        onRenameCancel={sectionProps.onRenameCancel}
        onStartRename={sectionProps.onStartRename}
        onSelectTypeNote={sectionProps.onSelectTypeNote}
        locale={sectionProps.locale}
      />
    </div>
  )
}

const TypesHeaderActions = (options: {
  locale: AppLocale
  onCreateNewType?: () => void
  setShowCustomize: Dispatch<SetStateAction<boolean>>
}) => {
  const { locale, onCreateNewType, setShowCustomize } = options
  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        title={translate(locale, 'sidebar.action.customizeSections')}
        aria-label={translate(locale, 'sidebar.action.customizeSections')}
        className="h-auto w-auto min-w-0 rounded-none p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
        onClick={(event) => {
          event.stopPropagation()
          setShowCustomize((value) => !value)
        }}
      >
        <SlidersHorizontal size={12} className="text-muted-foreground hover:text-foreground" />
      </Button>
      {onCreateNewType && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="h-auto w-auto min-w-0 rounded-none p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
          data-testid="create-type-btn"
          title={translate(locale, 'sidebar.action.createType')}
          aria-label={translate(locale, 'sidebar.action.createType')}
          onClick={(event) => {
            event.stopPropagation()
            onCreateNewType()
          }}
        >
          <Plus size={12} className="text-muted-foreground hover:text-foreground" />
        </Button>
      )}
    </div>
  )
}

interface TypesSectionProps {
  entries: VaultEntry[]
  visibleSections: SectionGroup[]
  allSectionGroups: SectionGroup[]
  sectionIds: string[]
  sensors: ReturnType<typeof useSensors>
  handleDragEnd: (event: DragEndEvent) => void
  sectionProps: SidebarSectionProps
  collapsed: boolean
  onToggle: () => void
  showCustomize: boolean
  setShowCustomize: Dispatch<SetStateAction<boolean>>
  isSectionVisible: (type: string) => boolean
  toggleVisibility: (type: string, typeEntryPath?: string) => void
  onCreateNewType?: () => void
  customizeRef: RefObject<HTMLDivElement | null>
  workspaceOrder?: readonly string[]
  locale?: AppLocale
}

const TypesList = (options: Pick<TypesSectionProps, 'handleDragEnd' | 'sectionIds' | 'sectionProps' | 'sensors' | 'visibleSections'>) => {
  const { handleDragEnd, sectionIds, sectionProps, sensors, visibleSections } = options
  return (
    <div style={{ paddingBottom: SIDEBAR_SECTION_CONTENT_PADDING_BOTTOM }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
          {visibleSections.map((group) => (
            <SortableSection key={group.type} group={group} sectionProps={sectionProps} />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  )
}

export const TypesSection = (options: TypesSectionProps) => {
  const {
    entries, visibleSections, allSectionGroups, sectionIds, sensors, handleDragEnd, sectionProps, collapsed,
    onToggle, showCustomize, setShowCustomize, isSectionVisible, toggleVisibility, onCreateNewType,
    customizeRef, workspaceOrder,
    locale = 'en',
  } = options
  return (
    <div className="border-b border-border">
      <div ref={customizeRef} style={{ position: 'relative', padding: '0 6px' }}>
        <SidebarGroupHeader label={translate(locale, 'sidebar.group.types')} collapsed={collapsed} onToggle={onToggle}>
          <TypesHeaderActions
            locale={locale}
            onCreateNewType={onCreateNewType}
            setShowCustomize={setShowCustomize}
          />
        </SidebarGroupHeader>
        {showCustomize && (
          <VisibilityPopover
            entries={entries}
            sections={allSectionGroups}
            isSectionVisible={isSectionVisible}
            onToggle={toggleVisibility}
            workspaceOrder={workspaceOrder}
            locale={locale}
          />
        )}
      </div>
      {!collapsed && (
        <TypesList
          handleDragEnd={handleDragEnd}
          sectionIds={sectionIds}
          sectionProps={sectionProps}
          sensors={sensors}
          visibleSections={visibleSections}
        />
      )}
    </div>
  )
}
