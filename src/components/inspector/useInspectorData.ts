import { useMemo } from 'react'
import type { VaultEntry } from '../../types'
import { wikilinkTarget } from '../../utils/wikilink'
import type { ReferencedByItem, BacklinkItem } from '../InspectorPanels'

interface InspectorLinkIndex {
  referencedBy: Map<string, ReferencedByItem[]>
  backlinks: Map<string, BacklinkItem[]>
}

interface EntryLookup {
  exactTargetEntries: Map<string, VaultEntry[]>
  pathSuffixEntries: Map<string, VaultEntry[]>
}

interface EntryTargetMatcher {
  exactTargets: Set<string>
  pathSuffixes: Set<string>
}

const inspectorLinkIndexCache = new WeakMap<VaultEntry[], InspectorLinkIndex>()

function pushToEntryLookup(map: Map<string, VaultEntry[]>, key: string, entry: VaultEntry): void {
  const existing = map.get(key)
  if (existing) {
    existing.push(entry)
    return
  }
  map.set(key, [entry])
}

function pushToResultMap<T>(map: Map<string, T[]>, key: string, item: T): void {
  const existing = map.get(key)
  if (existing) {
    existing.push(item)
    return
  }
  map.set(key, [item])
}

function getEntryPathSuffixes(entryPath: string): string[] {
  const pathWithoutExtension = entryPath.replace(/\.md$/, '').replace(/^\/+/, '')
  const segments = pathWithoutExtension.split('/')
  const suffixes: string[] = []

  for (let index = 0; index < segments.length; index += 1) {
    suffixes.push(segments.slice(index).join('/').toLowerCase())
  }

  return suffixes
}

function buildEntryLookup(entries: VaultEntry[]): EntryLookup {
  const exactTargetEntries = new Map<string, VaultEntry[]>()
  const pathSuffixEntries = new Map<string, VaultEntry[]>()

  for (const entry of entries) {
    const { exactTargets, pathSuffixes } = buildEntryTargetMatcher(entry)

    for (const target of exactTargets) {
      pushToEntryLookup(exactTargetEntries, target, entry)
    }
    for (const suffix of pathSuffixes) {
      pushToEntryLookup(pathSuffixEntries, suffix, entry)
    }
  }

  return { exactTargetEntries, pathSuffixEntries }
}

function buildEntryTargetMatcher(entry: VaultEntry): EntryTargetMatcher {
  return {
    exactTargets: new Set([
      entry.filename.replace(/\.md$/, ''),
      entry.title,
      ...entry.aliases,
    ]),
    pathSuffixes: new Set(getEntryPathSuffixes(entry.path)),
  }
}

function findMatchedEntries(target: string, lookup: EntryLookup): VaultEntry[] {
  const matches = new Map<string, VaultEntry>()
  const lastSegment = target.split('/').pop() ?? ''
  const pathMatches = target.includes('/') ? lookup.pathSuffixEntries.get(target.toLowerCase()) : undefined

  for (const candidate of lookup.exactTargetEntries.get(target) ?? []) {
    matches.set(candidate.path, candidate)
  }
  for (const candidate of lookup.exactTargetEntries.get(lastSegment) ?? []) {
    matches.set(candidate.path, candidate)
  }
  for (const candidate of pathMatches ?? []) {
    matches.set(candidate.path, candidate)
  }

  return [...matches.values()]
}

function collectMatchedPaths(
  targets: string[],
  lookup: EntryLookup,
  sourcePath: string,
  resolveTarget: (target: string) => string,
): string[] {
  const matchedPaths = new Set<string>()

  for (const rawTarget of targets) {
    const target = resolveTarget(rawTarget)
    for (const matchedEntry of findMatchedEntries(target, lookup)) {
      if (matchedEntry.path !== sourcePath) {
        matchedPaths.add(matchedEntry.path)
      }
    }
  }

  return [...matchedPaths]
}

