import * as Sentry from '@sentry/react'
import { resolveFrontendTelemetryConfig } from './telemetryConfig'

/** Pattern that matches absolute file paths (macOS / Linux / Windows). */
const PATH_PATTERN = /(?:\/[\w.-]+){2,}|[A-Z]:\\[\w\\.-]+/g

function scrubPaths(input: string): string {
  return input.replace(PATH_PATTERN, '<redacted-path>')
}

function scrubSentryEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.message) event.message = scrubPaths(event.message)
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubPaths(ex.value)
  }
  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (breadcrumb.message) breadcrumb.message = scrubPaths(breadcrumb.message)
  }
  return event
}

let sentryInitialized = false
let posthogInstance: typeof import('posthog-js').default | null = null

export function initSentry(anonymousId: string): void {
  if (sentryInitialized) return

  const { sentryDsn, sentryBuildVersion, sentryRelease } = resolveFrontendTelemetryConfig()
  if (!sentryDsn) return

  Sentry.init({
    dsn: sentryDsn,
    release: sentryRelease || undefined,
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
  })
  Sentry.setUser({ id: anonymousId })
  if (sentryBuildVersion) {
    const releaseKind = sentryRelease
      ? 'stable'
      : sentryBuildVersion.includes('-') ? 'prerelease' : 'internal'

    Sentry.setTag('tolaria.build_version', sentryBuildVersion)
    Sentry.setTag('tolaria.release_kind', releaseKind)
  }
  sentryInitialized = true
}

export function teardownSentry(): void {
  if (!sentryInitialized) return
  Sentry.close()
  sentryInitialized = false
}

export async function initPostHog(anonymousId: string, releaseChannel?: string): Promise<void> {
  if (posthogInstance) return

  const { posthogKey, posthogHost } = resolveFrontendTelemetryConfig()
  if (!posthogKey || !posthogHost) return

  const posthog = (await import('posthog-js')).default
  posthog.init(posthogKey, {
    api_host: posthogHost,
    autocapture: false,
    capture_pageview: false,
    persistence: 'memory',
    disable_session_recording: true,
  })
  posthog.identify(anonymousId, releaseChannel ? { release_channel: releaseChannel } : undefined)
  posthogInstance = posthog
}

export function teardownPostHog(): void {
  if (!posthogInstance) return
  posthogInstance.opt_out_capturing()
  posthogInstance.reset()
  posthogInstance = null
}

export function updatePostHogIdentify(releaseChannel: string): void {
  posthogInstance?.identify(undefined, { release_channel: releaseChannel })
}

/** Hardcoded defaults for first launch with no network (PostHog cache empty). */
const FEATURE_DEFAULTS: Record<string, boolean> = {}

let currentReleaseChannel: string = 'stable'

export function setReleaseChannel(channel: string): void {
  currentReleaseChannel = channel
}

export function isFeatureEnabled(flagKey: string): boolean {
  if (currentReleaseChannel === 'alpha') return true
  return posthogInstance?.isFeatureEnabled(flagKey) ?? FEATURE_DEFAULTS[flagKey] ?? false
}

export function trackEvent(name: string, properties?: Record<string, string | number>): void {
  posthogInstance?.capture(name, properties)
}

export { scrubPaths as _scrubPathsForTest }
