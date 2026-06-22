import { cellAddress, columnNameFromIndex } from './sheetCsv'

export interface SheetColumnMetadata {
  width?: number
}

export interface SheetRowMetadata {
  height?: number
}

export interface SheetBorderMetadata {
  color?: string
  style: string
}

export interface SheetCellMetadata {
  numFmt?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  fontSize?: number
  fontColor?: string
  fillColor?: string
  horizontalAlign?: string
  verticalAlign?: string
  wrapText?: boolean
  borderTop?: SheetBorderMetadata
  borderRight?: SheetBorderMetadata
  borderBottom?: SheetBorderMetadata
  borderLeft?: SheetBorderMetadata
}

export interface SheetMetadata {
  frozenColumns?: number
  frozenRows?: number
  showGridLines?: boolean
  columns: Record<string, SheetColumnMetadata>
  rows: Record<string, SheetRowMetadata>
  cells: Record<string, SheetCellMetadata>
}

type MetadataSection = 'columns' | 'rows' | 'cells'
type MetadataValue = string | number | boolean
type MetadataAssignment = {
  key: string
  property: string
  section: MetadataSection
  value: MetadataValue
}
type SheetSettingAssignment = {
  property: string
  value: MetadataValue
}
type MetadataParseCursor = {
  key: string | null
  section: MetadataSection | null
}
type MetadataLineWriter = {
  indent: string
  lines: string[]
}
type CellMetadataUpdater = (value: MetadataValue) => Partial<SheetCellMetadata> | null
type SheetSettingAssigner = (metadata: SheetMetadata, value: MetadataValue) => void
type ScalarCellMetadataKey = {
  key: string
  property: Exclude<{
    [Key in keyof SheetCellMetadata]: SheetCellMetadata[Key] extends MetadataValue | undefined ? Key : never
  }[keyof SheetCellMetadata], undefined>
}
type BorderCellMetadataKey = {
  key: string
  property: Exclude<{
    [Key in keyof SheetCellMetadata]: SheetCellMetadata[Key] extends SheetBorderMetadata | undefined ? Key : never
  }[keyof SheetCellMetadata], undefined>
}

const SHEET_METADATA_KEY = '_sheet'
const SCALAR_NUMBER_PATTERN = /^-?\d+(\.\d+)?$/
const TOP_LEVEL_SHEET_SETTINGS = [
  { key: 'show_grid_lines', property: 'showGridLines' },
  { key: 'frozen_rows', property: 'frozenRows' },
  { key: 'frozen_columns', property: 'frozenColumns' },
] as const
const CELL_SCALAR_METADATA_KEYS: ScalarCellMetadataKey[] = [
  { key: 'num_fmt', property: 'numFmt' },
  { key: 'bold', property: 'bold' },
  { key: 'italic', property: 'italic' },
  { key: 'underline', property: 'underline' },
  { key: 'strike', property: 'strike' },
  { key: 'font_size', property: 'fontSize' },
  { key: 'font_color', property: 'fontColor' },
  { key: 'fill_color', property: 'fillColor' },
  { key: 'horizontal_align', property: 'horizontalAlign' },
  { key: 'vertical_align', property: 'verticalAlign' },
  { key: 'wrap_text', property: 'wrapText' },
]
const CELL_BORDER_METADATA_KEYS: BorderCellMetadataKey[] = [
  { key: 'border_top', property: 'borderTop' },
  { key: 'border_right', property: 'borderRight' },
  { key: 'border_bottom', property: 'borderBottom' },
  { key: 'border_left', property: 'borderLeft' },
]

export function emptySheetMetadata(): SheetMetadata {
  return { columns: {}, rows: {}, cells: {} }
}

export function isSheetMetadataEmpty(metadata: SheetMetadata): boolean {
  return metadata.showGridLines === undefined
    && metadata.frozenRows === undefined
    && metadata.frozenColumns === undefined
    && Object.keys(metadata.columns).length === 0
    && Object.keys(metadata.rows).length === 0
    && Object.keys(metadata.cells).length === 0
}

export function columnIndexFromName(name: string): number | null {
  const normalized = name.trim().toUpperCase()
  if (!/^[A-Z]+$/.test(normalized)) return null

  let value = 0
  for (const char of normalized) {
    value = value * 26 + char.charCodeAt(0) - 64
  }
  return value
}

export function normalizeCellAddress(address: string): string | null {
  const match = address.trim().toUpperCase().match(/^([A-Z]+)([1-9]\d*)$/)
  if (!match) return null
  return `${match[1]}${match[2]}`
}

