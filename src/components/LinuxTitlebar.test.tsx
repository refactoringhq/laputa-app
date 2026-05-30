import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LinuxTitlebar } from './LinuxTitlebar'
import { shouldUseCustomWindowChrome } from '../utils/platform'

const {
  close,
  invoke,
  isMaximized,
  minimize,
  onResized,
  startDragging,
  startResizeDragging,
  toggleMaximize,
} = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  startDragging: vi.fn().mockResolvedValue(undefined),
  startResizeDragging: vi.fn().mockResolvedValue(undefined),
  minimize: vi.fn().mockResolvedValue(undefined),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  isMaximized: vi.fn().mockResolvedValue(false),
  onResized: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('../utils/platform', () => ({
  isMac: () => false,
  shouldUseCustomWindowChrome: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging,
    startResizeDragging,
    minimize,
    toggleMaximize,
    close,
    isMaximized,
    onResized,
  }),
}))

describe('LinuxTitlebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(shouldUseCustomWindowChrome).mockReturnValue(true)
  })

  it('does not render when custom desktop chrome is disabled', () => {
    vi.mocked(shouldUseCustomWindowChrome).mockReturnValue(false)

    render(<LinuxTitlebar />)

    expect(screen.queryByTestId('linux-titlebar')).toBeNull()
  })

  it('routes titlebar double-click through the shared drag-region command only once', () => {
    render(<LinuxTitlebar />)

    fireEvent.mouseDown(screen.getByTestId('linux-titlebar'), { button: 0, detail: 2 })

    expect(invoke).toHaveBeenCalledWith('perform_current_window_titlebar_double_click')
    expect(toggleMaximize).not.toHaveBeenCalled()
    expect(startDragging).not.toHaveBeenCalled()
  })

  it('wires custom titlebar window controls to the current window', () => {
    render(<LinuxTitlebar />)

    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(minimize).toHaveBeenCalledOnce()
    expect(toggleMaximize).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('localizes titlebar window control labels', () => {
    render(<LinuxTitlebar locale="it-IT" />)

    expect(screen.getByRole('button', { name: 'Riduci a icona' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ingrandisci' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Chiudi' })).toBeTruthy()
  })
})
