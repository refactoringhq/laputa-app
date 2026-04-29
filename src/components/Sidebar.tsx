import { useCallback, memo } from 'react'
import type { VaultEntry, FolderNode, SidebarSelection, ViewFile } from '../types'
import {
  KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { FolderTree } from './FolderTree'
import {
  computeReorder,
  useEntryCounts,
  useSidebarCollapsed,
  useSidebarSections,
} from './sidebar/sidebarHooks'
import {
  ContextMenuOverlay,
  CustomizeOverlay,
  FavoritesSection,
  type SidebarSectionProps,
  SidebarTitleBar,
  SidebarTopNav,
  TypesSection,
  ViewsSection,
} from './sidebar/SidebarSections'
import { useSidebarTypeInteractions } from './sidebar/useSidebarTypeInteractions'
import type { AppLocale } from '../lib/i18n'
import type { FolderFileActions } from '../hooks/useFileActions'

interface SidebarProps {
  entries: VaultEntry[]
  selection: SidebarSelection
  onSelect: (selection: SidebarSelection) => void
  onSelectNote?: (entry: VaultEntry) => void
  onCreateType?: (type: string) => void
  onCreateNewType?: () => void
  onCustomizeType?: (typeName: string, icon: string, color: string) => void
  onUpdateTypeTemplate?: (typeName: string, template: string) => void
  onReorderSections?: (orderedTypes: { typeName: string; order: number }[]) => void
  onRenameSection?: (typeName: string, label: string) => void
  onToggleTypeVisibility?: (typeName: string) => void
  onSelectFavorite?: (entry: VaultEntry) => void
  onReorderFavorites?: (orderedPaths: string[]) => void
  views?: ViewFile[]
  onCreateView?: () => void
  onEditView?: (filename: string) => void
  onDeleteView?: (filename: string) => void
  onReorderViews?: (orderedFilenames: string[]) => void
  folders?: FolderNode[]
  onCreateFolder?: (name: string) => Promise<boolean> | boolean
  onRenameFolder?: (folderPath: string, nextName: string) => Promise<boolean> | boolean
  onDeleteFolder?: (folderPath: string) => void
  folderFileActions?: FolderFileActions
  renamingFolderPath?: string | null
  onStartRenameFolder?: (folderPath: string) => void
  onCancelRenameFolder?: () => void
  showInbox?: boolean
  inboxCount?: number
  locale?: AppLocale
  onCollapse?: () => void
}

interface SidebarNavigationProps extends Pick<
  SidebarProps,
  | 'entries'
  | 'selection'
  | 'onSelect'
  | 'onSelectFavorite'
  | 'onReorderFavorites'
  | 'views'
  | 'onCreateView'
  | 'onEditView'
  | 'onDeleteView'
  | 'onReorderViews'
  | 'folders'
  | 'onCreateFolder'
  | 'onRenameFolder'
  | 'onDeleteFolder'
  | 'folderFileActions'
  | 'renamingFolderPath'
  | 'onStartRenameFolder'
  | 'onCancelRenameFolder'
  | 'showInbox'
  | 'inboxCount'
  | 'onCreateNewType'
  | 'locale'
> {
  activeCount: number
  archivedCount: number
  groupCollapsed: ReturnType<typeof useSidebarCollapsed>['collapsed']
  toggleGroup: ReturnType<typeof useSidebarCollapsed>['toggle']
  visibleSections: ReturnType<typeof useSidebarSections>['visibleSections']
  allSectionGroups: ReturnType<typeof useSidebarSections>['allSectionGroups']
  sectionIds: string[]
  sensors: ReturnType<typeof useSensors>
  handleDragEnd: (event: DragEndEvent) => void
  sectionProps: SidebarSectionProps
  typeInteractions: ReturnType<typeof useSidebarTypeInteractions>
  isSectionVisible: (type: string) => boolean
  toggleVisibility: (type: string) => void
}

function SidebarNavigation({
  entries,
  selection,
  onSelect,
  onSelectFavorite,
  onReorderFavorites,
  views = [],
  onCreateView,
  onEditView,
  onDeleteView,
  onReorderViews,
  folders = [],
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  folderFileActions,
  renamingFolderPath,
  onStartRenameFolder,
  onCancelRenameFolder,
  showInbox = true,
  inboxCount = 0,
  locale = 'en',
  onCreateNewType,
  activeCount,
  archivedCount,
  groupCollapsed,
  toggleGroup,
  visibleSections,
  allSectionGroups,
  sectionIds,
  sensors,
  handleDragEnd,
  sectionProps,
  typeInteractions,
  isSectionVisible,
  toggleVisibility,
}: SidebarNavigationProps) {
  const hasFavorites = entries.some((entry) => entry.favorite && !entry.archived)
  const hasViews = views.length > 0 || !!onCreateView

  return (
    <nav className="flex-1 overflow-y-auto">
      <SidebarTopNav
        selection={selection}
        onSelect={onSelect}
        showInbox={showInbox}
        inboxCount={inboxCount}
        activeCount={activeCount}
        archivedCount={archivedCount}
        locale={locale}
      />
      {hasFavorites && (
        <div className="border-b border-border">
          <FavoritesSection
            entries={entries}
            selection={selection}
            onSelect={onSelect}
            onSelectNote={onSelectFavorite}
            onReorder={onReorderFavorites}
            collapsed={groupCollapsed.favorites}
            locale={locale}
            onToggle={() => toggleGroup('favorites')}
          />
        </div>
      )}
      {hasViews && (
        <ViewsSection
          views={views}
          selection={selection}
          onSelect={onSelect}
          collapsed={groupCollapsed.views}
          onToggle={() => toggleGroup('views')}
          onCreateView={onCreateView}
          onEditView={onEditView}
          onDeleteView={onDeleteView}
          onReorderViews={onReorderViews}
          sensors={sensors}
          entries={entries}
          locale={locale}
        />
      )}
      <TypesSection
        visibleSections={visibleSections}
        allSectionGroups={allSectionGroups}
        sectionIds={sectionIds}
        sensors={sensors}
        handleDragEnd={handleDragEnd}
        sectionProps={sectionProps}
        collapsed={groupCollapsed.sections}
        onToggle={() => toggleGroup('sections')}
        showCustomize={typeInteractions.showCustomize}
        setShowCustomize={typeInteractions.setShowCustomize}
        isSectionVisible={isSectionVisible}
        toggleVisibility={toggleVisibility}
        onCreateNewType={onCreateNewType}
        customizeRef={typeInteractions.customizeRef}
        locale={locale}
      />
      <FolderTree
        folders={folders}
        selection={selection}
        onSelect={onSelect}
        onCreateFolder={onCreateFolder}
        onRenameFolder={onRenameFolder}
        onDeleteFolder={onDeleteFolder}
        folderFileActions={folderFileActions}
        renamingFolderPath={renamingFolderPath}
        onStartRenameFolder={onStartRenameFolder}
        onCancelRenameFolder={onCancelRenameFolder}
        collapsed={groupCollapsed.folders}
        locale={locale}
        onToggle={() => toggleGroup('folders')}
      />
    </nav>
  )
}

function useSidebarDndSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
}

