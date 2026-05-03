/**
 * Post-process BlockNote's blocksToMarkdownLossy output to produce
 * standard-convention Markdown:
 * - Tight lists (no blank lines between consecutive list items)
 * - Bullet list markers normalized to `-` (BlockNote outputs `*`)
 * - HTML entities like `&#x20;` decoded back to spaces
 * - Leading/trailing inline whitespace moved outside bold markers
 * - Stray hard-break-only lines removed after a markdown hard break
 * - No runs of 3+ blank lines (collapsed to one blank line)
 * - No trailing blank lines
 * - Code block content is never modified
 */
export function compactMarkdown(md: string): string {
  if (!md) return md

  const source = { lines: md.split('\n') }
  const result = { lines: [] as string[] }
  let inCodeBlock = false

  for (let i = 0; i < source.lines.length; i++) {
    const next = processMarkdownLine({ doc: source, idx: i, inCodeBlock })
    inCodeBlock = next.inCodeBlock
    if (next.line !== null) {
      result.lines.push(next.line)
    }
  }

  return finalizeMarkdown(result)
}

const LIST_RE = /^(\s*)([-*+]|\d+\.)\s/
const HARD_BREAK_ONLY_RE = /^\\+$/
const TRAILING_INLINE_CLOSERS_RE = /(?:[*_~`]+)$/
const STRONG_RE = /\*\*([^*\n]*?)\*\*/g

interface MarkdownDocument {
  lines: string[]
}

interface LinePosition {
  doc: MarkdownDocument
  idx: number
}

interface MarkdownLineValue {
  line: string
}

interface NormalizedLinePosition extends LinePosition {
  line: string
}

interface ProcessMarkdownLineArgs extends LinePosition {
  inCodeBlock: boolean
}

function processMarkdownLine(
  { doc, idx, inCodeBlock }: ProcessMarkdownLineArgs,
): { inCodeBlock: boolean; line: string | null } {
  const rawLine = doc.lines[idx]

  if (isFenceDelimiter({ line: rawLine })) {
    return { inCodeBlock: !inCodeBlock, line: rawLine }
  }

  if (inCodeBlock) {
    return { inCodeBlock, line: rawLine }
  }

  const line = normalizeMarkdownLine({ line: rawLine })
  if (shouldSkipLine({ doc, idx, line })) {
    return { inCodeBlock, line: null }
  }

  return { inCodeBlock, line }
}

function isFenceDelimiter({ line }: MarkdownLineValue): boolean {
  const trimmed = line.trimStart()
  return trimmed.startsWith('```') || trimmed.startsWith('~~~')
}

function normalizeMarkdownLine({ line }: MarkdownLineValue): string {
  const normalizedBullets = normalizeBulletMarker({ line })
  const decodedEntities = decodeHtmlEntities({ line: normalizedBullets })
  return normalizeStrongWhitespace({ line: decodedEntities })
}

function shouldSkipLine({ doc, idx, line }: NormalizedLinePosition): boolean {
  if (line.trim() === '') {
    return isBlankBetweenListItems({ doc, idx }) || isExcessiveBlankLine({ doc, idx })
  }

  return isRedundantHardBreakLine({ doc, idx, line })
}

/** True if this blank line sits between two list items (including nested) */
function isBlankBetweenListItems({ doc, idx }: LinePosition): boolean {
  const prev = findPrevNonBlank({ doc, idx })
  const next = findNextNonBlank({ doc, idx })
  if (prev === null || next === null) return false
  return LIST_RE.test(doc.lines[prev]) && LIST_RE.test(doc.lines[next])
}

/** True if this blank line is part of a run of 2+ consecutive blank lines
 *  (i.e. would create 3+ newlines in a row — collapse to just one blank line) */
function isExcessiveBlankLine({ doc, idx }: LinePosition): boolean {
  // Keep the first blank line in a run, skip subsequent ones
  if (idx > 0 && doc.lines[idx - 1].trim() === '') return true
  return false
}

function findPrevNonBlank({ doc, idx }: LinePosition): number | null {
  for (let i = idx - 1; i >= 0; i--) {
    if (doc.lines[i].trim() !== '') return i
  }
  return null
}

function findNextNonBlank({ doc, idx }: LinePosition): number | null {
  for (let i = idx + 1; i < doc.lines.length; i++) {
    if (doc.lines[i].trim() !== '') return i
  }
  return null
}

function isRedundantHardBreakLine({ doc, idx, line }: NormalizedLinePosition): boolean {
  if (!isHardBreakOnlyLine({ line })) return false

  const prev = findPrevNonBlank({ doc, idx })
  if (prev === null) return false

  const prevLine = normalizeMarkdownLine({ line: doc.lines[prev] })
  return isHardBreakOnlyLine({ line: prevLine }) || endsWithHardBreakMarker({ line: prevLine })
}

function isHardBreakOnlyLine({ line }: MarkdownLineValue): boolean {
  return HARD_BREAK_ONLY_RE.test(line.trim())
}

function endsWithHardBreakMarker({ line }: MarkdownLineValue): boolean {
  const trimmed = line.trimEnd()
  if (trimmed.endsWith('\\\\')) return true
  return trimmed.replace(TRAILING_INLINE_CLOSERS_RE, '').endsWith('\\\\')
}

const BULLET_RE = /^(\s*)\*(\s)/
/** Normalize `*` bullet markers to `-` (BlockNote default → standard convention) */
function normalizeBulletMarker({ line }: MarkdownLineValue): string {
  return line.replace(BULLET_RE, '$1-$2')
}

/** Decode HTML entities that BlockNote inserts (&#x20; &#x26; etc.) */
function decodeHtmlEntities({ line }: MarkdownLineValue): string {
  if (!line.includes('&#x')) return line
  return line.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

function normalizeStrongWhitespace({ line }: MarkdownLineValue): string {
  return line.replace(STRONG_RE, (match, content: string) => {
    const leadingWhitespace = content.match(/^\s+/)?.[0] ?? ''
    const trailingWhitespace = content.match(/\s+$/)?.[0] ?? ''
    if (!leadingWhitespace && !trailingWhitespace) {
      return match
    }

    const strongContent = content.slice(
      leadingWhitespace.length,
      content.length - trailingWhitespace.length,
    )
    if (!strongContent) {
      return match
    }

    return `${leadingWhitespace}**${strongContent}**${trailingWhitespace}`
  })
}

function finalizeMarkdown(doc: MarkdownDocument): string {
  while (doc.lines.length > 0 && doc.lines[doc.lines.length - 1].trim() === '') {
    doc.lines.pop()
  }
  if (doc.lines.length > 0) {
    doc.lines.push('')
  }
  return doc.lines.join('\n')
}
