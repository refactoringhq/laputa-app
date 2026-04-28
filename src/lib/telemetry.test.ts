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
      'Error in <redacted-path>'
    )
  })

  it('redacts Linux absolute paths', () => {
    expect(scrubPaths('Error in /home/user/vault/note.md')).toBe(
      'Error in <redacted-path>'
    )
  })

  it('redacts Windows paths', () => {
    expect(scrubPaths('Error in C:\\Users\\luca\\docs\\file.md')).toBe(
      'Error in <redacted-path>'
    )
  })

  it('leaves non-path strings untouched', () => {
    expect(scrubPaths('Something went wrong')).toBe('Something went wrong')
  })

  it('redacts multiple paths in one string', () => {
    const input = 'Failed copying /a/b/c to /x/y/z'
    expect(scrubPaths(input)).toBe('Failed copying <redacted-path> to <redacted-path>')
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
