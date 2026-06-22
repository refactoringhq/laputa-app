import {
  columnIndexFromName,
  columnNameFromOneBasedIndex,
  metadataCellAddress,
} from './sheetMetadata'
import { wikilinkTarget } from './wikilink'

const MAX_SHEET_ROWS = 1048576
const MAX_SHEET_COLUMNS = 16384

export const SHEET_EXTERNAL_CELL_REFERENCE_PATTERN = /\[\[([^\]\n]+?)\]\]\.(\$?)([A-Za-z]+)(\$?)([1-9]\d*)/g

export interface SheetExternalCellReference {
  address: string
  target: string
}

interface SheetExternalCellReferenceParts {
  column: number
  columnAbsolute: boolean
  row: number
  rowAbsolute: boolean
}

interface ShiftedExternalCellReference {
  column: number
  row: number
}

interface ExternalFormulaMatch {
  columnAbsolute: string
  match: string
  rawColumn: string
  rawRow: string
  rawTarget: string
  rowAbsolute: string
}

interface ExternalFormulaReferenceToken {
  columnAbsolute: string
  rawColumn: string
  rawRow: string
  rowAbsolute: string
}

interface ExternalFormulaShift {
  columnDelta: number
  rowDelta: number
}

interface ShiftedExternalFormulaReference {
  parsed: SheetExternalCellReferenceParts
  shifted: ShiftedExternalCellReference
  target: string
}

function parseExternalCellReferenceParts(token: ExternalFormulaReferenceToken): SheetExternalCellReferenceParts | null {
  const { columnAbsolute, rawColumn, rawRow, rowAbsolute } = token
  const column = columnIndexFromName(rawColumn)
  const row = Number.parseInt(rawRow, 10)
  if (!column || !Number.isFinite(row) || row < 1) return null
  return {
    column,
    columnAbsolute: columnAbsolute === '$',
    row,
    rowAbsolute: rowAbsolute === '$',
  }
}

export function isExternalFormulaInput(value: string): boolean {
  SHEET_EXTERNAL_CELL_REFERENCE_PATTERN.lastIndex = 0
  return value.trimStart().startsWith('=') && SHEET_EXTERNAL_CELL_REFERENCE_PATTERN.test(value)
}

export function extractSheetExternalCellReferences(value: string): SheetExternalCellReference[] {
  const references: SheetExternalCellReference[] = []
  SHEET_EXTERNAL_CELL_REFERENCE_PATTERN.lastIndex = 0
  for (const match of value.matchAll(SHEET_EXTERNAL_CELL_REFERENCE_PATTERN)) {
    const rawTarget = match[1]
    const parsed = parseExternalCellReferenceParts({
      columnAbsolute: match[2] ?? '',
      rawColumn: match[3] ?? '',
      rawRow: match[5] ?? '',
      rowAbsolute: match[4] ?? '',
    })
    if (!rawTarget || !parsed) continue
    references.push({
      address: metadataCellAddress(parsed.row, parsed.column),
      target: wikilinkTarget(`[[${rawTarget}]]`),
    })
  }
  return references
}

function externalReferenceColumnPrefix(parsed: SheetExternalCellReferenceParts): string {
  return parsed.columnAbsolute ? '$' : ''
}

function externalReferenceRowPrefix(parsed: SheetExternalCellReferenceParts): string {
  return parsed.rowAbsolute ? '$' : ''
}

function isWithinSheetBounds(reference: ShiftedExternalCellReference): boolean {
  return reference.column >= 1
    && reference.column <= MAX_SHEET_COLUMNS
    && reference.row >= 1
    && reference.row <= MAX_SHEET_ROWS
}

function shiftedExternalCellReference(
  parsed: SheetExternalCellReferenceParts,
  shift: ExternalFormulaShift,
): ShiftedExternalCellReference {
  return {
    column: parsed.columnAbsolute ? parsed.column : parsed.column + shift.columnDelta,
    row: parsed.rowAbsolute ? parsed.row : parsed.row + shift.rowDelta,
  }
}

function shiftedExternalFormulaReference(reference: ShiftedExternalFormulaReference): string {
  return `[[${reference.target}]].${externalReferenceColumnPrefix(reference.parsed)}${columnNameFromOneBasedIndex(reference.shifted.column)}${externalReferenceRowPrefix(reference.parsed)}${reference.shifted.row}`
}

function shiftExternalFormulaMatch(reference: ExternalFormulaMatch, shift: ExternalFormulaShift): string {
  const parsed = parseExternalCellReferenceParts({
    columnAbsolute: reference.columnAbsolute,
    rawColumn: reference.rawColumn,
    rawRow: reference.rawRow,
    rowAbsolute: reference.rowAbsolute,
  })
  if (!reference.rawTarget || !parsed) return reference.match

  const shifted = shiftedExternalCellReference(parsed, shift)
  return isWithinSheetBounds(shifted)
    ? shiftedExternalFormulaReference({ parsed, shifted, target: reference.rawTarget })
    : reference.match
}

export function shiftExternalFormulaReferences(value: string, rowDelta: number, columnDelta: number): string {
  if (!isExternalFormulaInput(value)) return value

  return value.replace(
    SHEET_EXTERNAL_CELL_REFERENCE_PATTERN,
    (match, rawTarget, columnAbsolute, rawColumn, rowAbsolute, rawRow) => shiftExternalFormulaMatch(
      {
        columnAbsolute,
        match,
        rawColumn,
        rawRow,
        rawTarget,
        rowAbsolute,
      },
      { columnDelta, rowDelta },
    ),
  )
}
