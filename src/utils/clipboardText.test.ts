import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { writeClipboardText } from './clipboardText'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const originalClipboard = navigator.clipboard
const mockInvoke = vi.mocked(invoke)

function setClipboard(writeText: ReturnType<typeof vi.fn> | undefined) {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  })
}

describe('writeClipboardText', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    ;(globalThis as { isTauri?: boolean }).isTauri = false
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    })
  })

  it('uses the Web Clipboard API when it is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard(writeText)

    await writeClipboardText('copy me')

    expect(writeText).toHaveBeenCalledWith('copy me')
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('prefers the Web Clipboard API inside Tauri', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard(writeText)
    ;(globalThis as { isTauri?: boolean }).isTauri = true

    await writeClipboardText('copy me')

    expect(writeText).toHaveBeenCalledWith('copy me')
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('falls back to the native command when Web Clipboard copy fails inside Tauri', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'))
    setClipboard(writeText)
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    mockInvoke.mockResolvedValue(undefined)

    await writeClipboardText('copy me')

    expect(mockInvoke).toHaveBeenCalledWith('copy_text_to_clipboard', { text: 'copy me' })
  })

  it('reports unavailable clipboard support outside Tauri', async () => {
    setClipboard(undefined)

    await expect(writeClipboardText('copy me')).rejects.toThrow('Clipboard API is unavailable')
  })
})
