import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import { markNoteOpenTrace } from '../utils/noteOpenPerformance'
import { errorMessage, isActiveVaultUnavailableError } from '../utils/vaultErrors'
import { getNoteWindowParams, isNoteWindow } from '../utils/windowMode'

type NotePath = VaultEntry['path']

export interface NoteContentIdentity {
  modifiedAt: number | null
  fileSize: number | null
}

export interface NoteContentCacheEntry {
  path: NotePath
  promise: Promise<string>
  value: string | null
  byteSize: number
  identity: NoteContentIdentity | null
}

export interface NoteContentResolvedEvent {
  entry: VaultEntry | null
  path: NotePath
  content: string
}

type NoteContentResolvedListener = (event: NoteContentResolvedEvent) => void

const prefetchCache = new Map<string, NoteContentCacheEntry>()
const resolvedListeners = new Set<NoteContentResolvedListener>()
const contentSizeEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null

export const NOTE_CONTENT_CACHE_LIMIT = 48
export const NOTE_CONTENT_ENTRY_MAX_BYTES = 2 * 1024 * 1024
export const NOTE_CONTENT_CACHE_MAX_BYTES = 24 * 1024 * 1024

export function subscribeNoteContentResolved(listener: NoteContentResolvedListener): () => void {
  resolvedListeners.add(listener)
  return () => resolvedListeners.delete(listener)
}

function emitNoteContentResolved(event: NoteContentResolvedEvent): void {
  for (const listener of resolvedListeners) {
    try {
      listener(event)
    } catch (error) {
      console.warn('Note content cache listener failed:', error)
    }
  }
}

function measureNoteContentBytes(content: string): number {
  return contentSizeEncoder ? contentSizeEncoder.encode(content).byteLength : content.length
}

function noteContentIdentity(entry: VaultEntry): NoteContentIdentity {
  return {
    modifiedAt: entry.modifiedAt,
    fileSize: entry.fileSize,
  }
}

function isCompleteIdentity(identity: NoteContentIdentity | null): identity is NoteContentIdentity {
  return identity !== null && identity.modifiedAt !== null && identity.fileSize !== null
}

function sameIdentity(left: NoteContentIdentity | null, right: NoteContentIdentity | null): boolean {
  return isCompleteIdentity(left)
    && isCompleteIdentity(right)
    && left.modifiedAt === right.modifiedAt
    && left.fileSize === right.fileSize
}

function targetPath(target: string | VaultEntry): NotePath {
  return typeof target === 'string' ? target : target.path
}

function targetEntry(target: string | VaultEntry): VaultEntry | null {
  return typeof target === 'string' ? null : target
}

function targetIdentity(target: string | VaultEntry): NoteContentIdentity | null {
  const entry = targetEntry(target)
  return entry ? noteContentIdentity(entry) : null
}

function getRetainedPrefetchCacheBytes(): number {
  let totalBytes = 0
  for (const entry of prefetchCache.values()) totalBytes += entry.byteSize
  return totalBytes
}

function dropOldestPrefetchEntry(): void {
  const oldestPath = prefetchCache.keys().next().value
  if (!oldestPath) return
  prefetchCache.delete(oldestPath)
}

function trimPrefetchCache(): void {
  while (
    prefetchCache.size > NOTE_CONTENT_CACHE_LIMIT
    || getRetainedPrefetchCacheBytes() > NOTE_CONTENT_CACHE_MAX_BYTES
  ) {
    if (prefetchCache.size === 0) return
    dropOldestPrefetchEntry()
  }
}

function rememberNoteContent(entry: NoteContentCacheEntry): NoteContentCacheEntry {
  const { path } = entry
  if (prefetchCache.has(path)) prefetchCache.delete(path)
  prefetchCache.set(path, entry)
  trimPrefetchCache()
  return entry
}

function retainResolvedNoteContent(entry: NoteContentCacheEntry, content: string, sourceEntry: VaultEntry | null): void {
  if (prefetchCache.get(entry.path) !== entry) return
  const byteSize = measureNoteContentBytes(content)
  if (byteSize > NOTE_CONTENT_ENTRY_MAX_BYTES) {
    prefetchCache.delete(entry.path)
    return
  }

  entry.value = content
  entry.byteSize = byteSize
  rememberNoteContent(entry)
  emitNoteContentResolved({ entry: sourceEntry, path: entry.path, content })
}

function getNoteContentCommandPayload(path: string): { path: string; vaultPath?: string } {
  if (!isNoteWindow()) return { path }

  const noteWindowParams = getNoteWindowParams()
  return noteWindowParams ? { path, vaultPath: noteWindowParams.vaultPath } : { path }
}

function getValidateNoteContentCommandPayload(path: string, content: string): { path: string; content: string; vaultPath?: string } {
  return { ...getNoteContentCommandPayload(path), content }
}

function shouldReuseExistingRequest(existing: NoteContentCacheEntry, identity: NoteContentIdentity | null): boolean {
  if (!isCompleteIdentity(identity) || !isCompleteIdentity(existing.identity)) return true
  return sameIdentity(existing.identity, identity)
}

