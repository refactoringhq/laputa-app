import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatchMenuEvent, useMenuEvents, type MenuEventHandlers } from './useMenuEvents'

const isTauriMock = vi.fn(() => false)
const listenMock = vi.fn()
const invokeMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../mock-tauri', () => ({
  isTauri: () => isTauriMock(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

function makeHandlers(): MenuEventHandlers {
  return {
    onSetViewMode: vi.fn(),
    onCreateNote: vi.fn(),
    onCreateType: vi.fn(),
    onQuickOpen: vi.fn(),
    onSave: vi.fn(),
    onOpenSettings: vi.fn(),
    onToggleInspector: vi.fn(),
    onCommandPalette: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
    onToggleOrganized: vi.fn(),
    onArchiveNote: vi.fn(),
    onDeleteNote: vi.fn(),
    onSearch: vi.fn(),
    onToggleRawEditor: vi.fn(),
    onToggleDiff: vi.fn(),
    onToggleAIChat: vi.fn(),
    onPastePlainText: vi.fn(),
    onGoBack: vi.fn(),
    onGoForward: vi.fn(),
    onCheckForUpdates: vi.fn(),
    onSelectFilter: vi.fn(),
    onOpenVault: vi.fn(),
    onRemoveActiveVault: vi.fn(),
    onRestoreGettingStarted: vi.fn(),
    onAddRemote: vi.fn(),
    onCommitPush: vi.fn(),
    onPull: vi.fn(),
    onResolveConflicts: vi.fn(),
    onViewChanges: vi.fn(),
    onInstallMcp: vi.fn(),
    onReloadVault: vi.fn(),
    onOpenInNewWindow: vi.fn(),
    onRestoreDeletedNote: vi.fn(),
    activeTabPathRef: { current: '/vault/test.md' } as React.MutableRefObject<string | null>,
    multiSelectionCommandRef: { current: null },
    activeTabPath: '/vault/test.md',
    hasRestorableDeletedNote: false,
    hasNoRemote: false,
  }
}

describe('useMenuEvents note-list search bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isTauriMock.mockReturnValue(false)
  })

  it('dispatches the note-list search toggle event for the native Cmd+F menu item', () => {
    const listener = vi.fn()
    window.addEventListener('laputa:toggle-note-list-search', listener)

    dispatchMenuEvent('edit-toggle-note-list-search', makeHandlers())

    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener('laputa:toggle-note-list-search', listener)
  })

  it('syncs note-list search availability into the native menu state', async () => {
    isTauriMock.mockReturnValue(true)
    listenMock.mockResolvedValue(vi.fn())

    renderHook(() => useMenuEvents(makeHandlers()))
    await vi.dynamicImportSettled()

    expect(invokeMock).toHaveBeenCalledWith('update_menu_state', expect.objectContaining({
      state: expect.objectContaining({ noteListSearchEnabled: false }),
    }))

    act(() => {
      window.dispatchEvent(new CustomEvent('laputa:note-list-search-availability', {
        detail: { enabled: true },
      }))
    })

    await waitFor(() => {
      expect(invokeMock).toHaveBeenLastCalledWith('update_menu_state', expect.objectContaining({
        state: expect.objectContaining({ noteListSearchEnabled: true }),
      }))
    })
  })
})
