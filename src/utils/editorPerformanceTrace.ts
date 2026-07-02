function isVitestRuntime(): boolean {
  return '__vitest_worker__' in globalThis
}

function canMeasurePerformance(): boolean {
  return import.meta.env.DEV && typeof performance !== 'undefined' && !isVitestRuntime()
}

function formatDuration(durationMs: number | null): string {
  return durationMs === null ? 'n/a' : `${durationMs.toFixed(1)}ms`
}

function logPerf(message: string): void {
  if (!canMeasurePerformance()) return
  console.debug(`[perf] ${message}`)
}

export function logRichEditorSerializationTrace(options: {
  blockCount: number
  cacheHits?: number
  cacheMisses?: number
  durationMs: number
  fallbackReason?: string | null
  notePath?: string
}): void {
  if (!canMeasurePerformance()) return
  const { blockCount, cacheHits, cacheMisses, durationMs, fallbackReason, notePath } = options
  if (blockCount < 200 && durationMs < 4) return

  logPerf(
    `richEditorSerialize path=${notePath ?? 'unknown'} blocks=${blockCount} `
    + `duration=${formatDuration(durationMs)} `
    + `cacheHits=${cacheHits ?? 0} cacheMisses=${cacheMisses ?? 0} `
    + `fallback=${fallbackReason ?? 'none'}`,
  )
}

export function logRichEditorDispatchTrace(options: {
  docChanged: boolean
  docSize: number
  durationMs: number
  notePath?: string | null
  stepCount: number
}): void {
  if (!canMeasurePerformance()) return
  const { docChanged, docSize, durationMs, notePath, stepCount } = options
  if (!docChanged && durationMs < 8) return
  if (docSize < 32 * 1024 && durationMs < 4) return

  logPerf(
    `richEditorDispatch path=${notePath ?? 'unknown'} docChanged=${String(docChanged)} `
    + `steps=${stepCount} docSize=${docSize} duration=${formatDuration(durationMs)}`,
  )
}

export function logEditorStabilityCheckTrace(options: {
  durationMs: number
  matched: boolean
  notePath: string
  sourceBytes: number
}): void {
  if (!canMeasurePerformance()) return
  const { durationMs, matched, notePath, sourceBytes } = options
  if (sourceBytes < 32 * 1024 && durationMs < 4) return

  logPerf(
    `editorStabilityCheck path=${notePath} bytes=${sourceBytes} `
    + `duration=${formatDuration(durationMs)} matched=${String(matched)}`,
  )
}

export function logEditorBlockResolutionTrace(options: {
  blockCount: number
  durationMs: number
  fallbackReason?: string | null
  notePath: string
  sourceBytes: number
  strategy: 'blank' | 'blocknote-parser' | 'direct-markdown' | 'fast-h1' | 'parsed-cache' | 'tab-cache'
}): void {
  if (!canMeasurePerformance()) return
  const { blockCount, durationMs, fallbackReason, notePath, sourceBytes, strategy } = options
  if (sourceBytes < 32 * 1024 && durationMs < 4) return

  logPerf(
    `editorBlockResolve path=${notePath} strategy=${strategy} `
    + `bytes=${sourceBytes} blocks=${blockCount} duration=${formatDuration(durationMs)} `
    + `fallback=${fallbackReason ?? 'none'}`,
  )
}

export function logEditorBlockApplyTrace(options: {
  blockCount: number
  chunks?: number
  durationMs: number
  mode?: 'progressive' | 'sync'
  notePath: string
}): void {
  if (!canMeasurePerformance()) return
  const { blockCount, chunks, durationMs, mode, notePath } = options
  if (blockCount < 200 && durationMs < 4) return

  logPerf(
    `editorBlockApply path=${notePath} blocks=${blockCount} `
    + `duration=${formatDuration(durationMs)} mode=${mode ?? 'sync'} chunks=${chunks ?? 1}`,
  )
}

export function logParsedBlockPreloadTrace(options: {
  durationMs?: number
  notePath: string
  reason?: string
  sourceBytes?: number
  state: 'deferred' | 'prepared' | 'queued' | 'skipped'
}): void {
  if (!canMeasurePerformance()) return
  const { durationMs, notePath, reason, sourceBytes, state } = options
  if (state === 'skipped' && !reason) return

  logPerf(
    `parsedBlockPreload path=${notePath} state=${state} `
    + `bytes=${sourceBytes ?? 0} duration=${formatDuration(durationMs ?? null)} `
    + `reason=${reason ?? 'none'}`,
  )
}
