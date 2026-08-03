function isVitestRuntime(): boolean {
  return '__vitest_worker__' in globalThis
}

function isPerformanceHarnessRuntime(): boolean {
  return Reflect.get(globalThis, '__TOLARIA_PERFORMANCE_HARNESS__') === true
}

export function canMeasurePerformance(): boolean {
  const enabled = isPerformanceHarnessRuntime() || (import.meta.env.DEV && !isVitestRuntime())
  return enabled && typeof performance !== 'undefined'
}

export function formatDuration(durationMs: number | null): string {
  return durationMs === null ? 'n/a' : `${durationMs.toFixed(1)}ms`
}

export function logPerf(message: string): void {
  if (!canMeasurePerformance()) return
  console.debug(`[perf] ${message}`)
}
