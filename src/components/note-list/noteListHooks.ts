import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import type { VaultEntry, SidebarSelection, ModifiedFile, NoteStatus, ViewDefinition, ViewFile } from '../../types'
import {
  type SortOption, type SortDirection, type SortConfig, type NoteListFilter,
  getSortComparator, extractSortableProperties,
  buildRelationshipGroups, filterEntries, filterInboxEntries,
  loadSortPreferences, saveSortPreferences,
  parseSortConfig, serializeSortConfig, clearListSortFromLocalStorage,
} from '../../utils/noteListHelpers'
import type { InboxPeriod } from '../../types'
import { buildTypeEntryMap } from '../../utils/typeColors'
import {
  buildChangesEntries, filterByQuery, filterGroupsByQuery, createNoteStatusResolver,
  isDeletedNoteEntry, isModifiedEntry, routeNoteClick, toggleSetMember,
} from './noteListUtils'
import type { DeletedNoteEntry } from './noteListUtils'
import { useMultiSelect, type MultiSelectState } from '../../hooks/useMultiSelect'
import { useNoteListKeyboard } from '../../hooks/useNoteListKeyboard'
import { prefetchNoteContent } from '../../hooks/useTabManagement'
import type { NoteListPropertiesScope } from './noteListPropertiesEvents'
import type { AllNotesFileVisibility } from '../../utils/allNotesFileVisibility'

// --- useTypeEntryMap ---

export function useTypeEntryMap(entries: VaultEntry[]) {
  return useMemo(() => buildTypeEntryMap(entries), [entries])
}

// --- useFilteredEntries ---

interface FilteredEntriesParams {
  entries: VaultEntry[]
  selection: SidebarSelection
  modifiedPathSet: Set<string>
  modifiedSuffixes: string[]
  modifiedFiles?: ModifiedFile[]
  subFilter?: NoteListFilter
  inboxPeriod?: InboxPeriod
  views?: ViewFile[]
  allNotesFileVisibility?: AllNotesFileVisibility
}

function buildFilteredEntries({
  entries,
  selection,
  isEntityView,
  isChangesView,
  isInboxView,
  modifiedPathSet,
  modifiedSuffixes,
  modifiedFiles,
  subFilter,
  inboxPeriod,
  views,
  allNotesFileVisibility,
}: FilteredEntriesParams & {
  isEntityView: boolean
  isChangesView: boolean
  isInboxView: boolean
}) {
  if (isEntityView) return []
  if (isChangesView) {
    if (modifiedFiles) return buildChangesEntries(entries, modifiedFiles)
    return entries.filter((entry) => isModifiedEntry(entry.path, modifiedPathSet, modifiedSuffixes))
  }
  if (isInboxView) return filterInboxEntries(entries, inboxPeriod ?? 'month')
  return filterEntries(entries, selection, {
    subFilter,
    views,
    allNotesFileVisibility,
  })
}

export function useFilteredEntries({
  entries,
  selection,
  modifiedPathSet,
  modifiedSuffixes,
  modifiedFiles,
  subFilter,
  inboxPeriod,
  views,
  allNotesFileVisibility,
}: FilteredEntriesParams) {
  const isEntityView = selection.kind === 'entity'
  const isChangesView = selection.kind === 'filter' && selection.filter === 'changes'
  const isInboxView = selection.kind === 'filter' && selection.filter === 'inbox'
  return useMemo(() => {
    return buildFilteredEntries({
      entries,
      selection,
      isEntityView,
      isChangesView,
      isInboxView,
      modifiedPathSet,
      modifiedSuffixes,
      modifiedFiles,
      subFilter,
      inboxPeriod,
      views,
      allNotesFileVisibility,
    })
  }, [allNotesFileVisibility, entries, inboxPeriod, isChangesView, isEntityView, isInboxView, modifiedFiles, modifiedPathSet, modifiedSuffixes, selection, subFilter, views])
}

// --- useNoteListData ---

interface NoteListDataParams {
  entries: VaultEntry[]; selection: SidebarSelection
  query: string; listSort: SortOption; listDirection: SortDirection
  modifiedPathSet: Set<string>; modifiedSuffixes: string[]
  modifiedFiles?: ModifiedFile[]
  subFilter?: NoteListFilter
  inboxPeriod?: InboxPeriod
  views?: ViewFile[]
  allNotesFileVisibility?: AllNotesFileVisibility
}

export function useNoteListData({
  entries,
  selection,
  query,
  listSort,
  listDirection,
  modifiedPathSet,
  modifiedSuffixes,
  modifiedFiles,
  subFilter,
  inboxPeriod,
  views,
  allNotesFileVisibility,
}: NoteListDataParams) {
  const isEntityView = selection.kind === 'entity'
  const isArchivedView = (selection.kind === 'filter' && selection.filter === 'archived') || subFilter === 'archived'
  const entityEntry = useMemo(() => {
    if (!isEntityView || selection.kind !== 'entity') return null
    return entries.find((entry) => entry.path === selection.entry.path) ?? selection.entry
  }, [entries, isEntityView, selection])

  const filteredEntries = useFilteredEntries({
    entries,
    selection,
    modifiedPathSet,
    modifiedSuffixes,
    modifiedFiles,
    subFilter,
    inboxPeriod,
    views,
    allNotesFileVisibility,
  })

  const searched = useMemo(() => {
    const sorted = [...filteredEntries].sort(getSortComparator(listSort, listDirection))
    return filterByQuery(sorted, query)
  }, [filteredEntries, listSort, listDirection, query])

  const searchedGroups = useMemo(() => {
    if (!entityEntry) return []
    const groups = buildRelationshipGroups(entityEntry, entries)
    return filterGroupsByQuery(groups, query)
  }, [entityEntry, entries, query])

  return { entityEntry, isEntityView, isArchivedView, searched, searchedGroups }
}

