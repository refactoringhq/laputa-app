import { useEffect, type MutableRefObject } from 'react'

const PREPARED_NOTE_PRELOAD_DELAY_MS = 75

interface PreparedNotePreloadOptions {
  eventName: string
  editorMountedRef: MutableRefObject<boolean>
  rawMode?: boolean
  preparePath: (path: string) => Promise<void> | void
}

interface PreloadQueueState {
  timer: number | null
  cancelled: boolean
  paths: string[]
}

interface PreloadRunnerOptions extends Omit<PreparedNotePreloadOptions, 'eventName'> {
  state: PreloadQueueState
}

function canSchedulePreload(state: PreloadQueueState): boolean {
  return state.timer === null && state.paths.length > 0
}

function canRunPreload({ state, rawMode, editorMountedRef }: PreloadRunnerOptions): boolean {
  return !state.cancelled && !rawMode && editorMountedRef.current
}

function schedulePreparedPreload(options: PreloadRunnerOptions): void {
  const { state } = options
  if (!canSchedulePreload(state)) return

  state.timer = window.setTimeout(() => {
    state.timer = null
    if (!canRunPreload(options)) return

    const nextPath = state.paths.shift()
    if (!nextPath) return
    Promise.resolve(options.preparePath(nextPath)).finally(() => {
      schedulePreparedPreload(options)
    })
  }, PREPARED_NOTE_PRELOAD_DELAY_MS)
}

function enqueuePreloadPath(state: PreloadQueueState, path: string): void {
  if (state.paths.includes(path)) return
  state.paths.push(path)
}

function resolvedContentPath(event: Event): string | null {
  return (event as CustomEvent<{ path?: string }>).detail?.path ?? null
}

function cancelPreloadQueue(state: PreloadQueueState): void {
  state.cancelled = true
  if (state.timer !== null) window.clearTimeout(state.timer)
}

export function usePreparedNotePreload({
  eventName,
  editorMountedRef,
  rawMode,
  preparePath,
}: PreparedNotePreloadOptions) {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const state: PreloadQueueState = { timer: null, cancelled: false, paths: [] }
    const runner = { state, editorMountedRef, rawMode, preparePath }

    const handleResolvedContent = (event: Event) => {
      const path = resolvedContentPath(event)
      if (!path) return
      enqueuePreloadPath(state, path)
      schedulePreparedPreload(runner)
    }

    window.addEventListener(eventName, handleResolvedContent)
    return () => {
      cancelPreloadQueue(state)
      window.removeEventListener(eventName, handleResolvedContent)
    }
  }, [editorMountedRef, eventName, preparePath, rawMode])
}
