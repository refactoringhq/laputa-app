export const TABLE_SNIPPET_FALLBACK = '📊 Table'
const TABLE_HEADER_PREVIEW_MAX = 80
const CELL_SEPARATOR = ' · '

interface SnippetWalkerState {
  parts: string[]
  insideHtmlTable: boolean
  htmlTableBuffer: string[]
  insidePipeTable: boolean
  pipeTableHeaderEmitted: boolean
}

function isPipeTableRow(line: string): boolean {
  return line.startsWith('|') && line.endsWith('|') && line.length >= 2
}

function isPipeTableSeparator(line: string): boolean {
  if (!line.includes('|')) return false
  const trimmed = line.replace(/^\|+|\|+$/g, '').trim()
  if (!trimmed) return false
  return trimmed
    .split('|')
    .map(cell => cell.trim().replace(/^:+|:+$/g, ''))
    .every(cell => cell.length > 0 && /^-+$/.test(cell))
}

function startsHtmlTable(line: string): boolean {
  return /^<table\b/i.test(line.trimStart())
}

function endsHtmlTable(line: string): boolean {
  return /<\/table\s*>/i.test(line)
}

function stripInlineHtml(line: string): string {
  return line.replace(/<\/?[A-Za-z][^>]*>/g, '').replace(/[ \t]+/g, ' ').trim()
}

function isFilteredLine(trimmed: string): boolean {
  return !trimmed
    || /^#+\s+/.test(trimmed)
    || trimmed.startsWith('```')
    || trimmed.startsWith('---')
}

function pipeTableCells(row: string): string[] {
  return row
    .replace(/^\|+|\|+$/g, '')
    .split('|')
    .map(cell => cell.trim())
    .filter(cell => cell.length > 0)
}

function truncateHeaderText(text: string): string {
  if (text.length <= TABLE_HEADER_PREVIEW_MAX) return text
  return `${text.slice(0, TABLE_HEADER_PREVIEW_MAX - 1).trimEnd()}…`
}

function formatTableMarker(cells: string[]): string {
  const cleaned = cells
    .map(cell => stripInlineHtml(cell))
    .filter(cell => cell.length > 0)
  if (cleaned.length === 0) return TABLE_SNIPPET_FALLBACK
  return `📊 ${truncateHeaderText(cleaned.join(CELL_SEPARATOR))}`
}

function htmlTableHeaderCells(html: string): string[] {
  const theadMatch = html.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)
  const scope = theadMatch ? theadMatch[1] : html
  const trMatch = scope.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i)
  if (!trMatch) return []
  return Array.from(trMatch[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi))
    .map(match => match[1].trim())
}

function visitHtmlTableContinuation(line: string, state: SnippetWalkerState): void {
  state.htmlTableBuffer.push(line)
  if (!endsHtmlTable(line)) return
  const marker = formatTableMarker(htmlTableHeaderCells(state.htmlTableBuffer.join('\n')))
  state.parts.push(marker)
  state.htmlTableBuffer = []
  state.insideHtmlTable = false
}

function visitHtmlTableStart(trimmed: string, state: SnippetWalkerState): void {
  state.insidePipeTable = false
  state.pipeTableHeaderEmitted = false
  state.htmlTableBuffer = [trimmed]
  if (endsHtmlTable(trimmed)) {
    const marker = formatTableMarker(htmlTableHeaderCells(trimmed))
    state.parts.push(marker)
    state.htmlTableBuffer = []
    return
  }
  state.insideHtmlTable = true
}

function visitPipeTable(trimmed: string, state: SnippetWalkerState): void {
  if (state.insidePipeTable) return
  if (isPipeTableSeparator(trimmed)) {
    state.insidePipeTable = true
    return
  }
  state.parts.push(formatTableMarker(pipeTableCells(trimmed)))
  state.insidePipeTable = true
  state.pipeTableHeaderEmitted = true
}

function stripListMarker(line: string): string {
  return line.replace(/^[ \t]*(?:[-*+]\s+|\d+\.\s+)/, '')
}

function visitProseLine(trimmed: string, state: SnippetWalkerState): void {
  state.insidePipeTable = false
  state.pipeTableHeaderEmitted = false
  const delisted = stripListMarker(trimmed)
  const cleaned = stripInlineHtml(delisted)
  if (cleaned) state.parts.push(cleaned)
}

function visitLine(rawLine: string, state: SnippetWalkerState): void {
  const line = rawLine.replace(/\r$/, '')
  if (state.insideHtmlTable) {
    visitHtmlTableContinuation(line, state)
    return
  }
  const trimmed = line.trim()
  if (isFilteredLine(trimmed)) {
    state.insidePipeTable = false
    return
  }
  if (startsHtmlTable(trimmed)) {
    visitHtmlTableStart(trimmed, state)
    return
  }
  if (isPipeTableRow(trimmed) || isPipeTableSeparator(trimmed)) {
    visitPipeTable(trimmed, state)
    return
  }
  visitProseLine(trimmed, state)
}

function createWalkerState(): SnippetWalkerState {
  return {
    parts: [],
    insideHtmlTable: false,
    htmlTableBuffer: [],
    insidePipeTable: false,
    pipeTableHeaderEmitted: false,
  }
}

function isTableMarkerPart(part: string): boolean {
  return part.startsWith('📊')
}

function joinSnippetParts(parts: string[]): string {
  let out = ''
  let prevWasTable = false
  for (const part of parts) {
    const isTable = isTableMarkerPart(part)
    if (!out) {
      out = part
    } else {
      out += isTable || prevWasTable ? `\n${part}` : ` ${part}`
    }
    prevWasTable = isTable
  }
  return out
}

/**
 * Build a plain-text snippet body from raw markdown content.
 * Drops headings, code fences, and rules. Replaces every table block (HTML or GFM pipe) with
 * a `📊 col1 · col2 · …` marker built from the header row, capped at 80 chars.
 * Surrounding prose is separated from the marker by `\n` so sidebar UIs can show the
 * table as its own visual line. Falls back to `📊 Table` if no header is recoverable.
 */
export function markdownBodyText(content: string): string {
  const state = createWalkerState()
  for (const rawLine of content.split('\n')) {
    visitLine(rawLine, state)
  }
  return joinSnippetParts(state.parts).trim()
}
