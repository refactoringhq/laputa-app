export interface SheetDocumentParts {
  frontmatter: SheetDocumentFrontmatter
  body: SheetDocumentBody
}

export interface ParsedCsvRows {
  rawRows: CsvSource[]
  rowTerminators: CsvRowTerminator[]
  rows: CsvRows
}

type CsvCell = string
type CsvRow = CsvCell[]
type CsvRows = CsvRow[]
type CsvRowTerminator = string
type CsvSource = string
type SheetDocumentBody = string
type SheetDocumentContent = string
type SheetDocumentFrontmatter = string
type ZeroBasedIndex = number

interface CsvCellValue {
  value: CsvCell
}

interface CsvRowComparison {
  left: CsvRow | undefined
  right: CsvRow | undefined
}

interface CsvRowSerialization {
  minimumWidth: number
  row: CsvRow
}

interface LineBreakLookup {
  content: SheetDocumentContent
  index: number
}

const FRONTMATTER_OPEN = '---'
const FRONTMATTER_DELIMITER_RE = /^---[ \t]*$/m

function firstLineBreakLength({ content, index }: LineBreakLookup): number {
  if (content[index] === '\r' && content[index + 1] === '\n') return 2
  if (content[index] === '\n' || content[index] === '\r') return 1
  return 0
}

export function splitSheetDocument(content: SheetDocumentContent): SheetDocumentParts {
  if (!content.startsWith(FRONTMATTER_OPEN)) return { frontmatter: '', body: content }

  const openingLineBreak = firstLineBreakLength({ content, index: FRONTMATTER_OPEN.length })
  if (openingLineBreak === 0) return { frontmatter: '', body: content }

  const searchStart = FRONTMATTER_OPEN.length + openingLineBreak
  const rest = content.slice(searchStart)
  const closeMatch = rest.match(FRONTMATTER_DELIMITER_RE)
  if (!closeMatch || closeMatch.index === undefined) return { frontmatter: '', body: content }

  const closeStart = searchStart + closeMatch.index
  const closeEnd = closeStart + closeMatch[0].length
  const closingLineBreak = firstLineBreakLength({ content, index: closeEnd })
  const bodyStart = closeEnd + closingLineBreak

  return {
    frontmatter: content.slice(0, bodyStart),
    body: content.slice(bodyStart),
  }
}

export function mergeSheetDocument(frontmatter: SheetDocumentFrontmatter, body: SheetDocumentBody): SheetDocumentContent {
  return `${frontmatter}${body}`
}

class CsvRowParser {
  private cell = ''
  private index = 0
  private quoted = false
  private row: CsvRow = []
  private rowStart = 0
  private readonly rawRows: CsvSource[] = []
  private readonly rowTerminators: CsvRowTerminator[] = []
  private readonly rows: CsvRows = []
  private readonly source: CsvSource

  constructor(source: CsvSource) {
    this.source = source
  }

  parse(): ParsedCsvRows {
    while (this.index < this.source.length) {
      this.consumeCurrentCharacter()
      this.index += 1
    }

    this.appendFinalRowWhenNeeded()
    return { rawRows: this.rawRows, rowTerminators: this.rowTerminators, rows: this.rows }
  }

  private appendCurrentCell(): void {
    this.row.push(this.cell)
    this.cell = ''
  }

  private appendCurrentRow(rowTerminator: CsvRowTerminator): void {
    this.appendCurrentCell()
    this.rows.push(this.row)
    this.rawRows.push(this.source.slice(this.rowStart, this.index))
    this.rowTerminators.push(rowTerminator)
    this.row = []
  }

  private appendFinalRowWhenNeeded(): void {
    if (!this.hasPendingFinalRow()) return
    this.appendCurrentCell()
    this.rows.push(this.row)
    this.rawRows.push(this.source.slice(this.rowStart))
    this.rowTerminators.push('')
  }

  private consumeCurrentCharacter(): void {
    if (this.quoted) {
      this.consumeQuotedCharacter()
      return
    }

    if (this.startsQuotedCell()) {
      this.quoted = true
      return
    }

    if (this.currentChar() === ',') {
      this.appendCurrentCell()
      return
    }

    if (this.currentCharIsRowBreak()) {
      this.consumeRowBreak()
      return
    }

    this.cell += this.currentChar()
  }

  private consumeQuotedCharacter(): void {
    if (this.currentChar() === '"' && this.nextChar() === '"') {
      this.cell += '"'
      this.index += 1
      return
    }

    if (this.currentChar() === '"') {
      this.quoted = false
      return
    }

    this.cell += this.currentChar()
  }

  private consumeRowBreak(): void {
    const rowTerminator = this.currentRowTerminator()
    this.appendCurrentRow(rowTerminator)
    if (rowTerminator === '\r\n') this.index += 1
    this.rowStart = this.index + 1
  }

  private currentChar(): CsvCell {
    return this.source[this.index] ?? ''
  }

  private currentCharIsRowBreak(): boolean {
    return this.currentChar() === '\n' || this.currentChar() === '\r'
  }

  private currentRowTerminator(): CsvRowTerminator {
    return this.currentChar() === '\r' && this.nextChar() === '\n' ? '\r\n' : this.currentChar()
  }

  private hasPendingFinalRow(): boolean {
    return this.cell.length > 0 || this.row.length > 0 || this.source.endsWith(',')
  }

