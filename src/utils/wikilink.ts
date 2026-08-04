/** Utility functions for parsing wikilink syntax: [[target|display]] */

import type { VaultEntry } from '../types'
import { slugifyNoteStem } from './noteSlug'
import { workspaceForEntry, workspacePathForEntry } from './workspaces'

export type AbsoluteNotePath = string
export type NoteTitleOrTarget = string
export type VaultPath = string
export type WikilinkReference = string
export type WikilinkTarget = string

/** Extracts the target path from a wikilink reference (strips [[ ]] and display text). */
export function wikilinkTarget(ref: WikilinkReference): WikilinkTarget {
  const inner = ref.replace(/^\[\[|\]\]$/g, '')
  const pipeIdx = inner.indexOf('|')
  return pipeIdx !== -1 ? inner.slice(0, pipeIdx) : inner
}

/** Extracts the display label from a wikilink reference. Falls back to humanised path stem. */
export function wikilinkDisplay(ref: WikilinkReference): string {
  const inner = ref.replace(/^\[\[|\]\]$/g, '')
  const pipeIdx = inner.indexOf('|')
  if (pipeIdx !== -1) return inner.slice(pipeIdx + 1)
  const last = inner.split('/').pop() ?? inner
  return last.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function stripWindowsExtendedPathPrefix(path: AbsoluteNotePath | VaultPath): string {
  return path
    .replace(/^\\\\\?\\UNC\\/i, '//')
    .replace(/^\\\\\?\\/, '')
}

function normalizeFilesystemPath(path: AbsoluteNotePath | VaultPath): string {
  return stripWindowsExtendedPathPrefix(path)
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '')
}

function withoutMarkdownExtension(pathStem: WikilinkTarget): WikilinkTarget {
  return pathStem.replace(/\.md$/i, '')
}

/** Extract the vault-relative path stem (no leading slash, no .md extension). */
export function relativePathStem(absolutePath: AbsoluteNotePath, vaultPath: VaultPath): WikilinkTarget {
  const normalizedAbsolutePath = normalizeFilesystemPath(absolutePath)
  const normalizedVaultPath = normalizeFilesystemPath(vaultPath)
  const prefix = normalizedVaultPath.endsWith('/') ? normalizedVaultPath : `${normalizedVaultPath}/`
  if (normalizedAbsolutePath.toLowerCase().startsWith(prefix.toLowerCase())) {
    return withoutMarkdownExtension(normalizedAbsolutePath.slice(prefix.length))
  }
  // Fallback: just the filename stem
  const filename = normalizedAbsolutePath.split('/').pop() ?? normalizedAbsolutePath
  return withoutMarkdownExtension(filename)
}

/** Slugify a human-readable title into the canonical wikilink filename stem. */
export const slugifyWikilinkTarget = slugifyNoteStem

function shouldPrefixWorkspaceAlias(entryAlias?: string, sourceAlias?: string): boolean {
  return !!entryAlias && !!sourceAlias && entryAlias !== sourceAlias
}

/** Build the canonical wikilink target for a vault entry. */
export function canonicalWikilinkTargetForEntry(entry: VaultEntry, vaultPath: VaultPath, sourceEntry?: VaultEntry): WikilinkTarget {
  const entryWorkspace = workspaceForEntry(entry)
  const sourceWorkspace = sourceEntry ? workspaceForEntry(sourceEntry) : null
  const entryVaultPath = workspacePathForEntry(entry) ?? vaultPath
  const localTarget = relativePathStem(entry.path, entryVaultPath)
  const entryAlias = entryWorkspace?.alias
  if (shouldPrefixWorkspaceAlias(entryAlias, sourceWorkspace?.alias)) {
    return `${entryAlias}/${localTarget}`
  }
  return localTarget
}

/** Resolve a user-facing title/path input to the canonical wikilink target. */
export function canonicalWikilinkTargetForTitle(
  titleOrTarget: NoteTitleOrTarget,
  entries: VaultEntry[],
  vaultPath: VaultPath,
  sourceEntry?: VaultEntry,
): WikilinkTarget {
  const trimmed = titleOrTarget.trim()
  const resolved = resolveEntry(entries, trimmed, sourceEntry)
  return resolved
    ? canonicalWikilinkTargetForEntry(resolved, vaultPath, sourceEntry)
    : trimmed.includes('/')
      ? trimmed.replace(/^\/+/, '').replace(/\.md$/, '')
      : slugifyWikilinkTarget(trimmed)
}

/** Wrap a target in wikilink syntax. */
export function formatWikilinkRef(target: WikilinkTarget): WikilinkReference {
  return `[[${target}]]`
}