function targetMatchesEntry(
  rawTarget: string,
  matcher: EntryTargetMatcher,
  resolveTarget: (target: string) => string,
): boolean {
  const target = resolveTarget(rawTarget)
  const lastSegment = target.split('/').pop() ?? ''
  return matcher.exactTargets.has(target)
    || matcher.exactTargets.has(lastSegment)
    || (target.includes('/') && matcher.pathSuffixes.has(target.toLowerCase()))
}

function indexReferencedByEntries(
  sourceEntry: VaultEntry,
  lookup: EntryLookup,
  referencedBy: Map<string, ReferencedByItem[]>,
): void {
  for (const [viaKey, refs] of Object.entries(sourceEntry.relationships)) {
    if (viaKey === 'Type') continue

    for (const matchedPath of collectMatchedPaths(refs, lookup, sourceEntry.path, wikilinkTarget)) {
      pushToResultMap(referencedBy, matchedPath, { entry: sourceEntry, viaKey })
    }
  }
}

function collectReferencedByForEntry(entry: VaultEntry, entries: VaultEntry[]): ReferencedByItem[] {
  const matcher = buildEntryTargetMatcher(entry)
  const referencedBy: ReferencedByItem[] = []

  for (const sourceEntry of entries) {
    if (sourceEntry.path === entry.path) continue

    for (const [viaKey, refs] of Object.entries(sourceEntry.relationships)) {
      if (viaKey === 'Type') continue
      if (refs.some((ref) => targetMatchesEntry(ref, matcher, wikilinkTarget))) {
        referencedBy.push({ entry: sourceEntry, viaKey })
      }
    }
  }

  return referencedBy
}

function indexBacklinkEntries(
  sourceEntry: VaultEntry,
  lookup: EntryLookup,
  backlinks: Map<string, BacklinkItem[]>,
): void {
  for (const matchedPath of collectMatchedPaths(sourceEntry.outgoingLinks, lookup, sourceEntry.path, (target) => target)) {
    pushToResultMap(backlinks, matchedPath, { entry: sourceEntry, context: null })
  }
}

function collectBacklinksForEntry(
  entry: VaultEntry,
  entries: VaultEntry[],
  referencedBy: ReferencedByItem[],
): BacklinkItem[] {
  const matcher = buildEntryTargetMatcher(entry)
  const referencedByPaths = new Set(referencedBy.map((item) => item.entry.path))
  const backlinks: BacklinkItem[] = []

  for (const sourceEntry of entries) {
    if (sourceEntry.path === entry.path || referencedByPaths.has(sourceEntry.path)) continue
    if (sourceEntry.outgoingLinks.some((target) => targetMatchesEntry(target, matcher, (value) => value))) {
      backlinks.push({ entry: sourceEntry, context: null })
    }
  }

  return backlinks
}

export function buildInspectorLinkIndex(entries: VaultEntry[]): InspectorLinkIndex {
  const lookup = buildEntryLookup(entries)
  const referencedBy = new Map<string, ReferencedByItem[]>()
  const backlinks = new Map<string, BacklinkItem[]>()

  for (const sourceEntry of entries) {
    indexReferencedByEntries(sourceEntry, lookup, referencedBy)
    indexBacklinkEntries(sourceEntry, lookup, backlinks)
  }

  return { referencedBy, backlinks }
}

export function getInspectorLinkIndex(entries: VaultEntry[]): InspectorLinkIndex {
  const cached = inspectorLinkIndexCache.get(entries)
  if (cached) return cached

  const built = buildInspectorLinkIndex(entries)
  inspectorLinkIndexCache.set(entries, built)
  return built
}

export function useReferencedBy(entry: VaultEntry | null, entries: VaultEntry[]): ReferencedByItem[] {
  return useMemo(() => (entry ? collectReferencedByForEntry(entry, entries) : []), [entry, entries])
}

export function useBacklinks(entry: VaultEntry | null, entries: VaultEntry[], referencedBy: ReferencedByItem[]): BacklinkItem[] {
  return useMemo(
    () => (entry ? collectBacklinksForEntry(entry, entries, referencedBy) : []),
    [entry, entries, referencedBy],
  )
}
