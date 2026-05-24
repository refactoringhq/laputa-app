import type { VaultEntry, WorkspaceIdentity } from '../types'

const NO_WORKSPACE_KEY = '__tolaria_no_workspace__'

export type TypeVisibilityLookup = Record<string, Record<string, boolean>>

function isMarkdown(entry: VaultEntry): boolean {
  return entry.fileKind === 'markdown' || !entry.fileKind
}

function typeKey(type: string): string {
  return type.trim().toLowerCase()
}

function workspaceKey(path?: string | null): string {
  return path?.trim() || NO_WORKSPACE_KEY
}

function entryWorkspaceKey(entry: Pick<VaultEntry, 'workspace'>): string {
  return workspaceKey(entry.workspace?.path)
}

function isActiveTypeDefinition(entry: VaultEntry): boolean {
  return isMarkdown(entry) && entry.isA === 'Type' && !entry.archived
}

export function buildTypeVisibilityLookup(entries: VaultEntry[]): TypeVisibilityLookup {
  const lookup: TypeVisibilityLookup = {}
  for (const entry of entries) {
    if (!isActiveTypeDefinition(entry)) continue
    const key = typeKey(entry.title)
    if (!key) continue
    lookup[key] = lookup[key] ?? {}
    lookup[key][entryWorkspaceKey(entry)] = entry.visible !== false
  }
  return lookup
}

export function isTypeVisibleInWorkspace(
  lookup: TypeVisibilityLookup,
  type: string,
  workspacePath?: string | null,
): boolean {
  const typeLookup = lookup[typeKey(type)]
  if (!typeLookup) return true
  const visible = typeLookup[workspaceKey(workspacePath)]
  return visible !== false
}

export function isSectionEntryVisibleForType(
  entry: VaultEntry,
  type: string,
  lookup: TypeVisibilityLookup,
): boolean {
  if (!isMarkdown(entry) || entry.isA !== type) return false
  return isTypeVisibleInWorkspace(lookup, type, entry.workspace?.path)
}

function isMatchingTypeDefinition(entry: VaultEntry, type: string): boolean {
  return isActiveTypeDefinition(entry) && typeKey(entry.title) === typeKey(type)
}

export function isTypeSectionVisible(
  entries: VaultEntry[],
  type: string,
  lookup: TypeVisibilityLookup = buildTypeVisibilityLookup(entries),
): boolean {
  let hasMatchingTypeDefinition = false

  for (const entry of entries) {
    if (isSectionEntryVisibleForType(entry, type, lookup)) return true
    if (!isMatchingTypeDefinition(entry, type)) continue
    hasMatchingTypeDefinition = true
    if (isTypeVisibleInWorkspace(lookup, type, entry.workspace?.path)) return true
  }

  return !hasMatchingTypeDefinition
}

function workspaceOrderIndex(workspace: WorkspaceIdentity, orderedWorkspacePaths: readonly string[]): number {
  const index = orderedWorkspacePaths.indexOf(workspace.path)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

export function collectTypeVisibilityWorkspaces(
  entries: VaultEntry[],
  orderedWorkspacePaths: readonly string[] = [],
): WorkspaceIdentity[] {
  const workspacesByPath = new Map<string, WorkspaceIdentity>()
  for (const entry of entries) {
    const workspace = entry.workspace
    if (!workspace || workspacesByPath.has(workspace.path)) continue
    workspacesByPath.set(workspace.path, workspace)
  }
  return [...workspacesByPath.values()].sort((a, b) => (
    workspaceOrderIndex(a, orderedWorkspacePaths) - workspaceOrderIndex(b, orderedWorkspacePaths)
  ))
}

export function findTypeDefinitionForWorkspace(
  entries: VaultEntry[],
  type: string,
  workspacePath: string,
): VaultEntry | null {
  const key = typeKey(type)
  return entries.find((entry) => (
    isMatchingTypeDefinition(entry, key)
      && entry.workspace?.path === workspacePath
  )) ?? null
}
