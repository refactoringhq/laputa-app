import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, addMockEntry, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import { slugifyNoteStem as slugify } from '../utils/noteSlug'
import { resolveEntry } from '../utils/wikilink'
import { trackEvent } from '../lib/telemetry'
import { cacheNoteContent } from './useTabManagement'
import { findByCollidingNotePath, joinVaultPath, notePathFilename } from '../utils/notePathIdentity'
import { canonicalFrontmatterKey } from '../utils/systemMetadata'
import { canonicalizeTypeName } from '../utils/vaultTypes'
import { labelFromWorkspacePath, workspaceIdentityFromVault } from '../utils/workspaces'
import type { VaultOption } from '../components/status-bar/types'

export interface NewEntryParams {
  path: string
  slug: string
  title: string
  type: string
  status: string | null
}

export function buildNewEntry({ path, slug, title, type, status }: NewEntryParams): VaultEntry {
  const now = Math.floor(Date.now() / 1000)
  return {
    path, filename: `${slug}.md`, title, isA: type,
    aliases: [], belongsTo: [], relatedTo: [],
    status, archived: false,
    modifiedAt: now, createdAt: now, fileSize: 0,
    snippet: '', wordCount: 0, relationships: {}, icon: null, color: null, order: null, outgoingLinks: [], sidebarLabel: null, template: null, sort: null, view: null, visible: null, properties: {}, organized: false, favorite: false, favoriteIndex: null, listPropertiesDisplay: [], hasH1: false,
  }
}

function workspaceForVaultPath(vaultPath: string, vaults: readonly VaultOption[] = [], defaultWorkspacePath?: string | null) {
  const configuredVault = vaults.find((vault) => vault.path === vaultPath)
  return workspaceIdentityFromVault(configuredVault ?? {
    label: labelFromWorkspacePath(vaultPath),
    path: vaultPath,
    available: true,
    mounted: true,
  }, { defaultWorkspacePath })
}

function resolveCreationVaultPath(
  vaultPath: string,
  defaultWorkspacePath?: string | null,
  vaults: readonly VaultOption[] = [],
): string {
  if (!defaultWorkspacePath) return vaultPath
  const defaultVault = vaults.find((vault) => vault.path === defaultWorkspacePath)
  if (!defaultVault) return defaultWorkspacePath
  return defaultVault.available === false || defaultVault.mounted === false ? vaultPath : defaultVault.path
}

export { slugify }

