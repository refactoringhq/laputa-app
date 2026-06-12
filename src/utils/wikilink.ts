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
  const prefix = normalizedVaultPath.endsWith('/') ? normalizedVaultPath : normalizedVaultPath + '/'
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

function filterEntriesByWorkspace(entries: VaultEntry[], alias: string | null): VaultEntry[] {
  if (!alias) return entries
  return entries.filter((entry) => workspaceForEntry(entry)?.alias.toLowerCase() === alias)
}

function prioritizeSourceWorkspace(entries: VaultEntry[], sourceEntry?: VaultEntry): VaultEntry[] {
  const sourceWorkspace = sourceEntry ? workspaceForEntry(sourceEntry) : null
  if (!sourceWorkspace) return entries
  return [
    ...entries.filter((entry) => workspaceForEntry(entry)?.alias === sourceWorkspace.alias),
    ...entries.filter((entry) => workspaceForEntry(entry)?.alias !== sourceWorkspace.alias),
  ]
}

function findEntryByPathSuffix(entries: VaultEntry[], resolutionKey: ResolutionKey): VaultEntry | undefined {
  if (resolutionKey.pathSuffixes.length === 0) return undefined
  return entries.find((entry) => {
    const normalizedEntryPath = normalizeFilesystemPath(entry.path).toLowerCase()
    return resolutionKey.pathSuffixes.some(pathSuffix => normalizedEntryPath.endsWith(pathSuffix))
  })
}

function findEntryByFilename(entries: VaultEntry[], { exactTarget, targetWithoutWorkspace, lastSegment }: ResolutionKey): VaultEntry | undefined {
  return entries.find((entry) => {
    const stem = entry.filename.replace(/\.md$/, '').toLowerCase()
    return stem === exactTarget || stem === targetWithoutWorkspace || stem === lastSegment
  })
}

function findEntryByAlias(entries: VaultEntry[], resolutionKey: ResolutionKey): VaultEntry | undefined {
  return entries.find(entry => entry.aliases.some((alias) => {
    const normalizedAlias = alias.toLowerCase()
    return normalizedAlias === resolutionKey.exactTarget || normalizedAlias === resolutionKey.targetWithoutWorkspace
  }))
}

function findEntryByTitle(entries: VaultEntry[], resolutionKey: ResolutionKey): VaultEntry | undefined {
  return entries.find((entry) => {
    const lowerTitle = entry.title.toLowerCase()
    return lowerTitle === resolutionKey.exactTarget || lowerTitle === resolutionKey.targetWithoutWorkspace || lowerTitle === resolutionKey.lastSegment
  })
}

function findEntryByHumanizedTitle(entries: VaultEntry[], resolutionKey: ResolutionKey): VaultEntry | undefined {
  if (!resolutionKey.humanizedTarget) return undefined
  return entries.find(entry => entry.title.toLowerCase() === resolutionKey.humanizedTarget)
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
  const workspaceAliases = new Set(entries.map((entry) => workspaceForEntry(entry)?.alias.toLowerCase()).filter((alias): alias is string => !!alias))
  const resolutionKey = buildResolutionKey(rawTarget, workspaceAliases)
  const workspaceScopedEntries = filterEntriesByWorkspace(entries, resolutionKey.workspaceAlias)
  const candidates = resolutionKey.workspaceAlias
    ? workspaceScopedEntries
    : prioritizeSourceWorkspace(entries, sourceEntry)
  return (
    findEntryByPathSuffix(candidates, resolutionKey)
    ?? findEntryByFilename(candidates, resolutionKey)
    ?? findEntryByAlias(candidates, resolutionKey)
    ?? findEntryByTitle(candidates, resolutionKey)
    ?? findEntryByHumanizedTitle(candidates, resolutionKey)
  )
}
