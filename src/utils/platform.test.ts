import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTauri } from '../mock-tauri'
import { isLinux, isMac, isWindows, shouldUseLinuxWindowChrome } from './platform'

vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(),
}))

const originalUserAgent = navigator.userAgent

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  })
}

describe('platform helpers', () => {
  afterEach(() => {
    setUserAgent(originalUserAgent)
    vi.mocked(isTauri).mockReturnValue(false)
  })

  it('detects Linux user agents but ignores Android', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64)')
    expect(isLinux()).toBe(true)

    setUserAgent('Mozilla/5.0 (Linux; Android 14)')
    expect(isLinux()).toBe(false)
  })

  it('detects macOS user agents', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    expect(isMac()).toBe(true)
  })

  it('detects Windows user agents', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    expect(isWindows()).toBe(true)

    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    expect(isWindows()).toBe(false)
  })

  it('only enables Linux window chrome inside Tauri', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64)')
    vi.mocked(isTauri).mockReturnValue(false)
    expect(shouldUseLinuxWindowChrome()).toBe(false)

    vi.mocked(isTauri).mockReturnValue(true)
    expect(shouldUseLinuxWindowChrome()).toBe(true)
  })
})
