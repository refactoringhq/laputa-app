import { trackEvent } from '../lib/telemetry'

export type ExcalidrawSource = 'embedded' | 'file'

const trackedSources = new Set<ExcalidrawSource>()

export function trackExcalidrawOpened(source: ExcalidrawSource): void {
  if (trackedSources.has(source)) return
  trackedSources.add(source)
  trackEvent('excalidraw_opened', { source })
}

export function resetExcalidrawTelemetryForTests(): void {
  trackedSources.clear()
}
