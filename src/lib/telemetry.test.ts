import { afterEach, describe, it, expect, vi } from 'vitest'

const sentryMocks = vi.hoisted(() => ({
  close: vi.fn(),
  init: vi.fn(),
  setTag: vi.fn(),
  setUser: vi.fn(),
}))

vi.mock('@sentry/react', () => sentryMocks)

import {
  _scrubPathsForTest as scrubPaths,
  initSentry,
  isFeatureEnabled,
  setReleaseChannel,
  teardownSentry,
  trackEvent,
} from './telemetry'
import { retainWhiteboardPlatformPermissionGuard } from '../utils/whiteboardPlatformPermissionRejection'

afterEach(() => {
  teardownSentry()
  vi.unstubAllEnvs()
  sentryMocks.close.mockClear()
  sentryMocks.init.mockClear()
  sentryMocks.setTag.mockClear()
  sentryMocks.setUser.mockClear()
})

describe('telemetry scrubPaths', () => {
  it('redacts macOS absolute paths', () => {
    expect(scrubPaths('Error in /Users/luca/Laputa/note.md')).toBe(
      'Error in [redacted-path]'
    )
  })

  it('redacts Linux absolute paths', () => {
    expect(scrubPaths('Error in /home/user/vault/note.md')).toBe(
      'Error in [redacted-path]'
    )
  })

  it('redacts Windows paths', () => {
    expect(scrubPaths('Error in C:\\Users\\luca\\docs\\file.md')).toBe(
      'Error in [redacted-path]'
    )
  })

  it('leaves non-path strings untouched', () => {
    expect(scrubPaths('Something went wrong')).toBe('Something went wrong')
  })

  it('redacts multiple paths in one string', () => {
    const input = 'Failed copying /a/b/c to /x/y/z'
    expect(scrubPaths(input)).toBe('Failed copying [redacted-path] to [redacted-path]')
  })
})

describe('trackEvent', () => {
  it('does not throw when PostHog is not initialized', () => {
    expect(() => trackEvent('test_event', { count: 1 })).not.toThrow()
  })

  it('accepts event name with no properties', () => {
    expect(() => trackEvent('note_created')).not.toThrow()
  })

  it('accepts event name with string and number properties', () => {
    expect(() => trackEvent('note_created', { has_type: 1, creation_path: 'cmd_n' })).not.toThrow()
  })
})

describe('initSentry', () => {
  function initSentryBeforeSend(): (event: Record<string, unknown>, hint?: { originalException?: unknown }) => unknown {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.ingest.sentry.io/123456')
    initSentry('anonymous-user')

    const beforeSend = sentryMocks.init.mock.calls[0]?.[0]?.beforeSend
    expect(beforeSend).toEqual(expect.any(Function))
    return beforeSend as (event: Record<string, unknown>, hint?: { originalException?: unknown }) => unknown
  }

  it.each([
    ['stable builds', '2026.4.23', '2026.4.23', 'stable'],
    ['alpha builds', '2026.4.28-alpha.7', undefined, 'prerelease'],
    ['local builds', '0.1.0', undefined, 'internal'],
  ])('sets release metadata for %s', (_name, buildVersion, sentryRelease, releaseKind) => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.ingest.sentry.io/123456')
    vi.stubEnv('VITE_SENTRY_RELEASE', buildVersion)

    initSentry('anonymous-user')

    expect(sentryMocks.init).toHaveBeenCalledWith(expect.objectContaining({
      dsn: 'https://public@example.ingest.sentry.io/123456',
      release: sentryRelease,
    }))
    expect(sentryMocks.setUser).toHaveBeenCalledWith({ id: 'anonymous-user' })
    expect(sentryMocks.setTag).toHaveBeenCalledWith('tolaria.build_version', buildVersion)
    expect(sentryMocks.setTag).toHaveBeenCalledWith('tolaria.release_kind', releaseKind)
  })

  it('drops active whiteboard platform permission rejections before sending them to Sentry', () => {
    const beforeSend = initSentryBeforeSend()
    const releaseGuard = retainWhiteboardPlatformPermissionGuard()
    const rejectionEvent = {
      exception: {
        values: [{
          type: 'NotAllowedError',
          value: 'The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.',
        }],
      },
    }
    const hintedEvent = { message: 'Unhandled promise rejection' }

    try {
      expect(beforeSend(rejectionEvent)).toBeNull()
      expect(beforeSend(hintedEvent, {
        originalException: {
          name: 'NotAllowedError',
          message: 'The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.',
        },
      })).toBeNull()
    } finally {
      releaseGuard()
    }
  })

  it('keeps non-whiteboard Sentry events while the whiteboard guard is active', () => {
    const beforeSend = initSentryBeforeSend()
    const releaseGuard = retainWhiteboardPlatformPermissionGuard()
    const event = {
      exception: {
        values: [{
          type: 'Error',
          value: 'Save failed',
        }],
      },
    }

    try {
      expect(beforeSend(event)).toBe(event)
    } finally {
      releaseGuard()
    }
  })

  it('keeps platform permission rejections when no whiteboard guard is active', () => {
    const beforeSend = initSentryBeforeSend()
    const event = {
      exception: {
        values: [{
          type: 'NotAllowedError',
          value: 'The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.',
        }],
      },
    }

    expect(beforeSend(event)).toBe(event)
  })

  it('drops stale Tauri listener cleanup errors before sending them to Sentry', () => {
    const beforeSend = initSentryBeforeSend()
    const staleListenerEvent = {
      exception: {
        values: [{
          type: 'TypeError',
          value: "undefined is not an object (evaluating 'listeners[eventId].handlerId')",
        }],
      },
    }
    const messageOnlyEvent = {
      message: "TypeError: undefined is not an object (evaluating 'listeners[eventId].handlerId')",
    }
    const unrelatedTypeErrorEvent = {
      exception: {
        values: [{
          type: 'TypeError',
          value: "undefined is not an object (evaluating 'note.title')",
        }],
      },
    }

    expect(beforeSend(staleListenerEvent)).toBeNull()
    expect(beforeSend(messageOnlyEvent)).toBeNull()
    expect(beforeSend(unrelatedTypeErrorEvent)).toBe(unrelatedTypeErrorEvent)
  })
})

describe('isFeatureEnabled', () => {
  it('returns true for alpha channel regardless of flag state', () => {
    setReleaseChannel('alpha')
    expect(isFeatureEnabled('any_flag')).toBe(true)
    expect(isFeatureEnabled('nonexistent_flag')).toBe(true)
  })

  it('returns false for stable channel when PostHog is not initialized', () => {
    setReleaseChannel('stable')
    expect(isFeatureEnabled('some_flag')).toBe(false)
  })

  it('returns false for beta channel when PostHog is not initialized', () => {
    setReleaseChannel('beta')
    expect(isFeatureEnabled('some_flag')).toBe(false)
  })
})
