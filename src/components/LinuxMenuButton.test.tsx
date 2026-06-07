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
  const trigger = await screen.findByRole('menuitem', {
    name: (accessibleName) => accessibleName.includes(label),
  })
  fireEvent.pointerMove(trigger)
  fireEvent.click(trigger)
}

async function openHorizontalMenu(label: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name: label }), { button: 0 })
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

    await openSubmenu('View')
    expect(screen.getByText('Ctrl+Shift+L')).toBeInTheDocument()
    fireEvent.click(await screen.findByText('Toggle AI Panel'))
    expect(invoke).toHaveBeenCalledWith('trigger_menu_command', { id: 'view-toggle-ai-chat' })
  }, MENU_TEST_TIMEOUT_MS)

  it('dispatches shared menu commands from the horizontal desktop menu', async () => {
    render(<LinuxMenuButton />)

    expect(screen.getByTestId('desktop-horizontal-menu')).toBeInTheDocument()

    await openHorizontalMenu('File')
    fireEvent.click(await screen.findByText('New Note'))
    expect(invoke).toHaveBeenCalledWith('trigger_menu_command', { id: 'file-new-note' })
  }, MENU_TEST_TIMEOUT_MS)

  it('opens an adjacent horizontal menu tab with one pointer interaction while another tab is open', async () => {
    render(<LinuxMenuButton />)

    await openHorizontalMenu('File')
    expect(await screen.findByText('New Note')).toBeInTheDocument()

    await openHorizontalMenu('Edit')
    expect(await screen.findByText('Paste without Formatting')).toBeInTheDocument()
  }, MENU_TEST_TIMEOUT_MS)

  it('localizes the custom desktop menu when a locale is provided', async () => {
    render(<LinuxMenuButton locale="zh-CN" />)

    expect(screen.getByRole('button', { name: '文件' })).toBeInTheDocument()

    await openHorizontalMenu('视图')
    expect(await screen.findByText('实际大小')).toBeInTheDocument()
    fireEvent.click(await screen.findByText('切换 AI 面板'))

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
