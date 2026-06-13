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

const STALE_TAURI_LISTENER_CLEANUP_SIGNATURE = "listeners[eventId].handlerId"

function scrubPaths(input: SensitiveTelemetryText): string {
  return redactPathText({ text: input })
}

function isStaleTauriListenerCleanupText(value: string | undefined): boolean {
  return value?.includes(STALE_TAURI_LISTENER_CLEANUP_SIGNATURE) ?? false
}

function errorText(value: unknown): string | undefined {
  if (!value) return undefined
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return undefined

  const maybeError = value as { message?: unknown; name?: unknown }
  const message = typeof maybeError.message === 'string' ? maybeError.message : undefined
  const name = typeof maybeError.name === 'string' ? maybeError.name : undefined
  return [name, message].filter(Boolean).join(': ') || undefined
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

function shouldDropStaleTauriListenerCleanupEvent(
  event: Sentry.ErrorEvent,
  hint?: Sentry.EventHint,
): boolean {
  if (isStaleTauriListenerCleanupText(errorText(hint?.originalException))) return true
  if (isStaleTauriListenerCleanupText(event.message)) return true

  return (event.exception?.values ?? []).some((exception) =>
    isStaleTauriListenerCleanupText(exception.value))
}

function shouldDropSentryEvent(event: Sentry.ErrorEvent, hint?: Sentry.EventHint): boolean {
  return shouldDropWhiteboardPlatformPermissionEvent(event, hint)
    || shouldDropStaleTauriListenerCleanupEvent(event, hint)
}

function scrubEventMessage(event: Sentry.ErrorEvent): void {
  if (event.message) event.message = scrubPaths(event.message)
}

function scrubExceptionValues(event: Sentry.ErrorEvent): void {
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubPaths(ex.value)
  }
}

function scrubBreadcrumbMessages(event: Sentry.ErrorEvent): void {
  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (breadcrumb.message) breadcrumb.message = scrubPaths(breadcrumb.message)
  }
}

function scrubSentryEvent(event: Sentry.ErrorEvent, hint?: Sentry.EventHint): Sentry.ErrorEvent | null {
  if (shouldDropSentryEvent(event, hint)) return null

  scrubEventMessage(event)
  scrubExceptionValues(event)
  scrubBreadcrumbMessages(event)

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
