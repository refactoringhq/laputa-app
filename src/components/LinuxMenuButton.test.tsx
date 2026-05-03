import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LinuxMenuButton } from './LinuxMenuButton'

const MENU_TEST_TIMEOUT_MS = 10_000

const { close, invoke, minimize, toggleMaximize } = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  minimize: vi.fn().mockResolvedValue(undefined),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ minimize, toggleMaximize, close }),
}))

async function openSubmenu(label: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Application menu' }), { button: 0 })
  const trigger = await screen.findByText(label)
  fireEvent.pointerMove(trigger)
  fireEvent.click(trigger)
}

describe('LinuxMenuButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dispatches shared menu commands from the Linux menu', async () => {
    render(<LinuxMenuButton />)

    await openSubmenu('Edit')
    expect(screen.getByText('Ctrl+Shift+V')).toBeInTheDocument()
    fireEvent.click(await screen.findByText('Paste without Formatting'))
    expect(invoke).toHaveBeenCalledWith('trigger_menu_command', { id: 'edit-paste-plain-text' })

    await openSubmenu('Note')
    expect(screen.getByText('Ctrl+Shift+L')).toBeInTheDocument()
    fireEvent.click(await screen.findByText('Toggle AI Panel'))
    expect(invoke).toHaveBeenCalledWith('trigger_menu_command', { id: 'view-toggle-ai-chat' })
  }, MENU_TEST_TIMEOUT_MS)

  it('invokes direct window actions from the Window submenu', async () => {
    render(<LinuxMenuButton />)

    await openSubmenu('Window')
    fireEvent.click(await screen.findByText('Minimize'))

    await openSubmenu('Window')
    fireEvent.click(await screen.findByText('Maximize'))

    await openSubmenu('Window')
    fireEvent.click(await screen.findByText('Close'))

    expect(minimize).toHaveBeenCalledOnce()
    expect(toggleMaximize).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
})
