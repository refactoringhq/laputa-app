import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncAppIconThemeMode } from './appIconTheme'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}))

vi.mock('../mock-tauri', () => ({
  isTauri: mocks.isTauri,
}))

describe('syncAppIconThemeMode', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.isTauri.mockReset()
  })

  it('skips browser runs', async () => {
    mocks.isTauri.mockReturnValue(false)

    await syncAppIconThemeMode('dark')

    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('sends the resolved theme mode to Tauri', async () => {
    mocks.isTauri.mockReturnValue(true)
    mocks.invoke.mockResolvedValue(undefined)

    await syncAppIconThemeMode('dark')

    expect(mocks.invoke).toHaveBeenCalledWith('update_app_icon', { themeMode: 'dark' })
  })
})
