import { useCallback, useMemo, useRef, useState } from 'react'

export interface ActionHistoryEntry {
  id?: string
  label: string
  path?: string
  undo: () => Promise<void> | void
  redo: () => Promise<void> | void
}

export interface ActionHistoryController {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
  isReplaying: () => boolean
  record: (entry: ActionHistoryEntry) => (() => void) | void
  recordAction: (entry: ActionHistoryEntry) => (() => void) | void
  undo: () => Promise<boolean>
  redo: () => Promise<boolean>
  withoutRecording: <T>(run: () => T | Promise<T>) => Promise<T>
}

interface ActionHistoryConfig {
  onRevealTarget?: (item: ActionHistoryEntry) => Promise<void> | void
  onToast?: (message: string) => void
}

type HistoryDirection = 'undo' | 'redo'

interface ActionHistorySnapshot {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
}

function actionFailureMessage(direction: HistoryDirection, label: string): string {
  return `Failed to ${direction} ${label.toLowerCase()}`
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

function withoutItem(
  stack: readonly ActionHistoryEntry[],
  item: ActionHistoryEntry,
): ActionHistoryEntry[] {
  if (item.id) return stack.filter((candidate) => candidate.id !== item.id)
  return stack.filter((candidate) => candidate !== item)
}

async function replayHistoryItem(direction: HistoryDirection, item: ActionHistoryEntry): Promise<void> {
  if (direction === 'undo') {
    await item.undo()
    return
  }
  await item.redo()
}

export function useActionHistory({ onRevealTarget, onToast }: ActionHistoryConfig = {}): ActionHistoryController {
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

  const record = useCallback((item: ActionHistoryEntry) => {
    if (isReplaying()) return undefined
    undoStackRef.current = [...undoStackRef.current, item]
    redoStackRef.current = []
    publish()
    return () => {
      undoStackRef.current = withoutItem(undoStackRef.current, item)
      redoStackRef.current = withoutItem(redoStackRef.current, item)
      publish()
    }
  }, [isReplaying, publish])

  const replay = useCallback(async (direction: HistoryDirection): Promise<boolean> => {
    if (isReplaying()) return false
    const source = direction === 'undo' ? undoStackRef : redoStackRef
    const destination = direction === 'undo' ? redoStackRef : undoStackRef
    const item = source.current.at(-1)
    if (!item) return false

    source.current = source.current.slice(0, -1)
    publish()

    try {
      await withoutRecording(async () => {
        if (item.path) await onRevealTarget?.(item)
        await replayHistoryItem(direction, item)
      })
      destination.current = [...destination.current, item]
      publish()
      return true
    } catch (error) {
      source.current = [...source.current, item]
      onToast?.(actionFailureMessage(direction, item.label))
      console.warn(`[action-history] Failed to ${direction} action`, error)
      publish()
      return false
    }
  }, [isReplaying, onRevealTarget, onToast, publish, withoutRecording])

  return useMemo(() => ({
    ...state,
    isReplaying,
    record,
    recordAction: record,
    redo: () => replay('redo'),
    undo: () => replay('undo'),
    withoutRecording,
  }), [isReplaying, record, replay, state, withoutRecording])
}
