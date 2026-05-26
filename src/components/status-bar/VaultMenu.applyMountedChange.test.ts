import { describe, expect, it, vi } from 'vitest'
import { applyMountedChange } from './vaultMenuMountedChange'
import type { VaultOption } from './types'

function vault(path: string, mounted = true): VaultOption {
  return { label: path, path, alias: path.replace('/', ''), mounted, available: true }
}

interface ChangeOverrides {
  defaultPath?: string
  vaultPath?: string
  path?: string
  mounted?: boolean
  includedVaults?: VaultOption[]
}

function callApply(overrides: ChangeOverrides) {
  const onSetDefaultWorkspace = vi.fn()
  const onSwitchVault = vi.fn()
  const onUpdateWorkspaceIdentity = vi.fn()
  applyMountedChange({
    defaultPath: overrides.defaultPath ?? '/a',
    vaultPath: overrides.vaultPath ?? '/a',
    includedVaults: overrides.includedVaults ?? [vault('/a'), vault('/b')],
    mounted: overrides.mounted ?? false,
    path: overrides.path ?? '/a',
    callbacks: { onSetDefaultWorkspace, onSwitchVault, onUpdateWorkspaceIdentity },
  })
  return { onSetDefaultWorkspace, onSwitchVault, onUpdateWorkspaceIdentity }
}

describe('applyMountedChange', () => {
  it.each([
    {
      name: 'both default and active vault',
      request: { defaultPath: '/a', vaultPath: '/a', path: '/a' },
      expectedDefault: '/b',
      expectedSwitch: '/b',
      expectedIdentity: ['/a', { mounted: false }],
    },
    {
      name: 'active vault only',
      request: { defaultPath: '/b', vaultPath: '/a', path: '/a' },
      expectedDefault: null,
      expectedSwitch: '/b',
      expectedIdentity: ['/a', { mounted: false }],
    },
    {
      name: 'default workspace only',
      request: { defaultPath: '/a', vaultPath: '/b', path: '/a' },
      expectedDefault: '/b',
      expectedSwitch: null,
      expectedIdentity: ['/a', { mounted: false }],
    },
    {
      name: 'neither default nor active vault',
      request: {
        defaultPath: '/a',
        vaultPath: '/a',
        path: '/b',
        includedVaults: [vault('/a'), vault('/b'), vault('/c')],
      },
      expectedDefault: null,
      expectedSwitch: null,
      expectedIdentity: ['/b', { mounted: false }],
    },
  ])('handles unmounting $name', ({ request, expectedDefault, expectedSwitch, expectedIdentity }) => {
    const { onSetDefaultWorkspace, onSwitchVault, onUpdateWorkspaceIdentity } = callApply(request)

    if (expectedDefault) expect(onSetDefaultWorkspace).toHaveBeenCalledWith(expectedDefault)
    else expect(onSetDefaultWorkspace).not.toHaveBeenCalled()
    if (expectedSwitch) expect(onSwitchVault).toHaveBeenCalledWith(expectedSwitch)
    else expect(onSwitchVault).not.toHaveBeenCalled()
    expect(onUpdateWorkspaceIdentity).toHaveBeenCalledWith(...expectedIdentity)
  })

  it('bails out without changing anything when no alternative mounted vault exists', () => {
    const { onSetDefaultWorkspace, onSwitchVault, onUpdateWorkspaceIdentity } = callApply({
      defaultPath: '/a',
      vaultPath: '/a',
      path: '/a',
      includedVaults: [vault('/a')],
    })

    expect(onSetDefaultWorkspace).not.toHaveBeenCalled()
    expect(onSwitchVault).not.toHaveBeenCalled()
    expect(onUpdateWorkspaceIdentity).not.toHaveBeenCalled()
  })

  it('only marks the vault unmounted (no reroute) when remounting', () => {
    const { onSetDefaultWorkspace, onSwitchVault, onUpdateWorkspaceIdentity } = callApply({
      defaultPath: '/a',
      vaultPath: '/a',
      path: '/b',
      mounted: true,
    })

    expect(onSetDefaultWorkspace).not.toHaveBeenCalled()
    expect(onSwitchVault).not.toHaveBeenCalled()
    expect(onUpdateWorkspaceIdentity).toHaveBeenCalledWith('/b', { mounted: true })
  })
})
