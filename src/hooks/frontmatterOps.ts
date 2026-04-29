import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import type { FrontmatterValue } from '../components/Inspector'
import { updateMockFrontmatter, deleteMockFrontmatterProperty } from './mockFrontmatterHelpers'
import { updateMockContent, trackMockChange } from '../mock-tauri'
import { parseFrontmatter } from '../utils/frontmatter'
import { canonicalSystemMetadataKey, isSystemMetadataKey } from '../utils/systemMetadata'
import { normalizeNoteWidthMode } from '../utils/noteWidth'

type FrontmatterCommand = 'update_frontmatter' | 'delete_frontmatter_property'
type FrontmatterKey = string
type FrontmatterOp = 'update' | 'delete'
type MarkdownContent = string
type ToastMessage = string | null
type VaultPath = string
type WikilinkText = string
type ScalarPropertyValue = string | number | boolean | null

const ENTRY_DELETE_MAP: Record<string, Partial<VaultEntry>> = {
  title: { title: '' },
  type: { isA: null }, is_a: { isA: null }, status: { status: null }, color: { color: null },
  _icon: { icon: null }, _sidebar_label: { sidebarLabel: null },
  aliases: { aliases: [] }, belongs_to: { belongsTo: [] }, related_to: { relatedTo: [] },
  _archived: { archived: false }, archived: { archived: false },
  _order: { order: null },
  template: { template: null }, _sort: { sort: null }, view: { view: null },
  _width: { noteWidth: null }, visible: { visible: null },
  _organized: { organized: false },
  _favorite: { favorite: false }, _favorite_index: { favoriteIndex: null },
  _list_properties_display: { listPropertiesDisplay: [] },
}

/** Check if a string contains a wikilink pattern `[[...]]`. */
function isWikilink(value: WikilinkText): boolean {
  return value.startsWith('[[') && value.includes(']]')
}

/** Extract wikilink strings from a FrontmatterValue. Returns empty array if none. */
function extractWikilinks(value: FrontmatterValue): WikilinkText[] {
  if (typeof value === 'string') return isWikilink(value) ? [value] : []
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && isWikilink(v))
  return []
}

/**
 * Relationship patch: a partial update to merge into `entry.relationships`.
 * Keys map to their new ref arrays. A `null` value means "remove this key".
 */
export type RelationshipPatch = Record<FrontmatterKey, WikilinkText[] | null>

/** Properties patch: a partial update to merge into `entry.properties`.
 *  Keys map to their new scalar values. A `null` value means "remove this key". */
export type PropertiesPatch = Record<FrontmatterKey, ScalarPropertyValue>

export interface EntryPatchResult {
  patch: Partial<VaultEntry>
  relationshipPatch: RelationshipPatch | null
  propertiesPatch: PropertiesPatch | null
}

interface FrontmatterPatchInput {
  key: FrontmatterKey
  lookupKey: FrontmatterKey
  systemMetadataKey: boolean
  value?: FrontmatterValue
}

function applyRecordPatch<T>(
  existing: Record<string, T>,
  patch: Record<string, T | null>,
): Record<string, T> {
  const merged = { ...existing }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key]
    else merged[key] = value
  }
  return merged
}

function frontmatterString(value: FrontmatterValue | undefined): string | null {
  return value != null ? String(value) : null
}

function frontmatterStringList(value: FrontmatterValue | undefined): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function frontmatterNumber(value: FrontmatterValue | undefined): number | null {
  return typeof value === 'number' ? value : null
}

function visibleValue(value: FrontmatterValue | undefined): false | null {
  return value === false ? false : null
}

function scalarPropertyValue(value: FrontmatterValue): ScalarPropertyValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}

function knownFrontmatterUpdates(value: FrontmatterValue | undefined): Record<FrontmatterKey, Partial<VaultEntry>> {
  const str = frontmatterString(value)
  const arr = frontmatterStringList(value)
  return {
    title: { title: str ?? '' },
    type: { isA: str }, is_a: { isA: str }, status: { status: str }, color: { color: str },
    _icon: { icon: str }, _sidebar_label: { sidebarLabel: str },
    aliases: { aliases: arr }, belongs_to: { belongsTo: arr }, related_to: { relatedTo: arr },
    _archived: { archived: Boolean(value) }, archived: { archived: Boolean(value) },
    _order: { order: frontmatterNumber(value) },
    template: { template: str },
    _sort: { sort: str },
    view: { view: str },
    _width: { noteWidth: normalizeNoteWidthMode(value) },
    visible: { visible: visibleValue(value) },
    _organized: { organized: Boolean(value) },
    _favorite: { favorite: Boolean(value) },
    _favorite_index: { favoriteIndex: frontmatterNumber(value) },
    _list_properties_display: { listPropertiesDisplay: arr },
  }
}