interface ResolutionKey {
  exactTarget: string
  workspaceAlias: string | null
  targetWithoutWorkspace: string
  lastSegment: string
  pathSuffixes: string[]
  humanizedTarget: string | null
}

interface IndexedResolutionEntry {
  aliases: string[]
  entry: VaultEntry
  filenameStem: string
  normalizedPath: string
  title: string
  workspaceAlias: string | null
}

interface ResolutionIndex {
  entries: IndexedResolutionEntry[]
  entriesByWorkspaceAlias: Map<string, IndexedResolutionEntry[]>
  resolutionCache: Map<string, VaultEntry | null>
  workspaceAliases: Set<string>
}

type EntryMatcher = (entry: IndexedResolutionEntry, resolutionKey: ResolutionKey) => boolean

const resolutionIndexesByEntries = new WeakMap<VaultEntry[], ResolutionIndex>()

function buildResolutionKey(rawTarget: WikilinkTarget, knownWorkspaceAliases: Set<string> = new Set()): ResolutionKey {
  const exactTarget = rawTarget.includes('|') ? rawTarget.split('|')[0] : rawTarget
  const normalizedTarget = exactTarget.toLowerCase()
  const segments = exactTarget.split('/').filter(Boolean)
  const candidateWorkspaceAlias = segments.length > 1 ? segments[0].toLowerCase() : null
  const workspaceAlias = candidateWorkspaceAlias && knownWorkspaceAliases.has(candidateWorkspaceAlias)
    ? candidateWorkspaceAlias
    : null
  const targetWithoutWorkspace = workspaceAlias ? segments.slice(1).join('/') : exactTarget
  const normalizedLocalTarget = targetWithoutWorkspace.toLowerCase()
  const normalizedPathTarget = normalizedLocalTarget.replace(/^\/+/, '')
  const pathSuffixes = normalizedPathTarget.includes('/')
    ? [`/${normalizedPathTarget}`, ...normalizedPathTarget.endsWith('.md') ? [] : [`/${normalizedPathTarget}.md`]]
    : []
  const lastSegment = targetWithoutWorkspace.includes('/') ? (targetWithoutWorkspace.split('/').pop() ?? targetWithoutWorkspace).toLowerCase() : normalizedLocalTarget
  const humanizedTarget = lastSegment.replace(/-/g, ' ')

  return {
    exactTarget: normalizedTarget,
    workspaceAlias,
    targetWithoutWorkspace: normalizedLocalTarget,
    lastSegment,
    pathSuffixes,
    humanizedTarget: humanizedTarget === normalizedLocalTarget ? null : humanizedTarget,
  }
}

function workspaceAliasForEntry(entry: VaultEntry | undefined): string | null {
  return entry ? (workspaceForEntry(entry)?.alias.toLowerCase() ?? null) : null
}

function buildIndexedResolutionEntry(entry: VaultEntry): IndexedResolutionEntry {
  return {
    aliases: entry.aliases.map((alias) => alias.toLowerCase()),
    entry,
    filenameStem: entry.filename.replace(/\.md$/, '').toLowerCase(),
    normalizedPath: normalizeFilesystemPath(entry.path).toLowerCase(),
    title: entry.title.toLowerCase(),
    workspaceAlias: workspaceAliasForEntry(entry),
  }
}

function buildResolutionIndex(entries: VaultEntry[]): ResolutionIndex {
  const indexedEntries = entries.map(buildIndexedResolutionEntry)
  const entriesByWorkspaceAlias = new Map<string, IndexedResolutionEntry[]>()
  const workspaceAliases = new Set<string>()

  for (const entry of indexedEntries) {
    if (!entry.workspaceAlias) continue
    workspaceAliases.add(entry.workspaceAlias)
    const workspaceEntries = entriesByWorkspaceAlias.get(entry.workspaceAlias) ?? []
    workspaceEntries.push(entry)
    entriesByWorkspaceAlias.set(entry.workspaceAlias, workspaceEntries)
  }

  return {
    entries: indexedEntries,
    entriesByWorkspaceAlias,
    resolutionCache: new Map(),
    workspaceAliases,
  }
}

function resolutionIndexForEntries(entries: VaultEntry[]): ResolutionIndex {
  const cached = resolutionIndexesByEntries.get(entries)
  if (cached) return cached

  const index = buildResolutionIndex(entries)
  resolutionIndexesByEntries.set(entries, index)
  return index
}

function resolutionCacheKey(resolutionKey: ResolutionKey, sourceWorkspaceAlias: string | null): string {
  return `${sourceWorkspaceAlias ?? ''}\n${resolutionKey.exactTarget}`
}

