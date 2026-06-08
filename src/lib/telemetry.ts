import * as Sentry from '@sentry/react'
import { resolveFrontendTelemetryConfig } from './telemetryConfig'
import { redactPathText } from './sensitiveTextRedaction'
import {
  hasActiveWhiteboardPlatformPermissionGuard,
  isWhiteboardPlatformPermissionRejection,
} from '../utils/whiteboardPlatformPermissionRejection'

type SensitiveTelemetryText = string
type AnonymousTelemetryId = string
type ReleaseChannel = string
type FeatureFlagKey = string
type ProductAnalyticsEventName = string
type ProductAnalyticsProperties = Record<string, string | number>

function scrubPaths(input: SensitiveTelemetryText): string {
  return redactPathText({ text: input })
}

function shouldDropWhiteboardPlatformPermissionEvent(
  event: Sentry.ErrorEvent,
  hint?: Sentry.EventHint,
): boolean {
  if (!hasActiveWhiteboardPlatformPermissionGuard()) return false
  if (isWhiteboardPlatformPermissionRejection(hint?.originalException)) return true

  return (event.exception?.values ?? []).some((exception) =>
    isWhiteboardPlatformPermissionRejection({
      message: exception.value ?? '',
      name: exception.type ?? '',
    }))
}

function scrubSentryEvent(event: Sentry.ErrorEvent, hint?: Sentry.EventHint): Sentry.ErrorEvent | null {
  if (shouldDropWhiteboardPlatformPermissionEvent(event, hint)) return null

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

export function initSentry(anonymousId: AnonymousTelemetryId): void {
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

export async function initPostHog(anonymousId: AnonymousTelemetryId, releaseChannel?: ReleaseChannel): Promise<void> {
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

export function updatePostHogIdentify(releaseChannel: ReleaseChannel): void {
  posthogInstance?.identify(undefined, { release_channel: releaseChannel })
}

/** Hardcoded defaults for first launch with no network (PostHog cache empty). */
const FEATURE_DEFAULTS: Record<string, boolean> = {}

let currentReleaseChannel: ReleaseChannel = 'stable'

export function setReleaseChannel(channel: ReleaseChannel): void {
  currentReleaseChannel = channel
}

export function isFeatureEnabled(flagKey: FeatureFlagKey): boolean {
  if (currentReleaseChannel === 'alpha') return true
  return posthogInstance?.isFeatureEnabled(flagKey) ?? (Reflect.get(FEATURE_DEFAULTS, flagKey) as boolean | undefined) ?? false
}

export function trackEvent(name: ProductAnalyticsEventName, properties?: ProductAnalyticsProperties): void {
  posthogInstance?.capture(name, properties)
}

export { scrubPaths as _scrubPathsForTest }