  private nextChar(): CsvCell {
    return this.source[this.index + 1] ?? ''
  }

  private startsQuotedCell(): boolean {
    return this.currentChar() === '"' && this.cell.length === 0
  }
}

export function parseCsvRowsWithSource(source: CsvSource): ParsedCsvRows {
  if (source.length === 0) return { rawRows: [], rowTerminators: [], rows: [] }
  return new CsvRowParser(source).parse()
}

export function parseCsvRows(source: CsvSource): CsvRows {
  return parseCsvRowsWithSource(source).rows
}

function shouldQuoteCsvCell({ value }: CsvCellValue): boolean {
  return value.includes(',')
    || value.includes('"')
    || value.includes('\n')
    || value.includes('\r')
    || value !== value.trim()
}

function serializeCsvCell(cell: CsvCellValue): string {
  if (!shouldQuoteCsvCell(cell)) return cell.value
  return `"${cell.value.replace(/"/g, '""')}"`
}

function lastMeaningfulRowIndex(rows: CsvRows): number {
  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    if (rows[rowIndex]?.some((cell) => cell !== '') === true) return rowIndex
  }
  return -1
}

function lastMeaningfulColumnIndex(row: CsvRow): number {
  for (let columnIndex = row.length - 1; columnIndex >= 0; columnIndex -= 1) {
    if (row[columnIndex] !== '') {
      return columnIndex
    }
  }
  return -1
}

function serializeCsvRow({ minimumWidth, row }: CsvRowSerialization): string {
  const lastColumn = lastMeaningfulColumnIndex(row)
  const columnCount = Math.max(lastColumn + 1, minimumWidth)
  if (columnCount <= 0) return ''

  return row
    .slice(0, columnCount)
    .map((cell) => serializeCsvCell({ value: cell ?? '' }))
    .join(',')
}

export function serializeCsvRows(rows: CsvRows): CsvSource {
  const lastRow = lastMeaningfulRowIndex(rows)
  if (lastRow < 0) return ''

  return rows.slice(0, lastRow + 1)
    .map((row) => serializeCsvRow({ minimumWidth: 0, row }))
    .join('\n')
}

function csvRowsEqual({ left, right }: CsvRowComparison): boolean {
  const leftCells = left ?? []
  const rightCells = right ?? []
  if (leftCells.length !== rightCells.length) return false
  return leftCells.every((cell, index) => cell === rightCells[index])
}

export function serializeCsvRowsPreservingSourceRows(rows: CsvRows, source: CsvSource): CsvSource {
  return serializeCsvRowsPreservingParsedSourceRows(rows, parseCsvRowsWithSource(source))
}

function sourceRowTerminator(parsedSource: ParsedCsvRows): CsvRowTerminator {
  return parsedSource.rowTerminators.find((terminator) => terminator !== '') ?? '\n'
}

export function serializeCsvRowsPreservingParsedSourceRows(rows: CsvRows, parsedSource: ParsedCsvRows): CsvSource {
  const lastRow = Math.max(lastMeaningfulRowIndex(rows), parsedSource.rows.length - 1)
  if (lastRow < 0) return ''
  const rowTerminator = sourceRowTerminator(parsedSource)

  return Array.from({ length: lastRow + 1 }, (_, rowIndex) => {
    const row = rows[rowIndex] ?? []
    const serializedRow = csvRowsEqual({ left: row, right: parsedSource.rows[rowIndex] })
      ? parsedSource.rawRows[rowIndex] ?? ''
      : serializeCsvRow({ minimumWidth: parsedSource.rows[rowIndex]?.length ?? 0, row })
    const terminator = parsedSource.rowTerminators[rowIndex] ?? (rowIndex < lastRow ? rowTerminator : '')
    return `${serializedRow}${terminator}`
  }).join('')
}

export function serializeCsvRowsReplacingParsedSourceRows(
  parsedSource: ParsedCsvRows,
  replacements: Map<number, CsvRow>,
): CsvSource {
  if (replacements.size === 0) {
    return parsedSource.rawRows.map((row, index) => `${row}${parsedSource.rowTerminators[index] ?? ''}`).join('')
  }

  const lastReplacementRow = Math.max(...replacements.keys())
  const lastRow = Math.max(parsedSource.rows.length - 1, lastReplacementRow)
  if (lastRow < 0) return ''
  const rowTerminator = sourceRowTerminator(parsedSource)

  return Array.from({ length: lastRow + 1 }, (_, rowIndex) => {
    const replacement = replacements.get(rowIndex)
    const serializedRow = replacement && !csvRowsEqual({ left: replacement, right: parsedSource.rows[rowIndex] })
      ? serializeCsvRow({ minimumWidth: parsedSource.rows[rowIndex]?.length ?? 0, row: replacement })
      : parsedSource.rawRows[rowIndex] ?? ''
    const terminator = parsedSource.rowTerminators[rowIndex] ?? (rowIndex < lastRow ? rowTerminator : '')
    return `${serializedRow}${terminator}`
  }).join('')
}

export function columnNameFromIndex(index: ZeroBasedIndex): string {
  let value = index + 1
  let name = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

export function cellAddress(rowIndex: ZeroBasedIndex, columnIndex: ZeroBasedIndex): string {
  return `${columnNameFromIndex(columnIndex)}${rowIndex + 1}`
}
