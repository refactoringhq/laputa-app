import { useCallback, useMemo } from 'react'
import type { VaultOption } from './types'
import { applyMountedChange } from './vaultMenuMountedChange'
import type { MountToggleRequest, VaultMenuInteractionOptions, VaultPathSelection } from './vaultMenuTypes'

function isIncludedVault(vault: VaultOption, defaultPath: string): boolean {
  return vault.available !== false && (vault.path === defaultPath || vault.mounted !== false)
}

export function useIncludedVaults(vaults: VaultOption[], defaultPath: string): VaultOption[] {
  return useMemo(() => vaults.filter((vault) => isIncludedVault(vault, defaultPath)), [defaultPath, vaults])
}

function shouldDisableMountToggle(request: MountToggleRequest): boolean {
  const { canSetDefaultWorkspace, defaultPath, includedVaultCount, isMounted, path } = request
  return path === defaultPath && isMounted && (includedVaultCount <= 1 || !canSetDefaultWorkspace)
}

function selectVaultPath(selection: VaultPathSelection): void {
  const { path, multiWorkspaceEnabled, onSetDefaultWorkspace, onSwitchVault, setOpen } = selection
  if (multiWorkspaceEnabled && onSetDefaultWorkspace) onSetDefaultWorkspace(path)
  else onSwitchVault(path)
  setOpen(false)
}

function useDisableMountToggle(options: VaultMenuInteractionOptions) {
  const { defaultPath, includedVaults, onSetDefaultWorkspace } = options
  return useCallback(
    (path: string) => shouldDisableMountToggle({
      canSetDefaultWorkspace: !!onSetDefaultWorkspace,
      defaultPath,
      includedVaultCount: includedVaults.length,
      isMounted: includedVaults.find((vault) => vault.path === path)?.mounted !== false,
      path,
    }),
    [defaultPath, includedVaults, onSetDefaultWorkspace],
  )
}

function useSelectVault(options: VaultMenuInteractionOptions) {
  const {
    defaultPath,
    includedVaults,
    multiWorkspaceEnabled,
    onSetDefaultWorkspace,
    onSwitchVault,
    onUpdateWorkspaceIdentity,
    setOpen,
    vaultPath,
  } = options
  return useCallback(
    (path: string) => selectVaultPath({
      defaultPath,
      includedVaults,
      multiWorkspaceEnabled,
      onSetDefaultWorkspace,
      onSwitchVault,
      onUpdateWorkspaceIdentity,
      path,
      setOpen,
      vaultPath,
    }),
    [
      defaultPath,
      includedVaults,
      multiWorkspaceEnabled,
      onSetDefaultWorkspace,
      onSwitchVault,
      onUpdateWorkspaceIdentity,
      setOpen,
      vaultPath,
    ],
  )
}

function useMountedChange(options: VaultMenuInteractionOptions) {
  const {
    defaultPath,
    includedVaults,
    onSetDefaultWorkspace,
    onSwitchVault,
    onUpdateWorkspaceIdentity,
    vaultPath,
  } = options
  return useCallback(
    (path: string, mounted: boolean) => applyMountedChange({
      defaultPath,
      vaultPath,
      includedVaults,
      mounted,
      path,
      callbacks: { onSetDefaultWorkspace, onSwitchVault, onUpdateWorkspaceIdentity },
    }),
    [defaultPath, includedVaults, onSetDefaultWorkspace, onSwitchVault, onUpdateWorkspaceIdentity, vaultPath],
  )
}

export function useVaultMenuInteractions(options: VaultMenuInteractionOptions) {
  return {
    disableMountToggleForPath: useDisableMountToggle(options),
    handleMountedChange: useMountedChange(options),
    handleSelectVault: useSelectVault(options),
  }
}
