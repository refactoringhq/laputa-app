export interface FastMarkdownParseMetrics {
  blockCount: number
  durationMs: number
  fallbackReason: string | null
  sourceBytes: number
}

export interface FastMarkdownParseResult {
  blocks: unknown[]
  metrics: FastMarkdownParseMetrics
  supported: boolean
}

interface TextStyles {
  bold?: boolean
  code?: boolean
  italic?: boolean
  strike?: boolean
}

interface InlineItem {
  type: 'link' | 'text'
  text?: string
  props?: Record<string, string>
  content?: InlineItem[]
  styles?: TextStyles
}

interface BlockLike {
  type: string
  content?: InlineItem[] | TableContentLike
  props?: Record<string, string | number | boolean>
  children: BlockLike[]
}

interface TableContentLike {
  type: 'tableContent'
  rows: Array<{ cells: Array<{ content: InlineItem[], type: 'tableCell' }> }>
  headerRows?: number
}

type InlineMarkdownText = string
type LineIndex = number
type MarkdownHref = string
type MarkdownLine = string
type MarkdownSourceText = string
type MarkdownToken = string

interface ParserState {
  fallbackReason: string | null
  lines: MarkdownLine[]
}

interface ListLine {
  checked?: boolean
  depth: number
  marker: string
  orderedStart?: number
  text: string
  type: 'bulletListItem' | 'checkListItem' | 'numberedListItem'
}

interface InlineLink {
  end: number
  href: string
  label: string
}

interface ParsedBlockStep {
  blocks: BlockLike[]
  next: LineIndex
}

interface BlockStepInput {
  block: BlockLike
  next: LineIndex
}

interface FastMarkdownSource {
  markdown: MarkdownSourceText
}

interface ParseResultInput {
  blocks: BlockLike[]
  source: FastMarkdownSource
  startedAt: number
  state: ParserState
}

interface SingleLineParseInput {
  index: LineIndex
  line: MarkdownLine
}

