import { useCallback, memo } from 'react'
import type {
  VaultEntry, FolderNode, SidebarSelection, ViewDefinition, ViewFile,
} from '../types'
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
import {
  SidebarCreatableLoadingSection,
  SidebarFavoritesLoadingSection,
  SidebarTypesLoadingSection,
} from './sidebar/SidebarLoadingSections'
import { useSidebarTypeInteractions } from './sidebar/useSidebarTypeInteractions'
import type { AppLocale } from '../lib/i18n'
import type { FolderFileActions } from '../hooks/useFileActions'
import type { AllNotesFileVisibility } from '../utils/allNotesFileVisibility'

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
  onDeleteType?: (typeName: string) => void
  onToggleTypeVisibility?: (typeName: string) => void
  onSelectFavorite?: (entry: VaultEntry) => void
  onReorderFavorites?: (orderedPaths: string[]) => void
  views?: ViewFile[]
  onCreateView?: () => void
  onEditView?: (filename: string) => void
  onDeleteView?: (filename: string) => void
  onUpdateViewDefinition?: (filename: string, patch: Partial<ViewDefinition>) => void
  onReorderViews?: (orderedFilenames: string[]) => void
  folders?: FolderNode[]
  onCreateFolder?: (name: string) => Promise<boolean> | boolean
  onRenameFolder?: (folderPath: string, nextName: string) => Promise<boolean> | boolean
  onDeleteFolder?: (folderPath: string) => void
  folderFileActions?: FolderFileActions
  renamingFolderPath?: string | null
  onStartRenameFolder?: (folderPath: string) => void
  onCancelRenameFolder?: () => void
  vaultRootPath?: string
  showInbox?: boolean
  inboxCount?: number
  allNotesFileVisibility?: AllNotesFileVisibility
  locale?: AppLocale
  onCollapse?: () => void
  loading?: boolean
  canGoBack?: boolean
  canGoForward?: boolean
  onGoBack?: () => void
  onGoForward?: () => void
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
  | 'onUpdateViewDefinition'
  | 'onReorderViews'
  | 'folders'
  | 'onCreateFolder'
  | 'onRenameFolder'
  | 'onDeleteFolder'
  | 'folderFileActions'
  | 'renamingFolderPath'
  | 'onStartRenameFolder'
  | 'onCancelRenameFolder'
  | 'vaultRootPath'
  | 'showInbox'
  | 'inboxCount'
  | 'onCreateNewType'
  | 'locale'
  | 'loading'
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

type SidebarFavoritesNavigationProps = Pick<
  SidebarNavigationProps,
  | 'loading'
  | 'entries'
  | 'selection'
  | 'onSelect'
  | 'onSelectFavorite'
  | 'onReorderFavorites'
  | 'groupCollapsed'
  | 'toggleGroup'
  | 'locale'
>

type SidebarViewsNavigationProps = Pick<
  SidebarNavigationProps,
  | 'loading'
  | 'views'
  | 'selection'
  | 'onSelect'
  | 'onCreateView'
  | 'onEditView'
  | 'onDeleteView'
  | 'onUpdateViewDefinition'
  | 'onReorderViews'
  | 'groupCollapsed'
  | 'toggleGroup'
  | 'sensors'
  | 'entries'
  | 'locale'
>

type SidebarTypesNavigationProps = Pick<
  SidebarNavigationProps,
  | 'loading'
  | 'visibleSections'
  | 'allSectionGroups'
  | 'sectionIds'
  | 'sensors'
  | 'handleDragEnd'
  | 'sectionProps'
  | 'groupCollapsed'
  | 'toggleGroup'
  | 'typeInteractions'
  | 'isSectionVisible'
  | 'toggleVisibility'
  | 'onCreateNewType'
  | 'locale'
>

type SidebarFoldersNavigationProps = Pick<
  SidebarNavigationProps,
  | 'loading'
  | 'folders'
  | 'selection'
  | 'onSelect'
  | 'onCreateFolder'
  | 'onRenameFolder'
  | 'onDeleteFolder'
  | 'folderFileActions'
  | 'renamingFolderPath'
  | 'onStartRenameFolder'
  | 'onCancelRenameFolder'
  | 'vaultRootPath'
  | 'groupCollapsed'
  | 'toggleGroup'
  | 'locale'