// --- useNoteListSearch ---

export function useNoteListSearch() {
  const [search, setSearch] = useState('')
  const [searchVisible, setSearchVisible] = useState(false)
  const query = search.trim().toLowerCase()

  const toggleSearch = useCallback(() => {
    setSearchVisible((v) => { if (v) setSearch(''); return !v })
  }, [])

  return { search, setSearch, query, searchVisible, toggleSearch }
}

// --- useNoteListSort ---

const DEFAULT_LIST_CONFIG: SortConfig = { option: 'modified', direction: 'desc' }

function findSelectedViewFile(selection: SidebarSelection, views?: ViewFile[]): ViewFile | null {
  if (selection.kind !== 'view') return null
  return views?.find((candidate) => candidate.filename === selection.filename) ?? null
}

function findSelectedTypeDocument(entries: VaultEntry[], selection: SidebarSelection): VaultEntry | null {
  if (selection.kind !== 'sectionGroup') return null
  return entries.find((entry) => entry.isA === 'Type' && entry.title === selection.type) ?? null
}

function resolveListSortConfig(
  typeDocument: VaultEntry | null,
  selectedView: ViewFile | null,
  sortPrefs: Record<string, SortConfig>,
): SortConfig {
  if (typeDocument?.sort) {
    const parsed = parseSortConfig(typeDocument.sort)
    if (parsed) return parsed
  }

  if (selectedView?.definition.sort) {
    const parsed = parseSortConfig(selectedView.definition.sort)
    if (parsed) return parsed
  }

  return selectedView ? DEFAULT_LIST_CONFIG : (sortPrefs['__list__'] ?? DEFAULT_LIST_CONFIG)
}

interface SortPersistence {
  onUpdateTypeSort?: (path: string, key: string, value: string) => void
  updateEntry?: (path: string, patch: Partial<VaultEntry>) => void
  onUpdateViewDefinition?: (filename: string, patch: Partial<ViewDefinition>) => void
}

function createSortPersistence(
  onUpdateTypeSort?: SortPersistence['onUpdateTypeSort'],
  updateEntry?: SortPersistence['updateEntry'],
  onUpdateViewDefinition?: SortPersistence['onUpdateViewDefinition'],
): SortPersistence | null {
  if (!onUpdateViewDefinition && !(onUpdateTypeSort && updateEntry)) return null
  return { onUpdateTypeSort, updateEntry, onUpdateViewDefinition }
}

function persistSortToType(path: string, config: SortConfig, persistence: SortPersistence) {
  const serialized = serializeSortConfig(config)
  persistence.onUpdateTypeSort?.(path, 'sort', serialized)
  persistence.updateEntry?.(path, { sort: serialized })
  clearListSortFromLocalStorage()
}

function persistSortToView(
  filename: string,
  config: SortConfig,
  onUpdateViewDefinition: NonNullable<SortPersistence['onUpdateViewDefinition']>,
) {
  onUpdateViewDefinition(filename, { sort: serializeSortConfig(config) })
}

type SortPersistenceTarget =
  | { kind: 'type'; path: string }
  | { kind: 'view'; filename: string }

function canPersistTypeSort(
  persistence: SortPersistence,
): persistence is SortPersistence & Required<Pick<SortPersistence, 'onUpdateTypeSort' | 'updateEntry'>> {
  return Boolean(persistence.onUpdateTypeSort && persistence.updateEntry)
}

function resolveSortPersistenceTarget(
  groupLabel: string,
  typeDocument: VaultEntry | null,
  selectedView: ViewFile | null,
  persistence: SortPersistence | null,
): SortPersistenceTarget | null {
  if (groupLabel !== '__list__' || !persistence) return null
  if (typeDocument && canPersistTypeSort(persistence)) {
    return { kind: 'type', path: typeDocument.path }
  }
  if (selectedView && persistence.onUpdateViewDefinition) {
    return { kind: 'view', filename: selectedView.filename }
  }
  return null
}

function persistListSort(target: SortPersistenceTarget, config: SortConfig, persistence: SortPersistence) {
  if (target.kind === 'type') {
    persistSortToType(target.path, config, persistence)
    return
  }

  if (persistence.onUpdateViewDefinition) {
    persistSortToView(target.filename, config, persistence.onUpdateViewDefinition)
  }
}

function migrateListSortToType(typeDoc: VaultEntry, sortPrefs: Record<string, SortConfig>, migrationDone: Set<string>, persistence: SortPersistence) {
  if (typeDoc.sort || migrationDone.has(typeDoc.path)) return
  const lsConfig = sortPrefs['__list__']
  if (!lsConfig) return
  migrationDone.add(typeDoc.path)
  persistSortToType(typeDoc.path, lsConfig, persistence)
}

function saveGroupSort(groupLabel: string, option: SortOption, direction: SortDirection, setSortPrefs: React.Dispatch<React.SetStateAction<Record<string, SortConfig>>>) {
  setSortPrefs((prev) => { const next = { ...prev, [groupLabel]: { option, direction } }; saveSortPreferences(next); return next })
}

