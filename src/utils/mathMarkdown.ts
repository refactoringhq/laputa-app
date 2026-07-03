import katex from 'katex'
import {
  serializeBlockNoteMarkdown,
  type DirectMarkdownCapableSerializer,
} from './blockNoteDirectMarkdown'

export const MATH_INLINE_TYPE = 'mathInline'
export const MATH_BLOCK_TYPE = 'mathBlock'

const INLINE_TOKEN_PREFIX = '@@TOLARIA_MATH_INLINE:'
const BLOCK_TOKEN_PREFIX = '@@TOLARIA_MATH_BLOCK:'
const TOKEN_SUFFIX = '@@'
const INLINE_TOKEN_RE = /@@TOLARIA_MATH_INLINE:([^@]+)@@/g
const CODE_FENCE_PREFIXES = ['```', '~~~']

interface InlineItem {
  type: string
  text?: string
  props?: Record<string, string>
  content?: unknown
  [key: string]: unknown
}

interface BlockLike {
  type?: string
  content?: BlockContent
  props?: Record<string, string>
  children?: BlockLike[]
  [key: string]: unknown
}

type BlockContent = InlineItem[] | TableContentLike | unknown

interface TableContentLike {
  type?: string
  rows?: TableRowLike[]
  [key: string]: unknown
}

interface TableRowLike {
  cells?: TableCellValue[]
  [key: string]: unknown
}

interface TableCellLike {
  content?: InlineItem[]
  [key: string]: unknown
}

type TableCellValue = TableCellLike | string
type InlineContentTransform = (content: InlineItem[]) => InlineItem[]

type MarkdownSerializer = DirectMarkdownCapableSerializer

interface LatexPayload {
  latex: string
}

interface EncodedPayload {
  encoded: string
}

interface TokenRequest extends LatexPayload {
  prefix: string
}

interface TokenReadRequest {
  text: string
  prefix: string
}

interface TextPosition {
  text: string
  index: number
}

interface LeadingAmount {
  end: number
}

interface InlineMathMatch extends LatexPayload {
  end: number
}

interface CompletedInlineMathMatch extends InlineMathMatch {
  start: number
}

interface MarkdownSource {
  markdown: string
}

interface MarkdownLine {
  line: string
}

interface MarkdownLines {
  lines: string[]
  start: number
}

interface MathRenderRequest extends LatexPayload {
  displayMode: boolean
}

function encodeLatex({ latex }: LatexPayload): string {
  return Array.from(latex, (char) => char.codePointAt(0)?.toString(16) ?? '').join('-')
}

function decodeLatex({ encoded }: EncodedPayload): string {
  if (/^[0-9a-f-]+$/iu.test(encoded)) {
    try {
      return encoded.split('-').map((part) => String.fromCodePoint(Number.parseInt(part, 16))).join('')
    } catch {
      return encoded
    }
  }

  try {
    return decodeURIComponent(encoded)
  } catch {
    return encoded
  }
}

function mathToken({ prefix, latex }: TokenRequest): string {
  return `${prefix}${encodeLatex({ latex })}${TOKEN_SUFFIX}`
}

function readMathToken({ text, prefix }: TokenReadRequest): string | null {
  if (!text.startsWith(prefix) || !text.endsWith(TOKEN_SUFFIX)) return null
  return decodeLatex({ encoded: text.slice(prefix.length, -TOKEN_SUFFIX.length) })
}

function isEscaped({ text, index }: TextPosition): boolean {
  let slashCount = 0
  for (let i = index - 1; i >= 0 && text.charAt(i) === '\\'; i--) {
    slashCount++
  }
  return slashCount % 2 === 1
}

function isCodeFence({ text: line }: { text: string }): boolean {
  const trimmed = line.trimStart()
  return CODE_FENCE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
}

function isSingleDollar({ text, index }: TextPosition): boolean {
  return text.charAt(index) === '$' && text.charAt(index - 1) !== '$' && text.charAt(index + 1) !== '$'
}

function isInlineMathEnd(position: TextPosition): boolean {
  return isSingleDollar(position) && !isEscaped(position)
}

function findInlineMathEnd({ text, index: start }: TextPosition): number {
  for (let i = start + 1; i < text.length; i++) {
    if (isInlineMathEnd({ text, index: i })) {
      return i
    }
  }
  return -1
}

function isValidInlineLatex({ latex }: LatexPayload): boolean {
  return Boolean(latex.trim())
    && !/^\s|\s$/.test(latex)
    && !looksLikeFinancialProse({ latex })
    && looksLikeIntentionalMath({ latex })
}

