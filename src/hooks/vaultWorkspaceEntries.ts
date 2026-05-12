import type { VaultOption } from '../components/status-bar/types'
import type { VaultEntry, WorkspaceIdentity } from '../types'
import { workspaceIdentityFromVault } from '../utils/workspaces'

export function uniqueWorkspacePathsFromVaults(vaultPath: string, vaults?: VaultOption[]): string[] {
  const paths = vaults?.length
    ? vaults.map((vault) => vault.path)
    : [vaultPath]
  return [...new Set(paths.filter((path) => path.trim().length > 0))]
}

export function workspacePathSetKey(paths: readonly string[]): string {
  return paths.join('\n')
}

function entryWorkspacePath(entry: VaultEntry, fallbackVaultPath: string): string {
  return entry.workspace?.path ?? fallbackVaultPath
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
      : entry.workspace?.path ?? ''
    if (path.trim()) paths.add(path)
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
  return inferFallbackWorkspacePath && fallbackVaultPath.trim() ? [fallbackVaultPath] : []
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

  const identitiesByPath = new Map(vaults.map((vault) => [
    vault.path,
    workspaceIdentityFromVault(vault, { defaultWorkspacePath }),
  ]))
  let changed = false
  const nextEntries = entries.map((entry) => {
    const identity = identitiesByPath.get(entryWorkspacePath(entry, fallbackVaultPath))
    if (!identity) return entry
    if (workspaceIdentityMetadataMatches(entry.workspace, identity)) return entry
    changed = true
    return { ...entry, workspace: identity }
  })

  return changed ? nextEntries : entries
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
  const desiredPathSet = new Set(desiredPaths)
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
