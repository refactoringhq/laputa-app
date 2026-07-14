import type { VaultOption } from '../components/status-bar/types'
import type { VaultEntry, WorkspaceIdentity } from '../types'
import { workspaceIdentityFromVault } from '../utils/workspaces'

function isNonBlankPath(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function pathOrEmpty(value: unknown): string {
  return isNonBlankPath(value) ? value : ''
}

function uniqueNonBlankPaths(paths: readonly unknown[]): string[] {
  return [...new Set(paths.filter(isNonBlankPath))]
}

export function uniqueWorkspacePathsFromVaults(vaultPath: string, vaults?: VaultOption[]): string[] {
  const paths = vaults?.length
    ? vaults.map((vault) => vault.path)
    : [vaultPath]
  return uniqueNonBlankPaths(paths)
}

export function workspacePathSetKey(paths: readonly string[]): string {
  return paths.join('\n')
}

function entryWorkspacePath(entry: VaultEntry, fallbackVaultPath: string): string {
  return pathOrEmpty(entry.workspace?.path) || pathOrEmpty(fallbackVaultPath)
}

export function initialVaultsForPath(path: string, vaults?: VaultOption[]): VaultOption[] | undefined {
  if (!vaults?.length) return undefined
  const matchingVaults = vaults.filter((vault) => vault.path === path)
  return matchingVaults.length > 0 ? matchingVaults : undefined
}

function workspacePathsFromEntries(
  entries: VaultEntry[],
  fallbackVaultPath: string,
  inferFallbackWorkspacePath: boolean,
): string[] {
  const paths = new Set<string>()
  for (const entry of entries) {
    const path = inferFallbackWorkspacePath
      ? entryWorkspacePath(entry, fallbackVaultPath)
      : pathOrEmpty(entry.workspace?.path)
    if (path) paths.add(path)
  }
  return [...paths]
}

export function loadedWorkspacePathsFromEntries(
  entries: VaultEntry[],
  fallbackVaultPath: string,
  options: { inferFallbackWorkspacePath?: boolean } = {},
): string[] {
  const inferFallbackWorkspacePath = options.inferFallbackWorkspacePath ?? true
  const paths = workspacePathsFromEntries(entries, fallbackVaultPath, inferFallbackWorkspacePath)
  if (paths.length > 0) return paths
  const fallbackPath = pathOrEmpty(fallbackVaultPath)
  return inferFallbackWorkspacePath && fallbackPath ? [fallbackPath] : []
}

type WorkspaceIdentityMetadataKey =
  | 'label'
  | 'alias'
  | 'shortLabel'
  | 'color'
  | 'icon'
  | 'mounted'
  | 'available'
  | 'defaultForNewNotes'

const WORKSPACE_IDENTITY_METADATA_KEYS: WorkspaceIdentityMetadataKey[] = [
  'label',
  'alias',
  'shortLabel',
  'color',
  'icon',
  'mounted',
  'available',
  'defaultForNewNotes',
]

function workspaceIdentityMetadataMatches(
  current: WorkspaceIdentity | undefined,
  identity: WorkspaceIdentity,
): boolean {
  if (!current) return false
  return WORKSPACE_IDENTITY_METADATA_KEYS.every((key) => current[key] === identity[key])
}

export function retagEntriesForWorkspaceMetadata({
  defaultWorkspacePath,
  entries,
  fallbackVaultPath,
  vaults,
}: {
  defaultWorkspacePath?: string | null
  entries: VaultEntry[]
  fallbackVaultPath: string
  vaults?: VaultOption[]
}): VaultEntry[] {
  if (!vaults?.length) return entries

  const identitiesByPath = new Map(vaults.flatMap((vault) => {
    const path = pathOrEmpty(vault.path)
    return path
      ? [[path, workspaceIdentityFromVault(vault, { defaultWorkspacePath })] as const]
      : []
  }))
  let nextEntries: VaultEntry[] | null = null

  entries.forEach((entry, index) => {
    const identity = identitiesByPath.get(entryWorkspacePath(entry, fallbackVaultPath))
    const nextEntry = identity && !workspaceIdentityMetadataMatches(entry.workspace, identity)
      ? { ...entry, workspace: identity }
      : entry
    if (nextEntry === entry && nextEntries === null) return

    nextEntries ??= entries.slice(0, index)
    nextEntries.push(nextEntry)
  })

  return nextEntries ?? entries
}

export function pruneEntriesOutsideWorkspaceSet({
  desiredPaths,
  entries,
  fallbackVaultPath,
}: {
  desiredPaths: readonly string[]
  entries: VaultEntry[]
  fallbackVaultPath: string
}): VaultEntry[] {
  const desiredPathSet = new Set(uniqueNonBlankPaths(desiredPaths))
  const nextEntries = entries.filter((entry) => desiredPathSet.has(entryWorkspacePath(entry, fallbackVaultPath)))
  return nextEntries.length === entries.length ? entries : nextEntries
}

export function replaceWorkspaceEntries({
  defaultWorkspacePath,
  entries,
  fallbackVaultPath,
  loadedEntries,
  loadedWorkspacePath,
  vaults,
}: {
  defaultWorkspacePath?: string | null
  entries: VaultEntry[]
  fallbackVaultPath: string
  loadedEntries: VaultEntry[]
  loadedWorkspacePath: string
  vaults?: VaultOption[]
}): VaultEntry[] {
  return retagEntriesForWorkspaceMetadata({
    defaultWorkspacePath,
    entries: [
      ...entries.filter((entry) => entryWorkspacePath(entry, fallbackVaultPath) !== loadedWorkspacePath),
      ...loadedEntries,
    ],
    fallbackVaultPath,
    vaults,
  })
}

export function replaceLoadedWorkspaceEntries({
  defaultWorkspacePath,
  entries,
  fallbackVaultPath,
  loadedEntries,
  vaults,
}: {
  defaultWorkspacePath?: string | null
  entries: VaultEntry[]
  fallbackVaultPath: string
  loadedEntries: VaultEntry[]
  vaults?: VaultOption[]
}): VaultEntry[] {
  const loadedPathSet = new Set(loadedWorkspacePathsFromEntries(loadedEntries, fallbackVaultPath))
  return retagEntriesForWorkspaceMetadata({
    defaultWorkspacePath,
    entries: [
      ...entries.filter((entry) => !loadedPathSet.has(entryWorkspacePath(entry, fallbackVaultPath))),
      ...loadedEntries,
    ],
    fallbackVaultPath,
    vaults,
  })
}
