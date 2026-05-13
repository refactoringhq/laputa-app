import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import { Dialog as DialogPrimitive } from 'radix-ui'
import {
  Box,
  Tldraw,
  createTLStore,
  defaultUserPreferences,
  getSnapshot,
  loadSnapshot,
  useDialogs,
  useTldrawUser,
  useValue,
  type Editor,
  type TLEventInfo,
  type TLUiDialog,
  type TLStoreSnapshot,
  type TLUserPreferences,
} from 'tldraw'
import 'tldraw/tldraw.css'
import { useDocumentThemeMode } from '../hooks/useDocumentThemeMode'
import type { ResolvedThemeMode } from '../lib/themeMode'
import { installTldrawTextMeasurementGuard } from './tldrawTextMeasurementGuard'

const EMPTY_TLDRAW_TRANSLATION_URL = 'data:application/json;base64,e30K'
const TOLARIA_TLDRAW_USER_ID = 'tolaria-whiteboard'

function resolveTldrawAssetUrl(assetUrl: string | undefined): string {
  return assetUrl ?? EMPTY_TLDRAW_TRANSLATION_URL
}

const tldrawAssetUrls = getAssetUrlsByImport(resolveTldrawAssetUrl)

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

function tldrawUserPreferences(themeMode: ResolvedThemeMode): TLUserPreferences {
  return {
    ...defaultUserPreferences,
    id: TOLARIA_TLDRAW_USER_ID,
    colorScheme: themeMode,
  }
}

function ignoreTldrawUserPreferencesUpdate(preferences: TLUserPreferences) {
  void preferences
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

function documentZoom(): number {
  const inlineZoom = document.documentElement.style.getPropertyValue('zoom')
  const computedZoom = getComputedStyle(document.documentElement).zoom
  const zoom = inlineZoom || computedZoom
  const parsed = Number.parseFloat(zoom)
  if (!Number.isFinite(parsed) || parsed <= 0) return 1
  return zoom.endsWith('%') ? parsed / 100 : parsed
}

function viewportBounds(screenBounds: Box | HTMLElement): Box | HTMLElement {
  if (screenBounds instanceof Box) return screenBounds

  const zoom = documentZoom()
  if (zoom === 1) return screenBounds

  const rect = screenBounds.getBoundingClientRect()
  return new Box(
    (rect.left || rect.x) / zoom,
    (rect.top || rect.y) / zoom,
    Math.max(rect.width / zoom, 1),
    Math.max(rect.height / zoom, 1),
  )
}

function zoomAdjustedPoint<T extends { x: number; y: number; z?: number }>(point: T, zoom: number): T {
  return {
    ...point,
    x: point.x / zoom,
    y: point.y / zoom,
  }
}

function zoomAdjustedEvent(info: TLEventInfo): TLEventInfo {
  const zoom = documentZoom()
  if (zoom === 1) return info

  switch (info.type) {
    case 'click':
    case 'pinch':
    case 'pointer':
    case 'wheel':
      return {
        ...info,
        point: zoomAdjustedPoint(info.point, zoom),
      } as TLEventInfo
    default:
      return info
  }
}

function installZoomAwareViewport(editor: Editor): () => void {
  const updateViewportScreenBounds = editor.updateViewportScreenBounds.bind(editor)
  const updateViewport: Editor['updateViewportScreenBounds'] = (screenBounds, center) =>
    updateViewportScreenBounds(viewportBounds(screenBounds), center)
  const dispatch = editor.dispatch.bind(editor)
  const animationFrameIds: number[] = []
  const timeoutIds: number[] = []

  editor.updateViewportScreenBounds = updateViewport
  editor.dispatch = (info: TLEventInfo) => dispatch(zoomAdjustedEvent(info))

  const updateCurrentCanvas = () => {
    const canvas = editor.getContainer().querySelector<HTMLElement>('.tl-canvas')
    if (canvas) updateViewport(canvas)
  }

  const scheduleViewportUpdate = () => {
    updateCurrentCanvas()
    animationFrameIds.push(window.requestAnimationFrame(updateCurrentCanvas))
    timeoutIds.push(window.setTimeout(updateCurrentCanvas, 150))
  }

  scheduleViewportUpdate()
  window.addEventListener('laputa-zoom-change', scheduleViewportUpdate)

  return () => {
    window.removeEventListener('laputa-zoom-change', scheduleViewportUpdate)
    animationFrameIds.forEach((id) => window.cancelAnimationFrame(id))
    timeoutIds.forEach((id) => window.clearTimeout(id))
    editor.updateViewportScreenBounds = updateViewportScreenBounds
    editor.dispatch = dispatch
  }
}

function installWhiteboardRuntimeGuards(editor: Editor): () => void {
  const cleanupTextMeasurementGuard = installTldrawTextMeasurementGuard(editor)
  const cleanupZoomAwareViewport = installZoomAwareViewport(editor)

  return () => {
    cleanupZoomAwareViewport()
    cleanupTextMeasurementGuard()
  }
}

interface TolariaTldrawDialogProps {
  dialog: TLUiDialog
  onClose: (id: string) => void
}

const DIALOG_OPEN_DISMISS_GRACE_MS = 250
let retainedTolariaTldrawDialogs: TLUiDialog[] = []

function useDeferredDialogOpen() {
  const openedAtRef = useRef(0)
  const [readyToOpen, setReadyToOpen] = useState(false)

  useEffect(() => {
    const animationFrameId = window.requestAnimationFrame(() => {
      openedAtRef.current = performance.now()
      setReadyToOpen(true)
    })
    return () => { window.cancelAnimationFrame(animationFrameId) }
  }, [])

  return { openedAtRef, readyToOpen }
}

function canDismissDialog(openedAt: number): boolean {
  return performance.now() - openedAt >= DIALOG_OPEN_DISMISS_GRACE_MS
}

function isOverlayEvent(event: ReactMouseEvent<HTMLDivElement>): boolean {
  return event.target === event.currentTarget
}

function shouldCloseFromOverlayClick(
  event: ReactMouseEvent<HTMLDivElement>,
  dialog: TLUiDialog,
  mouseDownInsideContent: boolean
): boolean {
  return isOverlayEvent(event) && !dialog.preventBackgroundClose && !mouseDownInsideContent
}

interface TolariaTldrawDialogContentProps {
  dialog: TLUiDialog
  mouseDownInsideContentRef: MutableRefObject<boolean>
  onClose: () => void
}

function TolariaTldrawDialogContent({
  dialog,
  mouseDownInsideContentRef,
  onClose,
}: TolariaTldrawDialogContentProps) {
  const ModalContent = dialog.component
  const handleClose = () => {
    mouseDownInsideContentRef.current = false
    onClose()
  }

  return (
    <div
      dir="ltr"
      className="tlui-dialog__content"
      aria-describedby={undefined}
      role="dialog"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        mouseDownInsideContentRef.current = false
        onClose()
      }}
      onMouseDown={() => { mouseDownInsideContentRef.current = true }}
      onMouseUp={() => { mouseDownInsideContentRef.current = false }}
    >
      <ModalContent onClose={handleClose} />
    </div>
  )
}