function persistOrSaveGroupSort(params: {
  groupLabel: string
  option: SortOption
  direction: SortDirection
  setSortPrefs: React.Dispatch<React.SetStateAction<Record<string, SortConfig>>>
  typeDocument: VaultEntry | null
  selectedView: ViewFile | null
  persistence: SortPersistence | null
}) {
  const persistenceTarget = resolveSortPersistenceTarget(
    params.groupLabel,
    params.typeDocument,
    params.selectedView,
    params.persistence,
  )
  if (!persistenceTarget || !params.persistence) {
    saveGroupSort(params.groupLabel, params.option, params.direction, params.setSortPrefs)
    return
  }

  persistListSort(persistenceTarget, { option: params.option, direction: params.direction }, params.persistence)
}

function deriveEffectiveSort(configOption: SortOption, customProperties: string[]): SortOption {
  if (!configOption.startsWith('property:')) return configOption
  return customProperties.includes(configOption.slice('property:'.length)) ? configOption : 'modified'
}

export interface UseNoteListSortParams {
  entries: VaultEntry[]
  selection: SidebarSelection
  modifiedPathSet: Set<string>
  modifiedSuffixes: string[]
  subFilter?: NoteListFilter
  inboxPeriod?: InboxPeriod
  views?: ViewFile[]
  onUpdateTypeSort?: (path: string, key: string, value: string | number | boolean | string[] | null) => void
  onUpdateViewDefinition?: (filename: string, patch: Partial<ViewDefinition>) => void
  updateEntry?: (path: string, patch: Partial<VaultEntry>) => void
}

export function useNoteListSort({
  entries,
  selection,
  modifiedPathSet,
  modifiedSuffixes,
  subFilter,
  inboxPeriod,
  views,
  onUpdateTypeSort,
  onUpdateViewDefinition,
  updateEntry,
}: UseNoteListSortParams) {
  const [sortPrefs, setSortPrefs] = useState<Record<string, SortConfig>>(loadSortPreferences)
  const typeDocument = useMemo(() => findSelectedTypeDocument(entries, selection), [entries, selection])
  const selectedView = useMemo(
    () => findSelectedViewFile(selection, views),
    [selection, views],
  )

  const listConfig = resolveListSortConfig(typeDocument, selectedView, sortPrefs)
  const persistence = useMemo<SortPersistence | null>(
    () => createSortPersistence(onUpdateTypeSort, updateEntry, onUpdateViewDefinition),
    [onUpdateTypeSort, onUpdateViewDefinition, updateEntry],
  )

  const migrationDoneRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!typeDocument || !persistence) return
    migrateListSortToType(typeDocument, sortPrefs, migrationDoneRef.current, persistence)
  }, [typeDocument, sortPrefs, persistence])

  const handleSortChange = useCallback((groupLabel: string, option: SortOption, direction: SortDirection) => {
    persistOrSaveGroupSort({
      groupLabel,
      option,
      direction,
      setSortPrefs,
      typeDocument,
      selectedView,
      persistence,
    })
  }, [typeDocument, selectedView, persistence])

  const filteredEntries = useFilteredEntries({
    entries,
    selection,
    modifiedPathSet,
    modifiedSuffixes,
    subFilter,
    inboxPeriod,
    views,
  })
  const customProperties = useMemo(() => extractSortableProperties(filteredEntries), [filteredEntries])
  const listSort = useMemo<SortOption>(() => deriveEffectiveSort(listConfig.option, customProperties), [listConfig.option, customProperties])
  const listDirection = listSort === listConfig.option ? listConfig.direction : 'desc'

  return { listSort, listDirection, customProperties, handleSortChange, sortPrefs, typeDocument }
}

// --- useMultiSelectKeyboard ---

function isInputFocused(): boolean {
  const el = document.activeElement
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || !!(el as HTMLElement)?.isContentEditable
}

function handleEscapeKey(e: KeyboardEvent, multiSelect: MultiSelectState) {
  if (e.key !== 'Escape' || !multiSelect.isMultiSelecting) return
  e.preventDefault()
  multiSelect.clear()
}

function handleSelectAllKey(e: KeyboardEvent, multiSelect: MultiSelectState, isEntityView: boolean) {
  if (e.key !== 'a' || !(e.metaKey || e.ctrlKey) || isEntityView || isInputFocused()) return
  e.preventDefault()
  multiSelect.selectAll()
}

function handleBulkActionKey(e: KeyboardEvent, multiSelect: MultiSelectState, onArchive: () => void, onDelete: () => void) {
  if (!multiSelect.isMultiSelecting || !(e.metaKey || e.ctrlKey)) return
  if (e.key === 'e') { e.preventDefault(); e.stopPropagation(); onArchive() }
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); e.stopPropagation(); onDelete() }
}

export function useMultiSelectKeyboard(multiSelect: MultiSelectState, isEntityView: boolean, onBulkArchive: () => void, onBulkDelete: () => void) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      handleEscapeKey(e, multiSelect)
      handleSelectAllKey(e, multiSelect, isEntityView)
      handleBulkActionKey(e, multiSelect, onBulkArchive, onBulkDelete)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [multiSelect, isEntityView, onBulkArchive, onBulkDelete])
}

// --- useModifiedFilesState ---

