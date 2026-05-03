import { BulkActionBar } from '../BulkActionBar'
import { FilterPills } from './FilterPills'
import { NoteListHeader } from './NoteListHeader'
import { EntityView, ListView } from './NoteListViews'
import type { useNoteListModel } from './useNoteListModel'

type NoteListLayoutProps = ReturnType<typeof useNoteListModel> & {
  handleBulkOrganize?: () => void
}

const NOTE_LIST_LOADING_ROWS = [
  { title: 184, line: 254, selected: false },
  { title: 142, line: 220, selected: true },
  { title: 98, line: 242, selected: false },
  { title: 212, line: 198, selected: false },
]

function NoteListLoadingBar({ width }: { width: number }) {
  return <span aria-hidden="true" className="block h-4 rounded bg-muted" style={{ width }} />
}

function NoteListLoadingRow({
  title,
  line,
  selected,
}: {
  title: number
  line: number
  selected: boolean
}) {
  return (
    <div
      className="border-b border-border"
      style={{ padding: '12px 12px 10px', background: selected ? 'var(--accent-green-light)' : undefined }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <NoteListLoadingBar width={title} />
        <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded bg-muted" />
      </div>
      <div className="flex flex-col gap-2">
        <NoteListLoadingBar width={line} />
        <NoteListLoadingBar width={Math.round(line * 0.72)} />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <NoteListLoadingBar width={44} />
        <NoteListLoadingBar width={82} />
      </div>
    </div>
  )
}

function NoteListLoadingSkeleton() {
  return (
    <div data-testid="note-list-loading-skeleton" className="animate-pulse">
      {NOTE_LIST_LOADING_ROWS.map((row, index) => (
        <NoteListLoadingRow key={index} {...row} />
      ))}
    </div>
  )
}

function MultiSelectBar({
  multiSelect,
  isArchivedView,
  handleBulkOrganize,
  handleBulkArchive,
  handleBulkDeletePermanently,
  handleBulkUnarchive,
}: Pick<NoteListLayoutProps, 'multiSelect' | 'isArchivedView' | 'handleBulkOrganize' | 'handleBulkArchive' | 'handleBulkDeletePermanently' | 'handleBulkUnarchive'>) {
  if (!multiSelect.isMultiSelecting) return null

  return (
    <BulkActionBar
      count={multiSelect.selectedPaths.size}
      isArchivedView={isArchivedView}
      onOrganize={handleBulkOrganize}
      onArchive={handleBulkArchive}
      onDelete={handleBulkDeletePermanently}
      onUnarchive={handleBulkUnarchive}
      onClear={multiSelect.clear}
    />
  )
}

function NoteListContent({
  entitySelection,
  searchedGroups,
  query,
  collapsedGroups,
  sortPrefs,
  toggleGroup,
  handleSortChange,
  renderItem,
  isArchivedView,
  isChangesView,
  isInboxView,
  modifiedFilesError,
  searched,
  noteListVirtuosoRef,
  locale,
  loading,
}: Pick<
  NoteListLayoutProps,
  | 'entitySelection'
  | 'searchedGroups'
  | 'query'
  | 'collapsedGroups'
  | 'sortPrefs'
  | 'toggleGroup'
  | 'handleSortChange'
  | 'renderItem'
  | 'isArchivedView'
  | 'isChangesView'
  | 'isInboxView'
  | 'modifiedFilesError'
  | 'searched'
  | 'noteListVirtuosoRef'
  | 'locale'
  | 'loading'
>) {
  return (
    <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
      {loading ? (
        <NoteListLoadingSkeleton />
      ) : entitySelection ? (
        <EntityView
          entity={entitySelection.entry}
          groups={searchedGroups}
          query={query}
          collapsedGroups={collapsedGroups}
          sortPrefs={sortPrefs}
          onToggleGroup={toggleGroup}
          onSortChange={handleSortChange}
          renderItem={renderItem}
          locale={locale}
        />
      ) : (
        <ListView
          isArchivedView={isArchivedView}
          isChangesView={isChangesView}
          isInboxView={isInboxView}
          changesError={modifiedFilesError}
          searched={searched}
          query={query}
          renderItem={renderItem}
          virtuosoRef={noteListVirtuosoRef}
          locale={locale}
        />
      )}
    </div>
  )
}

function NoteListBody({
  handleListKeyDown,
  noteListContainerRef,
  handleNoteListBlur,
  handleNoteListFocus,
  focusNoteList,
  noteListVirtuosoRef,
  entitySelection,
  searchedGroups,
  query,
  collapsedGroups,
  sortPrefs,
  toggleGroup,
  handleSortChange,
  renderItem,
  isArchivedView,
  isChangesView,
  isInboxView,
  modifiedFilesError,
  searched,
  locale,
  showFilterPills,
  noteListFilter,
  filterCounts,
  onNoteListFilterChange,
  loading,
}: Pick<
  NoteListLayoutProps,
  | 'handleListKeyDown'
  | 'noteListContainerRef'
  | 'handleNoteListBlur'
  | 'handleNoteListFocus'
  | 'focusNoteList'
  | 'noteListVirtuosoRef'
  | 'entitySelection'
  | 'searchedGroups'
  | 'query'
  | 'collapsedGroups'
  | 'sortPrefs'
  | 'toggleGroup'
  | 'handleSortChange'
  | 'renderItem'
  | 'isArchivedView'
  | 'isChangesView'
  | 'isInboxView'
  | 'modifiedFilesError'
  | 'searched'
  | 'locale'
  | 'showFilterPills'
  | 'noteListFilter'
  | 'filterCounts'
  | 'onNoteListFilterChange'
  | 'loading'
>) {
  return (
    <div
      ref={noteListContainerRef}
      className="relative flex flex-1 flex-col overflow-hidden outline-none"
      style={{ minHeight: 0 }}
      tabIndex={0}
      onBlur={handleNoteListBlur}
      onKeyDown={handleListKeyDown}
      onFocus={handleNoteListFocus}
      onClickCapture={focusNoteList}
      data-testid="note-list-container"
    >
      <NoteListContent
        entitySelection={entitySelection}
        searchedGroups={searchedGroups}
        query={query}
        collapsedGroups={collapsedGroups}
        sortPrefs={sortPrefs}
        toggleGroup={toggleGroup}
        handleSortChange={handleSortChange}
        renderItem={renderItem}
        isArchivedView={isArchivedView}
        isChangesView={isChangesView}
        isInboxView={isInboxView}
        modifiedFilesError={modifiedFilesError}
        searched={searched}
        noteListVirtuosoRef={noteListVirtuosoRef}
        locale={locale}
        loading={loading}
      />
      {showFilterPills && (
        <FilterPills
          active={noteListFilter}
          counts={filterCounts}
          onChange={onNoteListFilterChange}
          position="bottom"
          locale={locale}
        />
      )}
    </div>
  )
}

function NoteListLayoutHeader({
  title,
  typeDocument,
  isEntityView,
  listSort,
  listDirection,
  customProperties,
  locale,
  sidebarCollapsed,
  searchVisible,
  search,
  isSearching,
  searchInputRef,
  propertyPicker,
  handleSortChange,
  handleCreateNote,
  onOpenType,
  toggleSearch,
  setSearch,
  handleSearchKeyDown,
}: Pick<
  NoteListLayoutProps,
  | 'title'
  | 'typeDocument'
  | 'isEntityView'
  | 'listSort'
  | 'listDirection'
  | 'customProperties'
  | 'locale'
  | 'sidebarCollapsed'
  | 'searchVisible'
  | 'search'
  | 'isSearching'
  | 'searchInputRef'
  | 'propertyPicker'
  | 'handleSortChange'
  | 'handleCreateNote'
  | 'onOpenType'
  | 'toggleSearch'
  | 'setSearch'
  | 'handleSearchKeyDown'
>) {
  return (
    <NoteListHeader
      title={title}
      typeDocument={typeDocument}
      isEntityView={isEntityView}
      listSort={listSort}
      listDirection={listDirection}
      customProperties={customProperties}
      locale={locale}
      sidebarCollapsed={sidebarCollapsed}
      searchVisible={searchVisible}
      search={search}
      isSearching={isSearching}
      searchInputRef={searchInputRef}
      propertyPicker={propertyPicker}
      onSortChange={handleSortChange}
      onCreateNote={handleCreateNote}
      onOpenType={onOpenType}
      onToggleSearch={toggleSearch}
      onSearchChange={setSearch}
      onSearchKeyDown={handleSearchKeyDown}
    />
  )
}

function NoteListFooter({
  multiSelect,
  isArchivedView,
  handleBulkOrganize,
  handleBulkArchive,
  handleBulkDeletePermanently,
  handleBulkUnarchive,
  contextMenuNode,
  dialogNode,
}: Pick<
  NoteListLayoutProps,
  | 'multiSelect'
  | 'isArchivedView'
  | 'handleBulkOrganize'
  | 'handleBulkArchive'
  | 'handleBulkDeletePermanently'
  | 'handleBulkUnarchive'
  | 'contextMenuNode'
  | 'dialogNode'
>) {
  return (
    <>
      <MultiSelectBar
        multiSelect={multiSelect}
        isArchivedView={isArchivedView}
        handleBulkOrganize={handleBulkOrganize}
        handleBulkArchive={handleBulkArchive}
        handleBulkDeletePermanently={handleBulkDeletePermanently}
        handleBulkUnarchive={handleBulkUnarchive}
      />
      {contextMenuNode}{dialogNode}
    </>
  )
}

export function NoteListLayout({
  noteListPanelRef,
  handleNoteListPanelBlurCapture,
  handleNoteListPanelFocusCapture,
  ...contentProps
}: NoteListLayoutProps) {
  return (
    <div
      ref={noteListPanelRef}
      className="flex flex-col select-none overflow-hidden border-r border-border bg-card text-foreground"
      style={{ height: '100%' }}
      onBlurCapture={handleNoteListPanelBlurCapture}
      onFocusCapture={handleNoteListPanelFocusCapture}
    >
      <NoteListLayoutHeader {...contentProps} />
      <NoteListBody {...contentProps} />
      <NoteListFooter {...contentProps} />
    </div>
  )
}
