import { describe, expect, it } from 'vitest'
import type { VaultOption } from '../components/status-bar/types'
import type { VaultEntry } from '../types'
import {
  filterEntriesToVisibleWorkspaces,
  graphWorkspaceVaults,
  graphWorkspaceVaultsForLoading,
  vaultPathForEntry,
  visibleWorkspacePaths,
  workspaceIdentityFromVault,
  writableWorkspacePaths,
} from './workspaces'

const vaults: VaultOption[] = [
  { label: 'Personal', path: '/personal', alias: 'personal', available: true, mounted: true },
  { label: 'Team', path: '/team', alias: 'team', available: true, mounted: true },
]

function vaultsWithMalformedPath(): VaultOption[] {
  return [
    vaults[0],
    { label: 'Missing', path: null },
    vaults[1],
  ] as unknown as VaultOption[]
}

describe('graphWorkspaceVaults', () => {
  it('keeps the graph single-workspace until multiple workspaces are enabled', () => {
    expect(graphWorkspaceVaults({
      defaultVaultPath: '/personal',
      enabled: false,
      vaults,
    })).toBeUndefined()
  })

  it('returns mounted workspaces when multiple workspaces are enabled', () => {
    expect(graphWorkspaceVaults({
      defaultVaultPath: '/personal',
      enabled: true,
      vaults,
    })?.map((vault) => vault.path)).toEqual([
      '/personal',
      '/team',
    ])
  })

  it('includes managed default workspaces when they are mounted', () => {
    expect(graphWorkspaceVaults({
      defaultVaultPath: '/team',
      enabled: true,
      vaults: [
        { ...vaults[0], managedDefault: true },
        vaults[1],
      ],
    })?.map((vault) => vault.path)).toEqual([
      '/personal',
      '/team',
    ])
  })
})

describe('workspaceIdentityFromVault', () => {
  it('falls back to the path name when native omits a vault label', () => {
    const workspace = workspaceIdentityFromVault({
      path: '/Users/luca/Workspace/laputa',
    } as VaultOption)

    expect(workspace.label).toBe('laputa')
    expect(workspace.alias).toBe('laputa')
    expect(workspace.shortLabel).toBe('LA')
  })

  it('keeps the slug path-derived when the display name changes', () => {
    const workspace = workspaceIdentityFromVault({
      label: 'Personal Main',
      path: '/Users/luca/Workspace/laputa',
    } as VaultOption)

    expect(workspace.label).toBe('Personal Main')
    expect(workspace.alias).toBe('laputa')
  })

  it('uses a custom short label when one is configured', () => {
    const workspace = workspaceIdentityFromVault({
      label: 'Personal Notes',
      path: '/personal',
      shortLabel: 'pxl-extra',
    } as VaultOption)

    expect(workspace.shortLabel).toBe('PXL')
  })
})

describe('graphWorkspaceVaultsForLoading', () => {
  it('loads all available workspaces once multiple workspaces are enabled', () => {
    const loadingVaults = graphWorkspaceVaultsForLoading({
      defaultVaultPath: '/personal',
      enabled: true,
      vaults: [
        vaults[0],
        { ...vaults[1], mounted: false },
        { label: 'Missing', path: '/missing', available: false, mounted: true },
      ],
    })

    expect(loadingVaults?.map((vault) => [vault.path, vault.mounted])).toEqual([
      ['/personal', true],
      ['/team', true],
    ])
  })

  it('loads managed default workspaces so toggles can reveal them instantly', () => {
    const loadingVaults = graphWorkspaceVaultsForLoading({
      defaultVaultPath: '/team',
      enabled: true,
      vaults: [
        { ...vaults[0], managedDefault: true },
        vaults[1],
      ],
    })

    expect(loadingVaults?.map((vault) => vault.path)).toEqual(['/personal', '/team'])
  })

  it('keeps the graph single-workspace until multiple workspaces are enabled', () => {
    expect(graphWorkspaceVaultsForLoading({
      defaultVaultPath: '/personal',
      enabled: false,
      vaults,
    })).toBeUndefined()
  })

  it('skips malformed configured workspace paths while loading the graph', () => {
    const loadingVaults = graphWorkspaceVaultsForLoading({
      defaultVaultPath: '/personal',
      enabled: true,
      vaults: vaultsWithMalformedPath(),
    })

    expect(loadingVaults?.map((vault) => vault.path)).toEqual(['/personal', '/team'])
  })
})

describe('visibleWorkspacePaths', () => {
  it('keeps the active workspace visible even if its stored toggle is off', () => {
    expect(visibleWorkspacePaths({
      defaultVaultPath: '/personal',
      enabled: true,
      vaults: [
        { ...vaults[0], mounted: false },
        { ...vaults[1], mounted: false },
      ],
    })).toEqual(['/personal'])
  })

  it('returns undefined while multiple workspaces are disabled', () => {
    expect(visibleWorkspacePaths({
      defaultVaultPath: '/personal',
      enabled: false,
      vaults,
    })).toBeUndefined()
  })

  it('ignores malformed configured workspace paths when filtering visible workspaces', () => {
    expect(visibleWorkspacePaths({
      defaultVaultPath: '/personal',
      enabled: true,
      vaults: vaultsWithMalformedPath(),
    })).toEqual(['/personal', '/team'])
  })
})

describe('filterEntriesToVisibleWorkspaces', () => {
  const entries = [
    { path: '/personal/a.md', workspace: { path: '/personal' } },
    { path: '/team/b.md', workspace: { path: '/team' } },
    { path: '/legacy/c.md' },
  ] as VaultEntry[]

  it('filters workspace-backed entries to the selected visible paths', () => {
    expect(filterEntriesToVisibleWorkspaces(entries, ['/personal']).map((entry) => entry.path)).toEqual([
      '/personal/a.md',
      '/legacy/c.md',
    ])
  })

  it('returns all entries when no workspace visibility filter is active', () => {
    expect(filterEntriesToVisibleWorkspaces(entries, undefined)).toBe(entries)
  })
})

describe('vaultPathForEntry', () => {
  it('uses the entry workspace before falling back to the active vault', () => {
    expect(vaultPathForEntry({ workspace: { path: '/team' } } as VaultEntry, '/personal')).toBe('/team')
    expect(vaultPathForEntry({ workspace: null } as VaultEntry, '/personal')).toBe('/personal')
  })
})

describe('writableWorkspacePaths', () => {
  it('falls back to the active path when multiple workspaces are disabled', () => {
    expect(writableWorkspacePaths({
      defaultVaultPath: '/personal',
      graphVaults: undefined,
    })).toEqual(['/personal'])
  })

  it('excludes unavailable and explicitly unmounted graph workspaces', () => {
    expect(writableWorkspacePaths({
      defaultVaultPath: '/personal',
      graphVaults: [
        vaults[0],
        { ...vaults[1], mounted: false },
        { label: 'Archive', path: '/archive', available: false },
      ],
    })).toEqual(['/personal'])
  })

  it('ignores malformed writable workspace paths', () => {
    expect(writableWorkspacePaths({
      defaultVaultPath: '/personal',
      graphVaults: vaultsWithMalformedPath(),
    })).toEqual(['/personal', '/team'])
  })
})
