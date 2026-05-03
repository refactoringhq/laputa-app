import { readFileSync } from 'node:fs'

interface TauriCapability {
  permissions: string[]
}

const LINUX_WINDOW_CHROME_PERMISSIONS = [
  'core:window:allow-start-dragging',
  'core:window:allow-start-resize-dragging',
  'core:window:allow-minimize',
  'core:window:allow-toggle-maximize',
  'core:window:allow-close',
] as const

describe('Tauri window-control permissions', () => {
  it('allows the APIs used by Linux custom window chrome', () => {
    const capability = JSON.parse(
      readFileSync(`${process.cwd()}/src-tauri/capabilities/default.json`, 'utf8'),
    ) as TauriCapability

    expect(capability.permissions).toEqual(
      expect.arrayContaining([...LINUX_WINDOW_CHROME_PERMISSIONS]),
    )
  })
})
