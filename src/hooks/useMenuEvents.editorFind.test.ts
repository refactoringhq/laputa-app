import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMenuEvents, type MenuEventHandlers } from './useMenuEvents'

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
    activeTabPath: '/vault/a.md',
    activeTabPathRef: { current: '/vault/a.md' },
    hasNoRemote: false,
    hasRestorableDeletedNote: false,
    multiSelectionCommandRef: { current: null },
    onArchiveNote: vi.fn(),
    onCommandPalette: vi.fn(),
    onCreateNote: vi.fn(),
    onDeleteNote: vi.fn(),
    onFindInNote: vi.fn(),
    onOpenSettings: vi.fn(),
    onQuickOpen: vi.fn(),
    onReplaceInNote: vi.fn(),
    onSave: vi.fn(),
    onSearch: vi.fn(),
    onSetViewMode: vi.fn(),
    onToggleInspector: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
  }
}

describe('useMenuEvents editor find state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isTauriMock.mockReturnValue(true)
    listenMock.mockResolvedValue(vi.fn())
  })

  it('syncs editor find availability into the native menu state', async () => {
    renderHook(() => useMenuEvents(makeHandlers()))
    await vi.dynamicImportSettled()

    expect(invokeMock).toHaveBeenCalledWith('update_menu_state', expect.objectContaining({
      state: expect.objectContaining({ editorFindEnabled: false }),
    }))

    act(() => {
      window.dispatchEvent(new CustomEvent('laputa:editor-find-availability', {
        detail: { enabled: true },
      }))
    })

    await waitFor(() => {
      expect(invokeMock).toHaveBeenLastCalledWith('update_menu_state', expect.objectContaining({
        state: expect.objectContaining({ editorFindEnabled: true }),
      }))
    })
  })
})
