import type { VaultEntry, WorkspaceIdentity } from '../types'
import type { VaultOption } from '../components/status-bar/types'
import { ACCENT_COLOR_PICKER_KEYS } from './typeColors'

export const WORKSPACE_COLORS = ACCENT_COLOR_PICKER_KEYS
export type WorkspaceColor = typeof WORKSPACE_COLORS[number]

interface WorkspaceIdentityOptions {
  defaultWorkspacePath?: string | null
}

interface WorkspaceLabelInput {
  label: string
}

interface WorkspaceGraphOptions<T> {
  defaultVaultPath: string
  enabled: boolean
  vaults: T[]
}

interface WorkspaceSetOptions<T> {
  defaultVaultPath: string
  vaults: T[]
}

interface WritableWorkspaceOptions<T> {
  defaultVaultPath: string
  graphVaults: T[] | undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function slugifyWorkspaceAlias({ label }: WorkspaceLabelInput): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'workspace'
}

export function labelFromWorkspacePath(path: string | null | undefined): string {
  return stringValue(path).split(/[\\/]/).filter(Boolean).pop() || 'Workspace'
}

function shortLabelFromLabel({ label }: WorkspaceLabelInput): string {
  const words = label.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'W'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return words.slice(0, 2).map((word) => word[0].toUpperCase()).join('')
}

function workspaceShortLabelFromVault(vault: Pick<VaultOption, 'shortLabel'>, label: string): string {
  const customShortLabel = stringValue(vault.shortLabel).trim().toUpperCase().slice(0, 3)
  return customShortLabel || shortLabelFromLabel({ label })
}

export function workspaceAliasFromOption(vault: Pick<VaultOption, 'alias' | 'label' | 'path'>): string {
  const alias = stringValue(vault.alias).trim()
  return slugifyWorkspaceAlias({
    label: alias || labelFromWorkspacePath(vault.path),
  })
}

export function workspaceLabelFromVault(vault: Pick<VaultOption, 'label' | 'path'>): string {
  return stringValue(vault.label).trim() || labelFromWorkspacePath(vault.path)
}

export function workspaceIdentityFromVault(
  vault: VaultOption,
  options: WorkspaceIdentityOptions = {},
): WorkspaceIdentity {
  const path = stringValue(vault.path)
  const label = workspaceLabelFromVault(vault)
  const alias = workspaceAliasFromOption({ ...vault, label })
  return {
    id: alias,
    label,
    alias,
    path,
    shortLabel: workspaceShortLabelFromVault(vault, label),
    color: vault.color ?? null,
    icon: vault.icon ?? null,
    mounted: vault.mounted !== false,
    available: vault.available !== false,
    defaultForNewNotes: options.defaultWorkspacePath === path,
  }
}

export function workspaceForEntry(entry: Pick<VaultEntry, 'workspace' | 'path'>): WorkspaceIdentity | null {
  return entry.workspace ?? null
}

export function workspacePathForEntry(entry: Pick<VaultEntry, 'workspace'>): string | undefined {
  return entry.workspace?.path
}

export function vaultPathForEntry(entry: Pick<VaultEntry, 'workspace'>, fallbackVaultPath: string): string {
  return workspacePathForEntry(entry) ?? fallbackVaultPath
}

export function workspaceLabelForEntry(entry: Pick<VaultEntry, 'workspace'>): string | null {
  return entry.workspace?.label ?? null
}

export function workspaceDisplayPrefix(entry: Pick<VaultEntry, 'workspace'>): string | null {
  const workspace = entry.workspace ?? null
  return workspace ? `${workspace.label} / ` : null
}

export function mountedWorkspacePaths(vaults: VaultOption[]): string[] {
  return vaults
    .filter((vault) => vault.available !== false && vault.mounted !== false)
    .map((vault) => vault.path)
}

function uniqueWorkspacePaths(paths: string[]): string[] {
  return [...new Set(paths.filter((path) => path.trim().length > 0))]
}

export function workspacesMountedInGraph<T extends { path: string; available?: boolean; mounted?: boolean; managedDefault?: boolean }>({
  defaultVaultPath,
  vaults,
}: WorkspaceSetOptions<T>): T[] {
  return vaults.filter((vault) => {
    if (vault.path === defaultVaultPath) return true
    return vault.available !== false && vault.mounted !== false
  })
}

export function graphWorkspaceVaults<T extends { path: string; available?: boolean; mounted?: boolean; managedDefault?: boolean }>({
  defaultVaultPath,
  enabled,
  vaults,
}: WorkspaceGraphOptions<T>): T[] | undefined {
  if (!enabled) return undefined
  return workspacesMountedInGraph({ defaultVaultPath, vaults })
}

function shouldLoadGraphWorkspace(vault: { path: string; available?: boolean; managedDefault?: boolean }): boolean {
  if (!vault.path.trim()) return false
  if (vault.available === false) return false
  return true
}

function mountedGraphWorkspace<T extends { path: string }>(vault: T): T & { mounted: true } {
  return { ...vault, mounted: true }
}

export function graphWorkspaceVaultsForLoading<T extends { path: string; available?: boolean; mounted?: boolean; managedDefault?: boolean }>({
  defaultVaultPath,
  enabled,
  vaults,
}: WorkspaceGraphOptions<T>): Array<T & { mounted: true }> | undefined {
  if (!enabled) return undefined
  const byPath = new Map<string, T & { mounted: true }>()
  for (const vault of vaults) {
    if (shouldLoadGraphWorkspace(vault)) {
      byPath.set(vault.path, mountedGraphWorkspace(vault))
    }
  }
  if (defaultVaultPath.trim() && !byPath.has(defaultVaultPath)) {
    byPath.set(defaultVaultPath, { path: defaultVaultPath, mounted: true } as T & { mounted: true })
  }
  return [...byPath.values()]
}

export function visibleWorkspacePaths({
  defaultVaultPath,
  enabled,
  vaults,
}: WorkspaceGraphOptions<VaultOption>): string[] | undefined {
  if (!enabled) return undefined
  return uniqueWorkspacePaths([defaultVaultPath, ...mountedWorkspacePaths(vaults)])
}

export function filterEntriesToVisibleWorkspaces(
  entries: VaultEntry[],
  visiblePaths: readonly string[] | undefined,
): VaultEntry[] {
  if (!visiblePaths) return entries
  const visiblePathSet = new Set(visiblePaths)
  return entries.filter((entry) => {
    const workspacePath = workspacePathForEntry(entry)
    return !workspacePath || visiblePathSet.has(workspacePath)
  })
}

function isWritableWorkspace(workspace: { available?: boolean; mounted?: boolean }): boolean {
  return workspace.available !== false && workspace.mounted !== false
}

export function writableWorkspacePaths<T extends { path: string; available?: boolean; mounted?: boolean }>({
  defaultVaultPath,
  graphVaults,
}: WritableWorkspaceOptions<T>): string[] {
  const workspaces: Array<{ path: string; available?: boolean; mounted?: boolean }> = graphVaults ?? [{ path: defaultVaultPath }]
  return workspaces
    .filter(isWritableWorkspace)
    .map((workspace) => workspace.path)
}