export function cellAddressToIndexes(address: string): { row: number; column: number } | null {
  const normalized = normalizeCellAddress(address)
  if (!normalized) return null

  const match = normalized.match(/^([A-Z]+)([1-9]\d*)$/)
  if (!match) return null

  const column = columnIndexFromName(match[1])
  if (column === null) return null

  return { row: Number(match[2]), column }
}

export function metadataCellAddress(row: number, column: number): string {
  return cellAddress(row - 1, column - 1)
}

function hasMatchingQuote(value: string, quote: '"' | "'"): boolean {
  return value.startsWith(quote) && value.endsWith(quote)
}

function isQuotedScalar(value: string): boolean {
  return hasMatchingQuote(value, '"') || hasMatchingQuote(value, "'")
}

function parseScalar(value: string): MetadataValue {
  const trimmed = value.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (SCALAR_NUMBER_PATTERN.test(trimmed)) return Number(trimmed)
  if (isQuotedScalar(trimmed)) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

function scalarString(value: string | number | boolean): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function parseBorderMetadata(value: MetadataValue): SheetBorderMetadata | null {
  if (typeof value !== 'string') return null
  const [style, color] = value.trim().split(/\s+/, 2)
  if (!style) return null
  return color ? { color, style } : { style }
}

function borderMetadataString(value: SheetBorderMetadata): string {
  return value.color ? `${value.style} ${value.color}` : value.style
}

function metadataPropertyName(source: string): string {
  const trimmed = source.trim()
  if (isQuotedScalar(trimmed)) {
    return String(parseScalar(trimmed))
  }
  return trimmed
}

function assignColumnMetadata(metadata: SheetMetadata, assignment: MetadataAssignment): void {
  const { key, property, value } = assignment
  if (property !== 'width' || typeof value !== 'number') return
  const column = key.toUpperCase()
  if (columnIndexFromName(column) === null) return
  metadata.columns[column] = { ...metadata.columns[column], width: value }
}

function assignRowMetadata(metadata: SheetMetadata, assignment: MetadataAssignment): void {
  const { key, property, value } = assignment
  if (property !== 'height' || typeof value !== 'number') return
  if (!/^[1-9]\d*$/.test(key)) return
  metadata.rows[key] = { ...metadata.rows[key], height: value }
}

const CELL_METADATA_UPDATERS: Record<string, CellMetadataUpdater> = {
  num_fmt: (value) => typeof value === 'string' ? { numFmt: value } : null,
  bold: (value) => typeof value === 'boolean' ? { bold: value } : null,
  italic: (value) => typeof value === 'boolean' ? { italic: value } : null,
  underline: (value) => typeof value === 'boolean' ? { underline: value } : null,
  strike: (value) => typeof value === 'boolean' ? { strike: value } : null,
  font_size: (value) => typeof value === 'number' ? { fontSize: value } : null,
  font_color: (value) => typeof value === 'string' ? { fontColor: value } : null,
  fill_color: (value) => typeof value === 'string' ? { fillColor: value } : null,
  horizontal_align: (value) => typeof value === 'string' ? { horizontalAlign: value } : null,
  vertical_align: (value) => typeof value === 'string' ? { verticalAlign: value } : null,
  wrap_text: (value) => typeof value === 'boolean' ? { wrapText: value } : null,
  border_top: (value) => {
    const border = parseBorderMetadata(value)
    return border ? { borderTop: border } : null
  },
  border_right: (value) => {
    const border = parseBorderMetadata(value)
    return border ? { borderRight: border } : null
  },
  border_bottom: (value) => {
    const border = parseBorderMetadata(value)
    return border ? { borderBottom: border } : null
  },
  border_left: (value) => {
    const border = parseBorderMetadata(value)
    return border ? { borderLeft: border } : null
  },
}

function assignCellMetadata(metadata: SheetMetadata, assignment: MetadataAssignment): void {
  const { key, property, value } = assignment
  const cell = normalizeCellAddress(key)
  if (!cell) return

  const update = CELL_METADATA_UPDATERS[property]?.(value)
  if (!update) return

  metadata.cells[cell] = { ...metadata.cells[cell], ...update }
}

function isNonNegativeInteger(value: MetadataValue): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

const SHEET_SETTING_ASSIGNERS: Record<string, SheetSettingAssigner> = {
  show_grid_lines: (metadata, value) => {
    if (typeof value === 'boolean') metadata.showGridLines = value
  },
  frozen_rows: (metadata, value) => {
    if (isNonNegativeInteger(value)) metadata.frozenRows = value
  },
  frozen_columns: (metadata, value) => {
    if (isNonNegativeInteger(value)) metadata.frozenColumns = value
  },
}

function assignSheetSetting(metadata: SheetMetadata, assignment: SheetSettingAssignment): void {
  SHEET_SETTING_ASSIGNERS[assignment.property]?.(metadata, assignment.value)
}

function assignMetadataValue(metadata: SheetMetadata, assignment: MetadataAssignment): void {
  switch (assignment.section) {
    case 'columns':
      assignColumnMetadata(metadata, assignment)
      break
    case 'rows':
      assignRowMetadata(metadata, assignment)
      break
    case 'cells':
      assignCellMetadata(metadata, assignment)
      break
  }
}

function parseSectionLine(line: string): MetadataSection | null {
  const sectionMatch = line.match(/^ {2}(columns|rows|cells):\s*$/)
  return sectionMatch ? sectionMatch[1] as MetadataSection : null
}

function parseSheetSettingLine(line: string): SheetSettingAssignment | null {
  const sheetSettingMatch = line.match(/^ {2}([A-Za-z_]+):\s*(.+)$/)
  if (!sheetSettingMatch) return null
  return {
    property: metadataPropertyName(sheetSettingMatch[1]),
    value: parseScalar(sheetSettingMatch[2]),
  }
}

function parseEntryKeyLine(line: string): string | null {
  const keyMatch = line.match(/^ {4}([^:]+):\s*$/)
  return keyMatch ? metadataPropertyName(keyMatch[1]) : null
}

function parseValueLine(line: string, cursor: MetadataParseCursor): MetadataAssignment | null {
  const valueMatch = line.match(/^ {6}([^:]+):\s*(.*)$/)
  if (!valueMatch || !cursor.section || !cursor.key) return null
  return {
    key: cursor.key,
    property: metadataPropertyName(valueMatch[1]),
    section: cursor.section,
    value: parseScalar(valueMatch[2]),
  }
}

function parseMetadataLine(metadata: SheetMetadata, line: string, cursor: MetadataParseCursor): MetadataParseCursor {
  if (line.trim() === '') return cursor

  const section = parseSectionLine(line)
  if (section) return { key: null, section }

  const sheetSetting = parseSheetSettingLine(line)
  if (sheetSetting) {
    assignSheetSetting(metadata, sheetSetting)
    return { key: null, section: null }
  }

  const key = parseEntryKeyLine(line)
  if (key) return { ...cursor, key }

  const assignment = parseValueLine(line, cursor)
  if (assignment) assignMetadataValue(metadata, assignment)
  return cursor
}

export function parseSheetMetadata(frontmatter: string): SheetMetadata {
  const metadata = emptySheetMetadata()
  const lines = frontmatter.replace(/\r\n/g, '\n').split('\n')
  const startIndex = lines.findIndex((line) => line.trim() === `${SHEET_METADATA_KEY}:`)
  if (startIndex < 0) return metadata

  let cursor: MetadataParseCursor = { key: null, section: null }

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (!line.startsWith(' ')) break
    cursor = parseMetadataLine(metadata, line, cursor)
  }

  return metadata
}

