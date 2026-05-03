import { describe, expect, it } from 'vitest'
import {
  _defaultPostHogHostForTest as defaultPostHogHost,
  resolveFrontendTelemetryConfig,
  sanitizeTelemetryEnvValue,
} from './telemetryConfig'

function resolveConfig(overrides: {
  VITE_SENTRY_DSN?: string
  VITE_SENTRY_RELEASE?: string
  VITE_POSTHOG_KEY?: string
  VITE_POSTHOG_HOST?: string
} = {}) {
  return resolveFrontendTelemetryConfig({
    VITE_SENTRY_DSN: 'https://public@example.ingest.sentry.io/123456',
    VITE_SENTRY_RELEASE: '2026.4.23',
    VITE_POSTHOG_KEY: 'phc_test_key',
    VITE_POSTHOG_HOST: 'https://eu.i.posthog.com',
    ...overrides,
  })
}

describe('sanitizeTelemetryEnvValue', () => {
  it('trims surrounding whitespace', () => {
    expect(sanitizeTelemetryEnvValue('  value  ')).toBe('value')
  })

  it('unwraps matching quotes after trimming', () => {
    expect(sanitizeTelemetryEnvValue('  "value"  ')).toBe('value')
    expect(sanitizeTelemetryEnvValue("  'value'  ")).toBe('value')
  })

  it('returns an empty string for blank input', () => {
    expect(sanitizeTelemetryEnvValue('   ')).toBe('')
    expect(sanitizeTelemetryEnvValue(undefined)).toBe('')
  })
})

describe('resolveFrontendTelemetryConfig', () => {
  it.each([
    {
      name: 'keeps valid telemetry values after sanitizing them',
      overrides: {
        VITE_SENTRY_DSN: ' "https://public@example.ingest.sentry.io/123456" ',
        VITE_SENTRY_RELEASE: " '2026.4.23' ",
        VITE_POSTHOG_KEY: " 'phc_test_key' ",
        VITE_POSTHOG_HOST: ' https://eu.i.posthog.com ',
      },
      expected: {
        sentryDsn: 'https://public@example.ingest.sentry.io/123456',
        sentryBuildVersion: '2026.4.23',
        sentryRelease: '2026.4.23',
        posthogKey: 'phc_test_key',
        posthogHost: 'https://eu.i.posthog.com',
      },
    },
    {
      name: 'adds https to scheme-less DSNs and PostHog hosts',
      overrides: {
        VITE_SENTRY_DSN: 'public@example.ingest.sentry.io/123456',
        VITE_POSTHOG_KEY: 'phc_test_key',
        VITE_POSTHOG_HOST: 'eu.i.posthog.com',
      },
      expected: {
        sentryDsn: 'https://public@example.ingest.sentry.io/123456',
        sentryBuildVersion: '2026.4.23',
        sentryRelease: '2026.4.23',
        posthogKey: 'phc_test_key',
        posthogHost: 'https://eu.i.posthog.com',
      },
    },
  ])('$name', ({ overrides, expected }) => {
    expect(resolveConfig(overrides)).toEqual(expected)
  })

  it('uses the default PostHog host when one is not configured', () => {
    expect(resolveConfig({ VITE_POSTHOG_HOST: undefined }).posthogHost).toBe(defaultPostHogHost)
  })

  it('drops invalid Sentry DSNs instead of passing them to the SDK', () => {
    expect(resolveConfig({ VITE_SENTRY_DSN: 'not a dsn' }).sentryDsn).toBe('')
  })

  it('drops placeholder Sentry release values instead of grouping them', () => {
    expect(resolveConfig({ VITE_SENTRY_RELEASE: 'false' }).sentryRelease).toBe('')
  })

  it('keeps stable calendar versions as Sentry releases', () => {
    expect(resolveConfig({ VITE_SENTRY_RELEASE: '2026.4.28' }).sentryRelease).toBe('2026.4.28')
  })

  it('drops prerelease versions from the Sentry release field', () => {
    expect(resolveConfig({ VITE_SENTRY_RELEASE: '2026.4.28-alpha.7' })).toMatchObject({
      sentryBuildVersion: '2026.4.28-alpha.7',
      sentryRelease: '',
    })
  })

  it('drops local development versions from the Sentry release field', () => {
    expect(resolveConfig({ VITE_SENTRY_RELEASE: '0.1.0' })).toMatchObject({
      sentryBuildVersion: '0.1.0',
      sentryRelease: '',
    })
  })

  it('drops invalid PostHog hosts instead of loading scripts from them', () => {
    expect(resolveConfig({ VITE_POSTHOG_HOST: 'not a url' }).posthogHost).toBeNull()
  })

  it('drops placeholder telemetry hosts that would create broken startup requests', () => {
    expect(resolveConfig({
      VITE_SENTRY_DSN: 'https://public@false/123456',
      VITE_POSTHOG_HOST: 'false',
    })).toEqual({
      sentryDsn: '',
      sentryBuildVersion: '2026.4.23',
      sentryRelease: '2026.4.23',
      posthogKey: 'phc_test_key',
      posthogHost: null,
    })
  })

  it('drops single-label telemetry hosts but keeps localhost for dev', () => {
    expect(resolveConfig({
      VITE_SENTRY_DSN: 'https://public@le/123456',
      VITE_POSTHOG_HOST: 'https://le',
    })).toEqual({
      sentryDsn: '',
      sentryBuildVersion: '2026.4.23',
      sentryRelease: '2026.4.23',
      posthogKey: 'phc_test_key',
      posthogHost: null,
    })

    expect(resolveConfig({
      VITE_SENTRY_DSN: 'http://public@localhost:9000/123456',
      VITE_POSTHOG_HOST: 'http://localhost:8010',
    })).toEqual({
      sentryDsn: 'http://public@localhost:9000/123456',
      sentryBuildVersion: '2026.4.23',
      sentryRelease: '2026.4.23',
      posthogKey: 'phc_test_key',
      posthogHost: 'http://localhost:8010',
    })
  })
})