>

function SidebarFavoritesNavigation({
  loading,
  entries,
  selection,
  onSelect,
  onSelectFavorite,
  onReorderFavorites,
  groupCollapsed,
  toggleGroup,
  locale,
}: SidebarFavoritesNavigationProps) {
  if (loading) {
    return (
      <SidebarFavoritesLoadingSection
        collapsed={groupCollapsed.favorites}
        locale={locale}
        onToggle={() => toggleGroup('favorites')}
      />
    )
  }

  return (
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
  )
}

function SidebarViewsNavigation({
  loading,
  views,
  selection,
  onSelect,
  onCreateView,
  onEditView,
  onDeleteView,
  onUpdateViewDefinition,
  onReorderViews,
  groupCollapsed,
  toggleGroup,
  sensors,
  entries,
  locale,
}: SidebarViewsNavigationProps) {
  if (loading) {
    return (
      <SidebarCreatableLoadingSection
        collapsed={groupCollapsed.views}
        kind="views"
        locale={locale}
        onCreate={onCreateView}
        onToggle={() => toggleGroup('views')}
      />
    )
  }

  return (
    <ViewsSection
      views={views ?? []}
      selection={selection}
      onSelect={onSelect}
      collapsed={groupCollapsed.views}
      onToggle={() => toggleGroup('views')}
      onCreateView={onCreateView}
      onEditView={onEditView}
      onDeleteView={onDeleteView}
      onUpdateViewDefinition={onUpdateViewDefinition}
      onReorderViews={onReorderViews}
      sensors={sensors}
      entries={entries}
      locale={locale}
    />
  )
}

function SidebarTypesNavigation({
  loading,
  visibleSections,
  allSectionGroups,
  sectionIds,
  sensors,
  handleDragEnd,
  sectionProps,
  groupCollapsed,
  toggleGroup,
  typeInteractions,
  isSectionVisible,
  toggleVisibility,
  onCreateNewType,
  locale,
}: SidebarTypesNavigationProps) {
  if (loading) {
    return (
      <SidebarTypesLoadingSection
        collapsed={groupCollapsed.sections}
        locale={locale}
        onCreateNewType={onCreateNewType}
        onToggle={() => toggleGroup('sections')}
      />
    )
  }

  return (
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
  )
}

function SidebarFoldersNavigation({
  loading,
  folders,
  selection,
  onSelect,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  folderFileActions,
  renamingFolderPath,
  onStartRenameFolder,
  onCancelRenameFolder,
  vaultRootPath,
  groupCollapsed,
  toggleGroup,
  locale,
}: SidebarFoldersNavigationProps) {
  if (loading) {
    return (
      <SidebarCreatableLoadingSection
        collapsed={groupCollapsed.folders}
        kind="folders"
        locale={locale}
        onToggle={() => toggleGroup('folders')}
      />
    )
  }

  return (
    <FolderTree
      folders={folders ?? []}
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
      vaultRootPath={vaultRootPath}
    />
  )
}

function SidebarTopNavigation(props: SidebarNavigationProps) {
  return (
    <>
      <SidebarTopNav
        selection={props.selection}
        onSelect={props.onSelect}
        showInbox={props.showInbox ?? true}
        inboxCount={props.inboxCount ?? 0}
        activeCount={props.activeCount}
        archivedCount={props.archivedCount}
        locale={props.locale ?? 'en'}
        loading={props.loading ?? false}
      />
      {(props.loading || props.entries.some((entry) => entry.favorite && !entry.archived)) && (
        <SidebarFavoritesNavigation
          loading={props.loading}
          entries={props.entries}
          selection={props.selection}
          onSelect={props.onSelect}
          onSelectFavorite={props.onSelectFavorite}
          onReorderFavorites={props.onReorderFavorites}
          groupCollapsed={props.groupCollapsed}
          toggleGroup={props.toggleGroup}
          locale={props.locale}
        />
      )}
    </>
  )
}

