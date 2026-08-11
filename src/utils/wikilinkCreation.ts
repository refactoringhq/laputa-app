import type { VaultOption } from '../components/status-bar/types'
import type { VaultEntry } from '../types'
import { normalizeVaultRelativePath } from './notePathIdentity'
import { slugifyNoteStem } from './noteSlug'
import { relativePathStem, wikilinkDisplay, wikilinkTarget } from './wikilink'
import { workspaceAliasFromOption } from './workspaces'

export interface WikilinkCreationDestination {
  relativePath: string
  vaultPath: string
}

export interface WikilinkCreationRequest {
  destination: WikilinkCreationDestination
  title: string
}

interface ResolveWikilinkCreationRequestOptions {
  fallbackVaultPath: string
  sourceEntry?: VaultEntry
  target: string
  vaults?: readonly VaultOption[]
}

interface ParsedCreationTarget {
  hasPathQualifier: boolean
  segments: string[]
}

interface ResolvedCreationTarget {
  destinationVaultPath: string
  folderPath: string
  targetTitle: string
}

function normalizedTargetSegments(target: string): string[] {
  const segments: string[] = []
  for (const segment of target.replace(/\\/gu, '/').split('/')) {
    const trimmed = segment.trim()
    if (!trimmed || trimmed === '.') continue
    if (trimmed === '..') {
      segments.pop()
      continue
    }
    segments.push(trimmed)
  }
  return segments
}

function matchingWorkspace(
  firstSegment: string | undefined,
  vaults: readonly VaultOption[],
): VaultOption | undefined {
  if (!firstSegment) return undefined
  const normalizedAlias = firstSegment.toLocaleLowerCase()
  return vaults.find((vault) => (
    workspaceAliasFromOption(vault).toLocaleLowerCase() === normalizedAlias
    && vault.available !== false
    && vault.mounted !== false
  ))
}

function sourceFolder(sourceEntry: VaultEntry | undefined, vaultPath: string): string {
  if (!sourceEntry) return ''
  const sourceStem = relativePathStem(sourceEntry.path, vaultPath)
  return sourceStem.split('/').slice(0, -1).join('/')
}

function titleFromTarget(target: string): string {
  return wikilinkDisplay(target.replace(/\.md$/iu, ''))
}

function parseCreationTarget(target: string): ParsedCreationTarget | null {
  const rawTarget = wikilinkTarget(target).trim().replace(/\.md$/iu, '')
  const segments = normalizedTargetSegments(rawTarget)
  if (segments.length === 0) return null
  return {
    hasPathQualifier: rawTarget.replace(/\\/gu, '/').includes('/'),
    segments,
  }
}

function resolveSourceVaultPath(sourceEntry: VaultEntry | undefined, fallbackVaultPath: string): string {
  return sourceEntry?.workspace?.path ?? fallbackVaultPath
}

function resolveTargetFolder({
  explicitFolder,
  explicitWorkspace,
  hasPathQualifier,
  sourceEntry,
  sourceVaultPath,
}: {
  explicitFolder: string
  explicitWorkspace: VaultOption | undefined
  hasPathQualifier: boolean
  sourceEntry: VaultEntry | undefined
  sourceVaultPath: string
}): string {
  if (explicitWorkspace) return explicitFolder
  if (explicitFolder) return explicitFolder
  if (hasPathQualifier) return ''
  return sourceFolder(sourceEntry, sourceVaultPath)
}

function resolveCreationTarget(
  parsed: ParsedCreationTarget,
  sourceEntry: VaultEntry | undefined,
  fallbackVaultPath: string,
  vaults: readonly VaultOption[],
): ResolvedCreationTarget | null {
  const sourceVaultPath = resolveSourceVaultPath(sourceEntry, fallbackVaultPath)
  const explicitWorkspace = matchingWorkspace(parsed.segments[0], vaults)
  const targetSegments = explicitWorkspace ? parsed.segments.slice(1) : parsed.segments
  if (targetSegments.length === 0) return null

  const explicitFolder = targetSegments.slice(0, -1).join('/')
  return {
    destinationVaultPath: explicitWorkspace?.path ?? sourceVaultPath,
    folderPath: resolveTargetFolder({
      explicitFolder,
      explicitWorkspace,
      hasPathQualifier: parsed.hasPathQualifier,
      sourceEntry,
      sourceVaultPath,
    }),
    targetTitle: titleFromTarget(targetSegments.at(-1) ?? ''),
  }
}

function noteRelativePath(folderPath: string, title: string): string {
  const normalizedFolder = normalizeVaultRelativePath(folderPath)
  const filename = `${slugifyNoteStem(title)}.md`
  return normalizedFolder ? `${normalizedFolder}/${filename}` : filename
}

export function resolveWikilinkCreationRequest({
  fallbackVaultPath,
  sourceEntry,
  target,
  vaults = [],
}: ResolveWikilinkCreationRequestOptions): WikilinkCreationRequest | null {
  const parsed = parseCreationTarget(target)
  if (!parsed) return null
  const resolved = resolveCreationTarget(parsed, sourceEntry, fallbackVaultPath, vaults)
  if (!resolved) return null

  return {
    destination: {
      relativePath: noteRelativePath(resolved.folderPath, resolved.targetTitle),
      vaultPath: resolved.destinationVaultPath,
    },
    title: resolved.targetTitle,
  }
}
