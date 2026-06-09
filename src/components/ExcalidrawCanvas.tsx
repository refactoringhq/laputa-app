import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Excalidraw, serializeAsJSON } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type {
  AppState,
  BinaryFiles,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { useDocumentThemeMode } from '../hooks/useDocumentThemeMode'

const DEFAULT_HEIGHT = 520
const MIN_HEIGHT = 260
const MIN_WIDTH = 360
const SAVE_DEBOUNCE_MS = 350

export interface ExcalidrawCanvasProps {
  boardId: string
  height: string
  width: string
  snapshot: string
  fillParent?: boolean
  readOnly?: boolean
  onSnapshotChange: (snapshot: string) => void
}

interface ParsedScene {
  elements: readonly ExcalidrawElement[]
  appState: Partial<AppState>
  files: BinaryFiles
}

function parsePixelValue(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function cssSize({ fillParent, height, width }: { fillParent: boolean; height: string; width: string }): CSSProperties {
  if (fillParent) return { height: '100%', width: '100%' }
  const heightPx = Math.max(MIN_HEIGHT, parsePixelValue(height, DEFAULT_HEIGHT))
  const widthCss = width ? `${Math.max(MIN_WIDTH, parsePixelValue(width, MIN_WIDTH))}px` : '100%'
  return {
    height: `${heightPx}px`,
    width: widthCss,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseExcalidrawScene(source: string): ParsedScene | null {
  if (!source.trim()) return { elements: [], appState: {}, files: {} }

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null

  const elements = Array.isArray(parsed.elements) ? (parsed.elements as ExcalidrawElement[]) : []
  const appState = isRecord(parsed.appState) ? (parsed.appState as Partial<AppState>) : {}
  const files = isRecord(parsed.files) ? (parsed.files as BinaryFiles) : {}
  return { elements, appState, files }
}

function snapshotFromScene(elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles): string {
  return `${serializeAsJSON(elements, appState, files, 'local')}\n`
}

export function ExcalidrawCanvas({
  boardId,
  height,
  width,
  snapshot,
  fillParent = false,
  readOnly = false,
  onSnapshotChange,
}: ExcalidrawCanvasProps) {
  const themeMode = useDocumentThemeMode()
  const lastSerializedRef = useRef<string | null>(null)
  const onSnapshotChangeRef = useRef(onSnapshotChange)
  const userInteractedRef = useRef(false)
  const debounceRef = useRef<number | null>(null)
  const pendingSnapshotRef = useRef<string | null>(null)

  // Excalidraw consumes initialData on mount only; the parent remounts via `key`
  // to load a different scene, so this is computed once from the initial snapshot.
  const [initialData] = useState<ExcalidrawInitialDataState | null>(() => {
    const parsed = parseExcalidrawScene(snapshot)
    if (!parsed) return null
    return {
      elements: parsed.elements,
      appState: parsed.appState,
      files: parsed.files,
    }
  })

  useEffect(() => {
    onSnapshotChangeRef.current = onSnapshotChange
  }, [onSnapshotChange])

  useEffect(() => () => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
      const pending = pendingSnapshotRef.current
      if (pending !== null && userInteractedRef.current) {
        onSnapshotChangeRef.current(pending)
      }
    }
  }, [])

  const handleChange = (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (readOnly) return
    const next = snapshotFromScene(elements, appState, files)

    if (lastSerializedRef.current === null) {
      lastSerializedRef.current = next
      return
    }
    if (next === lastSerializedRef.current) return

    userInteractedRef.current = true
    lastSerializedRef.current = next
    pendingSnapshotRef.current = next

    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      const pending = pendingSnapshotRef.current
      if (pending === null) return
      pendingSnapshotRef.current = null
      onSnapshotChangeRef.current(pending)
    }, SAVE_DEBOUNCE_MS)
  }

  if (!initialData) {
    return (
      <div
        className="excalidraw-canvas excalidraw-canvas--error"
        data-board-id={boardId}
        role="alert"
        style={cssSize({ fillParent, height, width })}
      >
        <pre className="excalidraw-canvas__raw">{snapshot}</pre>
      </div>
    )
  }

  return (
    <div
      className="excalidraw-canvas"
      contentEditable={false}
      data-board-id={boardId}
      style={cssSize({ fillParent, height, width })}
    >
      <Excalidraw
        initialData={initialData}
        onChange={handleChange}
        theme={themeMode}
        viewModeEnabled={readOnly}
      />
    </div>
  )
}