const TolariaTldrawDialog = memo(function TolariaTldrawDialog({ dialog, onClose }: TolariaTldrawDialogProps) {
  const mouseDownInsideContentRef = useRef(false)
  const { openedAtRef, readyToOpen } = useDeferredDialogOpen()

  const closeDialogFromBackground = useCallback(() => {
    if (!canDismissDialog(openedAtRef.current)) return
    onClose(dialog.id)
  }, [dialog.id, onClose, openedAtRef])
  const closeDialogNow = useCallback(() => { onClose(dialog.id) }, [dialog.id, onClose])
  const handleOpenChange = useCallback((isOpen: boolean) => {
    if (!isOpen) closeDialogNow()
  }, [closeDialogNow])

  if (!readyToOpen) return null

  return (
    <DialogPrimitive.Root open onOpenChange={handleOpenChange}>
      <div
        dir="ltr"
        className="tlui-dialog__overlay"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) mouseDownInsideContentRef.current = false
        }}
        onClick={(event) => {
          if (shouldCloseFromOverlayClick(event, dialog, mouseDownInsideContentRef.current)) {
            closeDialogFromBackground()
          }
        }}
      >
        <TolariaTldrawDialogContent
          dialog={dialog}
          mouseDownInsideContentRef={mouseDownInsideContentRef}
          onClose={closeDialogNow}
        />
      </div>
    </DialogPrimitive.Root>
  )
})

function TolariaTldrawDialogs() {
  const { dialogs, removeDialog } = useDialogs()
  const requestedDialogs = useValue('tolaria tldraw dialogs', () => dialogs.get(), [dialogs])
  const [visibleDialogs, setVisibleDialogs] = useState<TLUiDialog[]>(() =>
    retainedTolariaTldrawDialogs.length > 0 ? retainedTolariaTldrawDialogs : dialogs.get()
  )

  const closeVisibleDialog = useCallback((id: string) => {
    const nextDialogs = retainedTolariaTldrawDialogs.filter((dialog) => dialog.id !== id)
    retainedTolariaTldrawDialogs = nextDialogs
    setVisibleDialogs(nextDialogs)
    removeDialog(id)
  }, [removeDialog])

  useEffect(() => {
    if (requestedDialogs.length === 0) return
    // tldraw clears the dialog atom while Radix closes the menu; keep the last requested dialog mounted locally.
    retainedTolariaTldrawDialogs = requestedDialogs
    queueMicrotask(() => {
      setVisibleDialogs(requestedDialogs)
    })
  }, [requestedDialogs])

  return visibleDialogs.map((dialog) => (
    <TolariaTldrawDialog
      key={dialog.id}
      dialog={dialog}
      onClose={closeVisibleDialog}
    />
  ))
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
  const themeMode = useDocumentThemeMode()
  const userPreferences = useMemo(() => tldrawUserPreferences(themeMode), [themeMode])
  const tldrawUser = useTldrawUser({
    setUserPreferences: ignoreTldrawUserPreferencesUpdate,
    userPreferences,
  })
  const tldrawUiComponents = useMemo(() => ({ Dialogs: TolariaTldrawDialogs }), [])

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
      contentEditable={false}
      data-board-id={boardId}
      style={cssSize(visibleSize)}
    >
      <Tldraw
        assetUrls={tldrawAssetUrls}
        components={tldrawUiComponents}
        onMount={installWhiteboardRuntimeGuards}
        store={store}
        user={tldrawUser}
      />
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