function SidebarViewAndTypeNavigation(props: SidebarNavigationProps) {
  const views = props.views ?? []
  const hasViews = props.loading || views.length > 0 || !!props.onCreateView

  return (
    <>
      {hasViews && (
        <SidebarViewsNavigation
          loading={props.loading}
          views={views}
          selection={props.selection}
          onSelect={props.onSelect}
          onCreateView={props.onCreateView}
          onEditView={props.onEditView}
          onDeleteView={props.onDeleteView}
          onUpdateViewDefinition={props.onUpdateViewDefinition}
          onReorderViews={props.onReorderViews}
          groupCollapsed={props.groupCollapsed}
          toggleGroup={props.toggleGroup}
          sensors={props.sensors}
          entries={props.entries}
          locale={props.locale}
        />
      )}
      <SidebarTypesNavigation
        loading={props.loading}
        visibleSections={props.visibleSections}
        allSectionGroups={props.allSectionGroups}
        sectionIds={props.sectionIds}
        sensors={props.sensors}
        handleDragEnd={props.handleDragEnd}
        sectionProps={props.sectionProps}
        groupCollapsed={props.groupCollapsed}
        toggleGroup={props.toggleGroup}
        typeInteractions={props.typeInteractions}
        isSectionVisible={props.isSectionVisible}
        toggleVisibility={props.toggleVisibility}
        onCreateNewType={props.onCreateNewType}
        locale={props.locale}
      />
    </>
  )
}

function SidebarNavigation(props: SidebarNavigationProps) {
  return (
    <nav className="flex-1 overflow-y-auto">
      <SidebarTopNavigation {...props} />
      <SidebarViewAndTypeNavigation {...props} />
      <SidebarFoldersNavigation
        loading={props.loading}
        folders={props.folders ?? []}
        selection={props.selection}
        onSelect={props.onSelect}
        onCreateFolder={props.onCreateFolder}
        onRenameFolder={props.onRenameFolder}
        onDeleteFolder={props.onDeleteFolder}
        folderFileActions={props.folderFileActions}
        renamingFolderPath={props.renamingFolderPath}
        onStartRenameFolder={props.onStartRenameFolder}
        onCancelRenameFolder={props.onCancelRenameFolder}
        vaultRootPath={props.vaultRootPath}
        groupCollapsed={props.groupCollapsed}
        toggleGroup={props.toggleGroup}
        locale={props.locale}
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

function useSidebarRuntime({
  entries,
  selection,
  onSelect,
  onSelectNote,
  onCustomizeType,
  onUpdateTypeTemplate,
  onReorderSections,
  onRenameSection,
  onDeleteType,
  onToggleTypeVisibility,
  allNotesFileVisibility,
  locale = 'en',
}: SidebarProps) {
  const { typeEntryMap, allSectionGroups, visibleSections, sectionIds } = useSidebarSections(entries)
  const { activeCount, archivedCount } = useEntryCounts(entries, allNotesFileVisibility)
  const { collapsed: groupCollapsed, toggle: toggleGroup } = useSidebarCollapsed()
  const typeInteractions = useSidebarTypeInteractions({
    allSectionGroups,
    typeEntryMap,
    onCustomizeType,
    onUpdateTypeTemplate,
    onRenameSection,
    onDeleteType,
  })

  const isSectionVisible = useCallback((type: string) => typeEntryMap[type]?.visible !== false, [typeEntryMap])
  const toggleVisibility = useCallback((type: string) => onToggleTypeVisibility?.(type), [onToggleTypeVisibility])
  const selectTypeNote = useCallback((type: string) => {
    const typeEntry = typeEntryMap[type] ?? typeEntryMap[type.toLowerCase()]
    if (typeEntry) onSelectNote?.(typeEntry)
  }, [onSelectNote, typeEntryMap])

  const sensors = useSidebarDndSensors()

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const reordered = computeReorder(sectionIds, active.id as string, over.id as string)
    if (reordered) onReorderSections?.(reordered.map((typeName, order) => ({ typeName, order })))
  }, [sectionIds, onReorderSections])

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
    onStartRename: typeInteractions.handleStartRename,
    onSelectTypeNote: selectTypeNote,
  }

  return {
    activeCount,
    allSectionGroups,
    archivedCount,
    groupCollapsed,
    handleDragEnd,
    isSectionVisible,
    sectionIds,
    sectionProps,
    sensors,
    toggleGroup,
    toggleVisibility,
    typeEntryMap,
    typeInteractions,
    visibleSections,
  }
}

