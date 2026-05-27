import type { VaultEntry } from '../types'
import { joinVaultPath, normalizeNotePathForCollision, normalizeNotePathForIdentity, normalizeNotePathSeparators } from './notePathIdentity'
import { workspaceAliasFromOption } from './workspaces'

export const TOLARIA_DEEP_LINK_SCHEME = 'tolaria'

export interface DeepLinkVault {
  alias?: string | null
  available?: boolean | null
  label?: string | null
  path: string
}

export type DeepLinkParseError = 'invalid_scheme' | 'missing_vault' | 'missing_path' | 'malformed_url' | 'unsafe_path'
export type DeepLinkOpenError = DeepLinkParseError | 'unknown_vault' | 'ambiguous_vault' | 'unavailable_vault' | 'missing_file'
export type DeepLinkBuildError = 'unknown_vault' | 'unavailable_vault' | 'outside_vault' | 'unsafe_path'

export type ParsedTolariaDeepLink =
  | { ok: true; relativePath: string; slug: string; url: string }
  | { ok: false; error: DeepLinkParseError }

export type ResolvedTolariaDeepLink =
  | { ok: true; absolutePath: string; relativePath: string; vault: DeepLinkVault }
  | { ok: false; error: DeepLinkOpenError }

export type BuiltTolariaDeepLink =
  | { ok: true; url: string }
  | { ok: false; error: DeepLinkBuildError }

interface TolariaDeepLinkInput {
  rawUrl: string
}

interface VaultRelativePathInput {
  path: string
}

interface VaultItemPathInput {
  itemPath: string
  vaultPath: string
}

interface VaultPathLookupInput {
  vaultPath: string
  vaults: readonly DeepLinkVault[]
}

interface VaultSlugLookupInput {
  slug: string
  vaults: readonly DeepLinkVault[]
}

interface TolariaDeepLinkResolveInput extends TolariaDeepLinkInput {
  vaults: readonly DeepLinkVault[]
}

interface TolariaDeepLinkBuildInput extends VaultPathLookupInput {
  entry: Pick<VaultEntry, 'path'>
}

interface VaultSlugEntry {
  baseSlug: string
  slug: string
  vault: DeepLinkVault
}

function normalizedVaultPath(vault: Pick<DeepLinkVault, 'path'>): string {
  return normalizeNotePathForCollision(vault.path)
}

function uniqueVaults(vaults: readonly DeepLinkVault[]): DeepLinkVault[] {
  const byPath = new Map<string, DeepLinkVault>()
  for (const vault of vaults) {
    const key = normalizedVaultPath(vault)
    if (!key || byPath.has(key)) continue
    byPath.set(key, vault)
  }
  return [...byPath.values()]
}

function stablePathHash({ path }: Pick<DeepLinkVault, 'path'>): string {
  let hash = 0x811c9dc5
  for (const char of normalizeNotePathForCollision(path)) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36).padStart(6, '0').slice(-6)
}

function baseSlugForVault(vault: DeepLinkVault): string {
  return workspaceAliasFromOption({
    alias: vault.alias ?? vault.label ?? '',
    label: vault.label ?? '',
    path: vault.path,
  })
}

export function vaultDeepLinkSlug(vault: DeepLinkVault, allVaults: readonly DeepLinkVault[]): string {
  const baseSlug = baseSlugForVault(vault)
  const matchingBaseSlugs = uniqueVaults(allVaults)
    .filter((candidate) => baseSlugForVault(candidate) === baseSlug)
  return matchingBaseSlugs.length > 1 ? `${baseSlug}-${stablePathHash(vault)}` : baseSlug
}

function vaultSlugEntries(vaults: readonly DeepLinkVault[]): VaultSlugEntry[] {
  const unique = uniqueVaults(vaults)
  return unique.map((vault) => ({
    baseSlug: baseSlugForVault(vault),
    slug: vaultDeepLinkSlug(vault, unique),
    vault,
  }))
}

function encodeRelativePath({ path }: VaultRelativePathInput): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function decodeRelativePath({ path }: VaultRelativePathInput): string | null {
  const pathname = path
  const encodedPath = pathname.replace(/^\/+/u, '')
  if (!encodedPath) return null

  const segments = encodedPath.split('/')
  const decodedSegments: string[] = []
  for (const segment of segments) {
    if (!segment) return null
    try {
      const decoded = decodeURIComponent(segment)
      if (!isSafePathSegment({ segment: decoded })) return null
      decodedSegments.push(decoded)
    } catch {
      return null
    }
  }
  return decodedSegments.join('/')
}

