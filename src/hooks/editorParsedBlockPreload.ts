import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { NoteContentResolvedEvent } from './noteContentCache'
import { subscribeNoteContentResolved } from './noteContentCache'

export const PARSED_BLOCK_PRELOAD_MIN_BYTES = 32 * 1024
export const PARSED_BLOCK_PRELOAD_DELAY_MS = 1800
export const PARSED_BLOCK_PRELOAD_FOREGROUND_IDLE_MS = 1500

type PrepareParsedBlocks = (event: NoteContentResolvedEvent) => Promise<void>

interface ParsedBlockPreloadOptions {
  activeTabPathRef: MutableRefObject<string | null>
  editorMountedRef: MutableRefObject<boolean>
  foregroundWorkAtRef: MutableRefObject<number>
  prepareParsedBlocks: PrepareParsedBlocks
  rawModeRef: MutableRefObject<boolean>
}

function canPreloadParsedBlocks(event: NoteContentResolvedEvent, activeTabPath: string | null): boolean {
  const { entry } = event
  if (!entry || entry.path === activeTabPath) return false
  if ((entry.fileKind ?? 'markdown') !== 'markdown') return false
  return entry.fileSize >= PARSED_BLOCK_PRELOAD_MIN_BYTES
}

function shouldDeferParsedPreload(options: {
  editorMountedRef: MutableRefObject<boolean>
  foregroundWorkAtRef: MutableRefObject<number>
  rawModeRef: MutableRefObject<boolean>
}) {
  const { editorMountedRef, foregroundWorkAtRef, rawModeRef } = options
  if (!editorMountedRef.current || rawModeRef.current) return true
  return Date.now() - foregroundWorkAtRef.current < PARSED_BLOCK_PRELOAD_FOREGROUND_IDLE_MS
}

function takeNextCandidate(
  queue: Map<string, NoteContentResolvedEvent>,
  activeTabPath: string | null,
): NoteContentResolvedEvent | null {
  for (const candidate of queue.values()) {
    queue.delete(candidate.path)
    if (candidate.path !== activeTabPath) return candidate
  }
  return null
}

function clearScheduledTimer(timerRef: MutableRefObject<number | null>): void {
  if (timerRef.current === null) return
  window.clearTimeout(timerRef.current)
  timerRef.current = null
}

export function useParsedBlockPreload({
  activeTabPathRef,
  editorMountedRef,
  foregroundWorkAtRef,
  prepareParsedBlocks,
  rawModeRef,
}: ParsedBlockPreloadOptions) {
  const queueRef = useRef<Map<string, NoteContentResolvedEvent>>(new Map())
  const runningRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const runNextRef = useRef<() => void>(() => {})

  const scheduleNext = useCallback(() => {
    if (timerRef.current !== null) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      runNextRef.current()
    }, PARSED_BLOCK_PRELOAD_DELAY_MS)
  }, [])

  const runNext = useCallback(async () => {
    if (runningRef.current) return
    if (shouldDeferParsedPreload({ editorMountedRef, foregroundWorkAtRef, rawModeRef })) {
      scheduleNext()
      return
    }

    const next = takeNextCandidate(queueRef.current, activeTabPathRef.current)
    if (!next) return
    runningRef.current = true
    try {
      await prepareParsedBlocks(next)
    } catch (error) {
      console.warn('Failed to preload parsed note blocks:', error)
    } finally {
      runningRef.current = false
      if (queueRef.current.size > 0) scheduleNext()
    }
  }, [activeTabPathRef, editorMountedRef, foregroundWorkAtRef, prepareParsedBlocks, rawModeRef, scheduleNext])

  useEffect(() => {
    runNextRef.current = () => { void runNext() }
  }, [runNext])

  useEffect(() => {
    const queue = queueRef.current
    const unsubscribe = subscribeNoteContentResolved((event) => {
      if (!canPreloadParsedBlocks(event, activeTabPathRef.current)) return
      queue.set(event.path, event)
      scheduleNext()
    })
    return () => {
      unsubscribe()
      clearScheduledTimer(timerRef)
      queue.clear()
    }
  }, [activeTabPathRef, scheduleNext])
}