function metadataLineWriter(lines: string[], indent: string): MetadataLineWriter {
  return { indent, lines }
}

function appendScalarLine(writer: MetadataLineWriter, key: string, value: MetadataValue | undefined): void {
  if (value !== undefined) writer.lines.push(`${writer.indent}${key}: ${scalarString(value)}`)
}

function appendSheetSettingLines(lines: string[], metadata: SheetMetadata): void {
  const writer = metadataLineWriter(lines, '  ')
  for (const setting of TOP_LEVEL_SHEET_SETTINGS) {
    appendScalarLine(writer, setting.key, metadata[setting.property])
  }
}

function sortedColumnEntries(metadata: SheetMetadata): Array<[string, SheetColumnMetadata]> {
  return Object.entries(metadata.columns)
    .filter(([, value]) => value.width !== undefined)
    .sort(([left], [right]) => (columnIndexFromName(left) ?? 0) - (columnIndexFromName(right) ?? 0))
}

function appendColumnMetadataLines(lines: string[], metadata: SheetMetadata): void {
  const columnEntries = sortedColumnEntries(metadata)
  if (columnEntries.length > 0) {
    const writer = metadataLineWriter(lines, '      ')
    lines.push('  columns:')
    for (const [column, value] of columnEntries) {
      lines.push(`    ${column}:`)
      appendScalarLine(writer, 'width', value.width)
    }
  }
}