function rawPathnameForTolariaUrl({ rawUrl }: TolariaDeepLinkInput): string | null {
  return rawUrl.match(/^tolaria:\/\/[^/?#]+(\/[^?#]*)/iu)?.[1] ?? null
}

function isSafePathSegment({ segment }: { segment: string }): boolean {
  return segment.length > 0
    && segment !== '.'
    && segment !== '..'
    && !segment.includes('/')
    && !segment.includes('\\')
}

export function isSafeVaultRelativePath({ path }: VaultRelativePathInput): boolean {
  const normalized = normalizeNotePathSeparators(path).replace(/^\/+|\/+$/gu, '')
  if (!normalized) return false
  return normalized.split('/').every((segment) => isSafePathSegment({ segment }))
}

export function relativePathForVaultItem({ itemPath, vaultPath }: VaultItemPathInput): string | null {
  const normalizedItemPath = normalizeNotePathForIdentity(itemPath)
  const normalizedVaultPath = normalizeNotePathForIdentity(vaultPath)
  const vaultPrefix = `${normalizedVaultPath.replace(/\/+$/u, '')}/`
  if (!normalizedItemPath.toLocaleLowerCase().startsWith(vaultPrefix.toLocaleLowerCase())) {
    return null
  }

  const relativePath = normalizedItemPath.slice(vaultPrefix.length)
  return isSafeVaultRelativePath({ path: relativePath }) ? relativePath : null
}

function findVaultByPath({ vaultPath, vaults }: VaultPathLookupInput): DeepLinkVault | undefined {
  const targetPath = normalizeNotePathForCollision(vaultPath)
  return uniqueVaults(vaults).find((vault) => normalizedVaultPath(vault) === targetPath)
}

function resolveVaultForSlug({ slug, vaults }: VaultSlugLookupInput): ResolvedTolariaDeepLink | DeepLinkVault {
  const normalizedSlug = slug.trim().toLocaleLowerCase()
  const entries = vaultSlugEntries(vaults)
  const exactSlugMatches = entries.filter((entry) => entry.slug === normalizedSlug)
  if (exactSlugMatches.length > 1) return { ok: false, error: 'ambiguous_vault' }
  if (exactSlugMatches.length === 1) return resolvedAvailableVault(exactSlugMatches[0].vault)

  const baseSlugMatches = entries.filter((entry) => entry.baseSlug === normalizedSlug)
  if (baseSlugMatches.length > 1) return { ok: false, error: 'ambiguous_vault' }
  if (baseSlugMatches.length === 1) return resolvedAvailableVault(baseSlugMatches[0].vault)
  return { ok: false, error: 'unknown_vault' }
}

function resolvedAvailableVault(vault: DeepLinkVault): DeepLinkVault | ResolvedTolariaDeepLink {
  return vault.available === false ? { ok: false, error: 'unavailable_vault' } : vault
}

export function parseTolariaDeepLink({ rawUrl }: TolariaDeepLinkInput): ParsedTolariaDeepLink {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, error: 'malformed_url' }
  }

  if (parsed.protocol !== `${TOLARIA_DEEP_LINK_SCHEME}:`) return { ok: false, error: 'invalid_scheme' }
  if (!parsed.hostname) return { ok: false, error: 'missing_vault' }

  const rawPathname = rawPathnameForTolariaUrl({ rawUrl })
  if (!rawPathname) return { ok: false, error: 'missing_path' }

  const relativePath = decodeRelativePath({ path: rawPathname })
  if (!relativePath) return { ok: false, error: 'unsafe_path' }
  return { ok: true, relativePath, slug: parsed.hostname, url: rawUrl }
}

export function resolveTolariaDeepLink({ rawUrl, vaults }: TolariaDeepLinkResolveInput): ResolvedTolariaDeepLink {
  const parsed = parseTolariaDeepLink({ rawUrl })
  if (!parsed.ok) return parsed

  const resolvedVault = resolveVaultForSlug({ slug: parsed.slug, vaults })
  if ('ok' in resolvedVault) return resolvedVault
  return {
    ok: true,
    absolutePath: joinVaultPath(resolvedVault.path, parsed.relativePath),
    relativePath: parsed.relativePath,
    vault: resolvedVault,
  }
}

export function buildTolariaDeepLinkForEntry({
  entry,
  vaultPath,
  vaults,
}: TolariaDeepLinkBuildInput): BuiltTolariaDeepLink {
  const vault = findVaultByPath({ vaultPath, vaults })
  if (!vault) return { ok: false, error: 'unknown_vault' }
  if (vault.available === false) return { ok: false, error: 'unavailable_vault' }

  const relativePath = relativePathForVaultItem({ itemPath: entry.path, vaultPath: vault.path })
  if (!relativePath) return { ok: false, error: 'outside_vault' }
  if (!isSafeVaultRelativePath({ path: relativePath })) return { ok: false, error: 'unsafe_path' }

  const slug = vaultDeepLinkSlug(vault, vaults)
  return {
    ok: true,
    url: `${TOLARIA_DEEP_LINK_SCHEME}://${slug}/${encodeRelativePath({ path: relativePath })}`,
  }
}