/** Convert a filename slug to a human-readable title (hyphens → spaces, title case). */
function slug_to_title(slug: string): string {
  return slug.split('-').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** Generate a unique "Untitled <type>" name by checking existing entries and pending names. */
export interface UntitledNameParams {
  entries: VaultEntry[]
  type: string
  pendingTitles?: Set<string>
}

export function generateUntitledName({ entries, type, pendingTitles }: UntitledNameParams): string {
  const baseName = `Untitled ${type.toLowerCase()}`
  const existingTitles = new Set(entries.map(e => e.title))
  if (pendingTitles) pendingTitles.forEach((title) => existingTitles.add(title))
  let title = baseName
  let counter = 2
  while (existingTitles.has(title)) {
    title = `${baseName} ${counter}`
    counter++
  }
  return title
}

export interface EntryMatchParams {
  entry: VaultEntry
  target: string
}

export function entryMatchesTarget({ entry, target }: EntryMatchParams): boolean {
  return resolveEntry([entry], target) === entry
}

/** Look up the template for a given type from the type entry. */
export interface TemplateLookupParams {
  entries: VaultEntry[]
  typeName: string
}

export function resolveTemplate({ entries, typeName }: TemplateLookupParams): string | null {
  const typeEntry = entries.find((entry) => entry.isA === 'Type' && entry.title === typeName)
  return typeEntry?.template ?? null
}

export interface NoteContentParams {
  title: string | null
  type: string
  status: string | null
  template?: string | null
  initialEmptyHeading?: boolean
  defaults?: TypeInstanceDefault[]
}

type DefaultValue = string | number | boolean | string[]

export interface TypeInstanceDefault {
  key: string
  value: DefaultValue
  kind: 'property' | 'relationship'
}

function buildNoteBody({ template, initialEmptyHeading }: Pick<NoteContentParams, 'template' | 'initialEmptyHeading'>): string {
  const templateStartsWithH1 = template?.trimStart().startsWith('# ') ?? false
  if (initialEmptyHeading && !templateStartsWithH1) {
    return template ? `\n# \n\n${template}` : '\n# \n\n'
  }
  return template ? `\n${template}` : ''
}

function isDefaultablePropertyValue(value: unknown): value is string | number | boolean {
  if (typeof value === 'string') return value.trim().length > 0
  return typeof value === 'number' || typeof value === 'boolean'
}

function relationshipDefaultValue(refs: string[]): DefaultValue | null {
  if (refs.length === 0) return null
  return refs.length === 1 ? refs[0] : refs
}

function resolveTypeEntry({ entries, typeName }: TemplateLookupParams): VaultEntry | undefined {
  return entries.find((entry) => entry.isA === 'Type' && entry.title === typeName)
}

function collectPropertyDefaults(typeEntry: VaultEntry): TypeInstanceDefault[] {
  return Object.entries(typeEntry.properties ?? {}).flatMap(([key, value]) => (
    isDefaultablePropertyValue(value) ? [{ key, value, kind: 'property' as const }] : []
  ))
}

function collectRelationshipDefaults(typeEntry: VaultEntry): TypeInstanceDefault[] {
  return Object.entries(typeEntry.relationships ?? {}).flatMap(([key, refs]) => {
    const value = relationshipDefaultValue(refs)
    return value ? [{ key, value, kind: 'relationship' as const }] : []
  })
}

function appendUniqueDefault(defaults: TypeInstanceDefault[], seenKeys: Set<string>, defaultValue: TypeInstanceDefault) {
  const canonicalKey = canonicalFrontmatterKey(defaultValue.key)
  if (canonicalKey === 'type' || canonicalKey === 'title' || seenKeys.has(canonicalKey)) return
  seenKeys.add(canonicalKey)
  defaults.push(defaultValue)
}

export function resolveTypeInstanceDefaults(params: TemplateLookupParams): TypeInstanceDefault[] {
  const typeEntry = resolveTypeEntry(params)
  if (!typeEntry) return []

  const defaults: TypeInstanceDefault[] = []
  const seenKeys = new Set<string>()
  const candidateDefaults = [
    ...collectPropertyDefaults(typeEntry),
    ...collectRelationshipDefaults(typeEntry),
  ]
  candidateDefaults.forEach((defaultValue) => appendUniqueDefault(defaults, seenKeys, defaultValue))
  return defaults
}

function hasOuterWhitespace(value: string): boolean {
  return value.trim() !== value
}

function isYamlWikilink(value: string): boolean {
  return value.startsWith('[[') && value.endsWith(']]')
}

function isAmbiguousYamlScalar(value: string): boolean {
  const lowerValue = value.toLowerCase()
  return lowerValue === 'true'
    || lowerValue === 'false'
    || lowerValue === 'null'
    || isDecimalYamlScalar({ value })
}

function isDecimalYamlScalar({ value }: { value: string }): boolean {
  const unsignedValue = value.startsWith('-') || value.startsWith('+') ? value.slice(1) : value
  const decimalParts = unsignedValue.split('.')
  return decimalParts.length <= 2 && decimalParts.every((part) => (
    part.length > 0 && Array.from(part).every((char) => char >= '0' && char <= '9')
  ))
}

function shouldQuoteYamlString(value: string): boolean {
  return [
    hasOuterWhitespace,
    isYamlWikilink,
    isAmbiguousYamlScalar,
    (candidate: string) => candidate.includes(':'),
  ].some((check) => check(value))
}

function formatYamlScalar(value: string | number | boolean): string {
  if (typeof value !== 'string') return String(value)
  if (shouldQuoteYamlString(value)) return JSON.stringify(value)
  return value
}

function appendDefaultFrontmatterLines(lines: string[], defaults: TypeInstanceDefault[]) {
  const existingKeys = new Set(lines.map((line) => canonicalFrontmatterKey(line.split(':', 1)[0])))

  for (const { key, value } of defaults) {
    const canonicalKey = canonicalFrontmatterKey(key)
    if (existingKeys.has(canonicalKey)) continue
    existingKeys.add(canonicalKey)
    if (Array.isArray(value)) {
      lines.push(`${key}:`)
      value.forEach((item) => lines.push(`  - ${formatYamlScalar(item)}`))
    } else {
      lines.push(`${key}: ${formatYamlScalar(value)}`)
    }
  }
}

export function buildNoteContent({ title, type, status, template, initialEmptyHeading = false, defaults = [] }: NoteContentParams): string {
  const lines = ['---']
  if (title) lines.push(`title: ${title}`)
  lines.push(`type: ${type}`)
  if (status) lines.push(`status: ${status}`)
  appendDefaultFrontmatterLines(lines, defaults)
  lines.push('---')
  const body = buildNoteBody({ template, initialEmptyHeading })
  return `${lines.join('\n')}\n${body}`
}

export interface NewNoteParams {
  title: string
  type: string
  vaultPath: string
  defaultWorkspacePath?: string | null
  vaults?: readonly VaultOption[]
  template?: string | null
  defaults?: TypeInstanceDefault[]
}

export function resolveNewNote({ title, type, vaultPath, defaultWorkspacePath, vaults = [], template, defaults = [] }: NewNoteParams): { entry: VaultEntry; content: string } {
  const creationVaultPath = resolveCreationVaultPath(vaultPath, defaultWorkspacePath, vaults)
  const slug = slugify(title)
  const status = null
  const entry = {
    ...buildNewEntry({ path: joinVaultPath(creationVaultPath, `${slug}.md`), slug, title, type, status }),
    workspace: workspaceForVaultPath(creationVaultPath, vaults, defaultWorkspacePath),
  }
  return applyTypeDefaults({
    entry,
    content: buildNoteContent({ title, type, status, template, defaults }),
    defaults,
  })
}

export interface NewTypeParams {
  typeName: string
  vaultPath: string
  defaultWorkspacePath?: string | null
  vaults?: readonly VaultOption[]
}

const TYPE_CREATION_ALIASES = new Map<string, string>([
  ['notes', 'Note'],
])

export function normalizeTypeCreationName(typeName: string): string {
  const trimmed = typeName.trim()
  return TYPE_CREATION_ALIASES.get(trimmed.toLowerCase()) ?? canonicalizeTypeName(trimmed) ?? trimmed
}

export function resolveNewType({ typeName, vaultPath, defaultWorkspacePath, vaults = [] }: NewTypeParams): { entry: VaultEntry; content: string } {
  const normalizedTypeName = normalizeTypeCreationName(typeName)
  const creationVaultPath = resolveCreationVaultPath(vaultPath, defaultWorkspacePath, vaults)
  const slug = slugify(normalizedTypeName)
  const entry = {
    ...buildNewEntry({ path: joinVaultPath(creationVaultPath, `${slug}.md`), slug, title: normalizedTypeName, type: 'Type', status: null }),
    workspace: workspaceForVaultPath(creationVaultPath, vaults, defaultWorkspacePath),
  }
  return { entry, content: `---\ntype: Type\n---\n\n# ${normalizedTypeName}\n` }
}

type ResolvedEntry = { entry: VaultEntry; content: string }

function relationshipRefs(value: DefaultValue): string[] {
  return Array.isArray(value) ? value : [String(value)]
}

function applyTypeDefaults({
  entry,
  content,
  defaults,
}: {
  entry: VaultEntry
  content: string
  defaults: TypeInstanceDefault[]
}): ResolvedEntry {
  if (defaults.length === 0) return { entry, content }

  const relationships = { ...entry.relationships }
  const properties = { ...entry.properties }
  for (const defaultValue of defaults) {
    if (defaultValue.kind === 'relationship') {
      relationships[defaultValue.key] = relationshipRefs(defaultValue.value)
      continue
    }
    properties[defaultValue.key] = defaultValue.value as string | number | boolean
  }

  return {
    entry: { ...entry, relationships, properties },
    content,
  }
}

interface BlockedCreationPlan {
  status: 'blocked'
  message: string
}

interface ReadyCreationPlan {
  status: 'create'
  resolved: ResolvedEntry
}

interface ExistingTypeCreationPlan {
  status: 'existing'
  entry: VaultEntry
}

export type NoteCreationPlan = BlockedCreationPlan | ReadyCreationPlan
export type TypeCreationPlan = BlockedCreationPlan | ExistingTypeCreationPlan | ReadyCreationPlan

function findPathCollision(entries: VaultEntry[], path: string): VaultEntry | undefined {
  return findByCollidingNotePath(entries, path)
}

function buildCreationCollisionMessage({ noun, title, path }: { noun: 'note' | 'type'; title: string; path: string }): string {
  const filename = notePathFilename(path)
  return `Cannot create ${noun} "${title}" because ${filename} already exists`
}

function findEquivalentTypeEntry(entries: VaultEntry[], typeName: string): VaultEntry | undefined {
  const trimmed = normalizeTypeCreationName(typeName)
  const targetSlug = slugify(trimmed)
  return entries.find((entry) =>
    entry.isA === 'Type' && (entry.title === trimmed || slugify(entry.title) === targetSlug)
  )
}

export function planNewNoteCreation({
  defaultWorkspacePath,
  entries,
  title,
  type,
  vaultPath,
  vaults,
  template,
  defaults,
}: NewNoteParams & { entries: VaultEntry[] }): NoteCreationPlan {
  const resolved = resolveNewNote({ title, type, vaultPath, defaultWorkspacePath, vaults, template, defaults })
  const collision = findPathCollision(entries, resolved.entry.path)
  if (collision) {
    return {
      status: 'blocked',
      message: buildCreationCollisionMessage({ noun: 'note', title, path: resolved.entry.path }),
    }
  }
  return { status: 'create', resolved }
}

export function planNewTypeCreation({
  defaultWorkspacePath,
  entries,
  typeName,
  vaultPath,
  vaults,
}: NewTypeParams & { entries: VaultEntry[] }): TypeCreationPlan {
  const existingType = findEquivalentTypeEntry(entries, typeName)
  if (existingType) return { status: 'existing', entry: existingType }

  const resolved = resolveNewType({ typeName, vaultPath, defaultWorkspacePath, vaults })
  const collision = findPathCollision(entries, resolved.entry.path)
  if (collision) {
    return {
      status: 'blocked',
      message: buildCreationCollisionMessage({ noun: 'type', title: typeName, path: resolved.entry.path }),
    }
  }

  return { status: 'create', resolved }
}

function isAlreadyExistsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /already exists|file exists|eexist/i.test(message)
}

