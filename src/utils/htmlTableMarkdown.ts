const TABLE_OPEN_RE = /^[ \t]{0,3}<table\b/i
const TABLE_CLOSE_RE = /<\/table\s*>/i
const FENCE_RE = /^[ \t]{0,3}(```+|~~~+)/

interface FenceState {
  marker: string | null
}

interface Replacement {
  startLine: number
  endLine: number
  output: string
}

interface ReplacementSearch {
  lines: string[]
  cursor: number
  fence: FenceState
}

interface TableNode {
  header: string[]
  body: string[][]
}

export function preProcessHtmlTables(markdown: string): string {
  if (!markdown.includes('<table')) return markdown
  const lines = splitPreservingNewlines(markdown)
  const replacements = collectReplacements(lines)
  if (!replacements.length) return markdown
  return applyReplacements({ lines, replacements })
}

function splitPreservingNewlines(markdown: string): string[] {
  return markdown.split('\n')
}

function collectReplacements(lines: string[]): Replacement[] {
  const replacements: Replacement[] = []
  const search: ReplacementSearch = { lines, cursor: 0, fence: { marker: null } }
  while (search.cursor < lines.length) {
    advanceFenceOrTable({ search, replacements })
  }
  return replacements
}

function advanceFenceOrTable(args: { search: ReplacementSearch; replacements: Replacement[] }): void {
  const { search, replacements } = args
  const line = search.lines[search.cursor]
  if (toggleFenceIfMatch({ line, fence: search.fence })) {
    search.cursor += 1
    return
  }
  if (search.fence.marker || !TABLE_OPEN_RE.test(line)) {
    search.cursor += 1
    return
  }
  consumeTableBlock({ search, replacements })
}

function toggleFenceIfMatch(args: { line: string; fence: FenceState }): boolean {
  const { line, fence } = args
  const match = FENCE_RE.exec(line)
  if (!match) return false
  if (!fence.marker) {
    fence.marker = match[1]
    return true
  }
  if (line.includes(fence.marker)) fence.marker = null
  return true
}

function consumeTableBlock(args: { search: ReplacementSearch; replacements: Replacement[] }): void {
  const { search, replacements } = args
  const closeLine = findCloseLine({ lines: search.lines, from: search.cursor })
  if (closeLine === -1) {
    search.cursor += 1
    return
  }
  const html = search.lines.slice(search.cursor, closeLine + 1).join('\n')
  const gfm = htmlTableToGfm(html)
  if (gfm) replacements.push({ startLine: search.cursor, endLine: closeLine, output: gfm })
  search.cursor = closeLine + 1
}

function findCloseLine(args: { lines: string[]; from: number }): number {
  const { lines, from } = args
  for (let i = from; i < lines.length; i += 1) {
    if (TABLE_CLOSE_RE.test(lines[i])) return i
  }
  return -1
}

function applyReplacements(args: { lines: string[]; replacements: Replacement[] }): string {
  const { lines, replacements } = args
  const out: string[] = []
  let cursor = 0
  for (const r of replacements) {
    out.push(...lines.slice(cursor, r.startLine))
    out.push(r.output)
    cursor = r.endLine + 1
  }
  out.push(...lines.slice(cursor))
  return out.join('\n')
}

function htmlTableToGfm(html: string): string | null {
  const table = parseTableElement(html)
  if (!table) return null
  if (hasUnsupportedSpan(table)) return null
  const node = collectTableNode(table)
  if (!node) return null
  return formatGfmTable(node)
}

function parseTableElement(html: string): Element | null {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return doc.querySelector('table')
  } catch {
    return null
  }
}

function hasUnsupportedSpan(table: Element): boolean {
  const cells = Array.from(table.querySelectorAll('th, td'))
  return cells.some(cell => cellSpan(cell, 'colspan') > 1 || cellSpan(cell, 'rowspan') > 1)
}

function cellSpan(cell: Element, attr: 'colspan' | 'rowspan'): number {
  const raw = cell.getAttribute(attr)
  if (!raw) return 1
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function collectTableNode(table: Element): TableNode | null {
  const rows = collectRows(table)
  if (!rows.length) return null
  const [header, ...body] = rows
  return { header, body }
}

function collectRows(table: Element): string[][] {
  const headRows = Array.from(table.querySelectorAll('thead tr')).map(rowCells)
  const bodyRows = Array.from(table.querySelectorAll('tbody tr')).map(rowCells)
  if (headRows.length || bodyRows.length) return [...headRows, ...bodyRows]
  return Array.from(table.querySelectorAll(':scope > tr')).map(rowCells)
}

function rowCells(row: Element): string[] {
  return Array.from(row.querySelectorAll(':scope > th, :scope > td')).map(formatCell)
}

function formatCell(cell: Element): string {
  return normalizeCellText(extractCellText(cell))
}

function extractCellText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? ''
  if (node.nodeType !== 1) return ''
  const el = node as Element
  if (el.tagName === 'BR') return '\n'
  return Array.from(el.childNodes).map(extractCellText).join('')
}

function normalizeCellText(raw: string): string {
  const collapsed = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(segment => segment.replace(/[ \t]+/g, ' ').trim())
    .filter(segment => segment.length > 0)
    .join('<br>')
  return collapsed.replace(/\|/g, '\\|')
}

function formatGfmTable({ header, body }: TableNode): string {
  const cols = header.length || (body[0]?.length ?? 0)
  if (!cols) return ''
  const headerRow = padRow({ row: header, cols })
  const separator = new Array<string>(cols).fill('---')
  const bodyRows = body.map(row => padRow({ row, cols }))
  const rendered = [formatRow(headerRow), formatRow(separator), ...bodyRows.map(formatRow)]
  return ['', ...rendered, ''].join('\n')
}

function padRow(args: { row: string[]; cols: number }): string[] {
  const { row, cols } = args
  if (row.length >= cols) return row.slice(0, cols)
  return [...row, ...new Array<string>(cols - row.length).fill('')]
}

function formatRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`
}