const HEADING_RE = /^(#{1,6})[ \t]+(.+?)\s*#*\s*$/u
const ORDERED_LIST_RE = /^([ \t]*)(\d+)[.)][ \t]+(.+)$/u
const UNORDERED_LIST_RE = /^([ \t]*)([-*+])[ \t]+(.+)$/u
const CHECK_LIST_RE = /^([ \t]*)([-*+])[ \t]+\[([ xX])\][ \t]+(.+)$/u
const THEMATIC_BREAK_RE = /^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/u
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/u
const HTML_BLOCK_RE = /^[ \t]{0,3}<\/?[A-Za-z][^>]*>/u
const MARKDOWN_IMAGE_RE = /(^|[^\\])!\[[^\]]*\]\(/u
const REFERENCE_LINK_RE = /^[ \t]{0,3}\[[^\]]+\]:[ \t]+/u
const UNSUPPORTED_BLOCK_RE = /^[ \t]{0,3}(?:#{7,}|:::+|\[\^.+\]:)/u
const TEXT_STYLE_KEYS: Array<keyof TextStyles> = ['bold', 'code', 'italic', 'strike']

const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

function sourceBytes(source: FastMarkdownSource): number {
  return textEncoder ? textEncoder.encode(source.markdown).byteLength : source.markdown.length
}

function paragraphBlock(content: InlineItem[]): BlockLike {
  return { type: 'paragraph', content, children: [] }
}

function textItem(text: InlineMarkdownText, styles: TextStyles = {}): InlineItem {
  return { type: 'text', text, styles }
}

function stylesEqual(left?: TextStyles, right?: TextStyles): boolean {
  return TEXT_STYLE_KEYS.every(style => Boolean(left?.[style]) === Boolean(right?.[style]))
}

function appendText(items: InlineItem[], text: string, styles: TextStyles): void {
  if (!text) return
  const previous = items.at(-1)
  if (previous?.type === 'text' && stylesEqual(previous.styles, styles)) {
    previous.text = `${previous.text ?? ''}${text}`
    return
  }
  items.push(textItem(text, { ...styles }))
}

function isEscaped(text: InlineMarkdownText, index: LineIndex): boolean {
  let slashCount = 0
  for (let i = index - 1; i >= 0 && text.charAt(i) === '\\'; i--) slashCount += 1
  return slashCount % 2 === 1
}

function findUnescaped(text: InlineMarkdownText, needle: MarkdownToken, from: LineIndex): LineIndex {
  let index = text.indexOf(needle, from)
  while (index !== -1 && isEscaped(text, index)) index = text.indexOf(needle, index + needle.length)
  return index
}

function markdownLinkBounds(text: InlineMarkdownText, index: LineIndex): { hrefEnd: LineIndex; labelEnd: LineIndex } | null {
  if (text.charAt(index) !== '[' || isEscaped(text, index)) return null
  const labelEnd = findUnescaped(text, ']', index + 1)
  if (labelEnd === -1 || text.charAt(labelEnd + 1) !== '(') return null
  const hrefEnd = findUnescaped(text, ')', labelEnd + 2)
  return hrefEnd === -1 ? null : { hrefEnd, labelEnd }
}

function validMarkdownLinkHref(href: MarkdownHref): boolean {
  if (!href) return false
  if (!/\s/u.test(href)) return true
  return href.startsWith('<') && href.endsWith('>')
}

function normalizedMarkdownLinkHref(href: MarkdownHref): MarkdownHref {
  return href.startsWith('<') && href.endsWith('>') ? href.slice(1, -1) : href
}

function readLinkAt(text: InlineMarkdownText, index: LineIndex): InlineLink | null {
  const bounds = markdownLinkBounds(text, index)
  if (!bounds) return null

  const href = text.slice(bounds.labelEnd + 2, bounds.hrefEnd).trim()
  if (!validMarkdownLinkHref(href)) return null
  return {
    end: bounds.hrefEnd + 1,
    href: normalizedMarkdownLinkHref(href),
    label: text.slice(index + 1, bounds.labelEnd),
  }
}

function parseInline(text: InlineMarkdownText, styles: TextStyles = {}): InlineItem[] {
  const items: InlineItem[] = []
  let index = 0

  while (index < text.length) {
    const link = readLinkAt(text, index)
    if (link) {
      items.push({
        type: 'link',
        props: { href: link.href },
        content: parseInline(link.label, styles),
      })
      index = link.end
      continue
    }

    const codeEnd = text.charAt(index) === '`' && !isEscaped(text, index)
      ? findUnescaped(text, '`', index + 1)
      : -1
    if (codeEnd !== -1) {
      appendText(items, text.slice(index + 1, codeEnd), { ...styles, code: true })
      index = codeEnd + 1
      continue
    }

    const marker = nextStyleMarker(text, index)
    if (marker) {
      const end = findUnescaped(text, marker.token, index + marker.token.length)
      if (end !== -1) {
        const inner = text.slice(index + marker.token.length, end)
        items.push(...parseInline(inner, { ...styles, [marker.style]: true }))
        index = end + marker.token.length
        continue
      }
    }

    appendText(items, text.charAt(index) === '\\' ? text.charAt(index + 1) || '\\' : text.charAt(index), styles)
    index += text.charAt(index) === '\\' && index + 1 < text.length ? 2 : 1
  }

  return items
}

function nextStyleMarker(text: InlineMarkdownText, index: LineIndex): { style: keyof TextStyles; token: MarkdownToken } | null {
  if (isEscaped(text, index)) return null
  if (text.startsWith('**', index)) return { style: 'bold', token: '**' }
  if (text.startsWith('__', index)) return { style: 'bold', token: '__' }
  if (text.startsWith('~~', index)) return { style: 'strike', token: '~~' }
  if (text.charAt(index) === '*') return { style: 'italic', token: '*' }
  if (text.charAt(index) === '_') return { style: 'italic', token: '_' }
  return null
}

function unsupportedLine(line: MarkdownLine): string | null {
  if (HTML_BLOCK_RE.test(line)) return 'html-block'
  if (MARKDOWN_IMAGE_RE.test(line)) return 'markdown-image'
  if (REFERENCE_LINK_RE.test(line)) return 'reference-link'
  if (UNSUPPORTED_BLOCK_RE.test(line)) return 'unsupported-block-marker'
  return null
}

function headingBlock(line: MarkdownLine): BlockLike | null {
  const match = HEADING_RE.exec(line)
  if (!match) return null
  return {
    type: 'heading',
    props: { level: match[1].length, textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
    content: parseInline(match[2]),
    children: [],
  }
}

function quoteBlock(line: MarkdownLine): BlockLike | null {
  const match = /^[ \t]{0,3}>[ \t]?(.*)$/u.exec(line)
  if (!match) return null
  return {
    type: 'quote',
    content: parseInline(match[1]),
    children: [],
  }
}

function listLine(line: MarkdownLine): ListLine | null {
  const check = CHECK_LIST_RE.exec(line)
  if (check) {
    return {
      checked: check[3].toLowerCase() === 'x',
      depth: listDepth(check[1]),
      marker: check[2],
      text: check[4],
      type: 'checkListItem',
    }
  }

  const ordered = ORDERED_LIST_RE.exec(line)
  if (ordered) {
    return {
      depth: listDepth(ordered[1]),
      marker: ordered[2],
      orderedStart: Number(ordered[2]),
      text: ordered[3],
      type: 'numberedListItem',
    }
  }

  const unordered = UNORDERED_LIST_RE.exec(line)
  if (!unordered) return null
  return {
    depth: listDepth(unordered[1]),
    marker: unordered[2],
    text: unordered[3],
    type: 'bulletListItem',
  }
}

function listDepth(indent: MarkdownLine): number {
  return Math.floor(indent.replace(/\t/gu, '  ').length / 2)
}

function listBlock(item: ListLine): BlockLike {
  return {
    type: item.type,
    props: {
      ...(item.type === 'checkListItem' ? { checked: item.checked === true } : {}),
      ...(item.type === 'numberedListItem' && item.orderedStart && item.orderedStart !== 1
        ? { start: item.orderedStart }
        : {}),
    },
    content: parseInline(item.text),
    children: [],
  }
}

function appendListBlock(
  state: ParserState,
  root: BlockLike[],
  stack: BlockLike[],
  item: ListLine,
): boolean {
  if (item.depth > stack.length) {
    state.fallbackReason = 'list-depth-gap'
    return false
  }

  const block = listBlock(item)
  if (item.depth === 0) {
    root.push(block)
  } else if (!appendNestedListBlock(state, stack, item.depth, block)) {
    return false
  }
  stack[item.depth] = block
  stack.length = item.depth + 1
  return true
}

function appendNestedListBlock(
  state: ParserState,
  stack: BlockLike[],
  depth: number,
  block: BlockLike,
): boolean {
  const parent = stack[depth - 1]
  if (!parent) {
    state.fallbackReason = 'list-parent-missing'
    return false
  }
  parent.children.push(block)
  return true
}

function parseList(state: ParserState, start: LineIndex): { blocks: BlockLike[]; next: LineIndex } | null {
  const firstLine = state.lines[start]
  if (firstLine === undefined || !listLine(firstLine)) return null

  const root: BlockLike[] = []
  const stack: BlockLike[] = []
  let index = start

  while (index < state.lines.length) {
    const item = listLine(state.lines[index])
    if (!item) break
    if (!appendListBlock(state, root, stack, item)) return null
    index += 1
  }

  return { blocks: root, next: index }
}

function parseFence(state: ParserState, start: LineIndex): { block: BlockLike; next: LineIndex } | null {
  const opening = FENCE_RE.exec(state.lines[start])
  if (!opening) return null
  const marker = opening[1]
  const markerChar = marker.charAt(0)
  const language = opening[2].trim().split(/\s+/u)[0] ?? ''
  let end = start + 1

  while (end < state.lines.length) {
    const trimmed = state.lines[end].trim()
    if (trimmed.startsWith(markerChar.repeat(marker.length))) {
      return {
        block: {
          type: 'codeBlock',
          props: { language: language || 'text' },
          content: [textItem(state.lines.slice(start + 1, end).join('\n'))],
          children: [],
        },
        next: end + 1,
      }
    }
    end += 1
  }

  state.fallbackReason = 'unclosed-code-fence'
  return null
}

function splitTableRow(line: MarkdownLine): string[] {
  let trimmed = line.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)

  const cells: string[] = []
  let cell = ''
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed.charAt(index)
    if (char === '\\' && trimmed.charAt(index + 1) === '|') {
      cell += '|'
      index += 1
      continue
    }
    if (char === '|') {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += char
  }
  cells.push(cell.trim())
  return cells
}

function isTableSeparator(line: MarkdownLine): boolean {
  const cells = splitTableRow(line)
  return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/u.test(cell))
}

