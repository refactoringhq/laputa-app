import type { VaultOption } from './types'

export interface VaultMountChangeCallbacks {
  onSetDefaultWorkspace?: (path: string) => void
  onSwitchVault: (path: string) => void
  onUpdateWorkspaceIdentity?: (path: string, patch: Partial<VaultOption>) => void
}

export interface VaultMountChangeRequest {
  defaultPath: string
  vaultPath: string
  includedVaults: VaultOption[]
  mounted: boolean
  path: string
  callbacks: VaultMountChangeCallbacks
}

function nextIncludedVaultPath(includedVaults: VaultOption[], currentPath: string): string | null {
  return includedVaults.find((vault) => vault.path !== currentPath)?.path ?? null
}

function isCurrentPathUnmount(request: VaultMountChangeRequest): boolean {
  if (request.mounted) return false
  if (request.path === request.defaultPath) return true
  return request.path === request.vaultPath
}

function rerouteUnmountedPath(request: VaultMountChangeRequest): boolean {
  const nextPath = nextIncludedVaultPath(request.includedVaults, request.path)
  if (!nextPath) return false
  if (request.path === request.defaultPath) request.callbacks.onSetDefaultWorkspace?.(nextPath)
  if (request.path === request.vaultPath) request.callbacks.onSwitchVault(nextPath)
  return true
}

export function applyMountedChange({
  defaultPath,
  vaultPath,
  includedVaults,
  mounted,
  path,
  callbacks,
}: VaultMountChangeRequest): void {
  const request = { defaultPath, vaultPath, includedVaults, mounted, path, callbacks }
  if (isCurrentPathUnmount(request) && !rerouteUnmountedPath(request)) return
  callbacks.onUpdateWorkspaceIdentity?.(path, { mounted })
}
