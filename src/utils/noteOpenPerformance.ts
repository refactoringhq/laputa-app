import {
  canMeasurePerformance,
  formatDuration,
  logPerf,
} from './performanceLogging'

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

function measureDuration(
  trace: NoteOpenTrace,
  start: keyof NoteOpenTrace['marks'] | 'startedAt',
  end: keyof NoteOpenTrace['marks'],
): number | null {
  const startTime = start === 'startedAt' ? trace.startedAt : Reflect.get(trace.marks, start) as number | undefined
  const endTime = Reflect.get(trace.marks, end) as number | undefined
  if (startTime === undefined || endTime === undefined) return null
  return endTime - startTime
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
  Reflect.set(trace.marks, stage, performance.now())
}

function editorSwapDuration(trace: NoteOpenTrace): number | null {
  const candidateStarts: Array<keyof NoteOpenTrace['marks'] | 'startedAt'> = [
    'contentLoadEnd',
    'freshnessCheckEnd',
    'beforeNavigateEnd',
    'startedAt',
  ]
  for (const start of candidateStarts) {
    const duration = measureDuration(trace, start, 'editorSwapped')
    if (duration !== null) return duration
  }
  return null
}

function cacheStatus(trace: NoteOpenTrace): 'hit' | 'miss' {
  return Reflect.get(trace.marks, 'cacheReady') === undefined ? 'miss' : 'hit'
}

export function finishNoteOpenTrace(path: string): void {
  if (!canMeasurePerformance()) return
  const trace = inFlightNoteOpens.get(path)
  if (!trace) return

  Reflect.set(trace.marks, 'editorSwapped', performance.now())
  const editorSwappedAt = Reflect.get(trace.marks, 'editorSwapped') as number
  const total = editorSwappedAt - trace.startedAt
  const beforeNavigate = measureDuration(trace, 'beforeNavigateStart', 'beforeNavigateEnd')
  const freshnessCheck = measureDuration(trace, 'freshnessCheckStart', 'freshnessCheckEnd')
  const contentLoad = measureDuration(trace, 'contentLoadStart', 'contentLoadEnd')
  const editorSwap = editorSwapDuration(trace)

  logPerf(
    `noteOpen path=${path} source=${trace.source} total=${formatDuration(total)} `
    + `beforeNavigate=${formatDuration(beforeNavigate)} `
    + `freshnessCheck=${formatDuration(freshnessCheck)} `
    + `contentLoad=${formatDuration(contentLoad)} `
    + `editorSwap=${formatDuration(editorSwap)} `
    + `cache=${cacheStatus(trace)}`,
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
