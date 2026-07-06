import * as Sentry from '@sentry/react'
import { resolveFrontendTelemetryConfig } from './telemetryConfig'
import { redactPathText } from './sensitiveTextRedaction'
import {
  hasActiveWhiteboardPlatformPermissionGuard,
  isWhiteboardPlatformPermissionRejection,
} from '../utils/whiteboardPlatformPermissionRejection'
import { classifyRichEditorRecoveryError } from '../components/richEditorRecoveryClassifier'

type SensitiveTelemetryText = string
type AnonymousTelemetryId = string
type ReleaseChannel = string
type FeatureFlagKey = string
type ProductAnalyticsEventName = string
type ProductAnalyticsProperties = Record<string, string | number>
type SentryExceptionValue = NonNullable<NonNullable<Sentry.ErrorEvent['exception']>['values']>[number]

interface BenignSentryEventMatcher {
  exception?: (exception: SentryExceptionValue) => boolean
  message?: (message: string | undefined) => boolean
  originalException?: (originalException: unknown, text: string | undefined) => boolean
}

const STALE_TAURI_LISTENER_CLEANUP_SIGNATURE = "listeners[eventId].handlerId"
const BLOCKNOTE_STALE_BLOCK_REFERENCE_PATTERN = /\bBlock with ID [^|\n]+? not found\b/
const NON_ERROR_MISSING_FILE_REJECTION_PATTERN = /\bNon-Error promise rejection captured with value:\s*File does not exist\b/i
const RESIZE_OBSERVER_LOOP_MESSAGES = [
  'ResizeObserver loop completed with undelivered notifications',
  'ResizeObserver loop limit exceeded',
] as const

function scrubPaths(input: SensitiveTelemetryText): string {
  return redactPathText({ text: input })
}

function isStaleTauriListenerCleanupText(value: string | undefined): boolean {
  return value?.includes(STALE_TAURI_LISTENER_CLEANUP_SIGNATURE) ?? false
}

function isBlockNoteStaleBlockReferenceText(value: string | undefined): boolean {
  return value ? BLOCKNOTE_STALE_BLOCK_REFERENCE_PATTERN.test(value) : false
}

function isResizeObserverLoopText(value: string | undefined): boolean {
  return value
    ? RESIZE_OBSERVER_LOOP_MESSAGES.some((message) => value.includes(message))
    : false
}

function isMissingFileText(value: string | undefined): boolean {
  return value ? /^File does not exist(?:\b|:)/i.test(value.trim()) : false
}

function isNonErrorMissingFileRejectionText(value: string | undefined): boolean {
  return value ? NON_ERROR_MISSING_FILE_REJECTION_PATTERN.test(value) : false
}

function isUnhandledRejectionExceptionType(value: string | undefined): boolean {
  const normalized = value?.toLowerCase() ?? ''
  return normalized.includes('unhandled') || normalized.includes('promise')
}

function recoveredRichEditorDomNotFoundError(name: string | undefined, message: string | undefined): boolean {
  if (!name || !message) return false

  return classifyRichEditorRecoveryError({ name, message }, 'render') === 'dom_not_found'
}

function recoveredRichEditorDomNotFoundText(value: string | undefined): boolean {
  const [name, ...messageParts] = value?.split(':') ?? []
  const message = messageParts.join(':').trim()

  return recoveredRichEditorDomNotFoundError(name, message)
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

function matchesBenignSentryEventSurface(
  event: Sentry.ErrorEvent,
  hint: Sentry.EventHint | undefined,
  matcher: BenignSentryEventMatcher,
): boolean {
  const originalException = hint?.originalException
  if (matcher.originalException?.(originalException, errorText(originalException))) return true
  if (matcher.message?.(event.message)) return true

  return (event.exception?.values ?? []).some((exception) =>
    matcher.exception?.(exception) ?? false)
}

function matchesBenignSentryEventText(
  event: Sentry.ErrorEvent,
  hint: Sentry.EventHint | undefined,
  matchesText: (value: string | undefined) => boolean,
): boolean {
  return matchesBenignSentryEventSurface(event, hint, {
    exception: (exception) => matchesText(exception.value),
    message: matchesText,
    originalException: (_originalException, text) => matchesText(text),
  })
}

function shouldDropWhiteboardPlatformPermissionEvent(
  event: Sentry.ErrorEvent,
  hint?: Sentry.EventHint,
): boolean {
  if (!hasActiveWhiteboardPlatformPermissionGuard()) return false

  return matchesBenignSentryEventSurface(event, hint, {
    exception: (exception) => isWhiteboardPlatformPermissionRejection({
      message: exception.value ?? '',
      name: exception.type ?? '',
    }),
    originalException: (originalException) =>
      isWhiteboardPlatformPermissionRejection(originalException),
  })
}

function shouldDropStaleTauriListenerCleanupEvent(
  event: Sentry.ErrorEvent,
  hint?: Sentry.EventHint,
): boolean {
  return matchesBenignSentryEventText(event, hint, isStaleTauriListenerCleanupText)
}

function shouldDropBlockNoteStaleBlockReferenceEvent(
  event: Sentry.ErrorEvent,
  hint?: Sentry.EventHint,
): boolean {
  return matchesBenignSentryEventText(event, hint, isBlockNoteStaleBlockReferenceText)
}

function shouldDropRichEditorDomNotFoundEvent(
  event: Sentry.ErrorEvent,
  hint?: Sentry.EventHint,
): boolean {
  return matchesBenignSentryEventSurface(event, hint, {
    exception: (exception) => recoveredRichEditorDomNotFoundError(exception.type, exception.value),
    message: recoveredRichEditorDomNotFoundText,
    originalException: (originalException) =>
      classifyRichEditorRecoveryError(originalException, 'render') === 'dom_not_found',
  })
}

function shouldDropResizeObserverLoopEvent(
  event: Sentry.ErrorEvent,
  hint?: Sentry.EventHint,
): boolean {
  return matchesBenignSentryEventText(event, hint, isResizeObserverLoopText)
}

function shouldDropMissingFilePromiseRejectionEvent(
  event: Sentry.ErrorEvent,
  hint?: Sentry.EventHint,
): boolean {
  return matchesBenignSentryEventSurface(event, hint, {
    exception: (exception) => isNonErrorMissingFileRejectionText(exception.value)
      || (isUnhandledRejectionExceptionType(exception.type) && isMissingFileText(exception.value)),
    message: isNonErrorMissingFileRejectionText,
    originalException: (originalException, text) =>
      typeof originalException === 'string' && isMissingFileText(text),
  })
}

function shouldDropSentryEvent(event: Sentry.ErrorEvent, hint?: Sentry.EventHint): boolean {
  return shouldDropWhiteboardPlatformPermissionEvent(event, hint)
    || shouldDropStaleTauriListenerCleanupEvent(event, hint)
    || shouldDropBlockNoteStaleBlockReferenceEvent(event, hint)
    || shouldDropRichEditorDomNotFoundEvent(event, hint)
    || shouldDropResizeObserverLoopEvent(event, hint)
    || shouldDropMissingFilePromiseRejectionEvent(event, hint)
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
