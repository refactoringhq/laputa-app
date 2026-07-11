import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTelemetry } from './useTelemetry'
import type { Settings } from '../types'

const mockInitSentry = vi.fn()
const mockTeardownSentry = vi.fn()
const mockInitPostHog = vi.fn()
const mockTeardownPostHog = vi.fn()
const mockUpdatePostHogIdentify = vi.fn()
const mockSetReleaseChannel = vi.fn()

vi.mock('../lib/telemetry', () => ({
  initSentry: (...args: unknown[]) => mockInitSentry(...args),
  teardownSentry: () => mockTeardownSentry(),
  initPostHog: (...args: unknown[]) => mockInitPostHog(...args),
  teardownPostHog: () => mockTeardownPostHog(),
  updatePostHogIdentify: (...args: unknown[]) => mockUpdatePostHogIdentify(...args),
  setReleaseChannel: (...args: unknown[]) => mockSetReleaseChannel(...args),
}))

const baseSettings: Settings = {
  auto_pull_interval_minutes: null,
  telemetry_consent: null, crash_reporting_enabled: null,
  analytics_enabled: null, anonymous_id: null, release_channel: null,
}

function renderTelemetry(settings: Settings, loaded = true) {
  return renderHook(() => useTelemetry(settings, loaded))
}

function analyticsSettings(releaseChannel: string | null = null): Settings {
  return {
    ...baseSettings,
    analytics_enabled: true,
    anonymous_id: 'test-uuid',
    release_channel: releaseChannel,
  }
}

describe('useTelemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when settings are not loaded', () => {
    renderTelemetry(baseSettings, false)
    expect(mockInitSentry).not.toHaveBeenCalled()
    expect(mockInitPostHog).not.toHaveBeenCalled()
  })

  it('does nothing when consent is not granted', () => {
    renderTelemetry({ ...baseSettings, telemetry_consent: false })
    expect(mockInitSentry).not.toHaveBeenCalled()
    expect(mockInitPostHog).not.toHaveBeenCalled()
  })

  it('initializes Sentry when crash reporting is enabled', () => {
    renderTelemetry({ ...baseSettings, crash_reporting_enabled: true, anonymous_id: 'test-uuid' })
    expect(mockInitSentry).toHaveBeenCalledWith('test-uuid')
  })

  it.each([
    { name: 'stable defaults', releaseChannel: null, expectedChannel: 'stable' },
    { name: 'legacy beta release channels', releaseChannel: 'beta', expectedChannel: 'stable' },
  ])('initializes PostHog for $name', ({ releaseChannel, expectedChannel }) => {
    renderTelemetry(analyticsSettings(releaseChannel))

    expect(mockInitPostHog).toHaveBeenCalledWith('test-uuid', expectedChannel)
    expect(mockSetReleaseChannel).toHaveBeenCalledWith(expectedChannel)
  })

  it('tears down Sentry when crash reporting is disabled after being enabled', () => {
    const settings1 = { ...baseSettings, crash_reporting_enabled: true, anonymous_id: 'test-uuid' }
    const { rerender } = renderHook(
      ({ settings, loaded }) => useTelemetry(settings, loaded),
      { initialProps: { settings: settings1, loaded: true } }
    )
    expect(mockInitSentry).toHaveBeenCalledOnce()

    const settings2 = { ...baseSettings, crash_reporting_enabled: false, anonymous_id: 'test-uuid' }
    rerender({ settings: settings2, loaded: true })
    expect(mockTeardownSentry).toHaveBeenCalledOnce()
  })

  it('does not initialize without anonymous_id', () => {
    renderTelemetry({ ...baseSettings, crash_reporting_enabled: true, anonymous_id: null })
    expect(mockInitSentry).not.toHaveBeenCalled()
  })

  it('updates the analytics identity when the normalized channel changes', () => {
    const { rerender } = renderHook(
      ({ settings, loaded }) => useTelemetry(settings, loaded),
      {
        initialProps: {
          settings: {
            ...baseSettings,
            analytics_enabled: true,
            anonymous_id: 'test-uuid',
            release_channel: 'alpha',
          },
          loaded: true,
        },
      },
    )

    rerender({
      settings: {
        ...baseSettings,
        analytics_enabled: true,
        anonymous_id: 'test-uuid',
        release_channel: 'beta',
      },
      loaded: true,
    })

    expect(mockUpdatePostHogIdentify).toHaveBeenCalledWith('stable')
  })

  it('keeps optional analytics initialization failures out of the global error path', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = new TypeError("undefined is not an object (evaluating 'o.default')")
    mockInitPostHog.mockRejectedValueOnce(error)

    try {
      renderTelemetry(analyticsSettings())
      await Promise.resolve()

      expect(warn).toHaveBeenCalledWith('[telemetry] Analytics init failed:', error)
    } finally {
      warn.mockRestore()
    }
  })
})