export function useModifiedFilesState(modifiedFiles: ModifiedFile[] | undefined, getNoteStatus: ((path: string) => NoteStatus) | undefined) {
  const modifiedPathSet = useMemo(() => new Set((modifiedFiles ?? []).map((f) => f.path)), [modifiedFiles])
  const modifiedSuffixes = useMemo(() => (modifiedFiles ?? []).map((f) => '/' + f.relativePath), [modifiedFiles])
  const resolvedGetNoteStatus = useMemo<(path: string) => NoteStatus>(
    () => createNoteStatusResolver(getNoteStatus, modifiedFiles, modifiedPathSet),
    [getNoteStatus, modifiedFiles, modifiedPathSet],
  )
  return { modifiedPathSet, modifiedSuffixes, resolvedGetNoteStatus }
}

// --- useChangeStatusResolver ---

function buildChangeStatusMap(isChangesView: boolean, modifiedFiles?: ModifiedFile[]) {
  if (!isChangesView || !modifiedFiles) return undefined

  const map = new Map<string, ModifiedFile['status']>()
  for (const file of modifiedFiles) {
    map.set(file.path, file.status)
    map.set('/' + file.relativePath, file.status)
  }

  return map
}

function resolveChangeStatus(path: string, changeStatusMap?: Map<string, ModifiedFile['status']>) {
  if (!changeStatusMap) return undefined

  const direct = changeStatusMap.get(path)
  if (direct) return direct

  const filename = path.split('/').slice(-1)[0]
  for (const [key, status] of changeStatusMap) {
    if (path.endsWith(key) || key.endsWith(filename)) return status
  }

  return undefined
}

export function useChangeStatusResolver(isChangesView: boolean, modifiedFiles?: ModifiedFile[]) {
  const changeStatusMap = useMemo(
    () => buildChangeStatusMap(isChangesView, modifiedFiles),
    [isChangesView, modifiedFiles],
  )

  return useCallback(
    (path: string) => resolveChangeStatus(path, changeStatusMap),
    [changeStatusMap],
  )
}

// --- useVisibleNotesSync ---

interface VisibleNotesSyncParams {
  visibleNotesRef?: React.MutableRefObject<VaultEntry[]>
  isEntityView: boolean
  entityEntry?: VaultEntry | null
  searched: VaultEntry[]
  searchedGroups: Array<{ entries: VaultEntry[] }>
}

function flattenNeighborhoodEntries(
  entityEntry: VaultEntry | null | undefined,
  searchedGroups: Array<{ entries: VaultEntry[] }>,
): VaultEntry[] {
  if (!entityEntry) return []
  return [entityEntry, ...searchedGroups.flatMap((group) => group.entries)]
}

export function useVisibleNotesSync({ visibleNotesRef, isEntityView, entityEntry, searched, searchedGroups }: VisibleNotesSyncParams) {
  useEffect(() => {
    if (!visibleNotesRef) return

    visibleNotesRef.current = isEntityView
      ? flattenNeighborhoodEntries(entityEntry, searchedGroups).filter((entry) => !isDeletedNoteEntry(entry))
      : searched.filter((entry) => !isDeletedNoteEntry(entry))
  }, [visibleNotesRef, entityEntry, isEntityView, searched, searchedGroups])
}

// --- useListPropertyPicker ---

function hasScalarListPropertyValue(value: string | null): boolean {
  return value !== null && value.trim() !== ''
}

function collectAvailableProperties(entries: VaultEntry[]): string[] {
  const keys = new Set<string>()
  for (const entry of entries) {
    if (hasScalarListPropertyValue(entry.status)) keys.add('status')
    for (const key of Object.keys(entry.properties ?? {})) keys.add(key)
    for (const key of Object.keys(entry.relationships ?? {})) keys.add(key)
  }
  return [...keys].sort((a, b) => a.localeCompare(b))
}

function collectTypeAvailableProperties(entries: VaultEntry[], typeName: string): string[] {
  return collectAvailableProperties(entries.filter((entry) => entry.isA === typeName))
}

function deriveDefaultDisplay(entries: VaultEntry[], typeEntryMap: Record<string, VaultEntry>): string[] {
  const ordered: string[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    for (const key of typeEntryMap[entry.isA ?? '']?.listPropertiesDisplay ?? []) {
      if (seen.has(key)) continue
      seen.add(key)
      ordered.push(key)
    }
  }

  return ordered
}

interface ScopedPropertyPickerState {
  availableProperties: string[]
  defaultDisplay: string[]
}

function useAllNotesPropertyPickerState(
  entries: VaultEntry[],
  selection: SidebarSelection,
  isAllNotesView: boolean,
  typeEntryMap: Record<string, VaultEntry>,
): ScopedPropertyPickerState {
  const allNotesEntries = useMemo(
    () => isAllNotesView
      ? [
          ...filterEntries(entries, selection, { subFilter: 'open' }),
          ...filterEntries(entries, selection, { subFilter: 'archived' }),
        ]
      : [],
    [entries, isAllNotesView, selection],
  )

  return {
    availableProperties: useMemo(
      () => collectAvailableProperties(allNotesEntries),
      [allNotesEntries],
    ),
    defaultDisplay: useMemo(
      () => deriveDefaultDisplay(allNotesEntries, typeEntryMap),
      [allNotesEntries, typeEntryMap],
    ),
  }
}

function useInboxPropertyPickerState(
  entries: VaultEntry[],
  inboxPeriod: InboxPeriod,
  isInboxView: boolean,
  typeEntryMap: Record<string, VaultEntry>,
): ScopedPropertyPickerState {
  const inboxEntries = useMemo(
    () => isInboxView ? filterInboxEntries(entries, inboxPeriod) : [],
    [entries, inboxPeriod, isInboxView],
  )

  return {
    availableProperties: useMemo(
      () => collectAvailableProperties(inboxEntries),
      [inboxEntries],
    ),
    defaultDisplay: useMemo(
      () => deriveDefaultDisplay(inboxEntries, typeEntryMap),
      [inboxEntries, typeEntryMap],
    ),
  }
}