function isTableStart(lines: MarkdownLine[], index: LineIndex): boolean {
  const current = lines[index]
  const next = lines[index + 1]
  return Boolean(current?.includes('|') && next && isTableSeparator(next))
}

function isTableBodyLine(state: ParserState, index: number): boolean {
  const line = state.lines[index]
  return Boolean(line?.includes('|') && line.trim())
}

function parseTable(state: ParserState, start: LineIndex): { block: BlockLike; next: LineIndex } | null {
  if (!isTableStart(state.lines, start)) return null
  const rows: string[][] = [splitTableRow(state.lines[start])]
  let index = start + 2
  while (index < state.lines.length && isTableBodyLine(state, index)) {
    rows.push(splitTableRow(state.lines[index]))
    index += 1
  }

  const width = Math.max(...rows.map(row => row.length), 0)
  if (width === 0) {
    state.fallbackReason = 'empty-table'
    return null
  }

  return {
    block: {
      type: 'table',
      content: {
        type: 'tableContent',
        headerRows: 1,
        rows: rows.map(row => ({
          cells: Array.from({ length: width }, (_, cellIndex) => ({
            type: 'tableCell' as const,
            content: parseInline(row[cellIndex] ?? ''),
          })),
        })),
      },
      children: [],
    },
    next: index,
  }
}

