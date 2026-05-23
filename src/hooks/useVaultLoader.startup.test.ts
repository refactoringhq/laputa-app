import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultOption } from '../components/status-bar/types'
import type { VaultEntry } from '../types'
import { useVaultLoader } from './useVaultLoader'

const backendInvokeFn = vi.fn()
let mockIsTauri = true
const ACTIVE_VAULT_PATH = '/laputa'
const EMPTY_ARRAY_COMMANDS = new Set(['get_modified_files', 'list_vault_folders', 'list_views'])

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => backendInvokeFn(...args),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => mockIsTauri,
  mockInvoke: (command: string, args?: Record<string, unknown>) => backendInvokeFn(command, args),
}))

function makeEntry(): VaultEntry {
  return {
    path: `${ACTIVE_VAULT_PATH}/note/recovered.md`,
    filename: 'recovered.md',
    title: 'Recovered',
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: 'Active',
    archived: false,
    modifiedAt: 1,
    createdAt: 1,
    fileSize: 100,
    snippet: '',
    wordCount: 0,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    sidebarLabel: null,
    template: null,
    sort: null,
    view: null,
    visible: null,
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    outgoingLinks: [],
    properties: {},
    hasH1: true,
    fileKind: 'markdown',
  }
}

function commandPath(args?: Record<string, unknown>): string {
  return typeof args?.path === 'string' ? args.path : ''
}

function buildUpgradeStartupMock() {
  let activeReloads = 0

  return {
    activeReloadCount: () => activeReloads,
    invoke: (command: string, args?: Record<string, unknown>) => {
      if (command === 'reload_vault') {
        if (commandPath(args) !== ACTIVE_VAULT_PATH) return Promise.resolve([])
        activeReloads += 1
        return Promise.resolve(activeReloads === 1 ? [] : [makeEntry()])
      }
      if (EMPTY_ARRAY_COMMANDS.has(command)) return Promise.resolve([])
      return Promise.resolve(null)
    },
  }
}

describe('useVaultLoader startup recovery', () => {
  beforeEach(() => {
    mockIsTauri = true
    backendInvokeFn.mockReset()
  })

  it('freshly reloads the active workspace when persisted metadata follows an empty startup scan', async () => {
    const laputa: VaultOption = { label: 'Laputa', path: ACTIVE_VAULT_PATH, available: true, mounted: true }
    const startupMock = buildUpgradeStartupMock()
    backendInvokeFn.mockImplementation(startupMock.invoke)

    const { result, rerender } = renderHook(
      ({ vaults }: { vaults?: VaultOption[] }) => useVaultLoader(ACTIVE_VAULT_PATH, vaults, ACTIVE_VAULT_PATH, vaults),
      { initialProps: { vaults: undefined } },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.entries).toEqual([])

    rerender({ vaults: [laputa] })

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.title)).toEqual(['Recovered'])
    })
    expect(startupMock.activeReloadCount()).toBeGreaterThanOrEqual(2)
  })
})