function createPersistFailureMessage(entry: VaultEntry, error: unknown): string {
  if (isAlreadyExistsError(error)) {
    const noun = entry.isA === 'Type' ? 'type' : 'note'
    return buildCreationCollisionMessage({ noun, title: entry.title, path: entry.path })
  }
  return entry.isA === 'Type'
    ? 'Failed to create type — disk write error'
    : 'Failed to create note — disk write error'
}

interface PersistNewNoteRequest {
  path: string
  content: string
  vaultPath?: string
}

function createNoteContentArgs({ path, content, vaultPath }: PersistNewNoteRequest): Record<string, unknown> {
  return vaultPath ? { path, content, vaultPath } : { path, content }
}

/** Persist a newly created note to disk. Returns a Promise for error handling. */
export function persistNewNote(request: PersistNewNoteRequest): Promise<void> {
  const args = createNoteContentArgs(request)
  if (!isTauri()) return mockInvoke<void>('save_note_content', args).then(() => {})
  return invoke<void>('create_note_content', args).then(() => {})
}

async function typeTargetExistsOnDisk({ path, vaultPath }: Pick<PersistNewNoteRequest, 'path' | 'vaultPath'>): Promise<boolean> {
  if (!isTauri()) return false

  try {
    const args = vaultPath ? { path, vaultPath } : { path }
    await invoke<string>('get_note_content', args)
    return true
  } catch {
    return false
  }
}

