// Wikilink placeholder tokens for markdown round-trip
const WL_START = '\u2039WIKILINK:'
const WL_END = '\u203A'
const WL_RE = new RegExp(`${WL_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^${WL_END}]+)${WL_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g')
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g
const FORMAT_MARKERS = new Set(['*', '_', '`', '~'])

/** Pre-process markdown: replace [[target]] with placeholder tokens */
export function preProcessWikilinks(md: string): string {
  const lines = md.split('\n')
  const tableLines = findMarkdownTableLines(lines)
  return lines.map((line, index) => (
    tableLines[index] ? line : replaceWikilinksWithPlaceholders(line)
  )).join('\n')
}

// Minimal shape of a BlockNote block for wikilink processing
interface BlockLike {
  content?: InlineItem[]
  children?: BlockLike[]
  [key: string]: unknown
}

interface InlineItem {
  type: string
  text?: string
  props?: Record<string, string>
  content?: unknown
  [key: string]: unknown
}

type ContentTransform = (content: InlineItem[]) => InlineItem[]

function replaceWikilinksWithPlaceholders(line: string): string {
  return line.replace(WIKILINK_RE, (_match, target) => `${WL_START}${target}${WL_END}`)
}

function findMarkdownTableLines(lines: string[]): boolean[] {
  const tableLines = lines.map(() => false)
  for (let index = 0; index < lines.length - 1; index++) {
    if (!isPotentialTableRow(lines[index]) || !isMarkdownTableSeparator(lines[index + 1])) {
      continue
    }

    tableLines[index] = true
    tableLines[index + 1] = true
    index = markTableBodyLines(lines, tableLines, index + 2) - 1
  }
  return tableLines
}

function markTableBodyLines(lines: string[], tableLines: boolean[], start: number): number {
  let index = start
  while (index < lines.length && isPotentialTableRow(lines[index])) {
    tableLines[index] = true
    index++
  }
  return index
}

function isPotentialTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.includes('|') && trimmed !== '|'
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitTableCells(line)
  return cells.length > 1 && cells.every(isMarkdownTableSeparatorCell)
}

function splitTableCells(line: string): string[] {
  let trimmed = line.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
  return trimmed.split('|').map((cell) => cell.trim()).filter(Boolean)
}

function isMarkdownTableSeparatorCell(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell)
}

/** Walk blocks recursively, applying a transform to each block's inline content */
function walkBlocks(blocks: unknown[], transform: ContentTransform, clone = false): unknown[] {
  return (blocks as BlockLike[]).map(block => {
    const b = clone ? { ...block } : block
    if (b.content && Array.isArray(b.content)) {
      b.content = transform(b.content)
    }
    if (b.children && Array.isArray(b.children)) {
      b.children = walkBlocks(b.children, transform, clone) as BlockLike[]
    }
    return b
  })
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
    if (item.type !== 'text' || typeof item.text !== 'string' || !item.text.includes(WL_START)) {
      result.push(item)
      continue
    }
    const text = item.text as string
    let lastIndex = 0
    WL_RE.lastIndex = 0
    let match
    while ((match = WL_RE.exec(text)) !== null) {
      if (match.index > lastIndex) {
        result.push({ ...item, text: text.slice(lastIndex, match.index) })
      }
      result.push({
        type: 'wikilink',
        props: { target: match[1] },
        content: undefined,
      })
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < text.length) {
      result.push({ ...item, text: text.slice(lastIndex) })
    }
  }
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

/** Strip YAML frontmatter from markdown, returning [frontmatter, body] */
export function splitFrontmatter(content: string): [string, string] {
  if (!content.startsWith('---')) return ['', content]
  const end = content.indexOf('\n---', 3)
  if (end === -1) return ['', content]
  let to = end + 4
  if (content[to] === '\n') to++
  return [content.slice(0, to), content.slice(to)]
}

/** Extract all outgoing wikilink targets from content.
 * Finds [[target]] and [[target|display]] patterns, returning just the target part.
 * Returns a sorted, deduplicated array. */
