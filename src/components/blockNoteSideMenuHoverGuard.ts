import { useEffect, type RefObject } from 'react'

type RectLike = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>

const HOVER_BRIDGE_PADDING_X = 8
const HOVER_BRIDGE_PADDING_Y = 6

function isVisibleRect(rect: RectLike) {
  return rect.right > rect.left && rect.bottom > rect.top
}

export function isWithinBlockNoteHandleHoverBridge(
  point: { x: number; y: number },
  editorRect: RectLike,
  sideMenuRect: RectLike,
) {
  if (!isVisibleRect(editorRect) || !isVisibleRect(sideMenuRect)) return false

  const left = Math.min(editorRect.left, sideMenuRect.left) - HOVER_BRIDGE_PADDING_X
  const right = Math.max(editorRect.left, sideMenuRect.right) + HOVER_BRIDGE_PADDING_X
  const top = sideMenuRect.top - HOVER_BRIDGE_PADDING_Y
  const bottom = sideMenuRect.bottom + HOVER_BRIDGE_PADDING_Y

  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
}

export function shouldSuppressBlockNoteHandleHoverUpdate({
  eventTarget,
  point,
  container,
  doc,
  hasPressedButton = false,
}: {
  eventTarget: EventTarget | null
  point: { x: number; y: number }
  container: HTMLElement | null
  doc: Document
  hasPressedButton?: boolean
}) {
  if (hasPressedButton) return false
  if (!container) return false

  const editor = container.querySelector('.bn-editor')
  if (!(editor instanceof HTMLElement)) return false

  if (eventTarget instanceof Element && eventTarget.closest('.bn-side-menu')) {
    return true
  }

  const sideMenu = doc.querySelector('.bn-side-menu')
  if (!(sideMenu instanceof HTMLElement)) return false

  return isWithinBlockNoteHandleHoverBridge(
    point,
    editor.getBoundingClientRect(),
    sideMenu.getBoundingClientRect(),
  )
}

export function useBlockNoteSideMenuHoverGuard(
  containerRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const doc = containerRef.current?.ownerDocument
    const view = doc?.defaultView
    if (!doc || !view) return

    const handleMouseMove = (event: MouseEvent) => {
      if (!shouldSuppressBlockNoteHandleHoverUpdate({
        eventTarget: event.target,
        point: { x: event.clientX, y: event.clientY },
        container: containerRef.current,
        doc,
        hasPressedButton: event.buttons !== 0,
      })) {
        return
      }

      event.stopPropagation()
    }

    view.addEventListener('mousemove', handleMouseMove, true)
    return () => view.removeEventListener('mousemove', handleMouseMove, true)
  }, [containerRef])
}
