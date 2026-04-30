import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useMenuEvents, dispatchMenuEvent, type MenuEventHandlers } from './useMenuEvents'

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
    onRepairVault: vi.fn(),
    onOpenInNewWindow: vi.fn(),
    onRestoreDeletedNote: vi.fn(),
    activeTabPathRef: { current: '/vault/test.md' } as React.MutableRefObject<string | null>,
    multiSelectionCommandRef: { current: null },
    activeTabPath: '/vault/test.md',
    hasRestorableDeletedNote: false,
    hasNoRemote: false,
  }
}

describe('useMenuEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isTauriMock.mockReturnValue(false)
  })

  it('cleans up a native menu listener even if unmounted before listen resolves', async () => {
    isTauriMock.mockReturnValue(true)

    let resolveListen: ((teardown: () => void) => void) | null = null
    const teardown = vi.fn()

    listenMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveListen = resolve
    }))

    const { unmount } = renderHook(() => useMenuEvents(makeHandlers()))
    await vi.dynamicImportSettled()

    expect(listenMock).toHaveBeenCalledTimes(1)

    unmount()

    resolveListen?.(teardown)
    await vi.dynamicImportSettled()

    expect(teardown).toHaveBeenCalledTimes(1)
  })

  it('swallows stale native menu unlisten failures from dev-mode remounts', async () => {
    isTauriMock.mockReturnValue(true)
    const teardown = vi.fn(() => {
      throw new TypeError("undefined is not an object (evaluating 'listeners[eventId].handlerId')")
    })

    listenMock.mockResolvedValueOnce(teardown)

    const { unmount } = renderHook(() => useMenuEvents(makeHandlers()))
    await vi.dynamicImportSettled()

    expect(() => unmount()).not.toThrow()
    await vi.dynamicImportSettled()
    expect(teardown).toHaveBeenCalledTimes(1)
  })
})

