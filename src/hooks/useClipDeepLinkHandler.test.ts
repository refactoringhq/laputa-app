import { describe, expect, it, vi } from 'vitest'
import { registerClipDeepLinkImports } from './useClipDeepLinkHandler'

const startupUrl = 'tolaria://clip/new?v=1&clipboard=1&path=Clippings%2FStartup.md'
const runtimeUrl = 'tolaria://clip/new?v=1&clipboard=1&path=Clippings%2FRuntime.md'

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('registerClipDeepLinkImports', () => {
  it('imports launch URLs from getCurrent and listens for runtime URLs', async () => {
    const dispose = vi.fn()
    const importUrl = vi.fn()
    const getCurrentUrls = vi.fn().mockResolvedValue([startupUrl])
    const onOpenUrl = vi.fn().mockImplementation(async (handler: (urls: string[]) => void) => {
      handler([runtimeUrl])
      return dispose
    })

    const cleanup = registerClipDeepLinkImports({
      getCurrentUrls,
      importUrl,
      onOpenUrl,
      onRegistrationError: vi.fn(),
    })

    await flushPromises()

    expect(getCurrentUrls).toHaveBeenCalledOnce()
    expect(onOpenUrl).toHaveBeenCalledOnce()
    expect(importUrl).toHaveBeenCalledWith(startupUrl)
    expect(importUrl).toHaveBeenCalledWith(runtimeUrl)

    cleanup()

    expect(dispose).toHaveBeenCalledOnce()
  })

  it('does not import delayed launch URLs after cleanup', async () => {
    let resolveCurrent: (urls: string[]) => void = () => {}
    const currentUrls = new Promise<string[]>((resolve) => {
      resolveCurrent = resolve
    })
    const dispose = vi.fn()
    const importUrl = vi.fn()

    const cleanup = registerClipDeepLinkImports({
      getCurrentUrls: () => currentUrls,
      importUrl,
      onOpenUrl: vi.fn().mockResolvedValue(dispose),
      onRegistrationError: vi.fn(),
    })

    cleanup()
    resolveCurrent([startupUrl])
    await flushPromises()

    expect(importUrl).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
