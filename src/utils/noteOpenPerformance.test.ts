import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginNoteOpenTrace,
  failNoteOpenTrace,
  finishNoteOpenTrace,
  logKeyboardNavigationTrace,
  markNoteOpenTrace,
} from './noteOpenPerformance'

const VITEST_WORKER_DESCRIPTOR = Object.getOwnPropertyDescriptor(globalThis, '__vitest_worker__')

describe('noteOpenPerformance', () => {
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

  it('logs a completed note-open trace with detailed stage timing', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const nowSpy = vi.spyOn(performance, 'now')
    nowSpy
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(120)
      .mockReturnValueOnce(150)
      .mockReturnValueOnce(170)
      .mockReturnValueOnce(200)
      .mockReturnValueOnce(245)
      .mockReturnValueOnce(255)
      .mockReturnValueOnce(290)
      .mockReturnValueOnce(315)

    beginNoteOpenTrace('/vault/note.md', 'sidebar')
    markNoteOpenTrace('/vault/note.md', 'beforeNavigateStart')
    markNoteOpenTrace('/vault/note.md', 'beforeNavigateEnd')
    markNoteOpenTrace('/vault/note.md', 'cacheReady')
    markNoteOpenTrace('/vault/note.md', 'freshnessCheckStart')
    markNoteOpenTrace('/vault/note.md', 'freshnessCheckEnd')
    markNoteOpenTrace('/vault/note.md', 'contentLoadStart')
    markNoteOpenTrace('/vault/note.md', 'contentLoadEnd')
    finishNoteOpenTrace('/vault/note.md')

    expect(debugSpy).toHaveBeenCalledWith(
      '[perf] noteOpen path=/vault/note.md source=sidebar total=215.0ms beforeNavigate=30.0ms freshnessCheck=45.0ms contentLoad=35.0ms editorSwap=25.0ms cache=hit',
    )
  })

  it('logs when an in-flight note open is superseded by another one', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const nowSpy = vi.spyOn(performance, 'now')
    nowSpy
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(35)
      .mockReturnValueOnce(55)

    beginNoteOpenTrace('/vault/alpha.md', 'sidebar')
    beginNoteOpenTrace('/vault/beta.md', 'search')
    failNoteOpenTrace('/vault/beta.md', 'cleanup')

    expect(debugSpy).toHaveBeenNthCalledWith(
      1,
      '[perf] noteOpen cancel path=/vault/alpha.md source=sidebar total=25.0ms reason=superseded',
    )
    expect(debugSpy).toHaveBeenNthCalledWith(
      2,
      '[perf] noteOpen cancel path=/vault/beta.md source=search total=20.0ms reason=cleanup',
    )
  })

  it('only logs keyboard traces when the list is large or slow enough', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    logKeyboardNavigationTrace('down', 100, 3)
    logKeyboardNavigationTrace('up', 600, 5)

    expect(debugSpy).toHaveBeenCalledTimes(1)
    expect(debugSpy).toHaveBeenCalledWith(
      '[perf] noteListKeyboard direction=up items=600 move=5.0ms',
    )
  })
})
