import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyMainWindowSizeConstraints,
  getMainWindowMinWidth,
  useMainWindowSizeConstraints,
} from './useMainWindowSizeConstraints'

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn<(...args: unknown[]) => Promise<void>>(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}))

describe('getMainWindowMinWidth', () => {
  const minWidthCases = [
    {
      name: 'keeps pane allowances when all primary panes are visible',
      visibility: {
        sidebarVisible: true,
        noteListVisible: true,
        inspectorCollapsed: true,
      },
      expectedWidth: 920,
    },
    {
      name: 'drops to the narrower editor-only floor when only the editor is visible',
      visibility: {
        sidebarVisible: false,
        noteListVisible: false,
        inspectorCollapsed: true,
      },
      expectedWidth: 480,
    },
    {
      name: 'accounts for the note list without the sidebar',
      visibility: {
        sidebarVisible: false,
        noteListVisible: true,
        inspectorCollapsed: true,
      },
      expectedWidth: 700,
    },
    {
      name: 'adds inspector width when the properties panel is open',
      visibility: {
        sidebarVisible: false,
        noteListVisible: false,
        inspectorCollapsed: false,
      },
      expectedWidth: 720,
    },
    {
      name: 'uses restored pane widths when they exceed the minimum allowances',
      visibility: {
        sidebarVisible: true,
        noteListVisible: true,
        inspectorCollapsed: false,
        sidebarWidth: 360,
        noteListWidth: 340,
        inspectorWidth: 320,
      },
      expectedWidth: 1500,
    },
  ] as const

  it.each(minWidthCases)('$name', ({ visibility, expectedWidth }) => {
    expect(getMainWindowMinWidth(visibility)).toBe(expectedWidth)
  })
})

describe('useMainWindowSizeConstraints', () => {
  beforeEach(() => {
    invoke.mockReset()
    invoke.mockResolvedValue()
  })

  const invokeCases = [
    {
      name: 'applies the computed minimum width through the native command',
      visibility: {
        sidebarVisible: false,
        noteListVisible: false,
        inspectorCollapsed: true,
      },
      expectedWidth: 480,
    },
    {
      name: 'updates the requested minimum when more panes become visible',
      visibility: {
        sidebarVisible: true,
        noteListVisible: true,
        inspectorCollapsed: false,
      },
      expectedWidth: 1160,
    },
  ] as const

  it.each(invokeCases)('$name', async ({ visibility, expectedWidth }) => {
    renderHook(() => useMainWindowSizeConstraints(visibility))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('update_current_window_min_size', {
        minWidth: expectedWidth,
        minHeight: 400,
        growToFit: true,
      })
    })
  })

  it('skips all window calls when the hook is disabled', async () => {
    renderHook(() => useMainWindowSizeConstraints({
      enabled: false,
      sidebarVisible: false,
      noteListVisible: false,
      inspectorCollapsed: true,
    }))

    await Promise.resolve()

    expect(invoke).not.toHaveBeenCalled()
  })

  it('sends the grow-to-fit payload through the native command helper', async () => {
    await applyMainWindowSizeConstraints(1200, { growToFit: false })

    expect(invoke).toHaveBeenCalledWith('update_current_window_min_size', {
      minWidth: 1200,
      minHeight: 400,
      growToFit: false,
    })
  })

  it('does not request native grow-to-fit on Windows', async () => {
    const originalUserAgent = navigator.userAgent
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })

    try {
      renderHook(() => useMainWindowSizeConstraints({
        sidebarVisible: true,
        noteListVisible: true,
        inspectorCollapsed: false,
      }))

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith('update_current_window_min_size', {
          minWidth: 1160,
          minHeight: 400,
          growToFit: false,
        })
      })
    } finally {
      Object.defineProperty(window.navigator, 'userAgent', {
        configurable: true,
        value: originalUserAgent,
      })
    }
  })

  it('keeps grow-to-fit enabled on non-Windows platforms', async () => {
    renderHook(() => useMainWindowSizeConstraints({
      sidebarVisible: true,
      noteListVisible: true,
      inspectorCollapsed: false,
    }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('update_current_window_min_size', {
        minWidth: 1160,
        minHeight: 400,
        growToFit: true,
      })
    })
  })
})
