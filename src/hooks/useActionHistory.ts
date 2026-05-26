import { useCallback, useMemo, useRef, useState } from 'react'

export interface ActionHistoryEntry {
  label: string
  undo: () => void | Promise<void>
  redo: () => void | Promise<void>
}

export interface ActionHistoryController {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
  isReplaying: () => boolean
  record: (entry: ActionHistoryEntry) => void
  undo: () => Promise<boolean>
  redo: () => Promise<boolean>
  withoutRecording: <T>(run: () => T | Promise<T>) => Promise<T>
}

interface ActionHistorySnapshot {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
}

function snapshot(
  undoStack: readonly ActionHistoryEntry[],
  redoStack: readonly ActionHistoryEntry[],
): ActionHistorySnapshot {
  return {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoLabel: undoStack.at(-1)?.label ?? null,
    redoLabel: redoStack.at(-1)?.label ?? null,
  }
}

export function useActionHistory(): ActionHistoryController {
  const undoStackRef = useRef<ActionHistoryEntry[]>([])
  const redoStackRef = useRef<ActionHistoryEntry[]>([])
  const replayDepthRef = useRef(0)
  const [state, setState] = useState<ActionHistorySnapshot>(() => snapshot([], []))

  const publish = useCallback(() => {
    setState(snapshot(undoStackRef.current, redoStackRef.current))
  }, [])

  const isReplaying = useCallback(() => replayDepthRef.current > 0, [])

  const withoutRecording = useCallback(async <T,>(run: () => T | Promise<T>): Promise<T> => {
    replayDepthRef.current += 1
    try {
      return await run()
    } finally {
      replayDepthRef.current = Math.max(0, replayDepthRef.current - 1)
    }
  }, [])

  const record = useCallback((entry: ActionHistoryEntry) => {
    if (isReplaying()) return
    undoStackRef.current = [...undoStackRef.current, entry]
    redoStackRef.current = []
    publish()
  }, [isReplaying, publish])

  const undo = useCallback(async () => {
    const entry = undoStackRef.current.at(-1)
    if (!entry) return false

    await withoutRecording(entry.undo)
    undoStackRef.current = undoStackRef.current.slice(0, -1)
    redoStackRef.current = [...redoStackRef.current, entry]
    publish()
    return true
  }, [publish, withoutRecording])

  const redo = useCallback(async () => {
    const entry = redoStackRef.current.at(-1)
    if (!entry) return false

    await withoutRecording(entry.redo)
    redoStackRef.current = redoStackRef.current.slice(0, -1)
    undoStackRef.current = [...undoStackRef.current, entry]
    publish()
    return true
  }, [publish, withoutRecording])

  return useMemo(() => ({
    ...state,
    isReplaying,
    record,
    undo,
    redo,
    withoutRecording,
  }), [isReplaying, record, redo, state, undo, withoutRecording])
}