interface ViewPropertyPickerState extends ScopedPropertyPickerState {
  selectedView: ViewFile | null
  hasCustomProperties: boolean
}

function useViewPropertyPickerState(
  entries: VaultEntry[],
  selection: SidebarSelection,
  views: ViewFile[] | undefined,
  typeEntryMap: Record<string, VaultEntry>,
): ViewPropertyPickerState {
  const selectedView = useMemo(
    () => findSelectedViewFile(selection, views),
    [selection, views],
  )
  const viewEntries = useMemo(
    () => selectedView ? filterEntries(entries, selection, { views }) : [],
    [entries, selection, selectedView, views],
  )

  return {
    selectedView,
    availableProperties: useMemo(
      () => collectAvailableProperties(viewEntries),
      [viewEntries],
    ),
    defaultDisplay: useMemo(
      () => deriveDefaultDisplay(viewEntries, typeEntryMap),
      [viewEntries, typeEntryMap],
    ),
    hasCustomProperties: Boolean(selectedView?.definition.listPropertiesDisplay?.length),
  }
}

export interface NoteListPropertyPicker {
  scope: NoteListPropertiesScope
  availableProperties: string[]
  currentDisplay: string[]
  onSave: (value: string[] | null) => void
  triggerTitle: string
}

interface BuildFilterPropertyPickerParams {
  scope: Exclude<NoteListPropertiesScope, 'type'>
  isActive: boolean
  availableProperties: string[]
  hasCustomProperties: boolean
  noteListProperties?: string[] | null
  defaultDisplay: string[]
  onSave?: (value: string[] | null) => void
  triggerTitle: string
}

function buildFilterPropertyPicker({
  scope,
  isActive,
  availableProperties,
  hasCustomProperties,
  noteListProperties,
  defaultDisplay,
  onSave,
  triggerTitle,
}: BuildFilterPropertyPickerParams): NoteListPropertyPicker | null {
  if (!isActive || !onSave) return null

  return {
    scope,
    availableProperties,
    currentDisplay: hasCustomProperties ? noteListProperties ?? [] : defaultDisplay,
    onSave,
    triggerTitle,
  }
}

interface BuildTypePropertyPickerParams {
  isSectionGroup: boolean
  typeDocument: VaultEntry | null
  onUpdateTypeSort?: (path: string, key: string, value: string | number | boolean | string[] | null) => void
  typeAvailableProperties: string[]
}

function buildTypePropertyPicker({
  isSectionGroup,
  typeDocument,
  onUpdateTypeSort,
  typeAvailableProperties,
}: BuildTypePropertyPickerParams): NoteListPropertyPicker | null {
  if (!isSectionGroup || !typeDocument || !onUpdateTypeSort) return null

  return {
    scope: 'type',
    availableProperties: typeAvailableProperties,
    currentDisplay: typeDocument.listPropertiesDisplay ?? [],
    onSave: (value: string[] | null) => onUpdateTypeSort(typeDocument.path, '_list_properties_display', value),
    triggerTitle: 'Customize columns',
  }
}

interface BuildViewPropertyPickerParams {
  selectedView: ViewFile | null
  availableProperties: string[]
  defaultDisplay: string[]
  onUpdateViewDefinition?: (filename: string, patch: Partial<ViewDefinition>) => void
}

function buildViewPropertyPicker({
  selectedView,
  availableProperties,
  defaultDisplay,
  onUpdateViewDefinition,
}: BuildViewPropertyPickerParams): NoteListPropertyPicker | null {
  if (!selectedView || !onUpdateViewDefinition) return null

  const currentDisplay = (selectedView.definition.listPropertiesDisplay?.length ?? 0) > 0
    ? selectedView.definition.listPropertiesDisplay ?? []
    : defaultDisplay

  return {
    scope: 'view',
    availableProperties,
    currentDisplay,
    onSave: (value: string[] | null) => onUpdateViewDefinition(selectedView.filename, { listPropertiesDisplay: value ?? [] }),
    triggerTitle: `Customize ${selectedView.definition.name} columns`,
  }
}

function resolveDisplayPropsOverride({
  isAllNotesView,
  hasCustomAllNotesProperties,
  allNotesNoteListProperties,
  isInboxView,
  hasCustomInboxProperties,
  inboxNoteListProperties,
  selectedView,
  hasCustomViewProperties,
}: {
  isAllNotesView: boolean
  hasCustomAllNotesProperties: boolean
  allNotesNoteListProperties?: string[] | null
  isInboxView: boolean
  hasCustomInboxProperties: boolean
  inboxNoteListProperties?: string[] | null
  selectedView: ViewFile | null
  hasCustomViewProperties: boolean
}) {
  if (selectedView && hasCustomViewProperties) {
    return selectedView.definition.listPropertiesDisplay ?? null
  }
  if (isAllNotesView && hasCustomAllNotesProperties) return allNotesNoteListProperties ?? null
  if (isInboxView && hasCustomInboxProperties) return inboxNoteListProperties ?? null
  return null
}