async function findTypeTargetCollision(resolved: ResolvedEntry): Promise<string | null> {
  if (!await typeTargetExistsOnDisk({
    path: resolved.entry.path,
    vaultPath: resolved.entry.workspace?.path,
  })) return null
  return buildCreationCollisionMessage({
    noun: 'type',
    title: resolved.entry.title,
    path: resolved.entry.path,
  })
}

// Rapid Cmd+N bursts can outpace the note-list render path on desktop. Keep
// the first create immediate, then serialize the rest so each new note settles
// before the next one is opened.
export const RAPID_CREATE_NOTE_SETTLE_MS = 200

function addEntryWithMock(entry: VaultEntry, content: string, addEntry: (e: VaultEntry) => void) {
  if (!isTauri()) addMockEntry(entry, content)
  addEntry(entry)
}

/** Dispatch focus-editor event with perf timing marker. */
function signalFocusEditor(opts?: { selectTitle?: boolean; path?: string }): void {
  window.dispatchEvent(new CustomEvent('laputa:focus-editor', {
    detail: { t0: performance.now(), selectTitle: opts?.selectTitle ?? false, path: opts?.path ?? null },
  }))
}

interface PersistCallbacks {
  onStart?: (p: string) => void
  onEnd?: (p: string) => void
  onPersisted?: (path: string) => void
}