function requestNoteContent(target: string | VaultEntry): NoteContentCacheEntry {
  const path = targetPath(target)
  const sourceEntry = targetEntry(target)
  const identity = targetIdentity(target)
  const cacheEntry: NoteContentCacheEntry = {
    path,
    promise: Promise.resolve(''),
    value: null,
    byteSize: 0,
    identity,
  }
  const commandPayload = getNoteContentCommandPayload(path)
  const promise = (isTauri()
    ? invoke<string>('get_note_content', commandPayload)
    : mockInvoke<string>('get_note_content', commandPayload)
  )
    .then((content) => {
      retainResolvedNoteContent(cacheEntry, content, sourceEntry)
      return content
    })
    .catch((err) => {
      if (prefetchCache.get(path) === cacheEntry) prefetchCache.delete(path)
      throw err
    })

  cacheEntry.promise = promise
  return rememberNoteContent(cacheEntry)
}

export function prefetchNoteContent(target: string | VaultEntry): void {
  const path = targetPath(target)
  const identity = targetIdentity(target)
  const existing = prefetchCache.get(path)
  if (existing && shouldReuseExistingRequest(existing, identity)) return

  void requestNoteContent(target).promise.catch((error) => {
    if (isNoActiveVaultSelectedError(error) || isUnreadableNoteContentError(error)) return
    console.warn('Failed to prefetch note content:', error)
  })
}

export function cacheNoteContent(path: string, content: string, entry?: VaultEntry): void {
  const byteSize = measureNoteContentBytes(content)
  if (byteSize > NOTE_CONTENT_ENTRY_MAX_BYTES) {
    prefetchCache.delete(path)
    return
  }

  rememberNoteContent({
    path,
    promise: Promise.resolve(content),
    value: content,
    byteSize,
    identity: entry ? noteContentIdentity(entry) : null,
  })
  emitNoteContentResolved({ entry: entry ?? null, path, content })
}

export function clearNoteContentCache(): void {
  prefetchCache.clear()
}

export function hasResolvedCachedContent(entry: NoteContentCacheEntry | null): entry is NoteContentCacheEntry & { value: string } {
  return !!entry && entry.value !== null
}

export function getCachedNoteContentEntry(path: string): NoteContentCacheEntry | null {
  return prefetchCache.get(path) ?? null
}

async function validateCachedNoteContent(entry: NoteContentCacheEntry): Promise<boolean> {
  if (entry.value === null) return false
  const payload = getValidateNoteContentCommandPayload(entry.path, entry.value)
  return isTauri()
    ? invoke<boolean>('validate_note_content', payload)
    : mockInvoke<boolean>('validate_note_content', payload)
}

function canTrustCachedContentIdentity(entry: VaultEntry, cachedEntry: NoteContentCacheEntry): boolean {
  return sameIdentity(noteContentIdentity(entry), cachedEntry.identity)
}

function canUseExistingContentRequest(target: VaultEntry, existing: NoteContentCacheEntry | undefined, forceFresh: boolean): existing is NoteContentCacheEntry {
  if (forceFresh || !existing) return false
  return shouldReuseExistingRequest(existing, noteContentIdentity(target))
}

async function loadNoteContent(target: VaultEntry, forceFresh = false): Promise<string> {
  const existing = prefetchCache.get(target.path)
  if (canUseExistingContentRequest(target, existing, forceFresh)) {
    return existing.promise
  }
  return requestNoteContent(target).promise
}

async function loadCachedContentIfFresh(entry: VaultEntry, cachedEntry: NoteContentCacheEntry): Promise<string | null> {
  if (cachedEntry.value === null) return null
  if (canTrustCachedContentIdentity(entry, cachedEntry)) {
    rememberNoteContent(cachedEntry)
    return cachedEntry.value
  }

  markNoteOpenTrace(entry.path, 'freshnessCheckStart')
  const isFresh = await validateCachedNoteContent(cachedEntry)
  markNoteOpenTrace(entry.path, 'freshnessCheckEnd')
  if (isFresh) {
    rememberNoteContent(cachedEntry)
    return cachedEntry.value
  }
  prefetchCache.delete(entry.path)
  return null
}

export async function loadContentForOpen(options: {
  entry: VaultEntry
  forceReload: boolean
  cachedEntry: NoteContentCacheEntry | null
}): Promise<string> {
  const { entry, forceReload, cachedEntry } = options

  if (!forceReload && hasResolvedCachedContent(cachedEntry)) {
    const cachedContent = await loadCachedContentIfFresh(entry, cachedEntry)
    if (cachedContent !== null) return cachedContent
  }

  return loadNoteContent(entry, forceReload || hasResolvedCachedContent(cachedEntry))
}

export function isNoActiveVaultSelectedError(error: unknown): boolean {
  return isActiveVaultUnavailableError(error)
}

export function isUnreadableNoteContentError(error: unknown): boolean {
  return /not valid utf-8 text|invalid utf-8|stream did not contain valid utf-8/i.test(errorMessage(error))
}
