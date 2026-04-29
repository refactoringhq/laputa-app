import type { VaultEntry, SidebarSelection, InboxPeriod, ViewFile } from '../types'
import { APP_STORAGE_KEYS, LEGACY_APP_STORAGE_KEYS, getAppStorageItem } from '../constants/appStorage'
import {
  orderInverseRelationshipLabels as sortInverseRelationshipLabels,
  resolveInverseRelationshipLabel,
} from './inverseRelationshipLabels'
import { evaluateView } from './viewFilters'
import { wikilinkTarget, resolveEntry } from './wikilink'

export type NoteListFilter = 'open' | 'archived'

export interface RelationshipGroup {
  label: string
  entries: VaultEntry[]
}

export function relativeDate(ts: number | null): string {
  if (!ts) return ''
  const now = Math.floor(Date.now() / 1000)
  const diff = now - ts
  if (diff < 0) {
    const date = new Date(ts * 1000)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  const date = new Date(ts * 1000)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function getDisplayDate(entry: VaultEntry): number | null {
  return entry.modifiedAt ?? entry.createdAt
}

export function formatSubtitle(entry: VaultEntry): string {
  const parts: string[] = []
  const date = getDisplayDate(entry)
  if (date) parts.push(relativeDate(date))
  if (entry.wordCount > 0) {
    parts.push(`${entry.wordCount.toLocaleString('en-US')} words`)
  } else {
    parts.push('Empty')
  }
  if (entry.outgoingLinks.length > 0) {
    parts.push(`${entry.outgoingLinks.length} ${entry.outgoingLinks.length === 1 ? 'link' : 'links'}`)
  }
  return parts.join(' \u00b7 ')
}

function wasCreatedBeforeLastModification(entry: VaultEntry): boolean {
  return !!(entry.createdAt && entry.modifiedAt && entry.createdAt !== entry.modifiedAt)
}

export function formatSearchSubtitle(entry: VaultEntry): string {
  const parts: string[] = []
  const modified = entry.modifiedAt ?? entry.createdAt
  if (modified) parts.push(relativeDate(modified))
  if (wasCreatedBeforeLastModification(entry)) {
    parts.push(`Created ${relativeDate(entry.createdAt!)}`)
  }
  if (entry.wordCount > 0) {
    parts.push(`${entry.wordCount.toLocaleString('en-US')} words`)
  } else {
    parts.push('Empty')
  }
  if (entry.outgoingLinks.length > 0) {
    parts.push(`${entry.outgoingLinks.length} ${entry.outgoingLinks.length === 1 ? 'link' : 'links'}`)
  }
  return parts.join(' \u00b7 ')
}

function refMatchesEntry(ref: string, entry: VaultEntry): boolean {
  const target = wikilinkTarget(ref).trim()
  if (!target) return false

  if (target.includes('/')) {
    const normalizedTarget = target.replace(/^\/+/, '').replace(/\.md$/, '').toLowerCase()
    return entry.path.toLowerCase().endsWith(`/${normalizedTarget}.md`)
  }

  return resolveEntry([entry], target) !== undefined
}

function refsMatch(refs: string[], entry: VaultEntry): boolean {
  return refs.some((ref) => refMatchesEntry(ref, entry))
}

function resolveRefs(refs: string[], entries: VaultEntry[]): VaultEntry[] {
  return refs
    .map((ref) => resolveEntry(entries, wikilinkTarget(ref)))
    .filter((e): e is VaultEntry => e !== undefined)
}

export function sortByModified(a: VaultEntry, b: VaultEntry): number {
  return (getDisplayDate(b) ?? 0) - (getDisplayDate(a) ?? 0)
}

export type SortOption = 'modified' | 'created' | 'title' | 'status' | `property:${string}`
export type SortDirection = 'asc' | 'desc'

export interface SortConfig {
  option: SortOption
  direction: SortDirection
}

export const DEFAULT_SORT_OPTIONS: SortOption[] = ['modified', 'created', 'title', 'status']

export function getDefaultDirection(option: SortOption): SortDirection {
  if (option === 'modified' || option === 'created') return 'desc'
  return 'asc'
}

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'modified', label: 'Modified' },
  { value: 'created', label: 'Created' },
  { value: 'title', label: 'Title' },
  { value: 'status', label: 'Status' },
]