/** Persist to disk; track pending state via onStart/onEnd. */
async function persistOptimistic(request: PersistNewNoteRequest, cbs: PersistCallbacks): Promise<void> {
  cbs.onStart?.(request.path)
  try {
    await persistNewNote(request)
    cbs.onPersisted?.(request.path)
  } finally {
    cbs.onEnd?.(request.path)
  }
}

interface PersistResolvedOptions {
  openTab?: boolean
}

type PersistResolvedEntryFn = (
  resolved: ResolvedEntry,
  options?: PersistResolvedOptions,
) => Promise<void>

interface CreationDeps {
  defaultWorkspacePath?: string | null
  entries: VaultEntry[]
  vaultPath: string
  vaults?: readonly VaultOption[]
  setToastMessage: (msg: string | null) => void
  persistResolvedEntry: PersistResolvedEntryFn
}

interface NoteCreationRequest extends CreationDeps {
  title: string
  type: string
  creationPath?: 'plus_button' | 'quick_open'
}

async function createNamedNote({
  entries,
  defaultWorkspacePath,
  title,
  type,
  vaultPath,
  vaults,
  setToastMessage,
  persistResolvedEntry,
  creationPath,
}: NoteCreationRequest): Promise<boolean> {
  const template = resolveTemplate({ entries, typeName: type })
  const defaults = resolveTypeInstanceDefaults({ entries, typeName: type })
  const plan = planNewNoteCreation({ entries, title, type, vaultPath, defaultWorkspacePath, vaults, template, defaults })
  if (plan.status === 'blocked') {
    setToastMessage(plan.message)
    return false
  }

  try {
    await persistResolvedEntry(plan.resolved)
    if (creationPath) {
      trackEvent('note_created', { has_type: type !== 'Note' ? 1 : 0, creation_path: creationPath })
    }
    return true
  } catch (error) {
    setToastMessage(createPersistFailureMessage(plan.resolved.entry, error))
    return false
  }
}

interface TypeCreationRequest extends CreationDeps {
  typeName: string
}

async function createTypeFromName({
  entries,
  defaultWorkspacePath,
  typeName,
  vaultPath,
  vaults,
  setToastMessage,
  persistResolvedEntry,
}: TypeCreationRequest): Promise<boolean> {
  const plan = planNewTypeCreation({ entries, typeName, vaultPath, defaultWorkspacePath, vaults })
  if (plan.status === 'existing') {
    setToastMessage(`Type "${plan.entry.title}" already exists`)
    return false
  }
  if (plan.status === 'blocked') {
    setToastMessage(plan.message)
    return false
  }

  const collisionMessage = await findTypeTargetCollision(plan.resolved)
  if (collisionMessage) {
    setToastMessage(collisionMessage)
    return false
  }

  try {
    await persistResolvedEntry(plan.resolved)
    trackEvent('type_created')
    return true
  } catch (error) {
    setToastMessage(createPersistFailureMessage(plan.resolved.entry, error))
    return false
  }
}