function deleteEntryPatch({ key, lookupKey, systemMetadataKey }: FrontmatterPatchInput): EntryPatchResult {
  const relationshipPatch = systemMetadataKey ? null : { [key]: null }
  const propertiesPatch = !systemMetadataKey && !(lookupKey in ENTRY_DELETE_MAP) ? { [key]: null } : null
  return { patch: ENTRY_DELETE_MAP[lookupKey] ?? {}, relationshipPatch, propertiesPatch }
}

function relationshipUpdatePatch(
  key: FrontmatterKey,
  systemMetadataKey: boolean,
  value: FrontmatterValue | undefined,
): RelationshipPatch | null {
  const wikilinks = value != null ? extractWikilinks(value) : []
  return !systemMetadataKey && wikilinks.length > 0 ? { [key]: wikilinks } : null
}

function propertiesUpdatePatch({
  key,
  lookupKey,
  systemMetadataKey,
  value,
}: FrontmatterPatchInput): PropertiesPatch | null {
  const knownUpdates = knownFrontmatterUpdates(value)
  if (systemMetadataKey || lookupKey in knownUpdates || value == null) return null
  return { [key]: scalarPropertyValue(value) }
}

function updateEntryPatch(input: FrontmatterPatchInput): EntryPatchResult {
  const updates = knownFrontmatterUpdates(input.value)
  return {
    patch: updates[input.lookupKey] ?? {},
    relationshipPatch: relationshipUpdatePatch(input.key, input.systemMetadataKey, input.value),
    propertiesPatch: propertiesUpdatePatch(input),
  }
}

/** Map a frontmatter key+value to the corresponding VaultEntry field(s). */
export function frontmatterToEntryPatch(
  op: FrontmatterOp, key: FrontmatterKey, value?: FrontmatterValue,
): EntryPatchResult {
  const lookupKey = canonicalSystemMetadataKey(key)
  const systemMetadataKey = isSystemMetadataKey(key)
  const input = { key, lookupKey, systemMetadataKey, value }
  return op === 'delete' ? deleteEntryPatch(input) : updateEntryPatch(input)
}

/** Parse frontmatter from full content and return a merged VaultEntry patch for all known fields. */
export function contentToEntryPatch(content: MarkdownContent): Partial<VaultEntry> {
  const fm = parseFrontmatter(content)
  const merged: Partial<VaultEntry> = {}
  const customProps: Record<FrontmatterKey, ScalarPropertyValue> = {}
  for (const [key, value] of Object.entries(fm)) {
    const { patch, propertiesPatch } = frontmatterToEntryPatch('update', key, value)
    Object.assign(merged, patch)
    if (propertiesPatch) Object.assign(customProps, propertiesPatch)
  }
  if (Object.keys(customProps).length > 0) merged.properties = customProps
  return merged
}

async function invokeFrontmatter(command: FrontmatterCommand, args: Record<string, unknown>): Promise<MarkdownContent> {
  return invoke<string>(command, args)
}

function seedMockContent(path: VaultPath, content: MarkdownContent): void {
  updateMockContent(path, content)
}

async function loadMockContent(path: VaultPath): Promise<MarkdownContent> {
  try {
    return await mockInvoke<MarkdownContent>('get_note_content', { path })
  } catch {
    return typeof window === 'undefined' ? '' : window.__mockContent?.[path] ?? ''
  }
}

async function persistMockContent(path: VaultPath, content: MarkdownContent): Promise<void> {
  try {
    await mockInvoke('save_note_content', { path, content })
  } finally {
    updateMockContent(path, content)
    trackMockChange(path)
  }
}

function applyMockFrontmatterUpdate(path: VaultPath, key: FrontmatterKey, value: FrontmatterValue): MarkdownContent {
  const content = updateMockFrontmatter(path, key, value)
  return content
}

function applyMockFrontmatterDelete(path: VaultPath, key: FrontmatterKey): MarkdownContent {
  const content = deleteMockFrontmatterProperty(path, key)
  return content
}

async function executeMockFrontmatterOp(
  op: FrontmatterOp,
  path: VaultPath,
  key: FrontmatterKey,
  value?: FrontmatterValue,
): Promise<MarkdownContent> {
  seedMockContent(path, await loadMockContent(path))
  const content = op === 'update'
    ? applyMockFrontmatterUpdate(path, key, value!)
    : applyMockFrontmatterDelete(path, key)
  await persistMockContent(path, content)
  return content
}