export const Sidebar = memo(function Sidebar({
  entries,
  selection,
  onSelect,
  onCustomizeType,
  onUpdateTypeTemplate,
  onReorderSections,
  onRenameSection,
  onToggleTypeVisibility,
  onSelectFavorite,
  onReorderFavorites,
  views = [],
  onCreateView,
  onEditView,
  onDeleteView,
  onReorderViews,
  folders = [],
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  folderFileActions,
  renamingFolderPath,
  onStartRenameFolder,
  onCancelRenameFolder,
  showInbox = true,
  inboxCount = 0,
  locale = 'en',
  onCollapse,
  onCreateNewType,
}: SidebarProps) {
  const { typeEntryMap, allSectionGroups, visibleSections, sectionIds } = useSidebarSections(entries)
  const { activeCount, archivedCount } = useEntryCounts(entries)
  const { collapsed: groupCollapsed, toggle: toggleGroup } = useSidebarCollapsed()
  const typeInteractions = useSidebarTypeInteractions({
    allSectionGroups,
    typeEntryMap,
    onCustomizeType,
    onUpdateTypeTemplate,
    onRenameSection,
  })

  const isSectionVisible = useCallback((type: string) => typeEntryMap[type]?.visible !== false, [typeEntryMap])
  const toggleVisibility = useCallback((type: string) => onToggleTypeVisibility?.(type), [onToggleTypeVisibility])

  const sensors = useSidebarDndSensors()

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const reordered = computeReorder(sectionIds, active.id as string, over.id as string)
    if (reordered) onReorderSections?.(reordered.map((typeName, order) => ({ typeName, order })))
  }, [sectionIds, onReorderSections])
  const viewActions = { onCreateView, onEditView, onDeleteView, onReorderViews }

  const sectionProps: SidebarSectionProps = {
    entries,
    selection,
    locale,
    onSelect,
    onContextMenu: typeInteractions.handleContextMenu,
    renamingType: typeInteractions.renamingType,
    renameInitialValue: typeInteractions.renameInitialValue,
    onRenameSubmit: typeInteractions.handleRenameSubmit,
    onRenameCancel: typeInteractions.cancelRename,
  }

  return (
    <aside className="flex h-full flex-col overflow-hidden border-r border-[var(--sidebar-border)] bg-sidebar text-sidebar-foreground">
      <SidebarTitleBar locale={locale} onCollapse={onCollapse} />
      <SidebarNavigation
        entries={entries}
        selection={selection}
        onSelect={onSelect}
        onSelectFavorite={onSelectFavorite}
        onReorderFavorites={onReorderFavorites}
        views={views}
        {...viewActions}
        folders={folders}
        onCreateFolder={onCreateFolder}
        onRenameFolder={onRenameFolder}
        onDeleteFolder={onDeleteFolder}
        folderFileActions={folderFileActions}
        renamingFolderPath={renamingFolderPath}
        onStartRenameFolder={onStartRenameFolder}
        onCancelRenameFolder={onCancelRenameFolder}
        showInbox={showInbox}
        inboxCount={inboxCount}
        locale={locale}
        onCreateNewType={onCreateNewType}
        activeCount={activeCount}
        archivedCount={archivedCount}
        groupCollapsed={groupCollapsed}
        toggleGroup={toggleGroup}
        visibleSections={visibleSections}
        allSectionGroups={allSectionGroups}
        sectionIds={sectionIds}
        sensors={sensors}
        handleDragEnd={handleDragEnd}
        sectionProps={sectionProps}
        typeInteractions={typeInteractions}
        isSectionVisible={isSectionVisible}
        toggleVisibility={toggleVisibility}
      />
      <ContextMenuOverlay
        pos={typeInteractions.contextMenuPos}
        type={typeInteractions.contextMenuType}
        innerRef={typeInteractions.contextMenuRef}
        onOpenCustomize={typeInteractions.openCustomizeTarget}
        onStartRename={typeInteractions.handleStartRename}
        locale={locale}
      />
      <CustomizeOverlay
        target={typeInteractions.customizeTarget}
        typeEntryMap={typeEntryMap}
        innerRef={typeInteractions.popoverRef}
        onCustomize={typeInteractions.handleCustomize}
        onChangeTemplate={typeInteractions.handleChangeTemplate}
        onClose={typeInteractions.closeCustomizeTarget}
      />
    </aside>
  )
})