function sortedRowEntries(metadata: SheetMetadata): Array<[string, SheetRowMetadata]> {
  return Object.entries(metadata.rows)
    .filter(([, value]) => value.height !== undefined)
    .sort(([left], [right]) => Number(left) - Number(right))
}

function appendRowMetadataLines(lines: string[], metadata: SheetMetadata): void {
  const rowEntries = sortedRowEntries(metadata)
  if (rowEntries.length > 0) {
    const writer = metadataLineWriter(lines, '      ')
    lines.push('  rows:')
    for (const [row, value] of rowEntries) {
      lines.push(`    "${row}":`)
      appendScalarLine(writer, 'height', value.height)
    }
  }
}

function compareCellMetadataAddresses(left: string, right: string): number {
  const leftIndexes = cellAddressToIndexes(left)
  const rightIndexes = cellAddressToIndexes(right)
  if (!leftIndexes || !rightIndexes) return left.localeCompare(right)
  if (leftIndexes.row !== rightIndexes.row) return leftIndexes.row - rightIndexes.row
  return leftIndexes.column - rightIndexes.column
}

function sortedCellEntries(metadata: SheetMetadata): Array<[string, SheetCellMetadata]> {
  return Object.entries(metadata.cells)
    .filter(([, value]) => Object.keys(value).length > 0)
    .sort(([left], [right]) => compareCellMetadataAddresses(left, right))
}

function appendScalarCellMetadataLines(lines: string[], metadata: SheetCellMetadata): void {
  const writer = metadataLineWriter(lines, '      ')
  for (const field of CELL_SCALAR_METADATA_KEYS) {
    appendScalarLine(writer, field.key, metadata[field.property])
  }
}

function appendBorderCellMetadataLines(lines: string[], metadata: SheetCellMetadata): void {
  for (const field of CELL_BORDER_METADATA_KEYS) {
    const border = metadata[field.property]
    if (border !== undefined) {
      lines.push(`      ${field.key}: ${scalarString(borderMetadataString(border))}`)
    }
  }
}

function appendCellMetadataLines(lines: string[], metadata: SheetMetadata): void {
  const cellEntries = sortedCellEntries(metadata)
  if (cellEntries.length > 0) {
    lines.push('  cells:')
    for (const [cell, value] of cellEntries) {
      lines.push(`    ${cell}:`)
      appendScalarCellMetadataLines(lines, value)
      appendBorderCellMetadataLines(lines, value)
    }
  }
}

function metadataBlockLines(metadata: SheetMetadata): string[] {
  const lines = [`${SHEET_METADATA_KEY}:`]

  appendSheetSettingLines(lines, metadata)
  appendColumnMetadataLines(lines, metadata)
  appendRowMetadataLines(lines, metadata)
  appendCellMetadataLines(lines, metadata)

  return lines
}

function removeExistingMetadataBlock(lines: string[]): string[] {
  const startIndex = lines.findIndex((line) => line.trim() === `${SHEET_METADATA_KEY}:`)
  if (startIndex < 0) return lines

  let endIndex = startIndex + 1
  while (endIndex < lines.length) {
    const line = lines[endIndex] ?? ''
    if (line.trim() !== '' && !line.startsWith(' ')) break
    endIndex += 1
  }

  return [...lines.slice(0, startIndex), ...lines.slice(endIndex)]
}

export function mergeSheetMetadata(frontmatter: string, metadata: SheetMetadata): string {
  if (!frontmatter.startsWith('---')) return frontmatter

  const lineEnding = frontmatter.includes('\r\n') ? '\r\n' : '\n'
  const normalized = frontmatter.replace(/\r\n/g, '\n')
  const hasTrailingLineBreak = normalized.endsWith('\n')
  const lines = removeExistingMetadataBlock(normalized.split('\n'))
  const closeIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closeIndex < 0) return frontmatter

  if (!isSheetMetadataEmpty(metadata)) {
    lines.splice(closeIndex, 0, ...metadataBlockLines(metadata))
  }

  const merged = lines.join(lineEnding)
  return hasTrailingLineBreak && !merged.endsWith(lineEnding) ? `${merged}${lineEnding}` : merged
}

export function columnNameFromOneBasedIndex(column: number): string {
  return columnNameFromIndex(column - 1)
}
