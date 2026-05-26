import type { VaultEntry, SidebarSelection, SidebarFilter, ModifiedFile, NoteStatus, ViewFile } from '../../types'
import type { RelationshipGroup } from '../../utils/noteListHelpers'
import { translate, type AppLocale } from '../../lib/i18n'
import { filenameStemToTitle } from '../../utils/noteTitle'
import { vaultRelativePathLabel } from '../../utils/notePathIdentity'

export interface DeletedNoteEntry extends VaultEntry {
  __deletedNotePreview: true
  __deletedRelativePath: string
  __changeAddedLines: number | null
  __changeDeletedLines: number | null
  __changeBinary: boolean
}

const FILTER_TITLE_KEYS = {
  archived: 'noteList.title.archive',
  changes: 'noteList.title.changes',
  inbox: 'noteList.title.inbox',
  pulse: 'noteList.title.history',
} as const

type LocalizedFilter = keyof typeof FILTER_TITLE_KEYS

function isLocalizedFilter(filter: SidebarFilter): filter is LocalizedFilter {
  return filter in FILTER_TITLE_KEYS
}

function resolveSelectionFilterTitle(selection: SidebarSelection, locale: AppLocale): string | null {
  if (selection.kind !== 'filter') return null
  if (!isLocalizedFilter(selection.filter)) return null
  return translate(locale, FILTER_TITLE_KEYS[selection.filter])
}

function resolveFolderTitle(selection: SidebarSelection): string | null {
  if (selection.kind !== 'folder') return null
  if (selection.path.trim()) return vaultRelativePathLabel(selection.path)
  return selection.rootPath ? vaultRelativePathLabel(selection.rootPath) : null
}

export function resolveHeaderTitle(selection: SidebarSelection, typeDocument: VaultEntry | null, views?: ViewFile[], locale: AppLocale = 'en'): string {
  if (selection.kind === 'view') {
    const view = views?.find((v) => v.filename === selection.filename)
    return view?.definition.name ?? translate(locale, 'noteList.title.view')
  }
  if (selection.kind === 'entity') return selection.entry.title
  const folderTitle = resolveFolderTitle(selection)
  if (folderTitle) return folderTitle
  if (typeDocument) return typeDocument.title

  return resolveSelectionFilterTitle(selection, locale) ?? translate(locale, 'noteList.title.notes')
}

function searchableTitle(entry: { title?: unknown }): string {
  return typeof entry.title === 'string' ? entry.title : ''
}

export function filterByQuery<T extends { title?: unknown }>(items: T[], query: string): T[] {
  return query ? items.filter((e) => searchableTitle(e).toLowerCase().includes(query)) : items
}

export function filterGroupsByQuery(groups: RelationshipGroup[], query: string): RelationshipGroup[] {
  if (!query) return groups
  return groups.map((g) => ({ ...g, entries: filterByQuery(g.entries, query) })).filter((g) => g.entries.length > 0)
}

export interface ClickActions {
  onReplace: (entry: VaultEntry) => void
  onEnterNeighborhood?: (entry: VaultEntry) => void
  onOpenInNewWindow?: (entry: VaultEntry) => void
  multiSelect: { selectRange: (path: string) => void; clear: () => void; setAnchor: (path: string) => void }
}

function usesCommandModifier(event: Pick<React.MouseEvent, 'metaKey' | 'ctrlKey'>): boolean {
  return event.metaKey || event.ctrlKey
}

function isOpenInNewWindowClick(event: Pick<React.MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>): boolean {
  return usesCommandModifier(event) && event.shiftKey
}

function isRangeSelectionClick(event: Pick<React.MouseEvent, 'shiftKey'>): boolean {
  return event.shiftKey
}

function isNeighborhoodClick(
  event: Pick<React.MouseEvent, 'metaKey' | 'ctrlKey'>,
  actions: ClickActions,
): boolean {
  return usesCommandModifier(event) && Boolean(actions.onEnterNeighborhood)
}