function findIndexedEntry(entries: IndexedResolutionEntry[], resolutionKey: ResolutionKey, matcher: EntryMatcher): VaultEntry | undefined {
  for (const entry of entries) {
    if (matcher(entry, resolutionKey)) return entry.entry
  }
  return undefined
}

function findPrioritizedEntry(
  index: ResolutionIndex,
  resolutionKey: ResolutionKey,
  sourceWorkspaceAlias: string | null,
  matcher: EntryMatcher,
): VaultEntry | undefined {
  return findIndexedEntry(
    prioritizedEntries(index, resolutionKey.workspaceAlias, sourceWorkspaceAlias),
    resolutionKey,
    matcher,
  )
}

function prioritizedEntries(
  index: ResolutionIndex,
  targetWorkspaceAlias: string | null,
  sourceWorkspaceAlias: string | null,
): IndexedResolutionEntry[] {
  if (targetWorkspaceAlias) return index.entriesByWorkspaceAlias.get(targetWorkspaceAlias) ?? []
  if (!sourceWorkspaceAlias) return index.entries
  const localEntries = index.entriesByWorkspaceAlias.get(sourceWorkspaceAlias) ?? []
  return localEntries.concat(index.entries.filter((entry) => entry.workspaceAlias !== sourceWorkspaceAlias))
}

function matchesPathSuffix(entry: IndexedResolutionEntry, resolutionKey: ResolutionKey): boolean {
  return resolutionKey.pathSuffixes.some((pathSuffix) => entry.normalizedPath.endsWith(pathSuffix))
}

function matchesFilename(entry: IndexedResolutionEntry, resolutionKey: ResolutionKey): boolean {
  return entry.filenameStem === resolutionKey.exactTarget
    || entry.filenameStem === resolutionKey.targetWithoutWorkspace
    || entry.filenameStem === resolutionKey.lastSegment
}

function matchesAlias(entry: IndexedResolutionEntry, resolutionKey: ResolutionKey): boolean {
  return entry.aliases.some((alias) => (
    alias === resolutionKey.exactTarget || alias === resolutionKey.targetWithoutWorkspace
  ))
}

function matchesTitle(entry: IndexedResolutionEntry, resolutionKey: ResolutionKey): boolean {
  return entry.title === resolutionKey.exactTarget
    || entry.title === resolutionKey.targetWithoutWorkspace
    || entry.title === resolutionKey.lastSegment
}

function matchesHumanizedTitle(entry: IndexedResolutionEntry, resolutionKey: ResolutionKey): boolean {
  return !!resolutionKey.humanizedTarget && entry.title === resolutionKey.humanizedTarget
}

function resolveEntryFromIndex(
  index: ResolutionIndex,
  resolutionKey: ResolutionKey,
  sourceWorkspaceAlias: string | null,
): VaultEntry | undefined {
  const matchers = resolutionKey.pathSuffixes.length > 0
    ? [matchesPathSuffix, matchesFilename, matchesAlias, matchesTitle, matchesHumanizedTitle]
    : [matchesFilename, matchesAlias, matchesTitle, matchesHumanizedTitle]
  for (const matcher of matchers) {
    const entry = findPrioritizedEntry(index, resolutionKey, sourceWorkspaceAlias, matcher)
    if (entry) return entry
  }
  return undefined
}

/**
 * Unified wikilink resolution: find the VaultEntry matching a wikilink target.
 * Handles pipe syntax, case-insensitive matching.
 * Resolution order (multi-pass, global priority):
 *   1. Path-suffix match (for path-style targets like "docs/adr/0031-foo")
 *   2. Filename stem match (strongest for flat vaults)
 *   3. Alias match
 *   4. Exact title match
 *   5. Humanized title match (kebab-case → words)
 */
export function resolveEntry(entries: VaultEntry[], rawTarget: WikilinkTarget, sourceEntry?: VaultEntry): VaultEntry | undefined {
  const index = resolutionIndexForEntries(entries)
  const resolutionKey = buildResolutionKey(rawTarget, index.workspaceAliases)
  const sourceWorkspaceAlias = workspaceAliasForEntry(sourceEntry)
  const cacheKey = resolutionCacheKey(resolutionKey, sourceWorkspaceAlias)
  if (index.resolutionCache.has(cacheKey)) return index.resolutionCache.get(cacheKey) ?? undefined

  const resolved = resolveEntryFromIndex(index, resolutionKey, sourceWorkspaceAlias)
  index.resolutionCache.set(cacheKey, resolved ?? null)
  return resolved
}