async function executeFrontmatterOp(
  op: FrontmatterOp,
  path: VaultPath,
  key: FrontmatterKey,
  value?: FrontmatterValue,
): Promise<MarkdownContent> {
  if (op === 'update') {
    return isTauri()
      ? invokeFrontmatter('update_frontmatter', { path, key, value })
      : executeMockFrontmatterOp(op, path, key, value)
  }
  return isTauri()
    ? invokeFrontmatter('delete_frontmatter_property', { path, key })
    : executeMockFrontmatterOp(op, path, key)
}

export interface FrontmatterOpOptions {
  /** Suppress toast feedback (caller manages its own toast). */
  silent?: boolean
}

export interface FrontmatterApplyCallbacks {
  updateTab: (path: VaultPath, content: MarkdownContent) => void
  updateEntry: (path: VaultPath, patch: Partial<VaultEntry>) => void
  toast: (message: ToastMessage) => void
  getEntry?: (path: VaultPath) => VaultEntry | undefined
}

export interface FrontmatterRunRequest {
  op: FrontmatterOp
  path: VaultPath
  key: FrontmatterKey
  value?: FrontmatterValue
  callbacks: FrontmatterApplyCallbacks
  options?: FrontmatterOpOptions
}

/** Apply a properties patch by merging into the existing properties map. */
export function applyPropertiesPatch(
  existing: Record<FrontmatterKey, ScalarPropertyValue>, propPatch: PropertiesPatch,
): Record<FrontmatterKey, ScalarPropertyValue> {
  return applyRecordPatch(existing, propPatch)
}

/** Apply a relationship patch by merging into the existing relationships map. */
export function applyRelationshipPatch(
  existing: Record<FrontmatterKey, WikilinkText[]>, relPatch: RelationshipPatch,
): Record<FrontmatterKey, WikilinkText[]> {
  return applyRecordPatch(existing, relPatch)
}

function patchNeedsExistingEntry(result: EntryPatchResult): boolean {
  return Boolean(result.relationshipPatch || result.propertiesPatch)
}

function buildFullEntryPatch(
  path: VaultPath,
  callbacks: FrontmatterApplyCallbacks,
  result: EntryPatchResult,
): Partial<VaultEntry> {
  const fullPatch = { ...result.patch }
  if (!patchNeedsExistingEntry(result) || !callbacks.getEntry) return fullPatch

  const current = callbacks.getEntry(path)
  if (!current) return fullPatch

  if (result.relationshipPatch) {
    fullPatch.relationships = applyRelationshipPatch(current.relationships, result.relationshipPatch)
  }
  if (result.propertiesPatch) {
    fullPatch.properties = applyPropertiesPatch(current.properties, result.propertiesPatch)
  }
  return fullPatch
}

function applyEntryPatch(path: VaultPath, callbacks: FrontmatterApplyCallbacks, result: EntryPatchResult) {
  const fullPatch = buildFullEntryPatch(path, callbacks, result)
  if (Object.keys(fullPatch).length > 0) callbacks.updateEntry(path, fullPatch)
}

function successToastMessage(op: FrontmatterOp): ToastMessage {
  return op === 'update' ? 'Property updated' : 'Property deleted'
}

function notifyFrontmatterSuccess(op: FrontmatterOp, callbacks: FrontmatterApplyCallbacks, options?: FrontmatterOpOptions) {
  if (!options?.silent) callbacks.toast(successToastMessage(op))
}

function failureToastMessage(op: FrontmatterOp): ToastMessage {
  return `Failed to ${op} property`
}

function handleFrontmatterFailure(
  op: FrontmatterOp,
  err: unknown,
  callbacks: FrontmatterApplyCallbacks,
  options?: FrontmatterOpOptions,
): undefined {
  console.error(`Failed to ${op} frontmatter:`, err)
  if (options?.silent) throw err
  callbacks.toast(failureToastMessage(op))
  return undefined
}

/** Run a frontmatter update/delete and apply the result to state.
 *  Returns the new file content on success, or undefined on failure. */
export async function runFrontmatterAndApply(request: FrontmatterRunRequest): Promise<MarkdownContent | undefined> {
  const { op, path, key, value, callbacks, options } = request
  try {
    const newContent = await executeFrontmatterOp(op, path, key, value)
    callbacks.updateTab(path, newContent)
    applyEntryPatch(path, callbacks, frontmatterToEntryPatch(op, key, value))
    notifyFrontmatterSuccess(op, callbacks, options)
    return newContent
  } catch (err) {
    return handleFrontmatterFailure(op, err, callbacks, options)
  }
}
