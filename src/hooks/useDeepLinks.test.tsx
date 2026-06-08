import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauri } from '../mock-tauri'
import { useDeepLinks } from './useDeepLinks'
import type { VaultEntry } from '../types'

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

function renderDeepLinks() {
  return renderHook(() => useDeepLinks({
    activeEntry: null,
    currentVaultPath: '/vault',
    enabled: true,
    entries: [] as VaultEntry[],
    isVaultContentLoading: false,
    onSelectNote: vi.fn(),
    onSwitchVault: vi.fn(),
    reloadVault: vi.fn().mockResolvedValue([]),
    setToastMessage: vi.fn(),
    vaultListLoaded: true,
    vaults: [{ label: 'Vault', path: '/vault' }],
  }))
}

describe('useDeepLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
    getCurrent.mockResolvedValue(null)
    onOpenUrl.mockResolvedValue(vi.fn())
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
})
