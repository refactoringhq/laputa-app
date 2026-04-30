import { useEffect, useMemo, useCallback } from 'react'
import type {
  VaultEntry,
  SidebarSelection,
  ModifiedFile,
  NoteStatus,
  InboxPeriod,
  ViewDefinition,
  ViewFile,
} from '../../types'
import type { AppLocale } from '../../lib/i18n'
import type { NoteListFilter } from '../../utils/noteListHelpers'
import { countByFilter, countAllByFilter, countAllNotesByFilter } from '../../utils/noteListHelpers'
import type { AllNotesFileVisibility } from '../../utils/allNotesFileVisibility'
import { NoteItem } from '../NoteItem'
import { prefetchNoteContent } from '../../hooks/useTabManagement'
import type { MultiSelectState } from '../../hooks/useMultiSelect'
import { isDeletedNoteEntry, resolveHeaderTitle, type DeletedNoteEntry } from './noteListUtils'
import { filterEntriesByNoteListQuery, filterGroupsByNoteListQuery } from './noteListSearch'
import { useNoteListSearchState } from './useNoteListSearchState'
import {
  useChangeStatusResolver,
  useListPropertyPicker,
  useModifiedFilesState,
  useNoteListData,
  useNoteListInteractions,
  useNoteListSort,
  useTypeEntryMap,
  useVisibleNotesSync,
} from './noteListHooks'
import { useChangesContextMenu } from './NoteListChangesMenu'
import { addNoteListSearchToggleListener, dispatchNoteListSearchAvailability } from '../../utils/noteListSearchEvents'

type EntitySelection = Extract<SidebarSelection, { kind: 'entity' }>
const LIKELY_NEXT_PRELOAD_LIMIT = 8
const ADJACENT_PRELOAD_RADIUS = 2

function useViewFlags(selection: SidebarSelection) {
  const isSectionGroup = selection.kind === 'sectionGroup'
  const isFolderView = selection.kind === 'folder'
  const isInboxView = selection.kind === 'filter' && selection.filter === 'inbox'
  const isAllNotesView = selection.kind === 'filter' && selection.filter === 'all'
  const isChangesView = selection.kind === 'filter' && selection.filter === 'changes'
  const showFilterPills = isSectionGroup || isFolderView
  return { isSectionGroup, isFolderView, isInboxView, isAllNotesView, isChangesView, showFilterPills }
}

function likelyNextPreloadEntries(entries: VaultEntry[], selectedNotePath: string | null): VaultEntry[] {
  if (entries.length === 0) return []
  const selectedIndex = selectedNotePath
    ? entries.findIndex((entry) => entry.path === selectedNotePath)
    : -1
  const start = selectedIndex >= 0
    ? Math.max(0, selectedIndex - ADJACENT_PRELOAD_RADIUS)
    : 0
  const end = selectedIndex >= 0
    ? Math.min(entries.length, selectedIndex + ADJACENT_PRELOAD_RADIUS + 1)
    : Math.min(entries.length, LIKELY_NEXT_PRELOAD_LIMIT)
  return entries
    .slice(start, end)
    .filter((entry) => !isDeletedNoteEntry(entry) && entry.fileKind !== 'binary')
    .slice(0, LIKELY_NEXT_PRELOAD_LIMIT)
}

function useLikelyNextPreload(entries: VaultEntry[], selectedNotePath: string | null) {
  useEffect(() => {
    const candidates = likelyNextPreloadEntries(entries, selectedNotePath)
    if (candidates.length === 0) return

    const timer = window.setTimeout(() => {
      for (const entry of candidates) prefetchNoteContent(entry.path)
    }, 100)

    return () => window.clearTimeout(timer)
  }, [entries, selectedNotePath])
}

function useBulkActions(
  multiSelect: MultiSelectState,
  onBulkArchive: NoteListProps['onBulkArchive'],
  onBulkDeletePermanently: NoteListProps['onBulkDeletePermanently'],
  isArchivedView: boolean,
) {
  const handleBulkArchive = useCallback(() => {
    const paths = [...multiSelect.selectedPaths]
    multiSelect.clear()
    onBulkArchive?.(paths)
  }, [multiSelect, onBulkArchive])

  const handleBulkDeletePermanently = useCallback(() => {
    const paths = [...multiSelect.selectedPaths]
    multiSelect.clear()
    onBulkDeletePermanently?.(paths)
  }, [multiSelect, onBulkDeletePermanently])

  const handleBulkUnarchive = useCallback(() => {
    const paths = [...multiSelect.selectedPaths]
    multiSelect.clear()
    onBulkArchive?.(paths)
  }, [multiSelect, onBulkArchive])

  const bulkArchiveOrUnarchive = isArchivedView ? handleBulkUnarchive : handleBulkArchive

  return {
    handleBulkArchive,
    handleBulkDeletePermanently,
    handleBulkUnarchive,
    bulkArchiveOrUnarchive,
  }
}