export function getSortOptionLabel(option: SortOption): string {
  if (option.startsWith('property:')) return option.slice('property:'.length)
  return SORT_OPTIONS.find((o) => o.value === option)?.label ?? option
}

/** Extract sortable custom property keys from a list of entries. */
export function extractSortableProperties(entries: VaultEntry[]): string[] {
  const keys = new Set<string>()
  for (const entry of entries) {
    if (entry.properties) {
      for (const key of Object.keys(entry.properties)) keys.add(key)
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b))
}

const STATUS_ORDER: Record<string, number> = {
  Active: 0, Paused: 1, Done: 2, Finished: 3,
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/

function tryParseDate(s: string): number | null {
  if (!ISO_DATE_RE.test(s)) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.getTime()
}

function compareNumericPair(a: unknown, b: unknown): number | null {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0)
  return null
}

function comparePropertyValues(a: unknown, b: unknown): number {
  const numeric = compareNumericPair(a, b)
  if (numeric !== null) return numeric
  const sa = String(a)
  const sb = String(b)
  const da = tryParseDate(sa)
  const db = tryParseDate(sb)
  if (da !== null && db !== null) return da - db
  return sa.localeCompare(sb)
}

function makePropertyComparator(key: string, flip: number): (a: VaultEntry, b: VaultEntry) => number {
  return (a, b) => {
    const va = a.properties?.[key] ?? null
    const vb = b.properties?.[key] ?? null
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    return flip * comparePropertyValues(va, vb)
  }
}

function makeBuiltinComparator(option: string, flip: number): (a: VaultEntry, b: VaultEntry) => number {
  if (option === 'title') return (a, b) => flip * a.title.localeCompare(b.title)
  if (option === 'created') return (a, b) => flip * ((a.createdAt ?? a.modifiedAt ?? 0) - (b.createdAt ?? b.modifiedAt ?? 0))
  if (option === 'status') return (a, b) => {
    const sa = STATUS_ORDER[a.status ?? ''] ?? 999
    const sb = STATUS_ORDER[b.status ?? ''] ?? 999
    if (sa !== sb) return flip * (sa - sb)
    return (getDisplayDate(b) ?? 0) - (getDisplayDate(a) ?? 0)
  }
  return (a, b) => flip * ((getDisplayDate(a) ?? 0) - (getDisplayDate(b) ?? 0))
}

export function getSortComparator(option: SortOption, direction?: SortDirection): (a: VaultEntry, b: VaultEntry) => number {
  const flip = (direction ?? getDefaultDirection(option)) === 'asc' ? 1 : -1
  if (option.startsWith('property:')) return makePropertyComparator(option.slice('property:'.length), flip)
  return makeBuiltinComparator(option, flip)
}

/** Serialize a SortConfig to the string format stored in type frontmatter: "option:direction". */
export function serializeSortConfig(config: SortConfig): string {
  return `${config.option}:${config.direction}`
}

/** Parse a frontmatter sort string ("option:direction") back to SortConfig. */
export function parseSortConfig(raw: string | null | undefined): SortConfig | null {
  if (!raw) return null
  // Format: "option:direction" where option itself can contain ":" (e.g. "property:Priority:asc")
  const lastColon = raw.lastIndexOf(':')
  if (lastColon <= 0) return null
  const dir = raw.slice(lastColon + 1)
  if (dir !== 'asc' && dir !== 'desc') return null
  const option = raw.slice(0, lastColon) as SortOption
  return { option, direction: dir }
}

export function loadSortPreferences(): Record<string, SortConfig> {
  try {
    const raw = getAppStorageItem('sortPreferences')
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    const result: Record<string, SortConfig> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        // Migrate old format: bare SortOption string → SortConfig
        const opt = value as SortOption
        result[key] = { option: opt, direction: getDefaultDirection(opt) }
      } else {
        result[key] = value as SortConfig
      }
    }
    return result
  } catch {
    return {}
  }
}