function SidebarRuntimeNavigation({
  props,
  runtime,
}: {
  props: SidebarProps
  runtime: ReturnType<typeof useSidebarRuntime>
}) {
  return (
    <SidebarNavigation
      entries={props.entries}
      selection={props.selection}
      onSelect={props.onSelect}
      onSelectFavorite={props.onSelectFavorite}
      onReorderFavorites={props.onReorderFavorites}
      views={props.views}
      onCreateView={props.onCreateView}
      onEditView={props.onEditView}
      onDeleteView={props.onDeleteView}
      onUpdateViewDefinition={props.onUpdateViewDefinition}
      onReorderViews={props.onReorderViews}
      folders={props.folders}
      onCreateFolder={props.onCreateFolder}
      onRenameFolder={props.onRenameFolder}
      onDeleteFolder={props.onDeleteFolder}
      folderFileActions={props.folderFileActions}
      renamingFolderPath={props.renamingFolderPath}
      onStartRenameFolder={props.onStartRenameFolder}
      onCancelRenameFolder={props.onCancelRenameFolder}
      vaultRootPath={props.vaultRootPath}
      showInbox={props.showInbox}
      inboxCount={props.inboxCount}
      locale={props.locale}
      loading={props.loading}
      onCreateNewType={props.onCreateNewType}
      activeCount={runtime.activeCount}
      archivedCount={runtime.archivedCount}
      groupCollapsed={runtime.groupCollapsed}
      toggleGroup={runtime.toggleGroup}
      visibleSections={runtime.visibleSections}
      allSectionGroups={runtime.allSectionGroups}
      sectionIds={runtime.sectionIds}
      sensors={runtime.sensors}
      handleDragEnd={runtime.handleDragEnd}
      sectionProps={runtime.sectionProps}
      typeInteractions={runtime.typeInteractions}
      isSectionVisible={runtime.isSectionVisible}
      toggleVisibility={runtime.toggleVisibility}
    />
  )
}

function SidebarInteractionOverlays({
  locale,
  runtime,
}: {
  locale: AppLocale
  runtime: ReturnType<typeof useSidebarRuntime>
}) {
  return (
    <>
      <ContextMenuOverlay
        pos={runtime.typeInteractions.contextMenuPos}
        type={runtime.typeInteractions.contextMenuType}
        innerRef={runtime.typeInteractions.contextMenuRef}
        onOpenCustomize={runtime.typeInteractions.openCustomizeTarget}
        onStartRename={runtime.typeInteractions.handleStartRename}
        onDelete={runtime.typeInteractions.handleDeleteType}
        locale={locale}
      />
      <CustomizeOverlay
        target={runtime.typeInteractions.customizeTarget}
        typeEntryMap={runtime.typeEntryMap}
        innerRef={runtime.typeInteractions.popoverRef}
        onCustomize={runtime.typeInteractions.handleCustomize}
        onChangeTemplate={runtime.typeInteractions.handleChangeTemplate}
        onClose={runtime.typeInteractions.closeCustomizeTarget}
        locale={locale}
      />
    </>
  )
}

export const Sidebar = memo(function Sidebar(props: SidebarProps) {
  const locale = props.locale ?? 'en'
  const runtime = useSidebarRuntime(props)

  return (
    <aside className="flex h-full flex-col overflow-hidden border-r border-[var(--sidebar-border)] bg-sidebar text-sidebar-foreground">
      <SidebarTitleBar
        locale={locale}
        onCollapse={props.onCollapse}
        canGoBack={props.canGoBack}
        canGoForward={props.canGoForward}
        onGoBack={props.onGoBack}
        onGoForward={props.onGoForward}
      />
      <SidebarRuntimeNavigation props={props} runtime={runtime} />
      <SidebarInteractionOverlays locale={locale} runtime={runtime} />
    </aside>
  )
})