export function routeNoteClick(entry: VaultEntry, e: React.MouseEvent, actions: ClickActions) {
  if (isOpenInNewWindowClick(e)) {
    actions.onOpenInNewWindow?.(entry)
    return
  }

  if (isRangeSelectionClick(e)) {
    actions.multiSelect.selectRange(entry.path)
    return
  }

  actions.multiSelect.clear()
  if (isNeighborhoodClick(e, actions)) {
    actions.onEnterNeighborhood?.(entry)
    return
  }

  actions.multiSelect.setAnchor(entry.path)
  actions.onReplace(entry)
}

export function createNoteStatusResolver(
  getNoteStatus: ((path: string) => NoteStatus) | undefined,
  modifiedFiles: ModifiedFile[] | undefined,
  modifiedPathSet: Set<string>,
): (path: string) => NoteStatus {
  if (modifiedFiles && modifiedFiles.length > 0) {
    return (path: string) => {
      const explicitStatus = getNoteStatus?.(path)
      if (explicitStatus && explicitStatus !== 'clean') return explicitStatus

      const modifiedFile = modifiedFiles.find((file) => file.path === path)
      if (modifiedFile?.status === 'added' || modifiedFile?.status === 'untracked') return 'new'
      return modifiedPathSet.has(path) ? 'modified' : 'clean'
    }
  }
  if (getNoteStatus) return getNoteStatus
  return () => 'clean'
}

export function toggleSetMember<T>(set: Set<T>, member: T): Set<T> {
  const next = new Set(set)
  if (next.has(member)) next.delete(member)
  else next.add(member)
  return next
}

export function isModifiedEntry(path: string, pathSet: Set<string>, suffixes: string[]): boolean {
  if (pathSet.has(path)) return true
  return suffixes.some((suffix) => path.endsWith(suffix))
}

export function isDeletedNoteEntry(entry: VaultEntry): entry is DeletedNoteEntry {
  return '__deletedNotePreview' in entry && entry.__deletedNotePreview === true
}

function matchesModifiedFile(entry: VaultEntry, file: ModifiedFile): boolean {
  return entry.path === file.path || entry.path.endsWith('/' + file.relativePath)
}

function applyChangeStats<T extends VaultEntry>(entry: T, file: ModifiedFile): T {
  return {
    ...entry,
    __changeAddedLines: file.addedLines ?? null,
    __changeDeletedLines: file.deletedLines ?? null,
    __changeBinary: Boolean(file.binary),
  }
}

function createDeletedNoteEntry(file: ModifiedFile): DeletedNoteEntry {
  const filename = file.relativePath.split('/').pop() ?? file.relativePath
  return {
    path: file.path,
    filename,
    title: filenameStemToTitle(filename),
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    modifiedAt: null,
    createdAt: null,
    fileSize: 0,
    snippet: '',
    wordCount: 0,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    sidebarLabel: null,
    template: null,
    sort: null,
    view: null,
    visible: null,
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    outgoingLinks: [],
    properties: {},
    hasH1: true,
    fileKind: 'markdown',
    __deletedNotePreview: true,
    __deletedRelativePath: file.relativePath,
    __changeAddedLines: file.addedLines ?? null,
    __changeDeletedLines: file.deletedLines ?? null,
    __changeBinary: Boolean(file.binary),
  }
}

export function buildChangesEntries(entries: VaultEntry[], modifiedFiles: ModifiedFile[] | undefined): VaultEntry[] {
  if (!modifiedFiles || modifiedFiles.length === 0) return []

  const liveEntries = entries.flatMap((entry) => {
    const file = modifiedFiles.find((candidate) => candidate.status !== 'deleted' && matchesModifiedFile(entry, candidate))
    return file ? [applyChangeStats(entry, file)] : []
  })

  const deletedEntries = modifiedFiles
    .filter((file) => file.status === 'deleted')
    .filter((file) => !entries.some((entry) => matchesModifiedFile(entry, file)))
    .map(createDeletedNoteEntry)

  return [...liveEntries, ...deletedEntries]
}

export function extractDeletedContentFromDiff(diff: string): string | null {
  const lines: string[] = []
  let inHunk = false

  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('\\')) continue
    if (line.startsWith('-') || line.startsWith(' ')) {
      lines.push(line.slice(1))
    }
  }

  return lines.length > 0 ? lines.join('\n') : null
}