interface UseListPropertyPickerParams {
  entries: VaultEntry[]
  selection: SidebarSelection
  inboxPeriod: InboxPeriod
  typeDocument: VaultEntry | null
  typeEntryMap: Record<string, VaultEntry>
  allNotesNoteListProperties?: string[] | null
  onUpdateAllNotesNoteListProperties?: (value: string[] | null) => void
  inboxNoteListProperties?: string[] | null
  onUpdateInboxNoteListProperties?: (value: string[] | null) => void
  onUpdateViewDefinition?: (filename: string, patch: Partial<ViewDefinition>) => void
  onUpdateTypeSort?: (path: string, key: string, value: string | number | boolean | string[] | null) => void
  views?: ViewFile[]
}

function resolvePropertyPicker(options: {
  selectedView: ViewFile | null
  viewAvailableProperties: string[]
  viewDefaultDisplay: string[]
  onUpdateViewDefinition?: (filename: string, patch: Partial<ViewDefinition>) => void
  isAllNotesView: boolean
  allNotesAvailableProperties: string[]
  hasCustomAllNotesProperties: boolean
  allNotesNoteListProperties?: string[] | null
  allNotesDefaultDisplay: string[]
  onUpdateAllNotesNoteListProperties?: (value: string[] | null) => void
  isInboxView: boolean
  inboxAvailableProperties: string[]
  hasCustomInboxProperties: boolean
  inboxNoteListProperties?: string[] | null
  inboxDefaultDisplay: string[]
  onUpdateInboxNoteListProperties?: (value: string[] | null) => void
  isSectionGroup: boolean
  typeDocument: VaultEntry | null
  onUpdateTypeSort?: (path: string, key: string, value: string | number | boolean | string[] | null) => void
  typeAvailableProperties: string[]
}) {
  return buildViewPropertyPicker({
    selectedView: options.selectedView,
    availableProperties: options.viewAvailableProperties,
    defaultDisplay: options.viewDefaultDisplay,
    onUpdateViewDefinition: options.onUpdateViewDefinition,
  }) ?? buildFilterPropertyPicker({
    scope: 'all',
    isActive: options.isAllNotesView,
    availableProperties: options.allNotesAvailableProperties,
    hasCustomProperties: options.hasCustomAllNotesProperties,
    noteListProperties: options.allNotesNoteListProperties,
    defaultDisplay: options.allNotesDefaultDisplay,
    onSave: options.onUpdateAllNotesNoteListProperties,
    triggerTitle: 'Customize All Notes columns',
  }) ?? buildFilterPropertyPicker({
    scope: 'inbox',
    isActive: options.isInboxView,
    availableProperties: options.inboxAvailableProperties,
    hasCustomProperties: options.hasCustomInboxProperties,
    noteListProperties: options.inboxNoteListProperties,
    defaultDisplay: options.inboxDefaultDisplay,
    onSave: options.onUpdateInboxNoteListProperties,
    triggerTitle: 'Customize Inbox columns',
  }) ?? buildTypePropertyPicker({
    isSectionGroup: options.isSectionGroup,
    typeDocument: options.typeDocument,
    onUpdateTypeSort: options.onUpdateTypeSort,
    typeAvailableProperties: options.typeAvailableProperties,
  })
}

type ResolvePropertyPickerOptions = Parameters<typeof resolvePropertyPicker>[0]

function useResolvedPropertyPicker({
  selectedView,
  viewAvailableProperties,
  viewDefaultDisplay,
  onUpdateViewDefinition,
  isAllNotesView,
  allNotesAvailableProperties,
  hasCustomAllNotesProperties,
  allNotesNoteListProperties,
  allNotesDefaultDisplay,
  onUpdateAllNotesNoteListProperties,
  isInboxView,
  inboxAvailableProperties,
  hasCustomInboxProperties,
  inboxNoteListProperties,
  inboxDefaultDisplay,
  onUpdateInboxNoteListProperties,
  isSectionGroup,
  typeDocument,
  onUpdateTypeSort,
  typeAvailableProperties,
}: ResolvePropertyPickerOptions) {
  return useMemo<NoteListPropertyPicker | null>(() => {
    return resolvePropertyPicker({
      selectedView,
      viewAvailableProperties,
      viewDefaultDisplay,
      onUpdateViewDefinition,
      isAllNotesView,
      allNotesAvailableProperties,
      hasCustomAllNotesProperties,
      allNotesNoteListProperties,
      allNotesDefaultDisplay,
      onUpdateAllNotesNoteListProperties,
      isInboxView,
      inboxAvailableProperties,
      hasCustomInboxProperties,
      inboxNoteListProperties,
      inboxDefaultDisplay,
      onUpdateInboxNoteListProperties,
      isSectionGroup,
      typeDocument,
      onUpdateTypeSort,
      typeAvailableProperties,
    })
  }, [
    allNotesAvailableProperties,
    allNotesDefaultDisplay,
    allNotesNoteListProperties,
    hasCustomAllNotesProperties,
    hasCustomInboxProperties,
    isAllNotesView,
    inboxAvailableProperties,
    inboxDefaultDisplay,
    inboxNoteListProperties,
    isInboxView,
    isSectionGroup,
    onUpdateAllNotesNoteListProperties,
    onUpdateInboxNoteListProperties,
    onUpdateTypeSort,
    onUpdateViewDefinition,
    selectedView,
    typeAvailableProperties,
    typeDocument,
    viewAvailableProperties,
    viewDefaultDisplay,
  ])
}