function parseParagraph(state: ParserState, start: LineIndex): { block: BlockLike; next: LineIndex } {
  const lines: string[] = []
  let index = start
  while (index < state.lines.length) {
    const line = state.lines[index]
    if (!line.trim()) break
    if (index !== start && startsBlock(state.lines, index)) break
    lines.push(line.trim())
    index += 1
  }

  return {
    block: paragraphBlock(parseInline(lines.join('\n'))),
    next: index,
  }
}

function startsBlock(lines: MarkdownLine[], index: LineIndex): boolean {
  const line = lines[index]
  return Boolean(
    headingBlock(line)
    || quoteBlock(line)
    || listLine(line)
    || FENCE_RE.test(line)
    || THEMATIC_BREAK_RE.test(line)
    || isTableStart(lines, index),
  )
}

function blockStep({ block, next }: BlockStepInput): ParsedBlockStep {
  return { blocks: [block], next }
}

function parseMultilineBlock(state: ParserState, index: LineIndex): ParsedBlockStep | null {
  const fence = parseFence(state, index)
  if (fence || state.fallbackReason) return fence ? blockStep({ block: fence.block, next: fence.next }) : null

  const table = parseTable(state, index)
  if (table || state.fallbackReason) return table ? blockStep({ block: table.block, next: table.next }) : null

  const list = parseList(state, index)
  return list ? { blocks: list.blocks, next: list.next } : null
}

function parseSingleLineBlock({ index, line }: SingleLineParseInput): ParsedBlockStep | null {
  const heading = headingBlock(line)
  if (heading) return blockStep({ block: heading, next: index + 1 })

  const quote = quoteBlock(line)
  if (quote) return blockStep({ block: quote, next: index + 1 })

  return THEMATIC_BREAK_RE.test(line)
    ? blockStep({ block: { type: 'divider', children: [] }, next: index + 1 })
    : null
}

function parseNextBlock(state: ParserState, index: LineIndex): ParsedBlockStep | null {
  const multiline = parseMultilineBlock(state, index)
  if (multiline || state.fallbackReason) return multiline

  const line = state.lines[index]
  const singleLine = parseSingleLineBlock({ index, line })
  if (singleLine) return singleLine

  const paragraph = parseParagraph(state, index)
  return blockStep({ block: paragraph.block, next: paragraph.next })
}

function createParseResult({ blocks, source, startedAt, state }: ParseResultInput): FastMarkdownParseResult {
  return {
    blocks,
    supported: state.fallbackReason === null,
    metrics: {
      blockCount: blocks.length,
      durationMs: now() - startedAt,
      fallbackReason: state.fallbackReason,
      sourceBytes: sourceBytes(source),
    },
  }
}

function parseBlocks(source: FastMarkdownSource): FastMarkdownParseResult {
  const startedAt = now()
  const state: ParserState = { fallbackReason: null, lines: source.markdown.split(/\r?\n/u) }
  const blocks: BlockLike[] = []
  let index = 0

  while (index < state.lines.length) {
    const line = state.lines[index]
    const unsupported = unsupportedLine(line)
    if (unsupported) {
      state.fallbackReason = unsupported
      break
    }
    if (!line.trim()) {
      index += 1
      continue
    }

    const parsed = parseNextBlock(state, index)
    if (state.fallbackReason) break
    if (!parsed) break
    blocks.push(...parsed.blocks)
    index = parsed.next
  }

  return createParseResult({ blocks, source, startedAt, state })
}

export function tryParseFastMarkdownBlocks(markdown: MarkdownSourceText): FastMarkdownParseResult {
  return parseBlocks({ markdown })
}

function canUseFastMarkdownWorker(): boolean {
  return typeof Worker !== 'undefined'
    && typeof URL !== 'undefined'
    && !('__vitest_worker__' in globalThis)
}

function parseFastMarkdownInWorker(source: FastMarkdownSource): Promise<FastMarkdownParseResult> {
  return new Promise((resolve) => {
    let settled = false
    const worker = new Worker(new URL('./editorFastMarkdownBlocks.worker.ts', import.meta.url), { type: 'module' })
    const settle = (result: FastMarkdownParseResult) => {
      if (settled) return
      settled = true
      worker.terminate()
      resolve(result)
    }

    worker.onmessage = (event: MessageEvent<FastMarkdownParseResult>) => {
      settle(event.data)
    }
    worker.onerror = () => {
      settle(tryParseFastMarkdownBlocks(source.markdown))
    }
    worker.postMessage(source.markdown)
  })
}

export async function tryParseFastMarkdownBlocksOffThread(markdown: MarkdownSourceText): Promise<FastMarkdownParseResult> {
  if (!canUseFastMarkdownWorker()) return tryParseFastMarkdownBlocks(markdown)
  try {
    return await parseFastMarkdownInWorker({ markdown })
  } catch {
    return tryParseFastMarkdownBlocks(markdown)
  }
}
