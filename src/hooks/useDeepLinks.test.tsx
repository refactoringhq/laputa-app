import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauri } from '../mock-tauri'
import { useDeepLinks } from './useDeepLinks'
import type { VaultEntry } from '../types'
import type { DeepLinkVault } from '../utils/deepLinks'

const { getCurrent, onOpenUrl } = vi.hoisted(() => ({
  getCurrent: vi.fn(),
  onOpenUrl: vi.fn(),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
  getCurrent,
  onOpenUrl,
}))

const personalVault: DeepLinkVault = { label: 'Personal', path: '/personal' }
const teamVault: DeepLinkVault = { label: 'Team', path: '/team' }

class BroadcastChannelMock {
  static channels: BroadcastChannelMock[] = []

  onmessage: ((event: MessageEvent<unknown>) => void) | null = null

  constructor(readonly name: string) {
    BroadcastChannelMock.channels.push(this)
  }

  close() {
    BroadcastChannelMock.channels = BroadcastChannelMock.channels.filter((channel) => channel !== this)
  }

  postMessage(message: unknown) {
    for (const channel of BroadcastChannelMock.channels) {
      if (channel === this || channel.name !== this.name) continue
      channel.onmessage?.(new MessageEvent('message', { data: message }))
    }
  }
}

function makeEntry(path: string, vault: DeepLinkVault, title = 'Note'): VaultEntry {
  return {
    path,
    filename: path.split('/').at(-1) ?? 'note.md',
    title,
    workspace: {
      id: vault.label?.toLowerCase() ?? 'vault',
      label: vault.label ?? 'Vault',
      alias: vault.label?.toLowerCase() ?? 'vault',
      path: vault.path,
      shortLabel: vault.label?.slice(0, 2).toUpperCase() ?? 'VA',
      color: null,
      icon: null,
      mounted: true,
      available: true,
      defaultForNewNotes: false,
    },
  } as VaultEntry
}

function renderDeepLinks(overrides: Partial<Parameters<typeof useDeepLinks>[0]> = {}) {
  return renderHook(() => useDeepLinks({
    activeEntry: null,
    currentVaultPath: personalVault.path,
    enabled: true,
    entries: [] as VaultEntry[],
    isVaultContentLoading: false,
    onSelectNote: vi.fn(),
    onSwitchVault: vi.fn(),
    reloadVault: vi.fn().mockResolvedValue([]),
    setToastMessage: vi.fn(),
    vaultListLoaded: true,
    vaults: [personalVault],
    ...overrides,
  }))
}

function waitForDeepLinkFallback() {
  return new Promise((resolve) => window.setTimeout(resolve, 300))
}

describe('useDeepLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
    getCurrent.mockResolvedValue(null)
    onOpenUrl.mockResolvedValue(vi.fn())
    BroadcastChannelMock.channels = []
    vi.stubGlobal('BroadcastChannel', BroadcastChannelMock)
    vi.spyOn(window, 'focus').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('swallows stale native deep-link unlisten failures on unmount', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    const stopListening = vi.fn(() => {
      throw new TypeError("undefined is not an object (evaluating 'listeners[eventId].handlerId')")
    })
    onOpenUrl.mockResolvedValue(stopListening)

    const { unmount } = renderDeepLinks()

    await waitFor(() => expect(onOpenUrl).toHaveBeenCalledOnce())

    expect(() => unmount()).not.toThrow()
    await waitFor(() => expect(stopListening).toHaveBeenCalledOnce())
  })

  it('routes deep links to the already-open vault window that owns the target vault', async () => {
    const personalSwitchVault = vi.fn()
    const teamEntry = makeEntry('/team/notes/roadmap.md', teamVault, 'Roadmap')
    const teamSelectNote = vi.fn()
    const vaults = [personalVault, teamVault]

    const personal = renderDeepLinks({
      currentVaultPath: personalVault.path,
      onSwitchVault: personalSwitchVault,
      vaults,
    })
    renderDeepLinks({
      currentVaultPath: teamVault.path,
      entries: [teamEntry],
      onSelectNote: teamSelectNote,
      vaults,
    })

    act(() => {
      personal.result.current.openDeepLink('tolaria://team/notes/roadmap.md')
    })

    await waitFor(() => expect(teamSelectNote).toHaveBeenCalledWith(teamEntry))
    await waitForDeepLinkFallback()
    expect(personalSwitchVault).not.toHaveBeenCalled()
  })

  it('falls back to switching vaults when no matching window claims the deep link', async () => {
    const switchVault = vi.fn()

    const { result } = renderDeepLinks({
      currentVaultPath: personalVault.path,
      onSwitchVault: switchVault,
      vaults: [personalVault, teamVault],
    })

    act(() => {
      result.current.openDeepLink('tolaria://team/notes/roadmap.md')
    })

    await waitFor(() => expect(switchVault).toHaveBeenCalledWith(teamVault.path), { timeout: 1_000 })
  })
})
