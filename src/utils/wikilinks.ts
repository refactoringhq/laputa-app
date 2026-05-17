// Wikilink placeholder tokens for markdown round-trip
const WL_START = '\u2039WIKILINK:'
const WL_END = '\u203A'
const WL_RE = /\u2039WIKILINK:([^\u203A]+)\u203A/g
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g
const TABLE_PLACEHOLDER_PREFIX = 'ENC:'
const FORMAT_MARKERS = new Set(['*', '_', '`', '~'])

type MarkdownSource = string
type MarkdownLine = string
type MarkdownLines = MarkdownLine[]
type TableLineMap = boolean[]
type PlaceholderPayload = string
type WikilinkTarget = string
type FrontmatterSplit = [MarkdownSource, MarkdownSource]
type CharacterCount = number
type LineIndex = number
type TextOffset = number
type TokenSequence = string
type ParsedTextRange = { text: MarkdownSource, nextIndex: TextOffset }
type MatchTargets = Set<WikilinkTarget>
type WordCount = number
type FenceMarker = string | null

/** Pre-process markdown: replace [[target]] with placeholder tokens */
export function preProcessWikilinks(md: MarkdownSource): MarkdownSource {
  const lines = md.split('\n')
  const tableLines = findMarkdownTableLines(lines)
  let fenceMarker: FenceMarker = null

  return lines.map((line, index) => {
    const nextFenceMarker = nextMarkdownFenceMarker(line, fenceMarker)
    if (nextFenceMarker !== fenceMarker || fenceMarker !== null) {
      fenceMarker = nextFenceMarker
      return line
    }

    return replaceWikilinksWithPlaceholders(line, { encodePayload: tableLines.at(index) ?? false })
  }).join('\n')
}

// Minimal shape of a BlockNote block for wikilink processing
interface BlockLike {
  content?: BlockContent
  children?: BlockLike[]
  [key: string]: unknown
}

type ScalarBlockContent = string | number | boolean | null | undefined
type BlockContent = InlineItem[] | TableContentLike | Record<string, unknown> | ScalarBlockContent

interface InlineItem {
  type: string
  text?: string
  props?: Record<string, string>
  content?: unknown
  [key: string]: unknown
}

interface TableContentLike {
  type: 'tableContent'
  rows?: TableRowLike[]
  [key: string]: unknown
}

interface TableRowLike {
  cells?: TableCellLike[]
  [key: string]: unknown
}

type TableCellLike = string | TableCellObjectLike

interface TableCellObjectLike {
  content?: InlineItem[]
  [key: string]: unknown
}

type ContentTransform = (content: InlineItem[]) => InlineItem[]

interface WikilinkReplacementOptions {
  encodePayload: boolean
}

function replaceWikilinksWithPlaceholders(
  line: MarkdownLine,
  options: WikilinkReplacementOptions,
): MarkdownLine {
  return line.replace(WIKILINK_RE, (_match, target) => wikilinkPlaceholder(target, options))
}

function wikilinkPlaceholder(
  target: WikilinkTarget,
  options: WikilinkReplacementOptions,
): string {
  const payload = options.encodePayload
    ? `${TABLE_PLACEHOLDER_PREFIX}${encodeURIComponent(target)}`
    : target
  return `${WL_START}${payload}${WL_END}`
}

function decodePlaceholderPayload(payload: PlaceholderPayload): WikilinkTarget {
  if (!payload.startsWith(TABLE_PLACEHOLDER_PREFIX)) return payload

  const encoded = payload.slice(TABLE_PLACEHOLDER_PREFIX.length)
  try {
    return decodeURIComponent(encoded)
  } catch {
    return encoded
  }
}

