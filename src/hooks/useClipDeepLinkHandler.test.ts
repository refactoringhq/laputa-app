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

  it('imports stored launch URLs once across handler re-registrations', async () => {
    const handledCurrentUrls = new Set<string>()
    const importUrl = vi.fn().mockResolvedValue('imported')
    const getCurrentUrls = vi.fn().mockResolvedValue([startupUrl])
    const onOpenUrl = vi.fn().mockResolvedValue(vi.fn())

    const firstCleanup = registerClipDeepLinkImports({
      getCurrentUrls,
      handledCurrentUrls,
      importUrl,
      onOpenUrl,
      onRegistrationError: vi.fn(),
    })
    await flushPromises()
    firstCleanup()

    const secondCleanup = registerClipDeepLinkImports({
      getCurrentUrls,
      handledCurrentUrls,
      importUrl,
      onOpenUrl,
      onRegistrationError: vi.fn(),
    })
    await flushPromises()
    secondCleanup()

    expect(getCurrentUrls).toHaveBeenCalledTimes(2)
    expect(importUrl).toHaveBeenCalledTimes(1)
    expect(importUrl).toHaveBeenCalledWith(startupUrl)
  })

  it('retries stored launch URLs after rejected imports', async () => {
    const handledCurrentUrls = new Set<string>()
    const importUrl = vi.fn()
      .mockResolvedValueOnce('rejected')
      .mockResolvedValueOnce('imported')
    const getCurrentUrls = vi.fn().mockResolvedValue([startupUrl])
    const onOpenUrl = vi.fn().mockResolvedValue(vi.fn())

    const firstCleanup = registerClipDeepLinkImports({
      getCurrentUrls,
      handledCurrentUrls,
      importUrl,
      onOpenUrl,
      onRegistrationError: vi.fn(),
    })
    await flushPromises()
    firstCleanup()

    const secondCleanup = registerClipDeepLinkImports({
      getCurrentUrls,
      handledCurrentUrls,
      importUrl,
      onOpenUrl,
      onRegistrationError: vi.fn(),
    })
    await flushPromises()
    secondCleanup()

    expect(importUrl).toHaveBeenCalledTimes(2)
    expect(importUrl).toHaveBeenNthCalledWith(1, startupUrl)
    expect(importUrl).toHaveBeenNthCalledWith(2, startupUrl)
  })
})
