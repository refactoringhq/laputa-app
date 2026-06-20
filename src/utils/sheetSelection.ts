import type { Area as IronCalcArea, CellStyle } from '@ironcalc/wasm'
import type { Model } from '@ironcalc/workbook'
import { metadataCellAddress } from './sheetMetadata'
import { isExternalFormulaInput } from './sheetExternalReferences'
import {
  boundedSheetIndex,
  MAX_SHEET_COLUMNS,
  MAX_SHEET_ROWS,
  SHEET_INDEX,
  type SheetBodyDirtyRows,
} from './sheetWorkbook'

export type SheetBodyRowsUpdate = Iterable<number> | 'all' | 'none' | undefined

function hasDirtyRowsUpdate(update: SheetBodyRowsUpdate): update is Iterable<number> {
  return update !== undefined && update !== 'all' && update !== 'none'
}

function mergedDirtyRowSet(current: SheetBodyDirtyRows, update: Iterable<number>): Set<number> | null {
  const next = current instanceof Set ? new Set(current) : new Set<number>()
  for (const row of update) {
    if (row >= 1 && row <= MAX_SHEET_ROWS) next.add(row)
  }
  return next.size === 0 ? null : next
}

export function selectedRangeArea(model: Model): IronCalcArea {
  const {
    sheet,
    range: [startRow, startColumn, endRow, endColumn],
  } = model.getSelectedView()
  const row = Math.min(startRow, endRow)
  const column = Math.min(startColumn, endColumn)

  return {
    sheet,
    row,
    column,
    width: Math.abs(endColumn - startColumn) + 1,
    height: Math.abs(endRow - startRow) + 1,
  }
}

export function dirtyRowsForArea(area: IronCalcArea): Set<number> {
  const rows = new Set<number>()
  if (area.sheet !== SHEET_INDEX) return rows
  for (let row = area.row; row < area.row + area.height; row += 1) {
    if (row >= 1 && row <= MAX_SHEET_ROWS) rows.add(row)
  }
  return rows
}

export function dirtyRowsForSelectedRange(model: Model): Set<number> {
  return dirtyRowsForArea(selectedRangeArea(model))
}

export function mergeDirtyBodyRows(current: SheetBodyDirtyRows, update: SheetBodyRowsUpdate): SheetBodyDirtyRows {
  if (update === 'none') return current
  if (!hasDirtyRowsUpdate(update) || current === 'all') return 'all'
  return mergedDirtyRowSet(current, update) ?? current
}

export function selectedRangeHasExternalFormulas(
  model: Model,
  area: IronCalcArea,
  externalFormulaInputs: Map<string, unknown>,
): boolean {
  if (area.sheet !== SHEET_INDEX) return false

  for (let rowOffset = 0; rowOffset < area.height; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < area.width; columnOffset += 1) {
      const row = area.row + rowOffset
      const column = area.column + columnOffset
      const content = model.getCellContent(SHEET_INDEX, row, column)
      if (externalFormulaInputs.has(metadataCellAddress(row, column)) || isExternalFormulaInput(content)) return true
    }
  }

  return false
}

export function selectedCellIndexes(model: Model): { column: number; row: number; sheet: number } | null {
  const { column, row, sheet } = model.getSelectedView()
  const boundedRow = boundedSheetIndex(row, MAX_SHEET_ROWS)
  const boundedColumn = boundedSheetIndex(column, MAX_SHEET_COLUMNS)
  if (sheet !== SHEET_INDEX || boundedRow === 0 || boundedColumn === 0) return null
  return { column: boundedColumn, row: boundedRow, sheet }
}

export function clearSelectedRangeContents(model: Model): void {
  const area = selectedRangeArea(model)
  model.rangeClearContents(
    area.sheet,
    area.row,
    area.column,
    area.row + area.height - 1,
    area.column + area.width - 1,
  )
}

export function selectedCellStyle(model: Model): CellStyle {
  const { sheet, row, column } = model.getSelectedView()
  return model.getCellStyle(sheet, row, column)
}

export function increaseDecimalPlaces(format: string): string {
  if (format === 'general') return '#,##0.000'
  const expanded = format.replace(/\.0/g, '.00')
  if (expanded.includes('.')) return expanded
  if (expanded.includes('0')) return expanded.replace(/0/g, '0.0')
  if (expanded.includes('#')) return expanded.replace(/#([^#,]|$)/g, '0.0$1')
  return expanded
}

export function decreaseDecimalPlaces(format: string): string {
  if (format === 'general') return '#,##0.0'
  return format.replace(/\.0/g, '.').replace(/0\.([^0]|$)/, '0$1')
}
