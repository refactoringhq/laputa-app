import type { Model } from '@ironcalc/workbook'
import { columnNameFromOneBasedIndex } from './sheetMetadata'

export interface SheetContextMenuState {
  columnName: string
  frozenColumns: number
  frozenRows: number
  isWrapped: boolean
  left: number
  row: number
  top: number
}

export type SheetStructureAction =
  | 'deleteColumn'
  | 'deleteRow'
  | 'insertColumnLeft'
  | 'insertColumnRight'
  | 'insertRowAbove'
  | 'insertRowBelow'

function isSingleRowDeleteError(caught: unknown, row: number): caught is Error {
  return row === 1
    && caught instanceof Error
    && caught.message === "Row number '1' is not valid."
}

function deleteSelectedRow(model: Model, sheet: number, row: number): void {
  try {
    model.deleteRow(sheet, row)
  } catch (caught) {
    if (!isSingleRowDeleteError(caught, row)) throw caught
    model.insertRow(sheet, row + 1)
    model.deleteRow(sheet, row)
  }
}

export function sheetContextMenuSelectionState(model: Model, left: number, top: number): SheetContextMenuState {
  const view = model.getSelectedView()
  return {
    columnName: columnNameFromOneBasedIndex(view.column),
    frozenColumns: model.getFrozenColumnsCount(view.sheet),
    frozenRows: model.getFrozenRowsCount(view.sheet),
    isWrapped: model.getCellStyle(view.sheet, view.row, view.column).alignment?.wrap_text === true,
    left,
    row: view.row,
    top,
  }
}

export function applySheetStructureAction(model: Model, action: SheetStructureAction): void {
  const { sheet, row, column } = model.getSelectedView()
  if (action === 'deleteColumn') {
    model.deleteColumn(sheet, column)
  } else if (action === 'deleteRow') {
    deleteSelectedRow(model, sheet, row)
  } else if (action === 'insertColumnLeft') {
    model.insertColumn(sheet, column)
  } else if (action === 'insertColumnRight') {
    model.insertColumn(sheet, column + 1)
  } else if (action === 'insertRowAbove') {
    model.insertRow(sheet, row)
  } else {
    model.insertRow(sheet, row + 1)
  }
}
