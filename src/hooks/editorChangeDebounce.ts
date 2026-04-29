import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'

export const RICH_EDITOR_CHANGE_DEBOUNCE_MS = 150

export function useDebouncedEditorChange({
  onFlush,
  suppressChangeRef,
}: {
  onFlush: () => void
  suppressChangeRef: MutableRefObject<boolean>
}) {
  const pendingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const flushPendingEditorChange = useCallback(() => {
    if (!pendingRef.current) return false
    clearTimer()
    pendingRef.current = false
    onFlush()
    return true
  }, [clearTimer, onFlush])

  const handleEditorChange = useCallback(() => {
    if (suppressChangeRef.current) return

    pendingRef.current = true
    clearTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void flushPendingEditorChange()
    }, RICH_EDITOR_CHANGE_DEBOUNCE_MS)
  }, [clearTimer, flushPendingEditorChange, suppressChangeRef])

  useEffect(() => {
    return () => {
      void flushPendingEditorChange()
      clearTimer()
    }
  }, [clearTimer, flushPendingEditorChange])

  return { handleEditorChange, flushPendingEditorChange }
}

export function consumeRawModeTransition(
  prevRawModeRef: MutableRefObject<boolean>,
  rawMode: boolean | undefined,
) {
  const rawModeJustEnded = prevRawModeRef.current && !rawMode
  prevRawModeRef.current = !!rawMode
  return rawModeJustEnded
}

export function flushBeforeRawMode(options: {
  rawMode?: boolean
  flushPendingEditorChange: () => boolean
}) {
  const { rawMode, flushPendingEditorChange } = options
  if (!rawMode) return false
  flushPendingEditorChange()
  return true
}

export function flushBeforePathChange(options: {
  pathChanged: boolean
  flushPendingEditorChange: () => boolean
}) {
  const { pathChanged, flushPendingEditorChange } = options
  if (pathChanged) flushPendingEditorChange()
}