describe('dispatchMenuEvent', () => {
  // View mode events
  it('view-editor-only sets editor-only mode', () => {
    const h = makeHandlers()
    dispatchMenuEvent('view-editor-only', h)
    expect(h.onSetViewMode).toHaveBeenCalledWith('editor-only')
  })

  it('view-editor-list sets editor-list mode', () => {
    const h = makeHandlers()
    dispatchMenuEvent('view-editor-list', h)
    expect(h.onSetViewMode).toHaveBeenCalledWith('editor-list')
  })

  it('view-all sets all mode', () => {
    const h = makeHandlers()
    dispatchMenuEvent('view-all', h)
    expect(h.onSetViewMode).toHaveBeenCalledWith('all')
  })

  // Simple handler events
  it('file-new-note triggers create note', () => {
    const h = makeHandlers()
    dispatchMenuEvent('file-new-note', h)
    expect(h.onCreateNote).toHaveBeenCalled()
  })

  it('file-daily-note is ignored once the command is removed', () => {
    const h = makeHandlers()
    dispatchMenuEvent('file-daily-note', h)
    expect(h.onCreateNote).not.toHaveBeenCalled()
    expect(h.onQuickOpen).not.toHaveBeenCalled()
  })

  it('file-quick-open triggers quick open', () => {
    const h = makeHandlers()
    dispatchMenuEvent('file-quick-open', h)
    expect(h.onQuickOpen).toHaveBeenCalled()
  })

  it('file-save triggers save', () => {
    const h = makeHandlers()
    dispatchMenuEvent('file-save', h)
    expect(h.onSave).toHaveBeenCalled()
  })

  it('app-settings triggers open settings', () => {
    const h = makeHandlers()
    dispatchMenuEvent('app-settings', h)
    expect(h.onOpenSettings).toHaveBeenCalled()
  })

  it('view-toggle-properties triggers toggle inspector', () => {
    const h = makeHandlers()
    dispatchMenuEvent('view-toggle-properties', h)
    expect(h.onToggleInspector).toHaveBeenCalled()
  })

  it('view-command-palette triggers command palette', () => {
    const h = makeHandlers()
    dispatchMenuEvent('view-command-palette', h)
    expect(h.onCommandPalette).toHaveBeenCalled()
  })

  it('vault-add-remote triggers the add-remote flow', () => {
    const h = makeHandlers()
    dispatchMenuEvent('vault-add-remote', h)
    expect(h.onAddRemote).toHaveBeenCalled()
  })

  it('view-zoom-in triggers zoom in', () => {
    const h = makeHandlers()
    dispatchMenuEvent('view-zoom-in', h)
    expect(h.onZoomIn).toHaveBeenCalled()
  })

  it('view-zoom-out triggers zoom out', () => {
    const h = makeHandlers()
    dispatchMenuEvent('view-zoom-out', h)
    expect(h.onZoomOut).toHaveBeenCalled()
  })

  it('view-zoom-reset triggers zoom reset', () => {
    const h = makeHandlers()
    dispatchMenuEvent('view-zoom-reset', h)
    expect(h.onZoomReset).toHaveBeenCalled()
  })

  it('edit-find-in-vault triggers search', () => {
    const h = makeHandlers()
    dispatchMenuEvent('edit-find-in-vault', h)
    expect(h.onSearch).toHaveBeenCalled()
  })

  // Active tab-dependent events
  it('note-archive triggers archive on active tab', () => {
    const h = makeHandlers()
    dispatchMenuEvent('note-archive', h)
    expect(h.onArchiveNote).toHaveBeenCalledWith('/vault/test.md')
  })

  it('note-archive does nothing when no active tab', () => {
    const h = makeHandlers()
    h.activeTabPathRef = { current: null }
    dispatchMenuEvent('note-archive', h)
    expect(h.onArchiveNote).not.toHaveBeenCalled()
  })

  it('note-toggle-organized triggers organized toggle on active tab', () => {
    const h = makeHandlers()
    dispatchMenuEvent('note-toggle-organized', h)
    expect(h.onToggleOrganized).toHaveBeenCalledWith('/vault/test.md')
  })

  it('note-toggle-organized uses the current multi-selection when available', () => {
    const h = makeHandlers()
    const organizeSelected = vi.fn()
    h.multiSelectionCommandRef.current = {
      selectedPaths: ['/vault/a.md', '/vault/b.md'],
      organizeSelected,
    }

    dispatchMenuEvent('note-toggle-organized', h)

    expect(organizeSelected).toHaveBeenCalledTimes(1)
    expect(h.onToggleOrganized).not.toHaveBeenCalled()
  })

  it('note-toggle-organized does nothing when no active tab', () => {
    const h = makeHandlers()
    h.activeTabPathRef = { current: null }
    dispatchMenuEvent('note-toggle-organized', h)
    expect(h.onToggleOrganized).not.toHaveBeenCalled()
  })

  it('note-delete triggers delete on active tab', () => {
    const h = makeHandlers()
    dispatchMenuEvent('note-delete', h)
    expect(h.onDeleteNote).toHaveBeenCalledWith('/vault/test.md')
  })

  it('note-delete uses the current multi-selection when available', () => {
    const h = makeHandlers()
    const deleteSelected = vi.fn()
    h.multiSelectionCommandRef.current = {
      selectedPaths: ['/vault/a.md', '/vault/b.md'],
      deleteSelected,
    }

    dispatchMenuEvent('note-delete', h)

    expect(deleteSelected).toHaveBeenCalledTimes(1)
    expect(h.onDeleteNote).not.toHaveBeenCalled()
  })

  it('note-delete does nothing when no active tab', () => {
    const h = makeHandlers()
    h.activeTabPathRef = { current: null }
    dispatchMenuEvent('note-delete', h)
    expect(h.onDeleteNote).not.toHaveBeenCalled()
  })

  // Optional handler events
  it('view-go-back triggers go back', () => {
    const h = makeHandlers()
    dispatchMenuEvent('view-go-back', h)
    expect(h.onGoBack).toHaveBeenCalled()
  })

  it('view-go-forward triggers go forward', () => {
    const h = makeHandlers()
    dispatchMenuEvent('view-go-forward', h)
    expect(h.onGoForward).toHaveBeenCalled()
  })

  it('app-check-for-updates triggers check for updates', () => {
    const h = makeHandlers()
    dispatchMenuEvent('app-check-for-updates', h)
    expect(h.onCheckForUpdates).toHaveBeenCalled()
  })

  // New File menu items
  it('file-new-type triggers create type', () => {
    const h = makeHandlers()
    dispatchMenuEvent('file-new-type', h)
    expect(h.onCreateType).toHaveBeenCalled()
  })

  // New Edit menu items
  it('edit-toggle-raw-editor triggers toggle raw editor', () => {
    const h = makeHandlers()
    dispatchMenuEvent('edit-toggle-raw-editor', h)
    expect(h.onToggleRawEditor).toHaveBeenCalled()
  })

  it('edit-toggle-diff triggers toggle diff', () => {
    const h = makeHandlers()
    dispatchMenuEvent('edit-toggle-diff', h)
    expect(h.onToggleDiff).toHaveBeenCalled()
  })

  it('view-toggle-ai-chat triggers toggle AI chat', () => {
    const h = makeHandlers()
    dispatchMenuEvent('view-toggle-ai-chat', h)
    expect(h.onToggleAIChat).toHaveBeenCalled()
  })

  it('note-restore-deleted triggers restore deleted note', () => {
    const h = makeHandlers()
    dispatchMenuEvent('note-restore-deleted', h)
    expect(h.onRestoreDeletedNote).toHaveBeenCalled()
  })

  it('view-toggle-backlinks triggers toggle inspector', () => {
    const h = makeHandlers()
    dispatchMenuEvent('view-toggle-backlinks', h)
    expect(h.onToggleInspector).toHaveBeenCalled()
  })

  // Go menu events
  it('go-all-notes selects all filter', () => {
    const h = makeHandlers()
    dispatchMenuEvent('go-all-notes', h)
    expect(h.onSelectFilter).toHaveBeenCalledWith('all')
  })

  it('go-archived selects archived filter', () => {
    const h = makeHandlers()
    dispatchMenuEvent('go-archived', h)
    expect(h.onSelectFilter).toHaveBeenCalledWith('archived')
  })

  it('go-changes selects changes filter', () => {
    const h = makeHandlers()
    dispatchMenuEvent('go-changes', h)
    expect(h.onSelectFilter).toHaveBeenCalledWith('changes')
  })

  it('go-inbox selects inbox filter', () => {
    const h = makeHandlers()
    dispatchMenuEvent('go-inbox', h)
    expect(h.onSelectFilter).toHaveBeenCalledWith('inbox')
  })

  // Vault menu events
  it('vault-open triggers open vault', () => {
    const h = makeHandlers()
    dispatchMenuEvent('vault-open', h)
    expect(h.onOpenVault).toHaveBeenCalled()
  })

  it('vault-remove triggers remove active vault', () => {
    const h = makeHandlers()
    dispatchMenuEvent('vault-remove', h)
    expect(h.onRemoveActiveVault).toHaveBeenCalled()
  })

  it('vault-restore-getting-started triggers restore', () => {
    const h = makeHandlers()
    dispatchMenuEvent('vault-restore-getting-started', h)
    expect(h.onRestoreGettingStarted).toHaveBeenCalled()
  })

  it('vault-commit-push triggers commit push', () => {
    const h = makeHandlers()
    dispatchMenuEvent('vault-commit-push', h)
    expect(h.onCommitPush).toHaveBeenCalled()
  })

  it('vault-pull triggers pull', () => {
    const h = makeHandlers()
    dispatchMenuEvent('vault-pull', h)
    expect(h.onPull).toHaveBeenCalled()
  })

  it('vault-resolve-conflicts triggers resolve conflicts', () => {
    const h = makeHandlers()
    dispatchMenuEvent('vault-resolve-conflicts', h)
    expect(h.onResolveConflicts).toHaveBeenCalled()
  })

  it('vault-view-changes triggers view changes', () => {
    const h = makeHandlers()
    dispatchMenuEvent('vault-view-changes', h)
    expect(h.onViewChanges).toHaveBeenCalled()
  })

  it('vault-install-mcp triggers install MCP', () => {
    const h = makeHandlers()
    dispatchMenuEvent('vault-install-mcp', h)
    expect(h.onInstallMcp).toHaveBeenCalled()
  })

  it('vault-reload triggers reload vault', () => {
    const h = makeHandlers()
    dispatchMenuEvent('vault-reload', h)
    expect(h.onReloadVault).toHaveBeenCalled()
  })

  it('vault-repair triggers repair vault', () => {
    const h = makeHandlers()
    dispatchMenuEvent('vault-repair', h)
    expect(h.onRepairVault).toHaveBeenCalled()
  })

  // Note: open in new window
  it('note-open-in-new-window triggers open in new window', () => {
    const h = makeHandlers()
    dispatchMenuEvent('note-open-in-new-window', h)
    expect(h.onOpenInNewWindow).toHaveBeenCalled()
  })

  // Edge cases
  it('unknown event ID does nothing', () => {
    const h = makeHandlers()
    dispatchMenuEvent('unknown-event', h)
    expect(h.onSetViewMode).not.toHaveBeenCalled()
    expect(h.onCreateNote).not.toHaveBeenCalled()
    expect(h.onSave).not.toHaveBeenCalled()
  })
})
