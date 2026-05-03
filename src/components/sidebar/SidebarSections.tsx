import {
  type Dispatch, type Ref, type RefObject, type SetStateAction,
} from 'react'
import type { VaultEntry, SidebarSelection, ViewFile } from '../../types'
import {
  DndContext, closestCenter, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SlidersHorizontal } from 'lucide-react'
import {
  CaretLeft, Plus,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import {
  type SectionGroup, isSelectionActive, SectionContent, VisibilityPopover,
} from '../SidebarParts'
import { TypeCustomizePopover } from '../TypeCustomizePopover'
import { useDragRegion } from '../../hooks/useDragRegion'
import { NoteDropTarget } from '../note-retargeting/NoteDropTarget'
import { useNoteRetargetingContext } from '../note-retargeting/noteRetargetingContext'
import { SidebarGroupHeader } from './SidebarGroupHeader'
import { SidebarViewItem } from './SidebarViewItem'
import { countByFilter } from '../../utils/noteListHelpers'

export { SidebarTopNav } from './SidebarTopNav'
export { FavoritesSection } from './FavoritesSection'

export interface SidebarSectionProps {
  entries: VaultEntry[]
  selection: SidebarSelection
  onSelect: (selection: SidebarSelection) => void
  onContextMenu: (event: React.MouseEvent, type: string) => void
  renamingType: string | null
  renameInitialValue: string
  onRenameSubmit: (value: string) => void
  onRenameCancel: () => void
}

export function ViewsSection({
  views,
  selection,
  onSelect,
  collapsed,
  onToggle,
  onCreateView,
  onEditView,
  onDeleteView,
  entries,
}: {
  views: ViewFile[]
  selection: SidebarSelection
  onSelect: (selection: SidebarSelection) => void
  collapsed: boolean
  onToggle: () => void
  onCreateView?: () => void
  onEditView?: (filename: string) => void
  onDeleteView?: (filename: string) => void
  entries: VaultEntry[]
}) {
  return (
    <div className="border-b border-border" style={{ padding: '0 6px' }}>
      <SidebarGroupHeader label="VIEWS" collapsed={collapsed} onToggle={onToggle}>
        {onCreateView && (
          <Plus
            size={12}
            className="text-muted-foreground hover:text-foreground"
            onClick={(event) => { event.stopPropagation(); onCreateView() }}
          />
        )}
      </SidebarGroupHeader>
      {!collapsed && (
        <div style={{ paddingBottom: 4 }}>
          {views.map((view) => (
            <SidebarViewItem
              key={view.filename}
              view={view}
              isActive={isSelectionActive(selection, { kind: 'view', filename: view.filename })}
              onSelect={() => onSelect({ kind: 'view', filename: view.filename })}
              onEditView={onEditView}
              onDeleteView={onDeleteView}
              entries={entries}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SortableSection({
  group,
  sectionProps,
}: {
  group: SectionGroup
  sectionProps: SidebarSectionProps
}) {
  const noteRetargeting = useNoteRetargetingContext()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.type })
  const itemCount = countByFilter(sectionProps.entries, group.type).open
  const isRenaming = sectionProps.renamingType === group.type
  const content = (
    <SectionContent
      group={group}
      itemCount={itemCount}
      selection={sectionProps.selection}
      onSelect={sectionProps.onSelect}
      onContextMenu={sectionProps.onContextMenu}
      dragHandleProps={listeners}
      isRenaming={isRenaming}
      renameInitialValue={isRenaming ? sectionProps.renameInitialValue : undefined}
      onRenameSubmit={sectionProps.onRenameSubmit}
      onRenameCancel={sectionProps.onRenameCancel}
    />
  )

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        padding: '0 6px',
      }}
      {...attributes}
    >
      {noteRetargeting ? (
        <NoteDropTarget
          canAcceptNotePath={(notePath) => noteRetargeting.canDropNoteOnType(notePath, group.type)}
          onDropNote={(notePath) => noteRetargeting.dropNoteOnType(notePath, group.type)}
        >
          {content}
        </NoteDropTarget>
      ) : content}
    </div>
  )
}

export function TypesSection({
  visibleSections,
  allSectionGroups,
  sectionIds,
  sensors,
  handleDragEnd,
  sectionProps,
  collapsed,
  onToggle,
  showCustomize,
  setShowCustomize,
  isSectionVisible,
  toggleVisibility,
  onCreateNewType,
  customizeRef,
}: {
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
  toggleVisibility: (type: string) => void
  onCreateNewType?: () => void
  customizeRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <div className="border-b border-border">
      <div ref={customizeRef} style={{ position: 'relative', padding: '0 6px' }}>
        <SidebarGroupHeader label="TYPES" collapsed={collapsed} onToggle={onToggle}>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              title="Customize sections"
              aria-label="Customize sections"
              className="h-auto w-auto min-w-0 rounded-none p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
              onClick={(event) => { event.stopPropagation(); setShowCustomize((value) => !value) }}
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
                title="Create new type"
                aria-label="Create new type"
                onClick={(event) => { event.stopPropagation(); onCreateNewType() }}
              >
                <Plus size={12} className="text-muted-foreground hover:text-foreground" />
              </Button>
            )}
          </div>
        </SidebarGroupHeader>
        {showCustomize && (
          <VisibilityPopover
            sections={allSectionGroups}
            isSectionVisible={isSectionVisible}
            onToggle={toggleVisibility}
          />
        )}
      </div>
      {!collapsed && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
            {visibleSections.map((group) => (
              <SortableSection key={group.type} group={group} sectionProps={sectionProps} />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}

export function SidebarTitleBar({ onCollapse }: { onCollapse?: () => void }) {
  const { onMouseDown } = useDragRegion()

  return (
    <div
      className="shrink-0 flex items-center justify-end border-b border-border"
      style={{ height: 52, padding: '0 8px', paddingLeft: 80, cursor: 'default' }}
      onMouseDown={onMouseDown}
    >
      {onCollapse && (
        <button
          className="flex shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          style={{ width: 24, height: 24 }}
          onClick={onCollapse}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
        >
          <CaretLeft size={14} weight="bold" />
        </button>
      )}
    </div>
  )
}

export function ContextMenuOverlay({
  pos,
  type,
  innerRef,
  onOpenCustomize,
  onStartRename,
}: {
  pos: { x: number; y: number } | null
  type: string | null
  innerRef: Ref<HTMLDivElement>
  onOpenCustomize: (type: string) => void
  onStartRename: (type: string) => void
}) {
  if (!pos || !type) return null

  const buttonClass = 'flex w-full items-center gap-2 rounded-sm border-none bg-transparent px-2 py-1.5 text-left text-sm cursor-default transition-colors hover:bg-accent hover:text-accent-foreground'

  return (
    <div
      ref={innerRef}
      className="fixed z-50 rounded-md border bg-popover p-1 shadow-md"
      style={{ left: pos.x, top: pos.y, minWidth: 180 }}
    >
      <button className={buttonClass} onClick={() => onStartRename(type)}>
        Rename section…
      </button>
      <button className={buttonClass} onClick={() => onOpenCustomize(type)}>
        Customize icon &amp; color…
      </button>
    </div>
  )
}

export function CustomizeOverlay({
  target,
  typeEntryMap,
  innerRef,
  folders,
  onCustomize,
  onChangeTemplate,
  onChangeDefaultFolder,
  onClose,
}: {
  target: string | null
  typeEntryMap: Record<string, VaultEntry>
  innerRef: Ref<HTMLDivElement>
  folders?: import('../../types').FolderNode[]
  onCustomize: (prop: 'icon' | 'color', value: string) => void
  onChangeTemplate: (template: string) => void
  onChangeDefaultFolder?: (folder: string | null) => void
  onClose: () => void
}) {
  if (!target) return null

  return (
    <div ref={innerRef} className="fixed z-50" style={{ left: 20, top: 100 }}>
      <TypeCustomizePopover
        currentIcon={typeEntryMap[target]?.icon ?? null}
        currentColor={typeEntryMap[target]?.color ?? null}
        currentTemplate={typeEntryMap[target]?.template ?? null}
        currentDefaultFolder={typeEntryMap[target]?.defaultFolder ?? null}
        folders={folders}
        onChangeIcon={(icon) => onCustomize('icon', icon)}
        onChangeColor={(color) => onCustomize('color', color)}
        onChangeTemplate={onChangeTemplate}
        onChangeDefaultFolder={onChangeDefaultFolder}
        onClose={onClose}
      />
    </div>
  )
}