function useFilterCounts(
  entries: VaultEntry[],
  selection: SidebarSelection,
  allNotesFileVisibility?: AllNotesFileVisibility,
) {
  return useMemo(() => {
    if (selection.kind === 'sectionGroup') return countByFilter(entries, selection.type)
    if (selection.kind === 'folder') return countAllByFilter(entries)
    if (selection.kind === 'filter' && selection.filter === 'all') {
      return countAllNotesByFilter(entries, allNotesFileVisibility)
    }
    return { open: 0, archived: 0 }
  }, [allNotesFileVisibility, entries, selection])
}

interface UseNoteListContentParams {
  entries: VaultEntry[]
  selection: SidebarSelection
  noteListFilter: NoteListFilter
  inboxPeriod: InboxPeriod
  modifiedFiles?: ModifiedFile[]
  modifiedSuffixes: string[]
  modifiedPathSet: Set<string>
  isInboxView: boolean
  selectedNotePath: string | null
  allNotesNoteListProperties?: string[] | null
  onUpdateAllNotesNoteListProperties?: (value: string[] | null) => void
  inboxNoteListProperties?: string[] | null
  onUpdateInboxNoteListProperties?: (value: string[] | null) => void
  onUpdateViewDefinition?: (filename: string, patch: Partial<ViewDefinition>) => void
  onUpdateTypeSort?: (path: string, key: string, value: string | number | boolean | string[] | null) => void
  updateEntry?: (path: string, patch: Partial<VaultEntry>) => void
  views?: ViewFile[]
  visibleNotesRef?: React.MutableRefObject<VaultEntry[]>
  allNotesFileVisibility?: AllNotesFileVisibility
}

function useNoteListContent({
  entries,
  selection,
  noteListFilter,
  inboxPeriod,
  modifiedFiles,
  modifiedSuffixes,
  modifiedPathSet,
  isInboxView,
  selectedNotePath,
  allNotesNoteListProperties,
  onUpdateAllNotesNoteListProperties,
  inboxNoteListProperties,
  onUpdateInboxNoteListProperties,
  onUpdateViewDefinition,
  onUpdateTypeSort,
  updateEntry,
  views,
  visibleNotesRef,
  allNotesFileVisibility,
}: UseNoteListContentParams) {
  const subFilter = (selection.kind === 'sectionGroup' || selection.kind === 'folder')
    ? noteListFilter
    : undefined
  const effectiveInboxPeriod = isInboxView ? inboxPeriod : undefined
  const { listSort, listDirection, customProperties, handleSortChange, sortPrefs, typeDocument } = useNoteListSort({
    entries,
    selection,
    modifiedPathSet,
    modifiedSuffixes,
    subFilter,
    inboxPeriod: effectiveInboxPeriod,
    views,
    onUpdateTypeSort,
    onUpdateViewDefinition,
    updateEntry,
  })
  const {
    closeSearch,
    isSearching,
    query,
    search,
    searchInputRef,
    searchVisible,
    setSearch,
    toggleSearch,
  } = useNoteListSearchState()
  const typeEntryMap = useTypeEntryMap(entries)
  const { displayPropsOverride, propertyPicker } = useListPropertyPicker({
    entries,
    selection,
    inboxPeriod,
    typeDocument,
    typeEntryMap,
    allNotesNoteListProperties,
    onUpdateAllNotesNoteListProperties,
    inboxNoteListProperties,
    onUpdateInboxNoteListProperties,
    onUpdateViewDefinition,
    onUpdateTypeSort,
    views,
  })
  const {
    entityEntry,
    isEntityView,
    isArchivedView,
    searched: sortedEntries,
    searchedGroups: sortedGroups,
  } = useNoteListData({
    entries,
    selection,
    query: '',
    listSort,
    listDirection,
    modifiedPathSet,
    modifiedSuffixes,
    modifiedFiles,
    subFilter,
    inboxPeriod: effectiveInboxPeriod,
    views,
    allNotesFileVisibility,
  })
  const searched = useMemo(() => filterEntriesByNoteListQuery(sortedEntries, query, {
    allEntries: entries,
    typeEntryMap,
    displayPropsOverride,
  }), [displayPropsOverride, entries, query, sortedEntries, typeEntryMap])
  const searchedGroups = useMemo(() => filterGroupsByNoteListQuery(sortedGroups, query, {
    allEntries: entries,
    typeEntryMap,
    displayPropsOverride,
  }), [displayPropsOverride, entries, query, sortedGroups, typeEntryMap])
  useVisibleNotesSync({ visibleNotesRef, isEntityView, entityEntry, searched, searchedGroups })
  useLikelyNextPreload(searched, selectedNotePath)

  return {
    customProperties,
    displayPropsOverride,
    entityEntry,
    handleSortChange,
    isArchivedView,
    isSearching,
    isEntityView,
    listDirection,
    listSort,
    propertyPicker,
    query,
    search,
    searchInputRef,
    searchVisible,
    searched,
    searchedGroups,
    closeSearch,
    setSearch,
    sortPrefs,
    toggleSearch,
    typeDocument,
    typeEntryMap,
  }
}

