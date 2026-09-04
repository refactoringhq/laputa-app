interface TableCellLike {
  content?: unknown[]
  props?: Record<string, unknown>
  type?: string
  [key: string]: unknown
}

type TableCellValue = string | TableCellLike

interface TableRowLike {
  cells?: TableCellValue[]
  [key: string]: unknown
}

interface TableContentLike {
  headerCols?: unknown
  headerRows?: unknown
  rows: TableRowLike[]
  type?: string
  [key: string]: unknown
}

interface BlockLike {
  children?: unknown[]
  content?: unknown
  type?: string
  [key: string]: unknown
}

const MAX_BLOCKNOTE_TABLE_SPAN = 10_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTableContent(value: unknown): value is TableContentLike {
  return isRecord(value) && value.type === 'tableContent' && Array.isArray(value.rows)
}

function tableContent(value: unknown): TableContentLike | null {
  return isTableContent(value) ? value : null
}

function blockObject(value: unknown): BlockLike | null {
  return isRecord(value) ? value : null
}

function safeTableCardinality(value: unknown, fallback: number, minimum: number): number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= MAX_BLOCKNOTE_TABLE_SPAN
    ? value
    : fallback
}

function optionalTableCardinality(value: unknown, fallback: number, minimum: number): number | undefined {
  if (value === undefined) return undefined
  return safeTableCardinality(value, fallback, minimum)
}

function normalizeTableCellCardinalities(cell: TableCellValue): TableCellValue {
  if (typeof cell === 'string' || cell.type !== 'tableCell') return cell
  const { props } = cell
  if (!isRecord(props)) return cell

  const colspan = optionalTableCardinality(props.colspan, 1, 1)
  const rowspan = optionalTableCardinality(props.rowspan, 1, 1)
  if (colspan === props.colspan && rowspan === props.rowspan) return cell

  const normalizedProps = { ...props }
  if (colspan !== undefined) normalizedProps.colspan = colspan
  if (rowspan !== undefined) normalizedProps.rowspan = rowspan
  return { ...cell, props: normalizedProps }
}

function normalizeTableRows(rows: TableRowLike[]): TableRowLike[] {
  let changed = false
  const normalized = rows.map((row) => {
    if (!Array.isArray(row.cells)) return row
    const cells = row.cells.map(normalizeTableCellCardinalities)
    if (cells.every((cell, index) => cell === row.cells?.at(index))) return row
    changed = true
    return { ...row, cells }
  })
  return changed ? normalized : rows
}

function normalizedTableContent(
  table: TableContentLike,
  rows: TableRowLike[],
  headerRows: number | undefined,
  headerCols: number | undefined,
): TableContentLike {
  const normalized = { ...table, rows }
  if (headerRows !== undefined) normalized.headerRows = headerRows
  if (headerCols !== undefined) normalized.headerCols = headerCols
  return normalized
}

function normalizeTableContentCardinalities(content: unknown): unknown {
  const table = tableContent(content)
  if (!table) return content

  const rows = normalizeTableRows(table.rows)
  const headerRows = optionalTableCardinality(table.headerRows, 0, 0)
  const headerCols = optionalTableCardinality(table.headerCols, 0, 0)
  if (rows === table.rows && headerRows === table.headerRows && headerCols === table.headerCols) return table
  return normalizedTableContent(table, rows, headerRows, headerCols)
}

function normalizeBlockTableCardinalities(value: unknown): unknown {
  const block = blockObject(value)
  if (!block) return value

  const content = block.type === 'table' ? normalizeTableContentCardinalities(block.content) : block.content
  const children = Array.isArray(block.children)
    ? normalizeUnsafeTableCardinalities(block.children)
    : block.children
  if (content === block.content && children === block.children) return block
  return { ...block, content, children }
}

export function normalizeUnsafeTableCardinalities(blocks: unknown[]): unknown[] {
  const normalized = blocks.map(normalizeBlockTableCardinalities)
  return normalized.every((block, index) => block === blocks.at(index)) ? blocks : normalized
}
