import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, addMockEntry, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import { slugifyNoteStem as slugify } from '../utils/noteSlug'
import { resolveEntry } from '../utils/wikilink'
import { trackEvent } from '../lib/telemetry'
import { cacheNoteContent } from './useTabManagement'

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

/** Default templates for built-in types. Used when the type entry has no custom template. */
export const DEFAULT_TEMPLATES: Record<string, string> = {
  Project: '## Objective\n\n\n\n## Key Results\n\n\n\n## Notes\n\n',
  Person: '## Role\n\n\n\n## Contact\n\n\n\n## Notes\n\n',
  Responsibility: '## Description\n\n\n\n## Key Activities\n\n\n\n## Notes\n\n',
  Experiment: '## Hypothesis\n\n\n\n## Method\n\n\n\n## Results\n\n\n\n## Conclusion\n\n',
}

/** Look up the template for a given type from the type entry or defaults. */
export interface TemplateLookupParams {
  entries: VaultEntry[]
  typeName: string
}

export function resolveTemplate({ entries, typeName }: TemplateLookupParams): string | null {
  const typeEntry = entries.find((entry) => entry.isA === 'Type' && entry.title === typeName)
  return typeEntry?.template ?? DEFAULT_TEMPLATES[typeName] ?? null
}

export interface NoteContentParams {
  title: string | null
  type: string
  status: string | null
  template?: string | null
  initialEmptyHeading?: boolean
}

function buildNoteBody({ template, initialEmptyHeading }: Pick<NoteContentParams, 'template' | 'initialEmptyHeading'>): string {
  if (initialEmptyHeading) {
    return template ? `\n# \n\n${template}` : '\n# \n\n'
  }
  return template ? `\n${template}` : ''
}

export function buildNoteContent({ title, type, status, template, initialEmptyHeading = false }: NoteContentParams): string {
  const lines = ['---']
  if (title) lines.push(`title: ${title}`)
  lines.push(`type: ${type}`)
  if (status) lines.push(`status: ${status}`)
  lines.push('---')
  const body = buildNoteBody({ template, initialEmptyHeading })
  return `${lines.join('\n')}\n${body}`
}

export interface NewNoteParams {
  title: string
  type: string
  vaultPath: string
  template?: string | null
}

export function resolveNewNote({ title, type, vaultPath, template }: NewNoteParams): { entry: VaultEntry; content: string } {
  const slug = slugify(title)
  const status = null
  const entry = buildNewEntry({ path: `${vaultPath}/${slug}.md`, slug, title, type, status })
  return { entry, content: buildNoteContent({ title, type, status, template }) }
}

export interface NewTypeParams {
  typeName: string
  vaultPath: string
}

export function resolveNewType({ typeName, vaultPath }: NewTypeParams): { entry: VaultEntry; content: string } {
  const slug = slugify(typeName)
  const entry = buildNewEntry({ path: `${vaultPath}/${slug}.md`, slug, title: typeName, type: 'Type', status: null })
  return { entry, content: `---\ntype: Type\n---\n\n# ${typeName}\n` }
}

type ResolvedEntry = { entry: VaultEntry; content: string }

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

function normalizeComparablePath(path: string): string {
  return path.replace(/\\/g, '/').toLocaleLowerCase()
}

function findPathCollision(entries: VaultEntry[], path: string): VaultEntry | undefined {
  const target = normalizeComparablePath(path)
  return entries.find((entry) => normalizeComparablePath(entry.path) === target)
}

function buildCreationCollisionMessage({ noun, title, path }: { noun: 'note' | 'type'; title: string; path: string }): string {
  const filename = path.split('/').pop() ?? path
  return `Cannot create ${noun} "${title}" because ${filename} already exists`
}

function findEquivalentTypeEntry(entries: VaultEntry[], typeName: string): VaultEntry | undefined {
  const trimmed = typeName.trim()
  const targetSlug = slugify(trimmed)
  return entries.find((entry) =>
    entry.isA === 'Type' && (entry.title === trimmed || slugify(entry.title) === targetSlug)
  )
}

