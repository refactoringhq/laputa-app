import type { Area as IronCalcArea } from '@ironcalc/wasm'
import type { Model } from '@ironcalc/workbook'
import { parseSheetMarkdownCell } from './sheetMarkdownCell'
import { serializeCsvRows } from './sheetCsv'
import { shiftExternalFormulaReferences } from './sheetExternalReferences'
import { selectedRangeArea, selectedRangeHasExternalFormulas } from './sheetSelection'
import { SHEET_INDEX } from './sheetWorkbook'

export const TOLARIA_SHEET_CLIPBOARD_MIME = 'application/x-tolaria-sheet-clipboard'

const TOLARIA_SHEET_CLIPBOARD_VERSION = 1

export interface TolariaSheetClipboardPayload {
  action: 'copy' | 'cut'
  cells: string[][]
  source: {
    column: number
    height: number
    path: string
    row: number
    width: number
  }
  type: 'tolaria-sheet-clipboard'
  version: number
}

interface ShiftedClipboardCellInputOptions {
  columnOffset: number
  destinationColumn: number
  destinationRow: number
  payload: TolariaSheetClipboardPayload
  rowOffset: number
}

function isClipboardAction(value: unknown): value is TolariaSheetClipboardPayload['action'] {
  return value === 'copy' || value === 'cut'
}

function isClipboardSource(value: unknown): value is TolariaSheetClipboardPayload['source'] {
  if (!value || typeof value !== 'object') return false
  const source = value as Partial<TolariaSheetClipboardPayload['source']>
  return typeof source.row === 'number'
    && typeof source.column === 'number'
    && typeof source.path === 'string'
}

function isClipboardPayload(value: unknown): value is TolariaSheetClipboardPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<TolariaSheetClipboardPayload>
  return payload.type === 'tolaria-sheet-clipboard'
    && payload.version === TOLARIA_SHEET_CLIPBOARD_VERSION
    && isClipboardAction(payload.action)
    && Array.isArray(payload.cells)
    && isClipboardSource(payload.source)
}

export function buildTolariaSheetClipboardPayload(
  model: Model,
  path: string,
  action: TolariaSheetClipboardPayload['action'],
  externalFormulaInputs: Map<string, unknown>,
): TolariaSheetClipboardPayload | null {
  const area = selectedRangeArea(model)
  if (!selectedRangeHasExternalFormulas(model, area, externalFormulaInputs)) return null

  const cells: string[][] = []
  for (let rowOffset = 0; rowOffset < area.height; rowOffset += 1) {
    const row: string[] = []
    for (let columnOffset = 0; columnOffset < area.width; columnOffset += 1) {
      row.push(parseSheetMarkdownCell(model.getCellContent(
        SHEET_INDEX,
        area.row + rowOffset,
        area.column + columnOffset,
      )).value)
    }
    cells.push(row)
  }

  return {
    action,
    cells,
    source: {
      column: area.column,
      height: area.height,
      path,
      row: area.row,
      width: area.width,
    },
    type: 'tolaria-sheet-clipboard',
    version: TOLARIA_SHEET_CLIPBOARD_VERSION,
  }
}

export function parseTolariaSheetClipboardPayload(value: string): TolariaSheetClipboardPayload | null {
  if (!value) return null

  try {
    const parsed: unknown = JSON.parse(value)
    return isClipboardPayload(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeTolariaSheetClipboard(dataTransfer: DataTransfer, payload: TolariaSheetClipboardPayload): void {
  const text = serializeCsvRows(payload.cells)
  dataTransfer.setData(TOLARIA_SHEET_CLIPBOARD_MIME, JSON.stringify(payload))
  dataTransfer.setData('text/plain', text)
  dataTransfer.setData('text/csv', text)
}

export function shiftedClipboardCellInput(input: string, options: ShiftedClipboardCellInputOptions): string {
  if (options.payload.action === 'cut') return input

  const sourceRow = options.payload.source.row + options.rowOffset
  const sourceColumn = options.payload.source.column + options.columnOffset
  return shiftExternalFormulaReferences(
    input,
    options.destinationRow - sourceRow,
    options.destinationColumn - sourceColumn,
  )
}

export function rangesIntersect(left: IronCalcArea, right: IronCalcArea): boolean {
  const leftEndRow = left.row + left.height - 1
  const leftEndColumn = left.column + left.width - 1
  const rightEndRow = right.row + right.height - 1
  const rightEndColumn = right.column + right.width - 1
  return left.sheet === right.sheet
    && left.row <= rightEndRow
    && leftEndRow >= right.row
    && left.column <= rightEndColumn
    && leftEndColumn >= right.column
}