interface UseNoteListInteractionStateParams {
  searched: VaultEntry[]
  searchedGroups: Array<{ entries: VaultEntry[] }>
  selectedNotePath: string | null
  selection: SidebarSelection
  noteListFilter: NoteListFilter
  isArchivedView: boolean
  isChangesView: boolean
  entityEntry: VaultEntry | null
  searchVisible: boolean
  toggleSearch: () => void
  modifiedFiles?: ModifiedFile[]
  onReplaceActiveTab: (entry: VaultEntry) => void
  onEnterNeighborhood?: (entry: VaultEntry) => void
  onOpenDeletedNote?: (entry: DeletedNoteEntry) => void
  onOpenInNewWindow?: (entry: VaultEntry) => void
  onAutoTriggerDiff?: () => void
  onDiscardFile?: (relativePath: string) => Promise<void>
  onCreateNote: (type?: string) => void
  onBulkArchive?: (paths: string[]) => void
  onBulkDeletePermanently?: (paths: string[]) => void
  locale: AppLocale
}

function useNoteListInteractionState({
  searched,
  searchedGroups,
  selectedNotePath,
  selection,
  noteListFilter,
  isArchivedView,
  isChangesView,
  entityEntry,
  searchVisible,
  toggleSearch,
  modifiedFiles,
  onReplaceActiveTab,
  onEnterNeighborhood,
  onOpenDeletedNote,
  onOpenInNewWindow,
  onAutoTriggerDiff,
  onDiscardFile,
  onCreateNote,
  onBulkArchive,
  onBulkDeletePermanently,
  locale,
}: UseNoteListInteractionStateParams) {
  const changesContextMenu = useChangesContextMenu({ isChangesView, onDiscardFile, modifiedFiles, locale })
  const {
    collapsedGroups,
    handleClickNote,
    handleCreateNote,
    handleListKeyDown,
    multiSelect,
    noteListKeyboard,
    toggleGroup,
  } = useNoteListInteractions({
    searched,
    searchedGroups,
    selectedNotePath,
    selection,
    noteListFilter,
    isChangesView,
    entityEntry,
    searchVisible,
    toggleSearch,
    onReplaceActiveTab,
    onEnterNeighborhood,
    onOpenDeletedNote,
    onOpenInNewWindow,
    onAutoTriggerDiff,
    onDiscardFile,
    openContextMenuForEntry: changesContextMenu.openContextMenuForEntry,
    onCreateNote,
  })
  const getChangeStatus = useChangeStatusResolver(isChangesView, modifiedFiles)
  const {
    handleBulkArchive,
    handleBulkDeletePermanently,
    handleBulkUnarchive,
  } = useBulkActions(multiSelect, onBulkArchive, onBulkDeletePermanently, isArchivedView)

  return {
    changesContextMenu,
    collapsedGroups,
    getChangeStatus,
    handleBulkArchive,
    handleBulkDeletePermanently,
    handleBulkUnarchive,
    handleClickNote,
    handleCreateNote,
    handleListKeyDown,
    multiSelect,
    noteListKeyboard,
    toggleGroup,
  }
}

