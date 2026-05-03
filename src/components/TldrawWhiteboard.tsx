import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Tldraw,
  createTLStore,
  getSnapshot,
  loadSnapshot,
  type TLStoreSnapshot,
} from 'tldraw'
import 'tldraw/tldraw.css'

interface TldrawWhiteboardProps {
  boardId: string
  height: string
  snapshot: string
  width: string
  onSnapshotChange: (snapshot: string) => void
  onSizeChange: (size: TldrawWhiteboardSize) => void
}

interface TldrawWhiteboardSize {
  height: string
  width: string
}

interface PixelSize {
  height: number
  width: number | null
}

interface ResizeStart {
  height: number
  pointerX: number
  pointerY: number
  width: number
}

type ResizeMode = 'height' | 'width' | 'both'

const DEFAULT_HEIGHT = 520
const MIN_HEIGHT = 260
const MIN_WIDTH = 360

function parsePixelValue(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeSize({ height, width }: TldrawWhiteboardSize): PixelSize {
  return {
    height: parsePixelValue(height, DEFAULT_HEIGHT),
    width: width ? parsePixelValue(width, MIN_WIDTH) : null,
  }
}

function sizeToProps({ height, width }: PixelSize): TldrawWhiteboardSize {
  return {
    height: String(Math.max(MIN_HEIGHT, Math.round(height))),
    width: width === null ? '' : String(Math.max(MIN_WIDTH, Math.round(width))),
  }
}

function cssSize({ height, width }: PixelSize): CSSProperties {
  return {
    '--tldraw-whiteboard-height': `${Math.max(MIN_HEIGHT, height)}px`,
    '--tldraw-whiteboard-width': width === null ? '100%' : `${Math.max(MIN_WIDTH, width)}px`,
  } as CSSProperties
}

function parseSnapshot(source: string): TLStoreSnapshot | null {
  if (!source.trim()) return null

  try {
    return JSON.parse(source) as TLStoreSnapshot
  } catch {
    return null
  }
}

function serializeSnapshot(snapshot: TLStoreSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`
}

export function TldrawWhiteboard({
  boardId,
  height,
  snapshot,
  width,
  onSnapshotChange,
  onSizeChange,
}: TldrawWhiteboardProps) {
  const store = useMemo(() => createTLStore(), [])
  const boardRef = useRef<HTMLDivElement | null>(null)
  const savedSnapshotRef = useRef<string | null>(null)
  const onSnapshotChangeRef = useRef(onSnapshotChange)
  const persistedSize = useMemo(() => normalizeSize({ height, width }), [height, width])
  const [resizingSize, setResizingSize] = useState<PixelSize | null>(null)
  const visibleSize = resizingSize ?? persistedSize

  useEffect(() => {
    onSnapshotChangeRef.current = onSnapshotChange
  }, [onSnapshotChange])

  useEffect(() => {
    if (snapshot === savedSnapshotRef.current) return

    const parsed = parseSnapshot(snapshot)
    if (parsed) {
      try {
        loadSnapshot(store, parsed)
        savedSnapshotRef.current = snapshot
        return
      } catch {
        // Fall through to an empty board when legacy or hand-edited JSON is invalid.
      }
    }

    savedSnapshotRef.current = serializeSnapshot(getSnapshot(store).document)
  }, [snapshot, store])

  useEffect(() => {
    let timeoutId: number | null = null

    const flushSnapshot = () => {
      timeoutId = null
      const nextSnapshot = serializeSnapshot(getSnapshot(store).document)
      if (nextSnapshot === savedSnapshotRef.current) return

      savedSnapshotRef.current = nextSnapshot
      onSnapshotChangeRef.current(nextSnapshot)
    }

    const scheduleSnapshotFlush = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId)
      timeoutId = window.setTimeout(flushSnapshot, 350)
    }

    const cleanup = store.listen(scheduleSnapshotFlush, { source: 'user', scope: 'document' })
    return () => {
      cleanup()
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [store])

  const startResize = (mode: ResizeMode) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const rect = boardRef.current?.getBoundingClientRect()
    const start: ResizeStart = {
      height: visibleSize.height,
      pointerX: event.clientX,
      pointerY: event.clientY,
      width: visibleSize.width ?? rect?.width ?? MIN_WIDTH,
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      const nextSize = {
        height: mode === 'width' ? start.height : start.height + moveEvent.clientY - start.pointerY,
        width: mode === 'height' ? visibleSize.width : start.width + moveEvent.clientX - start.pointerX,
      }
      setResizingSize(normalizeSize(sizeToProps(nextSize)))
    }

    const onPointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)

      const finalSize = {
        height: mode === 'width' ? start.height : start.height + upEvent.clientY - start.pointerY,
        width: mode === 'height' ? visibleSize.width : start.width + upEvent.clientX - start.pointerX,
      }
      const nextProps = sizeToProps(normalizeSize(sizeToProps(finalSize)))
      setResizingSize(null)
      onSizeChange(nextProps)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp, { once: true })
  }

  return (
    <div
      ref={boardRef}
      className="tldraw-whiteboard"
      data-board-id={boardId}
      style={cssSize(visibleSize)}
    >
      <Tldraw store={store} />
      <div
        aria-label="Resize whiteboard width"
        className="tldraw-whiteboard__resize-handle tldraw-whiteboard__resize-handle--width"
        onPointerDown={startResize('width')}
        role="separator"
      />
      <div
        aria-label="Resize whiteboard height"
        className="tldraw-whiteboard__resize-handle tldraw-whiteboard__resize-handle--height"
        onPointerDown={startResize('height')}
        role="separator"
      />
      <div
        aria-label="Resize whiteboard"
        className="tldraw-whiteboard__resize-handle tldraw-whiteboard__resize-handle--corner"
        onPointerDown={startResize('both')}
        role="separator"
      />
    </div>
  )
}