async function createTypeSilently({
  entries,
  defaultWorkspacePath,
  typeName,
  vaultPath,
  vaults,
  setToastMessage,
  persistResolvedEntry,
}: TypeCreationRequest): Promise<VaultEntry> {
  const plan = planNewTypeCreation({ entries, typeName, vaultPath, defaultWorkspacePath, vaults })
  if (plan.status === 'existing') return plan.entry
  if (plan.status === 'blocked') {
    setToastMessage(plan.message)
    throw new Error(plan.message)
  }

  const collisionMessage = await findTypeTargetCollision(plan.resolved)
  if (collisionMessage) {
    setToastMessage(collisionMessage)
    throw new Error(collisionMessage)
  }

  try {
    await persistResolvedEntry(plan.resolved, { openTab: false })
    return plan.resolved.entry
  } catch (error) {
    const message = createPersistFailureMessage(plan.resolved.entry, error)
    setToastMessage(message)
    throw new Error(message)
  }
}

interface ImmediateCreateDeps {
  addPendingSave?: (path: string) => void
  defaultWorkspacePath?: string | null
  entries: VaultEntry[]
  vaultPath: string
  vaults?: readonly VaultOption[]
  pendingSlugs: Set<string>
  openTabWithContent: (entry: VaultEntry, content: string) => void
  addEntry: (entry: VaultEntry) => void
  onNewNotePersisted?: (path: string) => void
  removePendingSave?: (path: string) => void
  setToastMessage: (msg: string | null) => void
}

interface ImmediateCreateRequest {
  type?: string
}

interface ImmediateCreateQueueConfig {
  addPendingSave?: (path: string) => void
  defaultWorkspacePath?: string | null
  entries: VaultEntry[]
  vaultPath: string
  vaults?: readonly VaultOption[]
  addEntry: (entry: VaultEntry) => void
  openTabWithContent: (entry: VaultEntry, content: string) => void
  onNewNotePersisted?: (path: string) => void
  removePendingSave?: (path: string) => void
  setToastMessage: (msg: string | null) => void
}

/** Generate a unique untitled filename using a timestamp. */
function generateUntitledFilename(entries: VaultEntry[], type: string, pendingSlugs?: Set<string>): string {
  const ts = Math.floor(Date.now() / 1000)
  const typeSlug = type === 'Note' ? 'note' : slugify(type)
  const base = `untitled-${typeSlug}-${ts}`
  const existingSlugs = new Set(entries.map((entry) => entry.filename.replace(/\.md$/, '')))

  let candidate = base
  let suffix = 2
  while (existingSlugs.has(candidate) || pendingSlugs?.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }

  pendingSlugs?.add(candidate)
  return candidate
}

async function persistImmediateEntry(
  deps: ImmediateCreateDeps,
  entry: VaultEntry,
  content: string,
): Promise<boolean> {
  try {
    await persistOptimistic({
      path: entry.path,
      content,
      vaultPath: entry.workspace?.path,
    }, {
      onStart: deps.addPendingSave,
      onEnd: deps.removePendingSave,
      onPersisted: deps.onNewNotePersisted,
    })
    return true
  } catch (error) {
    deps.setToastMessage(createPersistFailureMessage(entry, error))
    return false
  }
}

/** Create an untitled note and write its backing file before opening it. */
async function createNoteImmediate(deps: ImmediateCreateDeps, type?: string): Promise<boolean> {
  const noteType = type || 'Note'
  const slug = generateUntitledFilename(deps.entries, noteType, deps.pendingSlugs)
  const title = slug_to_title(slug)
  const template = resolveTemplate({ entries: deps.entries, typeName: noteType })
  const defaults = resolveTypeInstanceDefaults({ entries: deps.entries, typeName: noteType })
  const status = null
  const creationVaultPath = resolveCreationVaultPath(deps.vaultPath, deps.defaultWorkspacePath, deps.vaults)
  const entry = {
    ...buildNewEntry({ path: joinVaultPath(creationVaultPath, `${slug}.md`), slug, title, type: noteType, status }),
    workspace: workspaceForVaultPath(creationVaultPath, deps.vaults, deps.defaultWorkspacePath),
  }
  const resolved = applyTypeDefaults({
    entry,
    content: buildNoteContent({ title: null, type: noteType, status, template, initialEmptyHeading: true, defaults }),
    defaults,
  })
  const didPersist = await persistImmediateEntry(deps, resolved.entry, resolved.content)
  if (!didPersist) return false

  cacheNoteContent(resolved.entry.path, resolved.content, resolved.entry)
  deps.openTabWithContent(resolved.entry, resolved.content)
  addEntryWithMock(resolved.entry, resolved.content, deps.addEntry)
  signalFocusEditor({ path: resolved.entry.path, selectTitle: true })
  return true
}