interface UseRenderItemParams {
  entries: VaultEntry[]
  selectedNotePath: string | null
  typeEntryMap: Record<string, VaultEntry>
  displayPropsOverride?: string[] | null
  isChangesView: boolean
  onDiscardFile?: (relativePath: string) => Promise<void>
  resolvedGetNoteStatus: (path: string) => NoteStatus
  getChangeStatus: (path: string) => ModifiedFile['status'] | undefined
  handleClickNote: (entry: VaultEntry, event: React.MouseEvent) => void
  noteContextMenu?: ((entry: VaultEntry, event: React.MouseEvent) => void) | undefined
  multiSelect: MultiSelectState
  noteListKeyboard: { highlightedPath: string | null }
}

function useRenderItem({
  entries,
  selectedNotePath,
  typeEntryMap,
  displayPropsOverride,
  isChangesView,
  onDiscardFile,
  resolvedGetNoteStatus,
  getChangeStatus,
  handleClickNote,
  noteContextMenu,
  multiSelect,
  noteListKeyboard,
}: UseRenderItemParams) {
  const contextMenuHandler = isChangesView && onDiscardFile ? noteContextMenu : undefined

  return useCallback((entry: VaultEntry, options?: { forceSelected?: boolean }) => (
    isDeletedNoteEntry(entry) ? (
      <NoteItem
        key={entry.path}
        entry={entry}
        isSelected={options?.forceSelected || selectedNotePath === entry.path}
        isMultiSelected={multiSelect.selectedPaths.has(entry.path)}
        isHighlighted={entry.path === noteListKeyboard.highlightedPath}
        noteStatus={resolvedGetNoteStatus(entry.path)}
        changeStatus={getChangeStatus(entry.path)}
        typeEntryMap={typeEntryMap}
        allEntries={entries}
        displayPropsOverride={displayPropsOverride}
        onClickNote={handleClickNote}
        onContextMenu={contextMenuHandler}
      />
    ) : (
      <NoteItem
        key={entry.path}
        entry={entry}
        isSelected={options?.forceSelected || selectedNotePath === entry.path}
        isMultiSelected={multiSelect.selectedPaths.has(entry.path)}
        isHighlighted={entry.path === noteListKeyboard.highlightedPath}
        noteStatus={resolvedGetNoteStatus(entry.path)}
        changeStatus={getChangeStatus(entry.path)}
        typeEntryMap={typeEntryMap}
        allEntries={entries}
        displayPropsOverride={displayPropsOverride}
        onClickNote={handleClickNote}
        onPrefetch={prefetchNoteContent}
        onContextMenu={contextMenuHandler}
      />
    )
  ), [
    contextMenuHandler,
    displayPropsOverride,
    entries,
    getChangeStatus,
    handleClickNote,
    multiSelect.selectedPaths,
    noteListKeyboard.highlightedPath,
    resolvedGetNoteStatus,
    selectedNotePath,
    typeEntryMap,
  ])
}

export interface NoteListProps {
  entries: VaultEntry[]
  selection: SidebarSelection
  selectedNote: VaultEntry | null
  loading?: boolean
  noteListFilter: NoteListFilter
  onNoteListFilterChange: (filter: NoteListFilter) => void
  inboxPeriod?: InboxPeriod
  onInboxPeriodChange?: (period: InboxPeriod) => void
  modifiedFiles?: ModifiedFile[]
  modifiedFilesError?: string | null
  getNoteStatus?: (path: string) => NoteStatus
  sidebarCollapsed?: boolean
  onSelectNote: (entry: VaultEntry) => void
  onReplaceActiveTab: (entry: VaultEntry) => void
  onEnterNeighborhood?: (entry: VaultEntry) => void
  onCreateNote: (type?: string) => void
  onBulkArchive?: (paths: string[]) => void
  onBulkDeletePermanently?: (paths: string[]) => void
  onUpdateTypeSort?: (path: string, key: string, value: string | number | boolean | string[] | null) => void
  updateEntry?: (path: string, patch: Partial<VaultEntry>) => void
  onOpenInNewWindow?: (entry: VaultEntry) => void
  onDiscardFile?: (relativePath: string) => Promise<void>
  onAutoTriggerDiff?: () => void
  onOpenDeletedNote?: (entry: DeletedNoteEntry) => void
  allNotesNoteListProperties?: string[] | null
  onUpdateAllNotesNoteListProperties?: (value: string[] | null) => void
  inboxNoteListProperties?: string[] | null
  onUpdateInboxNoteListProperties?: (value: string[] | null) => void
  onUpdateViewDefinition?: (filename: string, patch: Partial<ViewDefinition>) => void
  views?: ViewFile[]
  visibleNotesRef?: React.MutableRefObject<VaultEntry[]>
  allNotesFileVisibility?: AllNotesFileVisibility
  locale?: AppLocale
}

