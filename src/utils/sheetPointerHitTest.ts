import type { Model } from '@ironcalc/workbook'

const MAX_SHEET_ROWS = 1048576
const MAX_SHEET_COLUMNS = 16384
const ROW_HEADER_WIDTH_PX = 30
const COLUMN_HEADER_HEIGHT_PX = 28
const FROZEN_SEPARATOR_WIDTH_PX = 3

type SheetAxis = 'column' | 'row'

interface SheetAxisHitTestOptions {
  coordinate: number
  firstVisibleIndex: number
  frozenCount: number
  frozenSize: number
  headerSize: number
  maxIndex: number
  sizeAtIndex: (index: number) => number
}

interface SheetAxisHitTestRequest {
  axis: SheetAxis
  coordinate: number
  model: Model
  sheet: number
}

function sheetColumnWidth(model: Model, sheet: number, column: number): number {
  return Math.round(model.getColumnWidth(sheet, column))
}

function sheetRowHeight(model: Model, sheet: number, row: number): number {
  return Math.round(model.getRowHeight(sheet, row))
}

function frozenColumnWidth(model: Model, sheet: number, frozenColumns: number): number {
  if (frozenColumns === 0) return 0

  let width = 0
  for (let column = 1; column <= frozenColumns; column += 1) {
    width += sheetColumnWidth(model, sheet, column)
  }
  return width + FROZEN_SEPARATOR_WIDTH_PX
}

function frozenRowHeight(model: Model, sheet: number, frozenRows: number): number {
  if (frozenRows === 0) return 0

  let height = 0
  for (let row = 1; row <= frozenRows; row += 1) {
    height += sheetRowHeight(model, sheet, row)
  }
  return height + FROZEN_SEPARATOR_WIDTH_PX
}

function indexAtOffset(
  offset: number,
  startIndex: number,
  maxIndex: number,
  sizeAtIndex: (index: number) => number,
): number | null {
  if (offset < 0) return null

  let cursor = 0
  for (let index = startIndex; index <= maxIndex; index += 1) {
    cursor += sizeAtIndex(index)
    if (offset < cursor) return index
  }
  return null
}

function sheetAxisIndexAtCanvasCoordinate({
  coordinate,
  firstVisibleIndex,
  frozenCount,
  frozenSize,
  headerSize,
  maxIndex,
  sizeAtIndex,
}: SheetAxisHitTestOptions): number | null {
  if (coordinate < headerSize) return null

  const cellOffset = coordinate - headerSize
  if (frozenCount > 0 && cellOffset < frozenSize) {
    return indexAtOffset(cellOffset, 1, frozenCount, sizeAtIndex)
  }

  return indexAtOffset(cellOffset - frozenSize, firstVisibleIndex, maxIndex, sizeAtIndex)
}

function sheetAxisFrozenCount(model: Model, sheet: number, axis: SheetAxis): number {
  return axis === 'column' ? model.getFrozenColumnsCount(sheet) : model.getFrozenRowsCount(sheet)
}

function sheetAxisFrozenSize(model: Model, sheet: number, axis: SheetAxis, frozenCount: number): number {
  return axis === 'column'
    ? frozenColumnWidth(model, sheet, frozenCount)
    : frozenRowHeight(model, sheet, frozenCount)
}

function sheetAxisHeaderSize(axis: SheetAxis): number {
  return axis === 'column' ? ROW_HEADER_WIDTH_PX : COLUMN_HEADER_HEIGHT_PX
}

function sheetAxisMaxIndex(axis: SheetAxis): number {
  return axis === 'column' ? MAX_SHEET_COLUMNS : MAX_SHEET_ROWS
}

function sheetAxisSizeAtIndex(model: Model, sheet: number, axis: SheetAxis): (index: number) => number {
  return axis === 'column'
    ? (column) => sheetColumnWidth(model, sheet, column)
    : (row) => sheetRowHeight(model, sheet, row)
}

function sheetAxisVisibleIndex(model: Model, frozenCount: number, axis: SheetAxis): number {
  const view = model.getSelectedView()
  return axis === 'column'
    ? Math.max(frozenCount + 1, view.left_column)
    : Math.max(frozenCount + 1, view.top_row)
}

function sheetAxisIndexAtCanvasPoint({ axis, coordinate, model, sheet }: SheetAxisHitTestRequest): number | null {
  const frozenCount = sheetAxisFrozenCount(model, sheet, axis)
  return sheetAxisIndexAtCanvasCoordinate({
    coordinate,
    firstVisibleIndex: sheetAxisVisibleIndex(model, frozenCount, axis),
    frozenCount,
    frozenSize: sheetAxisFrozenSize(model, sheet, axis, frozenCount),
    headerSize: sheetAxisHeaderSize(axis),
    maxIndex: sheetAxisMaxIndex(axis),
    sizeAtIndex: sheetAxisSizeAtIndex(model, sheet, axis),
  })
}

export function sheetCellFromCanvasPoint(
  model: Model,
  sheet: number,
  x: number,
  y: number,
): { column: number; row: number } | null {
  const column = sheetAxisIndexAtCanvasPoint({ axis: 'column', coordinate: x, model, sheet })
  const row = sheetAxisIndexAtCanvasPoint({ axis: 'row', coordinate: y, model, sheet })
  return row && column ? { column, row } : null
}