function trackImmediateCreate(request: ImmediateCreateRequest, didCreate: boolean): void {
  if (!didCreate) return
  trackEvent('note_created', {
    has_type: request.type ? 1 : 0,
    creation_path: request.type ? 'type_section' : 'cmd_n',
  })
}

function useLatestImmediateCreateDeps(
  config: ImmediateCreateQueueConfig,
  pendingSlugsRef: MutableRefObject<Set<string>>,
) {
  const {
    defaultWorkspacePath,
    entries,
    vaultPath,
    vaults,
    openTabWithContent,
    addEntry,
    addPendingSave,
    onNewNotePersisted,
    removePendingSave,
    setToastMessage,
  } = config
  const latestDepsRef = useRef<ImmediateCreateDeps | null>(null)
  const syncDeps = useCallback(() => {
    latestDepsRef.current = {
      entries,
      defaultWorkspacePath,
      vaultPath,
      vaults,
      pendingSlugs: pendingSlugsRef.current,
      openTabWithContent,
      addEntry,
      addPendingSave,
      onNewNotePersisted,
      removePendingSave,
      setToastMessage,
    }
  }, [
    entries,
    defaultWorkspacePath,
    vaultPath,
    vaults,
    openTabWithContent,
    addEntry,
    addPendingSave,
    onNewNotePersisted,
    removePendingSave,
    setToastMessage,
    pendingSlugsRef,
  ])

  useEffect(() => {
    syncDeps()
  }, [syncDeps])

  return { latestDepsRef, syncDeps }
}

function useImmediateCreateQueue(config: ImmediateCreateQueueConfig): (type?: string) => void {
  const pendingSlugsRef = useRef<Set<string>>(new Set())
  const queuedImmediateCreatesRef = useRef<ImmediateCreateRequest[]>([])
  const immediateCreateLockedRef = useRef(false)
  const immediateCreateTimerRef = useRef<number | null>(null)
  const queueMountedRef = useRef(true)
  const { latestDepsRef, syncDeps } = useLatestImmediateCreateDeps(config, pendingSlugsRef)

  const executeRequest = useCallback(async (request: ImmediateCreateRequest): Promise<void> => {
    const deps = latestDepsRef.current
    if (!deps) return

    try {
      const didCreate = await createNoteImmediate(deps, request.type)
      trackImmediateCreate(request, didCreate)
    } catch (error) {
      console.warn('Failed to create immediate note:', error)
    }
  }, [latestDepsRef])

  const scheduleQueuedBurst = useCallback(function scheduleQueuedBurst() {
    if (!queueMountedRef.current) return
    if (immediateCreateTimerRef.current !== null) return

    immediateCreateTimerRef.current = window.setTimeout(async () => {
      immediateCreateTimerRef.current = null
      const next = queuedImmediateCreatesRef.current.shift()
      if (!next) {
        immediateCreateLockedRef.current = false
        return
      }

      await executeRequest(next)
      scheduleQueuedBurst()
    }, RAPID_CREATE_NOTE_SETTLE_MS)
  }, [executeRequest])

  useEffect(() => {
    queueMountedRef.current = true
    return () => {
      queueMountedRef.current = false
      if (immediateCreateTimerRef.current !== null) {
        window.clearTimeout(immediateCreateTimerRef.current)
      }
    }
  }, [])

  return useCallback((type?: string) => {
    syncDeps()
    const request = { type }
    if (immediateCreateLockedRef.current) {
      queuedImmediateCreatesRef.current.push(request)
      return
    }

    immediateCreateLockedRef.current = true
    void executeRequest(request).then(scheduleQueuedBurst)
  }, [syncDeps, executeRequest, scheduleQueuedBurst])
}