export function extractOutgoingLinks(content: string): string[] {
  const links: string[] = []
  const re = /\[\[([^\]]+)\]\]/g
  let match
  while ((match = re.exec(content)) !== null) {
    const inner = match[1]
    const pipeIdx = inner.indexOf('|')
    const target = pipeIdx !== -1 ? inner.slice(0, pipeIdx) : inner
    if (target) links.push(target)
  }
  return [...new Set(links)].sort()
}

/** Extract the paragraph surrounding a [[target]] wikilink match from note content.
 * Searches for any target in the set, returns the first matching paragraph trimmed
 * to a max length. Returns null if no match found. */
export function extractBacklinkContext(
  content: string,
  matchTargets: Set<string>,
  maxLength = 120,
): string | null {
  const [, body] = splitFrontmatter(content)
  // Remove the H1 title line
  const withoutTitle = body.replace(/^\s*# [^\n]+\n?/, '')
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
function isSnippetLine(line: string): boolean {
  const t = line.trim()
  return t !== '' && !t.startsWith('#') && !t.startsWith('```') && !t.startsWith('---')
}

/** Strip leading list markers (*, -, +, 1.) from a line. */
function stripListMarker(line: string): string {
  const t = line.trimStart()
  for (const prefix of ['* ', '- ', '+ ']) {
    if (t.startsWith(prefix)) return t.slice(prefix.length)
  }
  const dotPos = t.indexOf('. ')
  if (dotPos >= 1 && dotPos <= 3 && /^\d+$/.test(t.slice(0, dotPos))) {
    return t.slice(dotPos + 2)
  }
  return t
}

/** Remove the first H1 heading line, allowing leading blank lines. */
function removeH1Line(body: string): string {
  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('# ')) return lines.slice(i + 1).join('\n')
    if (lines[i].trim() !== '') return body
  }
  return body
}

/** Strip markdown formatting chars: bold, italic, code, strikethrough, and resolve links. */
function stripMarkdownChars(s: string): string {
  let result = ''
  let i = 0
  while (i < s.length) {
    if (s.startsWith('[[', i)) {
      const parsed = readUntilSequence(s, i + 2, ']]')
      result += wikilinkDisplayText(parsed.text)
      i = parsed.nextIndex
    } else if (s[i] === '[') {
      const parsed = readUntilChar(s, i + 1, ']')
      result += parsed.text
      i = skipMarkdownLinkDestination(s, parsed.nextIndex)
    } else if (FORMAT_MARKERS.has(s[i])) {
      i++
    } else {
      result += s[i]
      i++
    }
  }
  return result
}

function readUntilSequence(value: string, start: number, sequence: string): { text: string, nextIndex: number } {
  const end = value.indexOf(sequence, start)
  if (end === -1) return { text: value.slice(start), nextIndex: value.length }
  return { text: value.slice(start, end), nextIndex: end + sequence.length }
}

function readUntilChar(value: string, start: number, char: string): { text: string, nextIndex: number } {
  const end = value.indexOf(char, start)
  if (end === -1) return { text: value.slice(start), nextIndex: value.length }
  return { text: value.slice(start, end), nextIndex: end + 1 }
}

function skipMarkdownLinkDestination(value: string, start: number): number {
  if (value[start] !== '(') return start

  const end = value.indexOf(')', start + 1)
  return end === -1 ? value.length : end + 1
}

function wikilinkDisplayText(inner: string): string {
  const pipe = inner.indexOf('|')
  return pipe === -1 ? inner : inner.slice(pipe + 1)
}

/** Extract sub-heading text (## , ### , etc.) stripped of the # prefix. */
function extractSubheadingText(line: string): string | null {
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
export function extractSnippet(content: string): string {
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
    .filter((t): t is string => t !== null)
    .join(' ')
  const headingStripped = stripMarkdownChars(headingText).trim()
  if (!headingStripped) return ''
  if (headingStripped.length <= 160) return headingStripped
  return headingStripped.slice(0, 160) + '...'
}

export function countWords(content: string): number {
  const [, body] = splitFrontmatter(content)
  const withoutTitle = body.replace(/^\s*# [^\n]+\n?/, '')
  const withoutWikilinks = withoutTitle.replace(/\[\[[^\]]*\]\]/g, '')
  const text = withoutWikilinks.replace(/[#*_[\]`>~\-|]/g, '').trim()
  if (!text) return 0
  return text.split(/\s+/).filter(Boolean).length
}