function buildNoteListLayoutModel(params: {
  selection: SidebarSelection
  views?: ViewFile[]
  sidebarCollapsed?: boolean
  loading: boolean
  modifiedFilesError?: string | null
  noteListFilter: NoteListFilter
  filterCounts: ReturnType<typeof useFilterCounts>
  onNoteListFilterChange: (filter: NoteListFilter) => void
  onOpenType: (entry: VaultEntry) => void
  locale: AppLocale
  content: ReturnType<typeof useNoteListContent> & {
    handleSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  }
  interaction: ReturnType<typeof useNoteListInteractionState> & {
    renderItem: (entry: VaultEntry, options?: { forceSelected?: boolean }) => React.ReactNode
    entitySelection: EntitySelection | null
  }
}) {
  return {
    title: resolveHeaderTitle(params.selection, params.content.typeDocument, params.views, params.locale),
    loading: params.loading,
    locale: params.locale,
    typeDocument: params.content.typeDocument,
    isEntityView: params.content.isEntityView,
    listSort: params.content.listSort,
    listDirection: params.content.listDirection,
    customProperties: params.content.customProperties,
    sidebarCollapsed: params.sidebarCollapsed,
    searchVisible: params.content.searchVisible,
    search: params.content.search,
    isSearching: params.content.isSearching,
    searchInputRef: params.content.searchInputRef,
    propertyPicker: params.content.propertyPicker,
    handleSortChange: params.content.handleSortChange,
    handleCreateNote: params.interaction.handleCreateNote,
    onOpenType: params.onOpenType,
    toggleSearch: params.content.toggleSearch,
    setSearch: params.content.setSearch,
    handleSearchKeyDown: params.content.handleSearchKeyDown,
    handleListKeyDown: params.interaction.handleListKeyDown,
    noteListPanelRef: params.interaction.noteListKeyboard.panelRef,
    handleNoteListPanelBlurCapture: params.interaction.noteListKeyboard.handlePanelBlurCapture,
    handleNoteListPanelFocusCapture: params.interaction.noteListKeyboard.handlePanelFocusCapture,
    noteListContainerRef: params.interaction.noteListKeyboard.containerRef,
    handleNoteListBlur: params.interaction.noteListKeyboard.handleBlur,
    handleNoteListFocus: params.interaction.noteListKeyboard.handleFocus,
    focusNoteList: params.interaction.noteListKeyboard.focusList,
    noteListVirtuosoRef: params.interaction.noteListKeyboard.virtuosoRef,
    entitySelection: params.interaction.entitySelection,
    searchedGroups: params.content.searchedGroups,
    collapsedGroups: params.interaction.collapsedGroups,
    sortPrefs: params.content.sortPrefs,
    toggleGroup: params.interaction.toggleGroup,
    renderItem: params.interaction.renderItem,
    typeEntryMap: params.content.typeEntryMap,
    handleClickNote: params.interaction.handleClickNote,
    isArchivedView: params.content.isArchivedView,
    isChangesView: params.selection.kind === 'filter' && params.selection.filter === 'changes',
    isInboxView: params.selection.kind === 'filter' && params.selection.filter === 'inbox',
    modifiedFilesError: params.modifiedFilesError,
    searched: params.content.searched,
    query: params.content.query,
    showFilterPills: params.selection.kind === 'sectionGroup' || params.selection.kind === 'folder',
    noteListFilter: params.noteListFilter,
    filterCounts: params.filterCounts,
    onNoteListFilterChange: params.onNoteListFilterChange,
    multiSelect: params.interaction.multiSelect,
    handleBulkArchive: params.interaction.handleBulkArchive,
    handleBulkDeletePermanently: params.interaction.handleBulkDeletePermanently,
    handleBulkUnarchive: params.interaction.handleBulkUnarchive,
    contextMenuNode: params.interaction.changesContextMenu.contextMenuNode,
    dialogNode: params.interaction.changesContextMenu.dialogNode,
  }
}

