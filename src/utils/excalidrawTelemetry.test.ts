import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as telemetry from '../lib/telemetry'
import { resetExcalidrawTelemetryForTests, trackExcalidrawOpened } from './excalidrawTelemetry'

describe('trackExcalidrawOpened', () => {
  beforeEach(() => {
    resetExcalidrawTelemetryForTests()
    vi.spyOn(telemetry, 'trackEvent').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits excalidraw_opened once per source within a session', () => {
    trackExcalidrawOpened('embedded')
    trackExcalidrawOpened('embedded')
    trackExcalidrawOpened('embedded')

    expect(telemetry.trackEvent).toHaveBeenCalledExactlyOnceWith('excalidraw_opened', { source: 'embedded' })
  })

  it('tracks embedded and file sources independently', () => {
    trackExcalidrawOpened('embedded')
    trackExcalidrawOpened('file')

    expect(telemetry.trackEvent).toHaveBeenNthCalledWith(1, 'excalidraw_opened', { source: 'embedded' })
    expect(telemetry.trackEvent).toHaveBeenNthCalledWith(2, 'excalidraw_opened', { source: 'file' })
  })

  it('reset helper allows tests to fire again', () => {
    trackExcalidrawOpened('file')
    resetExcalidrawTelemetryForTests()
    trackExcalidrawOpened('file')

    expect(telemetry.trackEvent).toHaveBeenCalledTimes(2)
  })
})