function looksLikeIntentionalMath({ latex }: LatexPayload): boolean {
  const trimmed = latex.trim()
  if (isSimpleVariable(trimmed)) return true
  if (startsWithLikelyCurrencyAmount(trimmed)) return false
  if (hasCoefficientVariableSyntax(trimmed)) return true
  if (!hasMathSyntax(trimmed)) return false
  if (hasLatexCommand(trimmed)) return true
  return !hasPlainProseWord(trimmed)
}

function isSimpleVariable(text: string): boolean {
  return /^[A-Za-z](?:['’])?$/u.test(text)
}

function hasLatexCommand(text: string): boolean {
  return /\\[A-Za-z]+/u.test(text)
}

function hasMathSyntax(text: string): boolean {
  return hasLatexCommand(text)
    || /[-+*/=<>^_{}~]/u.test(text)
}

function hasPlainProseWord(text: string): boolean {
  const withoutCommands = text.replace(/\\[A-Za-z]+/gu, '')
  return /[A-Za-z]{3,}/u.test(withoutCommands)
}

function startsWithLikelyCurrencyAmount(text: string): boolean {
  const amount = readLeadingAmount(text)
  return amount !== null && (
    amountBoundaryLooksLikeCurrency({ text, amount })
    || amountSpanLacksMathIntent(text)
  )
}

function readLeadingAmount(text: string): LeadingAmount | null {
  const match = /^[\d,]+(?:\.\d+)?(?:[KMBT%])?/iu.exec(text)
  if (!match) return null
  return { end: match[0].length }
}

function amountBoundaryLooksLikeCurrency({ text, amount }: { text: string; amount: LeadingAmount }): boolean {
  const nextChar = text.charAt(amount.end)
  if (!nextChar) return true
  return (nextChar === '/' && isAsciiLetter(text.charAt(amount.end + 1)))
    || nextChar === ','
    || nextChar === ')'
    || /\s/u.test(nextChar)
}

function amountSpanLacksMathIntent(text: string): boolean {
  if (hasCoefficientVariableSyntax(text)) return false
  return !hasMathSyntax(text) || hasPlainProseWord(text)
}

function hasCoefficientVariableSyntax(text: string): boolean {
  return /^[\d,]+(?:\.\d+)?[A-Za-z]{1,2}\d?(?:[_^][A-Za-z0-9{}]+)?$/u.test(text)
}

function looksLikeFinancialProse({ latex }: LatexPayload): boolean {
  const trimmed = latex.trim()
  return hasFinancialAmountPrefix(trimmed) && hasProseAfterAmount(trimmed)
}

function hasFinancialAmountPrefix(text: string): boolean {
  const integerEnd = scanIntegerAmount(text)
  if (integerEnd === 0) return false

  const suffixIndex = scanDecimalAmount(text, integerEnd)
  if (!isFinancialSuffix(text.charAt(suffixIndex))) return false

  const nextChar = text.charAt(suffixIndex + 1)
  return nextChar === ',' || nextChar === '.' || nextChar === ')' || /\s/.test(nextChar)
}

function scanIntegerAmount(text: string): number {
  if (!isAsciiDigit(text.charAt(0))) return 0

  let index = 0
  while (isAsciiDigit(text.charAt(index)) || text.charAt(index) === ',') index += 1
  return index
}

function scanDecimalAmount(text: string, index: number): number {
  if (text.charAt(index) !== '.') return index

  let nextIndex = index + 1
  if (!isAsciiDigit(text.charAt(nextIndex))) return index
  while (isAsciiDigit(text.charAt(nextIndex))) nextIndex += 1
  return nextIndex
}

function isFinancialSuffix(char: string): boolean {
  return 'KMBT%'.includes(char.toUpperCase())
}

function hasProseAfterAmount(text: string): boolean {
  for (let index = 0; index < text.length - 2; index += 1) {
    const current = text.charAt(index)
    const next = text.charAt(index + 1)
    if ((current === ',' || current === '.') && /\s/.test(next)) return true
    if (/\s/.test(current) && isAsciiLetter(next) && isAsciiLetter(text.charAt(index + 2))) return true
  }
  return false
}

function isAsciiDigit(char: string): boolean {
  return char >= '0' && char <= '9'
}

function isAsciiLetter(char: string): boolean {
  const lowerChar = char.toLowerCase()
  return lowerChar >= 'a' && lowerChar <= 'z'
}

function readInlineMath({ text, index }: TextPosition): InlineMathMatch | null {
  if (!isSingleDollar({ text, index }) || isEscaped({ text, index })) return null

  const end = findInlineMathEnd({ text, index })
  if (end === -1) return null
  if (isAsciiLetter(text.charAt(end + 1)) || isAsciiDigit(text.charAt(end + 1))) return null

  const latex = text.slice(index + 1, end)
  return isValidInlineLatex({ latex }) ? { latex, end } : null
}

function isCompletedInlineMathEnd({ text, index }: TextPosition): boolean {
  return isInlineMathEnd({ text, index }) && text[index - 1] !== '$'
}

function findCompletedInlineMathStart({ text, index: end }: TextPosition): number {
  for (let i = end - 1; i >= 0; i--) {
    if (isInlineMathEnd({ text, index: i }) && text.charAt(i - 1) !== '$') {
      return i
    }
  }
  return -1
}

export function readCompletedInlineMathAtEnd({ text }: { text: string }): CompletedInlineMathMatch | null {
  const end = text.length - 1
  if (end < 1 || !isCompletedInlineMathEnd({ text, index: end })) return null

  const start = findCompletedInlineMathStart({ text, index: end })
  if (start === -1) return null

  const latex = text.slice(start + 1, end)
  return isValidInlineLatex({ latex }) ? { latex, start, end } : null
}

function replaceInlineMath({ line }: MarkdownLine): string {
  let result = ''
  let index = 0
  let inCodeSpan = false

  while (index < line.length) {
    const char = line.charAt(index)
    if (char === '`') {
      inCodeSpan = !inCodeSpan
      result += char
      index++
      continue
    }

    const inlineMath = inCodeSpan ? null : readInlineMath({ text: line, index })
    if (inlineMath) {
      result += mathToken({ prefix: INLINE_TOKEN_PREFIX, latex: inlineMath.latex })
      index = inlineMath.end + 1
    } else {
      result += char
      index++
    }
  }

  return result
}

function readSingleLineDisplayMath({ line }: MarkdownLine): InlineMathMatch | null {
  const match = line.trim().match(/^\$\$(.+)\$\$$/)
  const latex = match?.at(1)?.trim()
  return latex ? { latex, end: 0 } : null
}

function readMultilineDisplayMath({ lines, start }: MarkdownLines): InlineMathMatch | null {
  const startLine = lines.at(start)
  if (startLine?.trim() !== '$$') return null
  const end = lines.findIndex((line, index) => index > start && line.trim() === '$$')
  return end === -1 ? null : { latex: lines.slice(start + 1, end).join('\n'), end }
}

function readDisplayMath({ lines, start }: MarkdownLines): InlineMathMatch | null {
  const line = lines.at(start)
  if (line === undefined) return null
  const trimmed = line.trim()
  const displayMath = trimmed === '$$'
    ? readMultilineDisplayMath({ lines, start })
    : readSingleLineDisplayMath({ line })
  return displayMath && displayMath.end === 0
    ? { ...displayMath, end: start }
    : displayMath
}

export function preProcessMathMarkdown({ markdown }: MarkdownSource): string {
  const lines = markdown.split('\n')
  const result: string[] = []
  let inFence = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines.at(i)
    if (line === undefined) continue
    if (isCodeFence({ text: line })) {
      inFence = !inFence
      result.push(line)
      continue
    }

    if (inFence) {
      result.push(line)
      continue
    }

    const displayMath = readDisplayMath({ lines, start: i })
    if (displayMath) {
      result.push(mathToken({ prefix: BLOCK_TOKEN_PREFIX, latex: displayMath.latex }))
      i = displayMath.end
      continue
    }

    result.push(replaceInlineMath({ line }))
  }

  return result.join('\n')
}

function expandInlineMath(content: InlineItem[]): InlineItem[] {
  return content.flatMap(expandInlineMathItem)
}

function expandInlineMathItem(item: InlineItem): InlineItem[] {
  if (item.type !== 'text' || typeof item.text !== 'string') return [item]

  return item.text
    .split(INLINE_TOKEN_RE)
    .flatMap((part, index) => inlineMathPartToItem({ source: item, part, index }))
}

function inlineMathPartToItem({ source, part, index }: { source: InlineItem; part: string; index: number }): InlineItem[] {
  if (!part) return []
  if (index % 2 === 0) return [{ ...source, text: part }]
  return [{
    type: MATH_INLINE_TYPE,
    props: { latex: decodeLatex({ encoded: part }) },
    content: undefined,
  }]
}

function restoreInlineMath(content: InlineItem[]): InlineItem[] {
  let changed = false
  const restored = content.map((item) => {
    if (item.type !== MATH_INLINE_TYPE || !item.props?.latex) return item
    changed = true
    return { type: 'text', text: `$${item.props.latex}$` }
  })
  return changed ? restored : content
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

function transformTableCell(cell: TableCellValue, transform: InlineContentTransform): TableCellValue {
  if (typeof cell === 'string' || !Array.isArray(cell.content)) return cell
  const content = transform(cell.content)
  return content === cell.content ? cell : { ...cell, content }
}

function transformTableContent(
  content: TableContentLike,
  transform: InlineContentTransform,
): TableContentLike {
  let changed = false
  const rows = content.rows?.map((row) => {
    let rowChanged = false
    const cells = row.cells?.map((cell) => {
      const nextCell = transformTableCell(cell, transform)
      if (nextCell !== cell) rowChanged = true
      return nextCell
    })
    if (!rowChanged) return row
    changed = true
    return { ...row, cells }
  })

  if (!changed) return content
  return {
    ...content,
    rows,
  }
}

function transformBlockContent(
  content: BlockContent,
  transform: InlineContentTransform,
): BlockContent {
  if (Array.isArray(content)) return transform(content)
  if (isTableContent(content)) return transformTableContent(content, transform)
  return content
}

function injectMathInBlock(block: BlockLike): BlockLike {
  const content = transformBlockContent(block.content, expandInlineMath)
  const children = transformChildBlocks(block.children, injectMathInBlock)
  const latex = Array.isArray(content) ? readDisplayMathToken(content) : null

  if (latex !== null) {
    return buildMathBlock({ block, latex })
  }

  return content === block.content && children === block.children ? block : { ...block, content, children }
}

function readDisplayMathToken(content: InlineItem[] | undefined): string | null {
  const onlyItem = content?.length === 1 ? content[0] : null
  if (onlyItem?.type !== 'text' || typeof onlyItem.text !== 'string') return null
  return readMathToken({ text: onlyItem.text, prefix: BLOCK_TOKEN_PREFIX })
}

function buildMathBlock({ block, latex }: { block: BlockLike } & LatexPayload): BlockLike {
  return {
    ...block,
    type: MATH_BLOCK_TYPE,
    props: { ...(block.props ?? {}), latex },
    content: undefined,
    children: [],
  }
}

function restoreInlineMathInBlock(block: BlockLike): BlockLike {
  const content = transformBlockContent(block.content, restoreInlineMath)
  const children = transformChildBlocks(block.children, restoreInlineMathInBlock)
  return content === block.content && children === block.children ? block : { ...block, content, children }
}

function transformChildBlocks(
  children: BlockLike[] | undefined,
  transform: (block: BlockLike) => BlockLike,
): BlockLike[] | undefined {
  if (!Array.isArray(children)) return children
  let changed = false
  const nextChildren = children.map((child) => {
    const nextChild = transform(child)
    if (nextChild !== child) changed = true
    return nextChild
  })
  return changed ? nextChildren : children
}

function isMathBlock(block: BlockLike): boolean {
  return block.type === MATH_BLOCK_TYPE && typeof block.props?.latex === 'string'
}

function displayMathMarkdown({ latex }: LatexPayload): string {
  return `$$\n${latex}\n$$`
}

export function injectMathInBlocks(blocks: unknown[]): unknown[] {
  return (blocks as BlockLike[]).map(injectMathInBlock)
}

export function restoreMathInBlocks(blocks: unknown[]): unknown[] {
  return (blocks as BlockLike[]).map(restoreInlineMathInBlock)
}

export function serializeMathAwareBlocks(editor: MarkdownSerializer, blocks: unknown[]): string {
  const chunks: string[] = []
  let pending: unknown[] = []

  const flushPending = () => {
    if (pending.length === 0) return
    const markdown = serializeBlockNoteMarkdown(editor, restoreMathInBlocks(pending)).trimEnd()
    if (markdown) chunks.push(markdown)
    pending = []
  }

  for (const block of blocks as BlockLike[]) {
    if (isMathBlock(block)) {
      flushPending()
      chunks.push(displayMathMarkdown({ latex: block.props?.latex ?? '' }))
    } else {
      pending.push(block)
    }
  }
  flushPending()

  return chunks.join('\n\n')
}

function escapeHtml({ text }: { text: string }): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderMathToHtml({ latex, displayMode }: MathRenderRequest): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      trust: false,
    })
  } catch {
    return escapeHtml({ text: latex })
  }
}
