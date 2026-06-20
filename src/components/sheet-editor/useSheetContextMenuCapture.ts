import { useCallback } from 'react'
import type { Dispatch, MouseEvent as ReactMouseEvent, MutableRefObject, SetStateAction } from 'react'
import { getDocumentZoom } from '../../extensions/zoomCursorFix'
import {
  elementCoordinateScale,
  localElementCoordinate,
} from '../../utils/sheetPointerCoordinates'
import {
  sheetContextMenuSelectionState,
  type SheetContextMenuState,
} from '../../utils/sheetContextMenuState'
import type { SheetWorkbookState } from './sheetEditorTypes'

interface UseSheetContextMenuCaptureOptions {
  captureSheetKeyboard: () => void
  setSheetContextMenu: Dispatch<SetStateAction<SheetContextMenuState | null>>
  sheetElementRef: MutableRefObject<HTMLDivElement | null>
  workbookRef: MutableRefObject<SheetWorkbookState | null>
}

export function useSheetContextMenuCapture({
  captureSheetKeyboard,
  setSheetContextMenu,
  sheetElementRef,
  workbookRef,
}: UseSheetContextMenuCaptureOptions) {
  return useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('.sheet-context-menu, .sheet-wikilink-autocomplete')) return
    const container = sheetElementRef.current
    if (!container) return

    event.preventDefault()
    event.stopPropagation()
    captureSheetKeyboard()

    const zoom = getDocumentZoom()
    const containerRect = container.getBoundingClientRect()
    const scale = elementCoordinateScale(container, containerRect, zoom)
    const localX = localElementCoordinate(event.clientX, containerRect, scale.x, 'x')
    const localY = localElementCoordinate(event.clientY, containerRect, scale.y, 'y')
    const containerWidth = container.clientWidth || containerRect.width * scale.x
    const containerHeight = container.clientHeight || containerRect.height * scale.y
    const menuWidth = 220
    const menuHeight = 360
    const current = workbookRef.current
    if (!current) return

    setSheetContextMenu(sheetContextMenuSelectionState(
      current.model,
      Math.max(8, Math.min(localX, containerWidth - menuWidth - 8)),
      Math.max(8, Math.min(localY, containerHeight - menuHeight - 8)),
    ))
  }, [captureSheetKeyboard, setSheetContextMenu, sheetElementRef, workbookRef])
}
