type NoteOpenStage =
  | 'beforeNavigateStart'
  | 'beforeNavigateEnd'
  | 'cacheReady'
  | 'freshnessCheckStart'
  | 'freshnessCheckEnd'
  | 'contentLoadStart'
  | 'contentLoadEnd'
  | 'editorSwapped'

interface NoteOpenTrace {
  startedAt: number
  source: string
  marks: Partial<Record<NoteOpenStage, number>>
}

const inFlightNoteOpens = new Map<string, NoteOpenTrace>()

function isVitestRuntime(): boolean {
  return '__vitest_worker__' in globalThis
}

function canMeasurePerformance(): boolean {
  return import.meta.env.DEV && typeof performance !== 'undefined' && !isVitestRuntime()
}

function formatDuration(durationMs: number | null): string {
  return durationMs === null ? 'n/a' : `${durationMs.toFixed(1)}ms`
}

function measureDuration(
  trace: NoteOpenTrace,
  start: keyof NoteOpenTrace['marks'] | 'startedAt',
  end: keyof NoteOpenTrace['marks'],
): number | null {
  const startTime = start === 'startedAt' ? trace.startedAt : trace.marks[start]
  const endTime = trace.marks[end]
  if (startTime === undefined || endTime === undefined) return null
  return endTime - startTime
}

function logPerf(message: string): void {
  if (!canMeasurePerformance()) return
  console.debug(`[perf] ${message}`)
}

export function beginNoteOpenTrace(path: string, source: string): void {
  if (!canMeasurePerformance()) return

  const startedAt = performance.now()
  for (const [otherPath, trace] of inFlightNoteOpens) {
    if (otherPath === path) continue
    logPerf(`noteOpen cancel path=${otherPath} source=${trace.source} total=${formatDuration(startedAt - trace.startedAt)} reason=superseded`)
    inFlightNoteOpens.delete(otherPath)
  }

  inFlightNoteOpens.set(path, { startedAt, source, marks: {} })
}

export function markNoteOpenTrace(path: string, stage: NoteOpenStage): void {
  if (!canMeasurePerformance()) return
  const trace = inFlightNoteOpens.get(path)
  if (!trace) return
  trace.marks[stage] = performance.now()
}

export function finishNoteOpenTrace(path: string): void {
  if (!canMeasurePerformance()) return
  const trace = inFlightNoteOpens.get(path)
  if (!trace) return

  trace.marks.editorSwapped = performance.now()
  const total = trace.marks.editorSwapped - trace.startedAt
  const beforeNavigate = measureDuration(trace, 'beforeNavigateStart', 'beforeNavigateEnd')
  const freshnessCheck = measureDuration(trace, 'freshnessCheckStart', 'freshnessCheckEnd')
  const contentLoad = measureDuration(trace, 'contentLoadStart', 'contentLoadEnd')
  const editorSwap = measureDuration(trace, 'contentLoadEnd', 'editorSwapped')
    ?? measureDuration(trace, 'freshnessCheckEnd', 'editorSwapped')
    ?? measureDuration(trace, 'beforeNavigateEnd', 'editorSwapped')
    ?? measureDuration(trace, 'startedAt', 'editorSwapped')

  logPerf(
    `noteOpen path=${path} source=${trace.source} total=${formatDuration(total)} `
    + `beforeNavigate=${formatDuration(beforeNavigate)} `
    + `freshnessCheck=${formatDuration(freshnessCheck)} `
    + `contentLoad=${formatDuration(contentLoad)} `
    + `editorSwap=${formatDuration(editorSwap)} `
    + `cache=${trace.marks.cacheReady !== undefined ? 'hit' : 'miss'}`,
  )
  inFlightNoteOpens.delete(path)
}

export function failNoteOpenTrace(path: string, reason: string): void {
  if (!canMeasurePerformance()) return
  const trace = inFlightNoteOpens.get(path)
  if (!trace) return

  const total = performance.now() - trace.startedAt
  logPerf(`noteOpen cancel path=${path} source=${trace.source} total=${formatDuration(total)} reason=${reason}`)
  inFlightNoteOpens.delete(path)
}

export function logKeyboardNavigationTrace(
  direction: 'up' | 'down',
  itemCount: number,
  durationMs: number,
): void {
  if (!canMeasurePerformance()) return
  if (itemCount < 500 && durationMs < 4) return
  logPerf(`noteListKeyboard direction=${direction} items=${itemCount} move=${formatDuration(durationMs)}`)
}
