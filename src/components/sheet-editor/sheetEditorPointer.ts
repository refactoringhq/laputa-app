import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Model } from '@ironcalc/workbook'
import { getDocumentZoom } from '../../extensions/zoomCursorFix'
import {
  elementCoordinateScale,
  localElementCoordinate,
  sheetCoordinateOrigin,
} from '../../utils/sheetPointerCoordinates'
import { sheetCellFromCanvasPoint } from '../../utils/sheetPointerHitTest'
import { SHEET_INDEX } from '../../utils/sheetWorkbook'

export function sheetCellFromPointer(
  event: ReactPointerEvent<HTMLDivElement>,
  container: HTMLDivElement,
  model: Model,
): { column: number; row: number } | null {
  const view = model.getSelectedView()
  if (view.sheet !== SHEET_INDEX) return null

  const originElement = sheetCoordinateOrigin(container)
  const originRect = originElement.getBoundingClientRect()
  const zoom = getDocumentZoom()
  const scale = elementCoordinateScale(originElement, originRect, zoom)
  const x = localElementCoordinate(event.clientX, originRect, scale.x, 'x')
  const y = localElementCoordinate(event.clientY, originRect, scale.y, 'y')
  return sheetCellFromCanvasPoint(model, view.sheet, x, y)
}
