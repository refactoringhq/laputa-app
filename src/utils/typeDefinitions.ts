import type { VaultEntry } from '../types'

const NO_WORKSPACE_KEY = '__tolaria_no_workspace__'

interface TypeNameQuery {
  type: string
}

interface WorkspacePathQuery {
  path?: string | null
}

interface TypeDefinitionLookup {
  entries: VaultEntry[]
  type: string
  typeEntryPath?: string
}

interface WorkspaceTypeDefinitionLookup {
  entries: VaultEntry[]
  type: string
  workspacePath: string
}

export function normalizeTypeName({ type }: TypeNameQuery): string {
  return type.trim().toLowerCase()
}

export function typeWorkspaceKey({ path }: WorkspacePathQuery): string {
  return path?.trim() || NO_WORKSPACE_KEY
}

export function entryTypeWorkspaceKey(entry: Pick<VaultEntry, 'workspace'>): string {
  return typeWorkspaceKey({ path: entry.workspace?.path })
}

export function isMarkdownEntry(entry: Pick<VaultEntry, 'fileKind'>): boolean {
  return entry.fileKind === 'markdown' || !entry.fileKind
}

export function isActiveTypeDefinition(entry: VaultEntry): boolean {
  return isMarkdownEntry(entry) && entry.isA === 'Type' && !entry.archived
}

export function isTypeDefinitionForName(entry: VaultEntry, query: TypeNameQuery): boolean {
  return isActiveTypeDefinition(entry) && normalizeTypeName({ type: entry.title }) === normalizeTypeName(query)
}

export function findTypeDefinition({
  entries,
  type,
  typeEntryPath,
}: TypeDefinitionLookup): VaultEntry | null {
  if (typeEntryPath) {
    const entry = entries.find((candidate) => candidate.path === typeEntryPath)
    return entry && isActiveTypeDefinition(entry) ? entry : null
  }
  const key = normalizeTypeName({ type })
  if (!key) return null
  return entries.find((entry) => isTypeDefinitionForName(entry, { type: key })) ?? null
}

export function findTypeDefinitionForWorkspace({
  entries,
  type,
  workspacePath,
}: WorkspaceTypeDefinitionLookup): VaultEntry | null {
  const key = normalizeTypeName({ type })
  if (!key) return null
  return entries.find((entry) => (
    isTypeDefinitionForName(entry, { type: key })
      && entry.workspace?.path === workspacePath
  )) ?? null
}
