import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginNoteOpenTrace,
  failNoteOpenTrace,
  finishNoteOpenTrace,
  logKeyboardNavigationTrace,
  markNoteOpenTrace,
} from './noteOpenPerformance'

const VITEST_WORKER_DESCRIPTOR = Object.getOwnPropertyDescriptor(globalThis, '__vitest_worker__')

describe('noteOpenPerformance additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    if (VITEST_WORKER_DESCRIPTOR) {
      Reflect.deleteProperty(globalThis, '__vitest_worker__')
    }
  })

  afterEach(() => {
    if (VITEST_WORKER_DESCRIPTOR) {
      Object.defineProperty(globalThis, '__vitest_worker__', VITEST_WORKER_DESCRIPTOR)
    }
  })

  it('logs n/a durations and cache misses when optional marks are absent', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(35)

    beginNoteOpenTrace('/vault/missing-stages.md', 'quick-open')
    finishNoteOpenTrace('/vault/missing-stages.md')

    expect(debugSpy).toHaveBeenCalledWith(
      '[perf] noteOpen path=/vault/missing-stages.md source=quick-open total=25.0ms beforeNavigate=n/a freshnessCheck=n/a contentLoad=n/a editorSwap=25.0ms cache=miss',
    )
  })

  it('ignores trace updates when running under the vitest runtime flag', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    Object.defineProperty(globalThis, '__vitest_worker__', {
      configurable: true,
      value: 'worker-1',
    })

    beginNoteOpenTrace('/vault/ignored.md', 'sidebar')
    markNoteOpenTrace('/vault/ignored.md', 'cacheReady')
    failNoteOpenTrace('/vault/ignored.md', 'ignored')
    finishNoteOpenTrace('/vault/ignored.md')
    logKeyboardNavigationTrace('down', 999, 12)

    expect(debugSpy).not.toHaveBeenCalled()
  })

  it('does not log quiet keyboard traces when both thresholds stay below the cutoff', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    logKeyboardNavigationTrace('down', 499, 3.9)

    expect(debugSpy).not.toHaveBeenCalled()
  })
})
