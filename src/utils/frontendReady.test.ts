import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FRONTEND_READY_EVENT_NAME,
  STARTUP_RELOAD_ATTEMPT_KEY,
  markFrontendReady,
  reloadFrontendOnceIfStartupFailed,
} from './frontendReady'

describe('frontend readiness recovery', () => {
  beforeEach(() => {
    window.__tolariaFrontendReady = false
    sessionStorage.clear()
  })

  it('marks the frontend ready and clears a pending startup reload', () => {
    const onReady = vi.fn()
    window.addEventListener(FRONTEND_READY_EVENT_NAME, onReady, { once: true })
    sessionStorage.setItem(STARTUP_RELOAD_ATTEMPT_KEY, '1')

    markFrontendReady()

    expect(window.__tolariaFrontendReady).toBe(true)
    expect(sessionStorage.getItem(STARTUP_RELOAD_ATTEMPT_KEY)).toBeNull()
    expect(onReady).toHaveBeenCalledOnce()
  })

  it('reloads once when React reports a startup error before readiness', () => {
    const reload = vi.fn()

    const firstAttempt = reloadFrontendOnceIfStartupFailed({ reload })
    const secondAttempt = reloadFrontendOnceIfStartupFailed({ reload })

    expect(firstAttempt).toBe(true)
    expect(secondAttempt).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem(STARTUP_RELOAD_ATTEMPT_KEY)).toBe('1')
  })

  it('does not reload after the frontend has reported readiness', () => {
    const reload = vi.fn()
    markFrontendReady()

    const didReload = reloadFrontendOnceIfStartupFailed({ reload })

    expect(didReload).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