export function useListPropertyPicker({
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
}: UseListPropertyPickerParams) {
  const isAllNotesView = selection.kind === 'filter' && selection.filter === 'all'
  const isInboxView = selection.kind === 'filter' && selection.filter === 'inbox'
  const isSectionGroup = selection.kind === 'sectionGroup'
  const allNotesState = useAllNotesPropertyPickerState(entries, selection, isAllNotesView, typeEntryMap)
  const inboxState = useInboxPropertyPickerState(entries, inboxPeriod, isInboxView, typeEntryMap)
  const viewState = useViewPropertyPickerState(entries, selection, views, typeEntryMap)
  const typeAvailableProperties = useMemo(
    () => typeDocument ? collectTypeAvailableProperties(entries, typeDocument.title) : [],
    [entries, typeDocument],
  )
  const hasCustomAllNotesProperties = !!(allNotesNoteListProperties && allNotesNoteListProperties.length > 0)
  const hasCustomInboxProperties = !!(inboxNoteListProperties && inboxNoteListProperties.length > 0)
  const displayPropsOverride = resolveDisplayPropsOverride({
    isAllNotesView,
    hasCustomAllNotesProperties,
    allNotesNoteListProperties,
    isInboxView,
    hasCustomInboxProperties,
    inboxNoteListProperties,
    selectedView: viewState.selectedView,
    hasCustomViewProperties: viewState.hasCustomProperties,
  })

  const propertyPicker = useResolvedPropertyPicker({
    selectedView: viewState.selectedView,
    viewAvailableProperties: viewState.availableProperties,
    viewDefaultDisplay: viewState.defaultDisplay,
    onUpdateViewDefinition,
    isAllNotesView,
    allNotesAvailableProperties: allNotesState.availableProperties,
    hasCustomAllNotesProperties,
    allNotesNoteListProperties,
    allNotesDefaultDisplay: allNotesState.defaultDisplay,
    onUpdateAllNotesNoteListProperties,
    isInboxView,
    inboxAvailableProperties: inboxState.availableProperties,
    hasCustomInboxProperties,
    inboxNoteListProperties,
    inboxDefaultDisplay: inboxState.defaultDisplay,
    onUpdateInboxNoteListProperties,
    isSectionGroup,
    typeDocument,
    onUpdateTypeSort,
    typeAvailableProperties,
  })

  return { displayPropsOverride, propertyPicker }
}

// --- useNoteListInteractions ---

function canPrefetchEntryContent(entry: VaultEntry): boolean {
  return !isDeletedNoteEntry(entry) && entry.fileKind !== 'binary'
}

interface UseNoteListInteractionsParams {
  searched: VaultEntry[]
  searchedGroups: Array<{ entries: VaultEntry[] }>
  selectedNotePath: string | null
  selection: SidebarSelection
  noteListFilter: NoteListFilter
  isChangesView: boolean
  entityEntry: VaultEntry | null
  searchVisible: boolean
  toggleSearch: () => void
  onReplaceActiveTab: (entry: VaultEntry) => void
  onEnterNeighborhood?: (entry: VaultEntry) => void
  onOpenDeletedNote?: (entry: DeletedNoteEntry) => void
  onOpenInNewWindow?: (entry: VaultEntry) => void
  onAutoTriggerDiff?: () => void
  onDiscardFile?: (relativePath: string) => Promise<void>
  openContextMenuForEntry: (entry: VaultEntry, point: { x: number; y: number }) => void
  onCreateNote: (type?: string) => void
}

function resolveChangesContextMenuEntry(
  event: React.KeyboardEvent<HTMLDivElement>,
  isChangesView: boolean,
  onDiscardFile: ((relativePath: string) => Promise<void>) | undefined,
  highlightedPath: string | null,
  searched: VaultEntry[],
) {
  if (!isChangesView || !onDiscardFile || !event.shiftKey || event.key !== 'F10' || !highlightedPath) return null
  return searched.find((candidate) => candidate.path === highlightedPath) ?? null
}

function openHighlightedChangesContextMenu(
  entry: VaultEntry,
  openContextMenuForEntry: (entry: VaultEntry, point: { x: number; y: number }) => void,
) {
  const row = document.querySelector<HTMLElement>(`[data-note-path="${entry.path}"]`)
  const rect = row?.getBoundingClientRect()
  openContextMenuForEntry(entry, {
    x: rect ? rect.left + 24 : 160,
    y: rect ? rect.bottom - 8 : 160,
  })
}

function resolveKeyboardEntries(
  searched: VaultEntry[],
  searchedGroups: Array<{ entries: VaultEntry[] }>,
  entityEntry: VaultEntry | null,
): VaultEntry[] {
  return entityEntry
    ? flattenNeighborhoodEntries(entityEntry, searchedGroups)
    : searched
}