export function useNoteListModel({
  entries,
  selection,
  selectedNote,
  loading = false,
  noteListFilter,
  onNoteListFilterChange,
  inboxPeriod = 'all',
  modifiedFiles,
  modifiedFilesError,
  getNoteStatus,
  sidebarCollapsed,
  onReplaceActiveTab,
  onEnterNeighborhood,
  onCreateNote,
  onBulkArchive,
  onBulkDeletePermanently,
  onUpdateTypeSort,
  updateEntry,
  onOpenInNewWindow,
  onDiscardFile,
  onAutoTriggerDiff,
  onOpenDeletedNote,
  allNotesNoteListProperties,
  onUpdateAllNotesNoteListProperties,
  inboxNoteListProperties,
  onUpdateInboxNoteListProperties,
  onUpdateViewDefinition,
  views,
  visibleNotesRef,
  allNotesFileVisibility,
  locale = 'en',
}: NoteListProps) {
  const selectedNotePath = selectedNote?.path ?? null
  const { modifiedPathSet, modifiedSuffixes, resolvedGetNoteStatus } = useModifiedFilesState(modifiedFiles, getNoteStatus)
  const { isInboxView } = useViewFlags(selection)
  const filterCounts = useFilterCounts(entries, selection, allNotesFileVisibility)
  const content = useNoteListContent({
    entries,
    selection,
    noteListFilter,
    inboxPeriod,
    modifiedFiles,
    modifiedSuffixes,
    modifiedPathSet,
    isInboxView,
    selectedNotePath,
    allNotesNoteListProperties,
    onUpdateAllNotesNoteListProperties,
    inboxNoteListProperties,
    onUpdateInboxNoteListProperties,
    onUpdateViewDefinition,
    onUpdateTypeSort,
    updateEntry,
    views,
    visibleNotesRef,
    allNotesFileVisibility,
  })
  const interaction = useNoteListInteractionState({
    searched: content.searched,
    searchedGroups: content.searchedGroups,
    selectedNotePath,
    selection,
    noteListFilter,
    isArchivedView: content.isArchivedView,
    isChangesView: selection.kind === 'filter' && selection.filter === 'changes',
    entityEntry: content.entityEntry,
    searchVisible: content.searchVisible,
    toggleSearch: content.toggleSearch,
    modifiedFiles,
    onReplaceActiveTab,
    onEnterNeighborhood,
    onOpenDeletedNote,
    onOpenInNewWindow,
    onAutoTriggerDiff,
    onDiscardFile,
    onCreateNote,
    onBulkArchive,
    onBulkDeletePermanently,
    locale,
  })
  const renderItem = useRenderItem({
    entries,
    selectedNotePath,
    typeEntryMap: content.typeEntryMap,
    displayPropsOverride: content.displayPropsOverride,
    isChangesView: selection.kind === 'filter' && selection.filter === 'changes',
    onDiscardFile,
    resolvedGetNoteStatus,
    getChangeStatus: interaction.getChangeStatus,
    handleClickNote: interaction.handleClickNote,
    noteContextMenu: interaction.changesContextMenu.handleNoteContextMenu,
    multiSelect: interaction.multiSelect,
    noteListKeyboard: interaction.noteListKeyboard,
  })
  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return

    event.preventDefault()
    content.closeSearch()
    requestAnimationFrame(() => {
      interaction.noteListKeyboard.focusList()
    })
  }
  const {
    isPanelActive: isNoteListSearchActive,
    toggleSearchShortcut,
  } = interaction.noteListKeyboard

  useEffect(() => {
    dispatchNoteListSearchAvailability(isNoteListSearchActive)
    return () => dispatchNoteListSearchAvailability(false)
  }, [isNoteListSearchActive])

  useEffect(() => {
    return addNoteListSearchToggleListener(() => {
      if (!isNoteListSearchActive) return
      toggleSearchShortcut()
    })
  }, [isNoteListSearchActive, toggleSearchShortcut])

  return buildNoteListLayoutModel({
    selection,
    views,
    sidebarCollapsed,
    loading,
    onOpenType: onReplaceActiveTab,
    modifiedFilesError,
    noteListFilter,
    filterCounts,
    onNoteListFilterChange,
    locale,
    content: {
      ...content,
      handleSearchKeyDown,
    },
    interaction: {
      ...interaction,
      renderItem,
      entitySelection: content.isEntityView && selection.kind === 'entity'
        ? { ...selection, entry: content.entityEntry ?? selection.entry }
        : null,
    },
  })
}