export function planNewNoteCreation({
  entries,
  title,
  type,
  vaultPath,
  template,
}: NewNoteParams & { entries: VaultEntry[] }): NoteCreationPlan {
  const resolved = resolveNewNote({ title, type, vaultPath, template })
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
  entries,
  typeName,
  vaultPath,
}: NewTypeParams & { entries: VaultEntry[] }): TypeCreationPlan {
  const existingType = findEquivalentTypeEntry(entries, typeName)
  if (existingType) return { status: 'existing', entry: existingType }

  const resolved = resolveNewType({ typeName, vaultPath })
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

/** Persist a newly created note to disk. Returns a Promise for error handling. */
export function persistNewNote(path: string, content: string): Promise<void> {
  if (!isTauri()) return mockInvoke<void>('save_note_content', { path, content }).then(() => {})
  return invoke<void>('create_note_content', { path, content }).then(() => {})
}

async function typeTargetExistsOnDisk(path: string): Promise<boolean> {
  if (!isTauri()) return false

  try {
    await invoke<string>('get_note_content', { path })
    return true
  } catch {
    return false
  }
}

async function findTypeTargetCollision(resolved: ResolvedEntry): Promise<string | null> {
  if (!await typeTargetExistsOnDisk(resolved.entry.path)) return null
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
async function persistOptimistic(path: string, content: string, cbs: PersistCallbacks): Promise<void> {
  cbs.onStart?.(path)
  try {
    await persistNewNote(path, content)
    cbs.onPersisted?.(path)
  } finally {
    cbs.onEnd?.(path)
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
  entries: VaultEntry[]
  vaultPath: string
  setToastMessage: (msg: string | null) => void
  persistResolvedEntry: PersistResolvedEntryFn
}

interface NoteCreationRequest extends CreationDeps {
  title: string
  type: string
  creationPath?: 'plus_button'
}

async function createNamedNote({
  entries,
  title,
  type,
  vaultPath,
  setToastMessage,
  persistResolvedEntry,
  creationPath,
}: NoteCreationRequest): Promise<boolean> {
  const template = resolveTemplate({ entries, typeName: type })
  const plan = planNewNoteCreation({ entries, title, type, vaultPath, template })
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
  typeName,
  vaultPath,
  setToastMessage,
  persistResolvedEntry,
}: TypeCreationRequest): Promise<boolean> {
  const plan = planNewTypeCreation({ entries, typeName, vaultPath })
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
  typeName,
  vaultPath,
  setToastMessage,
  persistResolvedEntry,
}: TypeCreationRequest): Promise<VaultEntry> {
  const plan = planNewTypeCreation({ entries, typeName, vaultPath })
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
  entries: VaultEntry[]
  vaultPath: string
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
  entries: VaultEntry[]
  vaultPath: string
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
    await persistOptimistic(entry.path, content, {
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
  const status = null
  const entry = buildNewEntry({ path: `${deps.vaultPath}/${slug}.md`, slug, title, type: noteType, status })
  const content = buildNoteContent({ title: null, type: noteType, status, template, initialEmptyHeading: true })
  const didPersist = await persistImmediateEntry(deps, entry, content)
  if (!didPersist) return false

  cacheNoteContent(entry.path, content)
  deps.openTabWithContent(entry, content)
  addEntryWithMock(entry, content, deps.addEntry)
  signalFocusEditor({ path: entry.path, selectTitle: true })
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
    entries,
    vaultPath,
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
      vaultPath,
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
    vaultPath,
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
  const { latestDepsRef, syncDeps } = useLatestImmediateCreateDeps(config, pendingSlugsRef)

  const executeRequest = useCallback((request: ImmediateCreateRequest) => {
    const deps = latestDepsRef.current
    if (!deps) return
    void createNoteImmediate(deps, request.type).then((didCreate) => trackImmediateCreate(request, didCreate))
  }, [latestDepsRef])

  const scheduleQueuedBurst = useCallback(function scheduleQueuedBurst() {
    if (immediateCreateTimerRef.current !== null) return

    immediateCreateTimerRef.current = window.setTimeout(() => {
      immediateCreateTimerRef.current = null
      const next = queuedImmediateCreatesRef.current.shift()
      if (!next) {
        immediateCreateLockedRef.current = false
        return
      }

      executeRequest(next)
      scheduleQueuedBurst()
    }, RAPID_CREATE_NOTE_SETTLE_MS)
  }, [executeRequest])

  useEffect(() => () => {
    if (immediateCreateTimerRef.current !== null) {
      window.clearTimeout(immediateCreateTimerRef.current)
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
    executeRequest(request)
    scheduleQueuedBurst()
  }, [syncDeps, executeRequest, scheduleQueuedBurst])
}

export interface NoteCreationConfig {
  addEntry: (entry: VaultEntry) => void
  removeEntry: (path: string) => void
  entries: VaultEntry[]
  setToastMessage: (msg: string | null) => void
  vaultPath: string
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
    entries,
    setToastMessage,
    addPendingSave,
    removePendingSave,
    vaultPath,
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
      await persistOptimistic(resolved.entry.path, resolved.content, {
        onStart: addPendingSave,
        onEnd: removePendingSave,
        onPersisted: onNewNotePersisted,
      })
      if (resolved.entry.isA === 'Type') {
        await onTypeStateChanged?.()
      }
    } catch (error) {
      removeEntry(resolved.entry.path)
      throw error
    }
  }, [openTabWithContent, addEntry, addPendingSave, removePendingSave, onNewNotePersisted, onTypeStateChanged, removeEntry])

  const handleCreateNote = useCallback((title: string, type: string): Promise<boolean> =>
    createNamedNote({ entries, vaultPath, setToastMessage, persistResolvedEntry, title, type, creationPath: 'plus_button' }),
  [entries, vaultPath, setToastMessage, persistResolvedEntry])

  const handleCreateType = useCallback((typeName: string): Promise<boolean> =>
    createTypeFromName({ entries, vaultPath, setToastMessage, persistResolvedEntry, typeName }),
  [entries, vaultPath, setToastMessage, persistResolvedEntry])

  const createTypeEntrySilent = useCallback((typeName: string): Promise<VaultEntry> =>
    createTypeSilently({ entries, vaultPath, setToastMessage, persistResolvedEntry, typeName }),
  [entries, vaultPath, setToastMessage, persistResolvedEntry])

  const handleCreateNoteForRelationship = useCallback((title: string): Promise<boolean> =>
    createNamedNote({ entries, vaultPath, setToastMessage, persistResolvedEntry, title, type: 'Note' }),
  [entries, vaultPath, setToastMessage, persistResolvedEntry])

  const handleCreateNoteImmediate = useImmediateCreateQueue({
    entries,
    vaultPath,
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
