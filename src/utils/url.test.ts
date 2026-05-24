import { afterEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import {
  copyLocalPath,
  isUrlValue,
  normalizeExternalUrl,
  openExternalUrl,
  openLocalFile,
  revealLocalPath,
} from './url'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const originalClipboard = navigator.clipboard

function setClipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

describe('normalizeExternalUrl', () => {
  it('keeps valid http URLs and normalizes bare domains', () => {
    expect(normalizeExternalUrl('https://example.com')).toBe('https://example.com')
    expect(normalizeExternalUrl('https://example.com/docs')).toBe('https://example.com/docs')
    expect(normalizeExternalUrl('example.com/docs')).toBe('https://example.com/docs')
  })

  it('rejects pure numeric values instead of treating them as bare domains', () => {
    expect(normalizeExternalUrl('2026')).toBeNull()
    expect(normalizeExternalUrl('0')).toBeNull()
    expect(isUrlValue('2026')).toBe(false)
  })

  it('rejects malformed or unsupported URLs', () => {
    expect(normalizeExternalUrl('https://exa mple.com')).toBeNull()
    expect(normalizeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeExternalUrl('not a url')).toBeNull()
  })
})

describe('openExternalUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not ask the browser to open malformed URLs', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)

    await openExternalUrl('https://exa mple.com')

    expect(open).not.toHaveBeenCalled()
  })

  it('treats Windows user-canceled opener dialogs as a benign no-op', async () => {
    vi.stubGlobal('isTauri', true)
    vi.mocked(openUrl).mockRejectedValueOnce(new Error('The operation was canceled by the user. (os error 1223)'))

    await expect(openExternalUrl('https://example.com')).resolves.toBeUndefined()

    expect(openUrl).toHaveBeenCalledWith('https://example.com')
  })

  it('keeps real native opener failures visible to callers', async () => {
    vi.stubGlobal('isTauri', true)
    const failure = new Error('failed to open default browser')
    vi.mocked(openUrl).mockRejectedValueOnce(failure)

    await expect(openExternalUrl('https://example.com')).rejects.toThrow(failure)
  })
})

describe('local file actions', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    })
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('opens local paths through the vault-scoped backend command', async () => {
    vi.stubGlobal('isTauri', true)

    await openLocalFile('/vault/attachments/report.pdf', '/vault')

    expect(invoke).toHaveBeenCalledWith('open_vault_file_external', {
      path: '/vault/attachments/report.pdf',
      vaultPath: '/vault',
    })
  })

  it('reveals local paths through the Tauri opener plugin', async () => {
    vi.stubGlobal('isTauri', true)

    await revealLocalPath('/vault/notes/project.md')

    expect(revealItemInDir).toHaveBeenCalledWith('/vault/notes/project.md')
  })

  it('copies local paths to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard(writeText)

    await copyLocalPath('/vault/Folder With Spaces/项目.md')

    expect(writeText).toHaveBeenCalledWith('/vault/Folder With Spaces/项目.md')
  })
})