export interface NoteCreationConfig {
  addEntry: (entry: VaultEntry) => void
  removeEntry: (path: string) => void
  entries: VaultEntry[]
  setToastMessage: (msg: string | null) => void
  vaultPath: string
  defaultWorkspacePath?: string | null
  vaults?: readonly VaultOption[]
  addPendingSave?: (path: string) => void
  removePendingSave?: (path: string) => void
  trackUnsaved?: (path: string) => void
  clearUnsaved?: (path: string) => void
  unsavedPaths?: Set<string>
  markContentPending?: (path: string, content: string) => void
  onNewNotePersisted?: (path: string) => void
  onTypeStateChanged?: () => void | Promise<void>
}

interface CreationTabDeps {
  openTabWithContent: (entry: VaultEntry, content: string) => void
}

export function useNoteCreation(config: NoteCreationConfig, tabDeps: CreationTabDeps) {
  const {
    addEntry,
    removeEntry,
    defaultWorkspacePath,
    entries,
    setToastMessage,
    addPendingSave,
    removePendingSave,
    vaultPath,
    vaults,
    onNewNotePersisted,
    onTypeStateChanged,
  } = config
  const { openTabWithContent } = tabDeps

  const persistResolvedEntry = useCallback(async (
    resolved: ResolvedEntry,
    options?: PersistResolvedOptions,
  ): Promise<void> => {
    if (options?.openTab !== false) openTabWithContent(resolved.entry, resolved.content)
    addEntryWithMock(resolved.entry, resolved.content, addEntry)
    try {
      await persistOptimistic(
        { path: resolved.entry.path, content: resolved.content, vaultPath: resolved.entry.workspace?.path },
        { onStart: addPendingSave, onEnd: removePendingSave, onPersisted: onNewNotePersisted },
      )
      if (resolved.entry.isA === 'Type') {
        await onTypeStateChanged?.()
      }
    } catch (error) {
      removeEntry(resolved.entry.path)
      throw error
    }
  }, [openTabWithContent, addEntry, addPendingSave, removePendingSave, onNewNotePersisted, onTypeStateChanged, removeEntry])

  const handleCreateNote = useCallback((title: string, type: string, creationPath: 'plus_button' | 'quick_open' = 'plus_button'): Promise<boolean> =>
    createNamedNote({ entries, vaultPath, defaultWorkspacePath, vaults, setToastMessage, persistResolvedEntry, title, type, creationPath }),
  [entries, vaultPath, defaultWorkspacePath, vaults, setToastMessage, persistResolvedEntry])

  const handleCreateType = useCallback((typeName: string): Promise<boolean> =>
    createTypeFromName({ entries, vaultPath, defaultWorkspacePath, vaults, setToastMessage, persistResolvedEntry, typeName }),
  [entries, vaultPath, defaultWorkspacePath, vaults, setToastMessage, persistResolvedEntry])

  const createTypeEntrySilent = useCallback((typeName: string): Promise<VaultEntry> =>
    createTypeSilently({ entries, vaultPath, defaultWorkspacePath, vaults, setToastMessage, persistResolvedEntry, typeName }),
  [entries, vaultPath, defaultWorkspacePath, vaults, setToastMessage, persistResolvedEntry])

  const handleCreateNoteForRelationship = useCallback((title: string): Promise<boolean> =>
    createNamedNote({ entries, vaultPath, defaultWorkspacePath, vaults, setToastMessage, persistResolvedEntry, title, type: 'Note' }),
  [entries, vaultPath, defaultWorkspacePath, vaults, setToastMessage, persistResolvedEntry])

  const handleCreateNoteImmediate = useImmediateCreateQueue({
    entries,
    vaultPath,
    defaultWorkspacePath,
    vaults,
    addEntry,
    addPendingSave,
    openTabWithContent,
    onNewNotePersisted,
    removePendingSave,
    setToastMessage,
  })

  return {
    handleCreateNote,
    handleCreateNoteImmediate,
    handleCreateNoteForRelationship,
    handleCreateType,
    createTypeEntrySilent,
  }
}