export function saveSortPreferences(prefs: Record<string, SortConfig>) {
  try {
    localStorage.setItem(APP_STORAGE_KEYS.sortPreferences, JSON.stringify(prefs))
    localStorage.removeItem(LEGACY_APP_STORAGE_KEYS.sortPreferences)
  } catch { /* ignore */ }
}

/** Remove the `__list__` key from localStorage sort preferences (used during migration). */
export function clearListSortFromLocalStorage(): void {
  try {
    const raw = getAppStorageItem('sortPreferences')
    if (!raw) return
    const parsed = JSON.parse(raw)
    delete parsed['__list__']
    if (Object.keys(parsed).length === 0) {
      localStorage.removeItem(APP_STORAGE_KEYS.sortPreferences)
      localStorage.removeItem(LEGACY_APP_STORAGE_KEYS.sortPreferences)
    } else {
      localStorage.setItem(APP_STORAGE_KEYS.sortPreferences, JSON.stringify(parsed))
      localStorage.removeItem(LEGACY_APP_STORAGE_KEYS.sortPreferences)
    }
  } catch { /* ignore */ }
}

function findBacklinks(entity: VaultEntry, allEntries: VaultEntry[]): VaultEntry[] {
  const stem = entity.filename.replace(/\.md$/, '')
  const pathStem = entity.path.replace(/^.*\/Laputa\//, '').replace(/\.md$/, '')
  const targets = new Set([entity.title, ...entity.aliases, stem, pathStem])

  return allEntries.filter((e) => {
    if (e.path === entity.path) return false
    return e.outgoingLinks.some((link) =>
      targets.has(link) || targets.has(link.split('/').pop() ?? ''),
    )
  })
}

class GroupBuilder {
  readonly groups: RelationshipGroup[] = []
  private readonly entityPath: string
  private readonly allEntries: VaultEntry[]

  constructor(entityPath: string, allEntries: VaultEntry[]) {
    this.entityPath = entityPath
    this.allEntries = allEntries
  }

  add(label: string, entries: VaultEntry[]) {
    const deduped = new Map<string, VaultEntry>()
    for (const entry of entries) {
      if (entry.path === this.entityPath || deduped.has(entry.path)) continue
      deduped.set(entry.path, entry)
    }

    if (deduped.size === 0) return
    this.groups.push({ label, entries: [...deduped.values()] })
  }

  addFromRefs(label: string, refs: string[]) {
    this.add(label, resolveRefs(refs, this.allEntries).sort(sortByModified))
  }

  filterAndAdd(label: string, predicate: (e: VaultEntry) => boolean) {
    this.add(label, this.allEntries.filter(predicate).sort(sortByModified))
  }
}

function appendInverseRelationshipEntries(
  inverseGroups: Map<string, VaultEntry[]>,
  label: string,
  entry: VaultEntry,
) {
  const existing = inverseGroups.get(label)
  if (existing) {
    existing.push(entry)
    return
  }

  inverseGroups.set(label, [entry])
}

function appendLegacyInverseRelationshipEntries(
  inverseGroups: Map<string, VaultEntry[]>,
  entity: VaultEntry,
  entry: VaultEntry,
) {
  if (refsMatch(entry.belongsTo, entity)) {
    appendInverseRelationshipEntries(inverseGroups, resolveInverseRelationshipLabel('Belongs to', entry), entry)
  }

  if (refsMatch(entry.relatedTo, entity)) {
    appendInverseRelationshipEntries(inverseGroups, resolveInverseRelationshipLabel('Related to', entry), entry)
  }
}

function appendDynamicInverseRelationshipEntries(
  inverseGroups: Map<string, VaultEntry[]>,
  entity: VaultEntry,
  entry: VaultEntry,
) {
  for (const [key, refs] of Object.entries(entry.relationships ?? {})) {
    if (key === 'Type' || !refsMatch(refs, entity)) continue
    appendInverseRelationshipEntries(inverseGroups, resolveInverseRelationshipLabel(key, entry), entry)
  }
}

function orderInverseRelationshipLabels(inverseGroups: Map<string, VaultEntry[]>): string[] {
  return sortInverseRelationshipLabels(inverseGroups.keys())
}

function collectInverseRelationshipGroups(
  entity: VaultEntry,
  allEntries: VaultEntry[],
): RelationshipGroup[] {
  const inverseGroups = new Map<string, VaultEntry[]>()

  for (const other of allEntries) {
    if (other.path === entity.path) continue
    appendLegacyInverseRelationshipEntries(inverseGroups, entity, other)
    appendDynamicInverseRelationshipEntries(inverseGroups, entity, other)
  }

  return orderInverseRelationshipLabels(inverseGroups)
    .map((label) => {
      const entries = inverseGroups.get(label)
      if (!entries) return null
      return { label, entries: [...entries].sort(sortByModified) }
    })
    .filter((group): group is RelationshipGroup => group !== null)
}

export function buildRelationshipGroups(
  entity: VaultEntry,
  allEntries: VaultEntry[],
): RelationshipGroup[] {
  const b = new GroupBuilder(entity.path, allEntries)
  const rels = entity.relationships ?? {}

  if (entity.isA === 'Type') {
    b.filterAndAdd('Instances', (e) => e.isA === entity.title)
  }

  // Direct relationships first — all keys from entity.relationships take
  // priority so that reverse/computed groups (Children, Events, Referenced by)
  // only show *additional* entries not already covered by a direct property.
  Object.keys(rels)
    .filter((k) => k.toLowerCase() !== 'type')
    .sort((a, b) => a.localeCompare(b))
    .forEach((key) => b.addFromRefs(key, rels[key] ?? []))

  collectInverseRelationshipGroups(entity, allEntries).forEach((group) => b.add(group.label, group.entries))
  b.add('Backlinks', findBacklinks(entity, allEntries).sort(sortByModified))

  return b.groups
}

const isActive = (e: VaultEntry) => !e.archived
const isMarkdown = (e: VaultEntry) => e.fileKind === 'markdown' || !e.fileKind
const ATTACHMENTS_FOLDER = 'attachments'

function applySubFilter(entries: VaultEntry[], subFilter: NoteListFilter): VaultEntry[] {
  if (subFilter === 'archived') return entries.filter((e) => e.archived)
  return entries.filter(isActive)
}

function isInFolder(entryPath: string, folderRelPath: string): boolean {
  const folderPath = normalizeFolderPath(folderRelPath)
  if (!folderPath) return false
  const normalizedEntryPath = normalizeFolderPath(entryPath)
  return normalizedEntryPath.includes(`/${folderPath}/`) || normalizedEntryPath.startsWith(`${folderPath}/`)
}

function normalizeFolderPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

export function isAllNotesEntry(entry: VaultEntry): boolean {
  return isMarkdown(entry) && !isInFolder(entry.path, ATTACHMENTS_FOLDER)
}

function filterViewEntries(entries: VaultEntry[], filename: string, views?: ViewFile[]): VaultEntry[] {
  const view = views?.find((candidate) => candidate.filename === filename)
  if (!view) return []
  return evaluateView(view.definition, entries.filter(isMarkdown))
}

function filterFolderEntries(entries: VaultEntry[], folderPath: string, subFilter?: NoteListFilter): VaultEntry[] {
  // Folder view shows ALL files (text + binary), not just markdown
  const folderEntries = entries.filter((entry) => isInFolder(entry.path, folderPath))
  return subFilter ? applySubFilter(folderEntries, subFilter) : folderEntries.filter(isActive)
}

function filterSectionGroupEntries(entries: VaultEntry[], type: string, subFilter?: NoteListFilter): VaultEntry[] {
  const typeEntries = entries.filter((entry) => isMarkdown(entry) && entry.isA === type)
  return subFilter ? applySubFilter(typeEntries, subFilter) : typeEntries.filter(isActive)
}

function filterTopLevelEntries(
  entries: VaultEntry[],
  selection: Extract<SidebarSelection, { kind: 'filter' }>,
  subFilter?: NoteListFilter,
): VaultEntry[] {
  const filterableEntries = selection.filter === 'all'
    ? entries.filter(isAllNotesEntry)
    : entries.filter(isMarkdown)
  if (selection.filter === 'all' && subFilter) return applySubFilter(filterableEntries, subFilter)
  return filterByFilterType(filterableEntries, selection.filter)
}

function filterByKind(entries: VaultEntry[], selection: SidebarSelection, subFilter?: NoteListFilter, views?: ViewFile[]): VaultEntry[] {
  if (selection.kind === 'entity') return []
  if (selection.kind === 'view') return filterViewEntries(entries, selection.filename, views)
  if (selection.kind === 'folder') return filterFolderEntries(entries, selection.path, subFilter)
  if (selection.kind === 'sectionGroup') return filterSectionGroupEntries(entries, selection.type, subFilter)
  if (selection.kind === 'filter') return filterTopLevelEntries(entries, selection, subFilter)
  return []
}

function filterByFilterType(entries: VaultEntry[], filter: string): VaultEntry[] {
  if (filter === 'all') return entries.filter(isActive)
  if (filter === 'archived') return entries.filter((e) => e.archived)
  if (filter === 'favorites') return entries.filter((e) => e.favorite && !e.archived)
  if (filter === 'pulse') return []
  return []
}

export function filterEntries(entries: VaultEntry[], selection: SidebarSelection, subFilter?: NoteListFilter, views?: ViewFile[]): VaultEntry[] {
  return filterByKind(entries, selection, subFilter, views)
}

/** Count notes per sub-filter for a given type. */
export function countByFilter(entries: VaultEntry[], type: string): Record<NoteListFilter, number> {
  let open = 0, archived = 0
  for (const e of entries) {
    if (!isMarkdown(e) || e.isA !== type) continue
    if (e.archived) archived++
    else open++
  }
  return { open, archived }
}

function countEntriesByArchiveStatus(entries: VaultEntry[]): Record<NoteListFilter, number> {
  let open = 0, archived = 0
  for (const entry of entries) {
    if (entry.archived) archived++
    else open++
  }
  return { open, archived }
}

/** Count notes per sub-filter across all entries (no type filter). */
export function countAllByFilter(entries: VaultEntry[]): Record<NoteListFilter, number> {
  return countEntriesByArchiveStatus(entries.filter(isMarkdown))
}

/** Count All Notes-eligible documents per sub-filter, excluding files under attachments/. */
export function countAllNotesByFilter(entries: VaultEntry[]): Record<NoteListFilter, number> {
  return countEntriesByArchiveStatus(entries.filter(isAllNotesEntry))
}

// --- Inbox ---

/** Check if entry belongs in the Inbox (markdown only, not organized, not archived, not a Type). */
export function isInboxEntry(entry: VaultEntry): boolean {
  if (!isMarkdown(entry)) return false
  if (entry.archived) return false
  if (entry.isA === 'Type') return false
  return !entry.organized
}

const INBOX_PERIOD_DAYS: Record<InboxPeriod, number> = {
  week: 7, month: 30, quarter: 90, all: Infinity,
}

/** Filter entries for the Inbox view: not organized, within the given time period, sorted by createdAt desc. */
export function filterInboxEntries(entries: VaultEntry[], period: InboxPeriod): VaultEntry[] {
  const now = Math.floor(Date.now() / 1000)
  const cutoff = period === 'all' ? 0 : now - INBOX_PERIOD_DAYS[period] * 86400

  return entries
    .filter((e) => isInboxEntry(e) && (e.createdAt ?? 0) >= cutoff)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}

/** Count inbox entries per period. */
export function countInboxByPeriod(entries: VaultEntry[]): Record<InboxPeriod, number> {
  const inbox = entries.filter((e) => isInboxEntry(e))
  const now = Math.floor(Date.now() / 1000)

  let week = 0, month = 0, quarter = 0
  for (const e of inbox) {
    const age = now - (e.createdAt ?? 0)
    if (age <= 7 * 86400) week++
    if (age <= 30 * 86400) month++
    if (age <= 90 * 86400) quarter++
  }

  return { week, month, quarter, all: inbox.length }
}
