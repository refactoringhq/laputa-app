import { describe, expect, it, vi, afterEach } from 'vitest'
import { currentStatus, subscribeStatus, isWriteBlocked } from './vaultProviderRuntime'

describe('vaultProviderRuntime', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns available status for local-folder', () => {
    const status = currentStatus('local-folder')
    expect(status.availability).toBe('available')
    expect(status.syncState).toBe('not_applicable')
    expect(status.message).toBeNull()
  })

  it('returns available status with unknown sync for icloud-drive', () => {
    const status = currentStatus('icloud-drive')
    expect(status.availability).toBe('available')
    expect(status.syncState).toBe('unknown')
    expect(status.message).toBeNull()
  })

  it('local-folder subscription is a no-op', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeStatus('local-folder', listener)
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('icloud-drive subscription emits updates', () => {
    vi.useFakeTimers()
    const listener = vi.fn()
    const unsubscribe = subscribeStatus('icloud-drive', listener)

    vi.advanceTimersByTime(30_000)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      availability: 'available',
    }))

    unsubscribe()
    vi.advanceTimersByTime(30_000)
    expect(listener).toHaveBeenCalledTimes(1) // no more after unsubscribe
    vi.useRealTimers()
  })

  it('blocks writes when unavailable', () => {
    expect(isWriteBlocked({ availability: 'unavailable', syncState: 'unknown', message: 'gone' })).toBe(true)
    expect(isWriteBlocked({ availability: 'available', syncState: 'unknown', message: null })).toBe(false)
    expect(isWriteBlocked({ availability: 'degraded', syncState: 'syncing_or_delayed', message: null })).toBe(false)
  })
})
