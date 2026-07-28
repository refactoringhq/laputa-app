import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canMeasurePerformance,
  formatDuration,
  logPerf,
} from './performanceLogging'

const HARNESS_KEY = '__TOLARIA_PERFORMANCE_HARNESS__'
const HARNESS_DESCRIPTOR = Object.getOwnPropertyDescriptor(globalThis, HARNESS_KEY)
const VITEST_WORKER_DESCRIPTOR = Object.getOwnPropertyDescriptor(globalThis, '__vitest_worker__')

function restoreGlobal(key: string, descriptor: PropertyDescriptor | undefined): void {
  Reflect.deleteProperty(globalThis, key)
  if (descriptor) Object.defineProperty(globalThis, key, descriptor)
}

describe('performance logging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Reflect.deleteProperty(globalThis, HARNESS_KEY)
  })

  afterEach(() => {
    restoreGlobal(HARNESS_KEY, HARNESS_DESCRIPTOR)
    restoreGlobal('__vitest_worker__', VITEST_WORKER_DESCRIPTOR)
  })

  it('formats measured and unavailable durations consistently', () => {
    expect(formatDuration(12.34)).toBe('12.3ms')
    expect(formatDuration(null)).toBe('n/a')
  })

  it('lets the performance harness override the vitest guard', () => {
    Reflect.set(globalThis, HARNESS_KEY, true)

    expect(canMeasurePerformance()).toBe(true)
  })

  it('does not log ordinary vitest runs', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    logPerf('noteOpen total=12.3ms')

    expect(canMeasurePerformance()).toBe(false)
    expect(debugSpy).not.toHaveBeenCalled()
  })

  it('prefixes enabled debug messages with the performance contract marker', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    Reflect.set(globalThis, HARNESS_KEY, true)

    logPerf('noteOpen total=12.3ms')

    expect(debugSpy).toHaveBeenCalledWith('[perf] noteOpen total=12.3ms')
  })
})
