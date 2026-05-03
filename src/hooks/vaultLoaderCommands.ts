import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { FolderNode, GitPushResult, VaultEntry, ViewFile } from '../types'
import { normalizeVaultEntries, normalizeViewFiles } from '../utils/vaultMetadataNormalization'

interface TauriCallOptions {
  command: string
  tauriArgs: Record<string, unknown>
  mockArgs?: Record<string, unknown>
}

interface VaultPathOptions {
  vaultPath: string
}

interface CommitWithPushOptions extends VaultPathOptions {
  message: string
}

interface LoadedVaultData {
  entries: VaultEntry[]
}

interface LoadedVaultChrome {
  folders: FolderNode[]
  views: ViewFile[]
}

export function hasVaultPath({ vaultPath }: VaultPathOptions): boolean {
  return vaultPath.trim().length > 0
}

export function tauriCall<T>({ command, tauriArgs, mockArgs }: TauriCallOptions): Promise<T> {
  return isTauri() ? invoke<T>(command, tauriArgs) : mockInvoke<T>(command, mockArgs ?? tauriArgs)
}

export async function checkVaultPathAvailability({ vaultPath }: VaultPathOptions): Promise<boolean | null> {
  if (!hasVaultPath({ vaultPath })) return false

  try {
    return await tauriCall<boolean>({
      command: 'check_vault_exists',
      tauriArgs: { path: vaultPath },
    })
  } catch {
    return null
  }
}

function loadVaultEntriesWithCommand({ vaultPath, command }: VaultPathOptions & { command: string }): Promise<VaultEntry[]> {
  return tauriCall<unknown>({ command, tauriArgs: { path: vaultPath } })
    .then((entries) => normalizeVaultEntries(entries, vaultPath))
}

function loadVaultEntries({ vaultPath }: VaultPathOptions): Promise<VaultEntry[]> {
  const command = isTauri() ? 'reload_vault' : 'list_vault'
  return loadVaultEntriesWithCommand({ vaultPath, command })
}

export function reloadVaultEntries({ vaultPath }: VaultPathOptions): Promise<VaultEntry[]> {
  return loadVaultEntriesWithCommand({ vaultPath, command: 'reload_vault' })
}

export function loadVaultFolders({ vaultPath }: VaultPathOptions): Promise<FolderNode[]> {
  return tauriCall<FolderNode[]>({ command: 'list_vault_folders', tauriArgs: { path: vaultPath } })
}

export function loadVaultViews({ vaultPath }: VaultPathOptions): Promise<ViewFile[]> {
  return tauriCall<unknown>({ command: 'list_views', tauriArgs: { vaultPath } })
    .then(normalizeViewFiles)
}

export async function loadVaultData({ vaultPath }: VaultPathOptions): Promise<LoadedVaultData> {
  if (!isTauri()) console.info('[mock] Using mock Tauri data for browser testing')
  const entries = await loadVaultEntries({ vaultPath })
  console.log(`Vault scan complete: ${entries.length} entries found`)
  return { entries }
}

export async function loadVaultChrome({ vaultPath }: VaultPathOptions): Promise<LoadedVaultChrome> {
  const [folders, views] = await Promise.all([
    loadVaultFolders({ vaultPath }).catch(() => [] as FolderNode[]),
    loadVaultViews({ vaultPath }).catch(() => [] as ViewFile[]),
  ])

  return {
    folders: folders ?? [],
    views: views ?? [],
  }
}

export async function commitWithPush({ vaultPath, message }: CommitWithPushOptions): Promise<GitPushResult> {
  if (!isTauri()) {
    await mockInvoke<string>('git_commit', { message })
    return mockInvoke<GitPushResult>('git_push', {})
  }
  await invoke<string>('git_commit', { vaultPath, message })
  return invoke<GitPushResult>('git_push', { vaultPath })
}
