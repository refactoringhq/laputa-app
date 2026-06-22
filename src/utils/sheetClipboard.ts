import type { Area as IronCalcArea } from '@ironcalc/wasm'
import type { Model } from '@ironcalc/workbook'
import {
  columnIndexFromName,
  columnNameFromOneBasedIndex,
  metadataCellAddress,
} from './sheetMetadata'
import { parseSheetMarkdownCell } from './sheetMarkdownCell'
import { serializeCsvRows } from './sheetCsv'
import { shiftExternalFormulaReferences } from './sheetExternalReferences'
import type { SheetExternalFormulaInput } from './sheetExternalFormulaWorker'
import { selectedRangeArea } from './sheetSelection'
import { MAX_SHEET_COLUMNS, MAX_SHEET_ROWS, SHEET_INDEX } from './sheetWorkbook'

export const TOLARIA_SHEET_CLIPBOARD_MIME = 'application/x-tolaria-sheet-clipboard'

const TOLARIA_SHEET_CLIPBOARD_VERSION = 1
const LOCAL_CELL_REFERENCE_PATTERN = /(^|[^A-Za-z0-9_.\][$])(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d*)(?![A-Za-z0-9_]|\s*\()/g

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

interface LocalReferenceMatch {
  columnAbsolute: string
  rawColumn: string
  rawRow: string
  rowAbsolute: string
}

interface LocalReferenceParts {
  column: number
  columnAbsolute: boolean
  row: number
  rowAbsolute: boolean
}

interface ReferenceShift {
  columnDelta: number
  rowDelta: number
}

interface SheetPosition {
  column: number
  row: number
}

interface SheetCellLookup {
  externalFormulaInputs: Map<string, SheetExternalFormulaInput>
  model: Model
  position: SheetPosition
}

interface FormulaSourcePosition {
  referenceOffset: number
  source: string
}

interface LocalFormulaShiftInput {
  shift: ReferenceShift
  value: string
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

function sheetCellInput({ externalFormulaInputs, model, position }: SheetCellLookup): string {
  const externalFormula = externalFormulaInputs.get(metadataCellAddress(position.row, position.column))
  if (externalFormula) return externalFormula.source

  return parseSheetMarkdownCell(model.getCellContent(SHEET_INDEX, position.row, position.column)).value
}

function selectedRangeHasFormulaInputs(
  model: Model,
  area: IronCalcArea,
  externalFormulaInputs: Map<string, SheetExternalFormulaInput>,
): boolean {
  if (area.sheet !== SHEET_INDEX) return false

  for (let rowOffset = 0; rowOffset < area.height; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < area.width; columnOffset += 1) {
      const row = area.row + rowOffset
      const column = area.column + columnOffset
      if (externalFormulaInputs.has(metadataCellAddress(row, column))) return true
      const input = sheetCellInput({ externalFormulaInputs, model, position: { column, row } })
      if (input.trimStart().startsWith('=')) return true
    }
  }

  return false
}

function isInsideWikilinkTarget({ referenceOffset, source }: FormulaSourcePosition): boolean {
  const lastOpen = source.lastIndexOf('[[', referenceOffset)
  if (lastOpen === -1) return false
  return lastOpen > source.lastIndexOf(']]', referenceOffset)
}

function isInsideDoubleQuotedFormulaString({ referenceOffset, source }: FormulaSourcePosition): boolean {
  let inside = false
  for (let offset = 0; offset < referenceOffset; offset += 1) {
    if (source[offset] !== '"') continue
    if (inside && source[offset + 1] === '"') {
      offset += 1
      continue
    }
    inside = !inside
  }
  return inside
}

function parseLocalReferenceParts(match: LocalReferenceMatch): LocalReferenceParts | null {
  const column = columnIndexFromName(match.rawColumn)
  const row = Number.parseInt(match.rawRow, 10)
  if (column === null || !Number.isFinite(row) || row < 1) return null

  return {
    column,
    columnAbsolute: match.columnAbsolute === '$',
    row,
    rowAbsolute: match.rowAbsolute === '$',
  }
}

function shiftedLocalReferencePosition(reference: LocalReferenceParts, shift: ReferenceShift): SheetPosition {
  return {
    column: reference.columnAbsolute ? reference.column : reference.column + shift.columnDelta,
    row: reference.rowAbsolute ? reference.row : reference.row + shift.rowDelta,
  }
}

function isWithinSheetBounds(position: SheetPosition): boolean {
  const columnInBounds = position.column >= 1 && position.column <= MAX_SHEET_COLUMNS
  const rowInBounds = position.row >= 1 && position.row <= MAX_SHEET_ROWS
  return columnInBounds && rowInBounds
}

function localReferenceText(reference: LocalReferenceParts, position: SheetPosition): string {
  const columnPrefix = reference.columnAbsolute ? '$' : ''
  const rowPrefix = reference.rowAbsolute ? '$' : ''
  return `${columnPrefix}${columnNameFromOneBasedIndex(position.column)}${rowPrefix}${position.row}`
}

function shiftedLocalCellReference(match: LocalReferenceMatch, shift: ReferenceShift): string | null {
  const reference = parseLocalReferenceParts(match)
  if (!reference) return null

  const shifted = shiftedLocalReferencePosition(reference, shift)
  return isWithinSheetBounds(shifted) ? localReferenceText(reference, shifted) : null
}

function shiftLocalFormulaReferences({ shift, value }: LocalFormulaShiftInput): string {
  if (!value.trimStart().startsWith('=')) return value

  return value.replace(LOCAL_CELL_REFERENCE_PATTERN, (
    match: string,
    prefix: string,
    columnAbsolute: string,
    rawColumn: string,
    rowAbsolute: string,
    rawRow: string,
    offset: number,
    source: string,
  ) => {
    const referenceOffset = offset + prefix.length
    const sourcePosition = { referenceOffset, source }
    if (isInsideWikilinkTarget(sourcePosition)) return match
    if (isInsideDoubleQuotedFormulaString(sourcePosition)) return match

    const shifted = shiftedLocalCellReference({
      columnAbsolute,
      rawColumn,
      rawRow,
      rowAbsolute,
    }, shift)
    return shifted ? `${prefix}${shifted}` : match
  })
}

export function buildTolariaSheetClipboardPayload(
  model: Model,
  path: string,
  action: TolariaSheetClipboardPayload['action'],
  externalFormulaInputs: Map<string, SheetExternalFormulaInput>,
): TolariaSheetClipboardPayload | null {
  const area = selectedRangeArea(model)
  if (!selectedRangeHasFormulaInputs(model, area, externalFormulaInputs)) return null

  const cells: string[][] = []
  for (let rowOffset = 0; rowOffset < area.height; rowOffset += 1) {
    const row: string[] = []
    for (let columnOffset = 0; columnOffset < area.width; columnOffset += 1) {
      row.push(sheetCellInput({
        externalFormulaInputs,
        model,
        position: {
          column: area.column + columnOffset,
          row: area.row + rowOffset,
        },
      }))
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
  const rowDelta = options.destinationRow - sourceRow
  const columnDelta = options.destinationColumn - sourceColumn
  return shiftLocalFormulaReferences({
    shift: { columnDelta, rowDelta },
    value: shiftExternalFormulaReferences(
      input,
      rowDelta,
      columnDelta,
    ),
  })
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