function lineFenceMarker(line: MarkdownLine): FenceMarker {
  return line.trimStart().match(/^(`{3,}|~{3,})/)?.[1] ?? null
}

function nextMarkdownFenceMarker(line: MarkdownLine, currentMarker: FenceMarker): FenceMarker {
  const marker = lineFenceMarker(line)
  if (!marker) return currentMarker
  if (!currentMarker) return marker
  return marker[0] === currentMarker[0] && marker.length >= currentMarker.length ? null : currentMarker
}

function blankFencedCodeLines(content: MarkdownSource): MarkdownSource {
  let fenceMarker: FenceMarker = null
  return content.split('\n').map((line) => {
    const nextFenceMarker = nextMarkdownFenceMarker(line, fenceMarker)
    const shouldBlank = fenceMarker !== null || nextFenceMarker !== fenceMarker
    fenceMarker = nextFenceMarker
    return shouldBlank ? '' : line
  }).join('\n')
}

function findMarkdownTableLines(lines: MarkdownLines): TableLineMap {
  const tableLines = lines.map(() => false)
  let fenceMarker: FenceMarker = null

  for (let index = 0; index < lines.length - 1; index++) {
    const line = lines.at(index)
    const nextLine = lines.at(index + 1)
    if (line === undefined || nextLine === undefined) continue
    const nextFenceMarker = nextMarkdownFenceMarker(line, fenceMarker)
    if (fenceMarker !== null || nextFenceMarker !== fenceMarker) {
      fenceMarker = nextFenceMarker
      continue
    }

    if (!isPotentialTableRow(line) || !isMarkdownTableSeparator(nextLine)) {
      continue
    }

    tableLines.splice(index, 1, true)
    tableLines.splice(index + 1, 1, true)
    index = markTableBodyLines(lines, tableLines, index + 2) - 1
  }
  return tableLines
}

function markTableBodyLines(
  lines: MarkdownLines,
  tableLines: TableLineMap,
  start: LineIndex,
): LineIndex {
  let index = start
  while (index < lines.length) {
    const line = lines.at(index)
    if (line === undefined || !isPotentialTableRow(line)) break
    tableLines.splice(index, 1, true)
    index++
  }
  return index
}

function isPotentialTableRow(line: MarkdownLine): boolean {
  const trimmed = line.trim()
  return trimmed.includes('|') && trimmed !== '|'
}

function isMarkdownTableSeparator(line: MarkdownLine): boolean {
  const cells = splitTableCells(line)
  return cells.length > 1 && cells.every(isMarkdownTableSeparatorCell)
}

function splitTableCells(line: MarkdownLine): MarkdownLines {
  let trimmed = line.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
  return trimmed.split('|').map((cell) => cell.trim()).filter(Boolean)
}

function isMarkdownTableSeparatorCell(cell: MarkdownLine): boolean {
  return /^:?-+:?$/.test(cell)
}

/** Walk blocks recursively, applying a transform to each block's inline content */
function walkBlocks(blocks: unknown[], transform: ContentTransform, clone = false): unknown[] {
  return (blocks as BlockLike[]).map(block => {
    const b = clone ? { ...block } : block
    b.content = transformBlockContent(b.content, transform)
    if (b.children && Array.isArray(b.children)) {
      b.children = walkBlocks(b.children, transform, clone) as BlockLike[]
    }
    return b
  })
}

function transformBlockContent(content: BlockContent, transform: ContentTransform): BlockContent {
  if (Array.isArray(content)) return transform(content)
  if (isTableContent(content)) return transformTableContent(content, transform)
  return content
}

function isTableContent(content: BlockContent): content is TableContentLike {
  return Boolean(
    content
      && typeof content === 'object'
      && !Array.isArray(content)
      && (content as TableContentLike).type === 'tableContent'
      && Array.isArray((content as TableContentLike).rows),
  )
}

function transformTableContent(
  content: TableContentLike,
  transform: ContentTransform,
): TableContentLike {
  return {
    ...content,
    rows: content.rows?.map((row) => ({
      ...row,
      cells: row.cells?.map((cell) => transformTableCell(cell, transform)),
    })),
  }
}

function transformTableCell(cell: TableCellLike, transform: ContentTransform): TableCellLike {
  if (typeof cell === 'string' || !Array.isArray(cell.content)) return cell
  return { ...cell, content: transform(cell.content) }
}

function textSegment(item: InlineItem, text: MarkdownSource): InlineItem {
  return { ...item, text }
}

function wikilinkItem(target: WikilinkTarget): InlineItem {
  return {
    type: 'wikilink',
    props: { target },
    content: undefined,
  }
}

/** Walk blocks and replace placeholder text with wikilink inline content */
export function injectWikilinks(blocks: unknown[]): unknown[] {
  return walkBlocks(blocks, expandWikilinksInContent)
}

/**
 * Deep-clone blocks and convert wikilink inline content back to [[target]] text.
 * This is the reverse of injectWikilinks — used before blocksToMarkdownLossy
 * so that wikilinks survive the markdown round-trip.
 */
export function restoreWikilinksInBlocks(blocks: unknown[]): unknown[] {
  return walkBlocks(blocks, collapseWikilinksInContent, true)
}

function expandWikilinksInContent(content: InlineItem[]): InlineItem[] {
  const result: InlineItem[] = []
  for (const item of content) {
    result.push(...expandWikilinksInItem(item))
  }
  return result
}

function expandWikilinksInItem(item: InlineItem): InlineItem[] {
  if (item.type !== 'text' || typeof item.text !== 'string' || !item.text.includes(WL_START)) return [item]

  const result: InlineItem[] = []
  let lastIndex = 0
  WL_RE.lastIndex = 0
  let match
  while ((match = WL_RE.exec(item.text)) !== null) {
    if (match.index > lastIndex) result.push(textSegment(item, item.text.slice(lastIndex, match.index)))
    result.push(wikilinkItem(decodePlaceholderPayload(match[1])))
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < item.text.length) result.push(textSegment(item, item.text.slice(lastIndex)))
  return result
}

function collapseWikilinksInContent(content: InlineItem[]): InlineItem[] {
  const result: InlineItem[] = []
  for (const item of content) {
    if (item.type === 'wikilink' && item.props?.target) {
      result.push({ type: 'text', text: `[[${item.props.target}]]` })
    } else {
      result.push(item)
    }
  }
  return result
}

function frontmatterOpeningLength(content: MarkdownSource): CharacterCount | null {
  if (content.startsWith('---\r\n')) return 5
  if (content.startsWith('---\n')) return 4
  return null
}

function precedingLineEndingLength(value: MarkdownSource): CharacterCount {
  return value.startsWith('\r\n') ? 2 : value.startsWith('\n') ? 1 : 0
}

function frontmatterCloseLength(value: MarkdownSource): CharacterCount {
  const lineEndingLength = precedingLineEndingLength(value)
  if (value.endsWith('\r\n')) return lineEndingLength + 5
  if (value.endsWith('\n')) return lineEndingLength + 4
  return lineEndingLength + 3
}

/** Strip YAML frontmatter from markdown, returning [frontmatter, body] */
export function splitFrontmatter(content: MarkdownSource): FrontmatterSplit {
  const openLength = frontmatterOpeningLength(content)
  if (openLength === null) return ['', content]

  const afterOpen = content.slice(openLength)
  const close = afterOpen.match(/(?:^|\r?\n)---(?:\r?\n|$)/)
  if (!close || close.index === undefined) return ['', content]

  const to = openLength + close.index + frontmatterCloseLength(close[0])
  return [content.slice(0, to), content.slice(to)]
}

/** Extract all outgoing wikilink targets from content.
 * Finds [[target]] and [[target|display]] patterns, returning just the target part.
 * Returns a sorted, deduplicated array. */
export function extractOutgoingLinks(content: MarkdownSource): WikilinkTarget[] {
  const links: WikilinkTarget[] = []
  const re = /\[\[([^\]]+)\]\]/g
  let match
  const searchableContent = blankFencedCodeLines(content)
  for (const line of searchableContent.split('\n')) {
    re.lastIndex = 0
    while ((match = re.exec(line)) !== null) {
      const inner = match[1]
      const pipeIdx = inner.indexOf('|')
      const target = pipeIdx !== -1 ? inner.slice(0, pipeIdx) : inner
      if (target) links.push(target)
    }
  }
  return [...new Set(links)].sort()
}

/** Extract the paragraph surrounding a [[target]] wikilink match from note content.
 * Searches for any target in the set, returns the first matching paragraph trimmed
 * to a max length. Returns null if no match found. */
export function extractBacklinkContext(
  content: MarkdownSource,
  matchTargets: MatchTargets,
  maxLength: CharacterCount = 120,
): MarkdownSource | null {
  const [, body] = splitFrontmatter(content)
  const searchableBody = blankFencedCodeLines(body)
  // Remove the H1 title line
  const withoutTitle = searchableBody.replace(/^\s*# [^\n]+\n?/, '')
  const paragraphs = withoutTitle.split(/\n{2,}/)

  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed) continue
    // Check if this paragraph contains a wikilink matching any target
    const re = /\[\[([^\]]+)\]\]/g
    let match
    while ((match = re.exec(trimmed)) !== null) {
      const inner = match[1]
      const pipeIdx = inner.indexOf('|')
      const target = pipeIdx !== -1 ? inner.slice(0, pipeIdx) : inner
      if (matchTargets.has(target) || matchTargets.has(target.split('/').pop() ?? '')) {
        // Collapse whitespace and truncate
        const flat = trimmed.replace(/\s+/g, ' ')
        if (flat.length <= maxLength) return flat
        return flat.slice(0, maxLength - 1) + '\u2026'
      }
    }
  }
  return null
}

/** Check if a line is useful for snippet extraction (not blank, heading, code fence, or rule). */
function isSnippetLine(line: MarkdownLine): boolean {
  const t = line.trim()
  return t !== '' && !t.startsWith('#') && !t.startsWith('```') && !t.startsWith('---')
}

/** Strip leading list markers (*, -, +, 1.) from a line. */
function stripListMarker(line: MarkdownLine): MarkdownLine {
  const t = line.trimStart()
  for (const prefix of ['* ', '- ', '+ ']) {
    if (t.startsWith(prefix)) return t.slice(prefix.length)
  }
  const dotPos = t.indexOf('. ')
  if (isOrderedListMarker(t, dotPos)) {
    return t.slice(dotPos + 2)
  }
  return t
}

function isOrderedListMarker(line: MarkdownLine, dotPos: TextOffset): boolean {
  if (dotPos < 1 || dotPos > 3) return false
  return /^\d+$/.test(line.slice(0, dotPos))
}

/** Remove the first H1 heading line, allowing leading blank lines. */
function removeH1Line(body: MarkdownSource): MarkdownSource {
  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines.at(i) ?? ''
    if (line.trim().startsWith('# ')) return lines.slice(i + 1).join('\n')
    if (line.trim() !== '') return body
  }
  return body
}

/** Strip markdown formatting chars: bold, italic, code, strikethrough, and resolve links. */
function stripMarkdownChars(s: MarkdownSource): MarkdownSource {
  let result = ''
  let i = 0
  while (i < s.length) {
    if (s.startsWith('[[', i)) {
      const parsed = readUntilSequence(s, i + 2, ']]')
      result += wikilinkDisplayText(parsed.text)
      i = parsed.nextIndex
    } else if (s.charAt(i) === '[') {
      const parsed = readUntilChar(s, i + 1, ']')
      result += parsed.text
      i = skipMarkdownLinkDestination(s, parsed.nextIndex)
    } else if (FORMAT_MARKERS.has(s.charAt(i))) {
      i++
    } else {
      result += s.charAt(i)
      i++
    }
  }
  return result
}

function readUntilSequence(
  value: MarkdownSource,
  start: TextOffset,
  sequence: TokenSequence,
): ParsedTextRange {
  const end = value.indexOf(sequence, start)
  if (end === -1) return { text: value.slice(start), nextIndex: value.length }
  return { text: value.slice(start, end), nextIndex: end + sequence.length }
}

function readUntilChar(
  value: MarkdownSource,
  start: TextOffset,
  char: TokenSequence,
): ParsedTextRange {
  const end = value.indexOf(char, start)
  if (end === -1) return { text: value.slice(start), nextIndex: value.length }
  return { text: value.slice(start, end), nextIndex: end + 1 }
}

function skipMarkdownLinkDestination(value: MarkdownSource, start: TextOffset): TextOffset {
  if (value.charAt(start) !== '(') return start

  const end = value.indexOf(')', start + 1)
  return end === -1 ? value.length : end + 1
}

function wikilinkDisplayText(inner: WikilinkTarget): MarkdownSource {
  const pipe = inner.indexOf('|')
  return pipe === -1 ? inner : inner.slice(pipe + 1)
}

/** Extract sub-heading text (## , ### , etc.) stripped of the # prefix. */
function extractSubheadingText(line: MarkdownLine): MarkdownSource | null {
  const t = line.trim()
  const stripped = t.replace(/^#+/, '')
  if (stripped.length < t.length && stripped.startsWith(' ')) {
    const text = stripped.trim()
    return text || null
  }
  return null
}

/** Extract a snippet: first ~160 chars of body content, stripped of markdown.
 *  Mirrors the Rust extract_snippet() logic for frontend use. */
export function extractSnippet(content: MarkdownSource): MarkdownSource {
  const [, body] = splitFrontmatter(content)
  const withoutH1 = removeH1Line(body)
  const clean = withoutH1.split('\n').filter(isSnippetLine).map(stripListMarker).join(' ')
  const stripped = stripMarkdownChars(clean).trim()
  if (stripped) {
    if (stripped.length <= 160) return stripped
    return stripped.slice(0, 160) + '...'
  }
  // Fallback: collect sub-heading text when no paragraph content exists
  const headingText = withoutH1.split('\n')
    .map(extractSubheadingText)
    .filter((t): t is MarkdownSource => t !== null)
    .join(' ')
  const headingStripped = stripMarkdownChars(headingText).trim()
  if (!headingStripped) return ''
  if (headingStripped.length <= 160) return headingStripped
  return headingStripped.slice(0, 160) + '...'
}

export function countWords(content: MarkdownSource): WordCount {
  const [, body] = splitFrontmatter(content)
  const withoutTitle = body.replace(/^\s*# [^\n]+\n?/, '')
  const withoutWikilinks = withoutTitle.replace(/\[\[[^\]]*\]\]/g, '')
  const text = withoutWikilinks.replace(/[#*_[\]`>~\-|]/g, '').trim()
  if (!text) return 0
  return text.split(/\s+/).filter(Boolean).length
}
