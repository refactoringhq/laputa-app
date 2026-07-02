import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginNoteOpenTrace,
  failNoteOpenTrace,
  finishNoteOpenTrace,
  logKeyboardNavigationTrace,
  markNoteOpenTrace,
} from './noteOpenPerformance'
import {
  logEditorBlockApplyTrace,
  logEditorBlockResolutionTrace,
  logEditorStabilityCheckTrace,
  logParsedBlockPreloadTrace,
  logRichEditorDispatchTrace,
  logRichEditorSerializationTrace,
} from './editorPerformanceTrace'

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
    const debugSpy = vi.spyOn(globalThis.console, 'debug').mockImplementation(() => {})
    vi.spyOn(globalThis.performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(35)

    beginNoteOpenTrace('/vault/missing-stages.md', 'quick-open')
    finishNoteOpenTrace('/vault/missing-stages.md')

    expect(debugSpy).toHaveBeenCalledWith(
      '[perf] noteOpen path=/vault/missing-stages.md source=quick-open total=25.0ms beforeNavigate=n/a freshnessCheck=n/a contentLoad=n/a editorSwap=25.0ms cache=miss',
    )
  })

  it('ignores trace updates when running under the vitest runtime flag', () => {
    const debugSpy = vi.spyOn(globalThis.console, 'debug').mockImplementation(() => {})
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
    const debugSpy = vi.spyOn(globalThis.console, 'debug').mockImplementation(() => {})

    logKeyboardNavigationTrace('down', 499, 3.9)

    expect(debugSpy).not.toHaveBeenCalled()
  })

  it('logs rich-editor dispatch probes for large or slow transactions', () => {
    const debugSpy = vi.spyOn(globalThis.console, 'debug').mockImplementation(() => {})

    logRichEditorDispatchTrace({
      docChanged: true,
      docSize: 64 * 1024,
      durationMs: 5,
      notePath: '/vault/large.md',
      stepCount: 1,
    })

    expect(debugSpy).toHaveBeenCalledWith(
      '[perf] richEditorDispatch path=/vault/large.md docChanged=true steps=1 docSize=65536 duration=5.0ms',
    )
  })

  it('logs editor lifecycle performance probes for large or slow notes', () => {
    const debugSpy = vi.spyOn(globalThis.console, 'debug').mockImplementation(() => {})

    logRichEditorSerializationTrace({
      blockCount: 320,
      cacheHits: 240,
      cacheMisses: 80,
      durationMs: 12,
      fallbackReason: null,
      notePath: '/vault/large.md',
    })
    logEditorBlockResolutionTrace({
      blockCount: 320,
      durationMs: 9,
      notePath: '/vault/large.md',
      sourceBytes: 64 * 1024,
      strategy: 'direct-markdown',
    })
    logEditorBlockApplyTrace({
      blockCount: 320,
      durationMs: 14,
      notePath: '/vault/large.md',
    })
    logEditorStabilityCheckTrace({
      durationMs: 8,
      matched: true,
      notePath: '/vault/large.md',
      sourceBytes: 64 * 1024,
    })
    logParsedBlockPreloadTrace({
      durationMs: 11,
      notePath: '/vault/next.md',
      sourceBytes: 70 * 1024,
      state: 'prepared',
    })

    expect(debugSpy).toHaveBeenNthCalledWith(
      1,
      '[perf] richEditorSerialize path=/vault/large.md blocks=320 duration=12.0ms cacheHits=240 cacheMisses=80 fallback=none',
    )
    expect(debugSpy).toHaveBeenNthCalledWith(
      2,
      '[perf] editorBlockResolve path=/vault/large.md strategy=direct-markdown bytes=65536 blocks=320 duration=9.0ms fallback=none',
    )
    expect(debugSpy).toHaveBeenNthCalledWith(
      3,
      '[perf] editorBlockApply path=/vault/large.md blocks=320 duration=14.0ms mode=sync chunks=1',
    )
    expect(debugSpy).toHaveBeenNthCalledWith(
      4,
      '[perf] editorStabilityCheck path=/vault/large.md bytes=65536 duration=8.0ms matched=true',
    )
    expect(debugSpy).toHaveBeenNthCalledWith(
      5,
      '[perf] parsedBlockPreload path=/vault/next.md state=prepared bytes=71680 duration=11.0ms reason=none',
    )
  })
})