function useKeyboardInteractionState({
  searched,
  searchedGroups,
  entityEntry,
  selectedNotePath,
  searchVisible,
  toggleSearch,
  onReplaceActiveTab,
  onEnterNeighborhood,
  onOpenDeletedNote,
}: Pick<
  UseNoteListInteractionsParams,
  | 'searched'
  | 'searchedGroups'
  | 'entityEntry'
  | 'selectedNotePath'
  | 'searchVisible'
  | 'toggleSearch'
  | 'onReplaceActiveTab'
  | 'onEnterNeighborhood'
  | 'onOpenDeletedNote'
>) {
  const keyboardEntries = useMemo(
    () => resolveKeyboardEntries(searched, searchedGroups, entityEntry),
    [entityEntry, searched, searchedGroups],
  )

  const handleKeyboardOpen = useCallback((entry: VaultEntry) => {
    if (isDeletedNoteEntry(entry)) {
      onOpenDeletedNote?.(entry)
      return
    }
    onReplaceActiveTab(entry)
  }, [onOpenDeletedNote, onReplaceActiveTab])

  const handleKeyboardPrefetch = useCallback((entry: VaultEntry) => {
    if (canPrefetchEntryContent(entry)) prefetchNoteContent(entry.path)
  }, [])

  const handleNeighborhoodOpen = useCallback(async (entry: VaultEntry) => {
    if (isDeletedNoteEntry(entry)) return
    await onReplaceActiveTab(entry)
    onEnterNeighborhood?.(entry)
  }, [onEnterNeighborhood, onReplaceActiveTab])

  const noteListKeyboard = useNoteListKeyboard({
    items: keyboardEntries,
    selectedNotePath,
    onOpen: handleKeyboardOpen,
    onEnterNeighborhood: handleNeighborhoodOpen,
    onPrefetch: handleKeyboardPrefetch,
    searchVisible,
    toggleSearch,
    enabled: true,
  })
  const multiSelect = useMultiSelect(keyboardEntries, selectedNotePath)

  return { handleNeighborhoodOpen, multiSelect, noteListKeyboard }
}

function useNoteClickHandler({
  isChangesView,
  onReplaceActiveTab,
  handleNeighborhoodOpen,
  onOpenDeletedNote,
  onOpenInNewWindow,
  onAutoTriggerDiff,
  multiSelect,
}: {
  isChangesView: boolean
  onReplaceActiveTab: (entry: VaultEntry) => void
  handleNeighborhoodOpen: (entry: VaultEntry) => Promise<void>
  onOpenDeletedNote?: (entry: DeletedNoteEntry) => void
  onOpenInNewWindow?: (entry: VaultEntry) => void
  onAutoTriggerDiff?: () => void
  multiSelect: MultiSelectState
}) {
  return useCallback((entry: VaultEntry, event: React.MouseEvent) => {
    if (isDeletedNoteEntry(entry)) {
      routeNoteClick(entry, event, {
        onReplace: () => onOpenDeletedNote?.(entry),
        onEnterNeighborhood: () => onOpenDeletedNote?.(entry),
        multiSelect,
      })
      return
    }

    routeNoteClick(entry, event, {
      onReplace: onReplaceActiveTab,
      onEnterNeighborhood: handleNeighborhoodOpen,
      onOpenInNewWindow,
      multiSelect,
    })

    if (isChangesView && onAutoTriggerDiff) {
      setTimeout(onAutoTriggerDiff, 50)
    }
  }, [
    isChangesView,
    multiSelect,
    onAutoTriggerDiff,
    onOpenDeletedNote,
    onOpenInNewWindow,
    onReplaceActiveTab,
    handleNeighborhoodOpen,
  ])
}

function useListKeyDownHandler({
  isChangesView,
  onDiscardFile,
  highlightedPath,
  searched,
  openContextMenuForEntry,
  handleKeyDown,
}: {
  isChangesView: boolean
  onDiscardFile?: (relativePath: string) => Promise<void>
  highlightedPath: string | null
  searched: VaultEntry[]
  openContextMenuForEntry: (entry: VaultEntry, point: { x: number; y: number }) => void
  handleKeyDown: (event: React.KeyboardEvent) => void
}) {
  return useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const entry = resolveChangesContextMenuEntry(
      event,
      isChangesView,
      onDiscardFile,
      highlightedPath,
      searched,
    )
    if (entry) {
      event.preventDefault()
      event.stopPropagation()
      openHighlightedChangesContextMenu(entry, openContextMenuForEntry)
      return
    }

    handleKeyDown(event)
  }, [handleKeyDown, highlightedPath, isChangesView, onDiscardFile, openContextMenuForEntry, searched])
}

export function useNoteListInteractions({
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
  openContextMenuForEntry,
  onCreateNote,
}: UseNoteListInteractionsParams) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const { handleNeighborhoodOpen, multiSelect, noteListKeyboard } = useKeyboardInteractionState({
    searched,
    searchedGroups,
    entityEntry,
    selectedNotePath,
    searchVisible,
    toggleSearch,
    onReplaceActiveTab,
    onEnterNeighborhood,
    onOpenDeletedNote,
  })

  useEffect(() => {
    multiSelect.clear()
  }, [noteListFilter, selection]) // eslint-disable-line react-hooks/exhaustive-deps -- clear only when selection/filter changes

  const handleClickNote = useNoteClickHandler({
    isChangesView,
    onReplaceActiveTab,
    handleNeighborhoodOpen,
    onOpenDeletedNote,
    onOpenInNewWindow,
    onAutoTriggerDiff,
    multiSelect,
  })

  const handleListKeyDown = useListKeyDownHandler({
    isChangesView,
    onDiscardFile,
    highlightedPath: noteListKeyboard.highlightedPath,
    searched,
    openContextMenuForEntry,
    handleKeyDown: noteListKeyboard.handleKeyDown,
  })

  const handleCreateNote = useCallback(() => {
    onCreateNote(selection.kind === 'sectionGroup' ? selection.type : undefined)
  }, [onCreateNote, selection])

  const toggleGroup = useCallback((label: string) => {
    setCollapsedGroups((prev) => toggleSetMember(prev, label))
  }, [])

  return {
    collapsedGroups,
    handleClickNote,
    handleCreateNote,
    handleListKeyDown,
    multiSelect,
    noteListKeyboard,
    toggleGroup,
  }
}
