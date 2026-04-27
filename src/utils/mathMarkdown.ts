import katex from 'katex'

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
  content?: InlineItem[]
  props?: Record<string, string>
  children?: BlockLike[]
  [key: string]: unknown
}

interface MarkdownSerializer {
  blocksToMarkdownLossy: (blocks: unknown[]) => string
}

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
  return encodeURIComponent(latex)
}

function decodeLatex({ encoded }: EncodedPayload): string {
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
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) {
    slashCount++
  }
  return slashCount % 2 === 1
}

function isCodeFence({ text: line }: { text: string }): boolean {
  const trimmed = line.trimStart()
  return CODE_FENCE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
}

function isSingleDollar({ text, index }: TextPosition): boolean {
  return text[index] === '$' && text[index + 1] !== '$'
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
  return Boolean(latex.trim()) && !/^\s|\s$/.test(latex)
}

function readInlineMath({ text, index }: TextPosition): InlineMathMatch | null {
  if (!isSingleDollar({ text, index }) || isEscaped({ text, index })) return null

  const end = findInlineMathEnd({ text, index })
  if (end === -1) return null

  const latex = text.slice(index + 1, end)
  return isValidInlineLatex({ latex }) ? { latex, end } : null
}

function isCompletedInlineMathEnd({ text, index }: TextPosition): boolean {
  return isInlineMathEnd({ text, index }) && text[index - 1] !== '$'
}

function findCompletedInlineMathStart({ text, index: end }: TextPosition): number {
  for (let i = end - 1; i >= 0; i--) {
    if (isInlineMathEnd({ text, index: i }) && text[i - 1] !== '$') {
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
    const char = line[index]
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
  const latex = match?.[1]?.trim()
  return latex ? { latex, end: 0 } : null
}

function readMultilineDisplayMath({ lines, start }: MarkdownLines): InlineMathMatch | null {
  if (lines[start].trim() !== '$$') return null
  const end = lines.findIndex((line, index) => index > start && line.trim() === '$$')
  return end === -1 ? null : { latex: lines.slice(start + 1, end).join('\n'), end }
}

function readDisplayMath({ lines, start }: MarkdownLines): InlineMathMatch | null {
  const trimmed = lines[start].trim()
  const displayMath = trimmed === '$$'
    ? readMultilineDisplayMath({ lines, start })
    : readSingleLineDisplayMath({ line: lines[start] })
  return displayMath && displayMath.end === 0
    ? { ...displayMath, end: start }
    : displayMath
}

export function preProcessMathMarkdown({ markdown }: MarkdownSource): string {
  const lines = markdown.split('\n')
  const result: string[] = []
  let inFence = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
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
  return content.map((item) => {
    if (item.type !== MATH_INLINE_TYPE || !item.props?.latex) return item
    return { type: 'text', text: `$${item.props.latex}$` }
  })
}

function injectMathInBlock(block: BlockLike): BlockLike {
  const content = Array.isArray(block.content) ? expandInlineMath(block.content) : block.content
  const children = Array.isArray(block.children) ? block.children.map(injectMathInBlock) : block.children
  const latex = readDisplayMathToken(content)

  if (latex !== null) {
    return buildMathBlock({ block, latex })
  }

  return { ...block, content, children }
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
  const content = Array.isArray(block.content) ? restoreInlineMath(block.content) : block.content
  const children = Array.isArray(block.children) ? block.children.map(restoreInlineMathInBlock) : block.children
  return { ...block, content, children }
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
    const markdown = editor.blocksToMarkdownLossy(restoreMathInBlocks(pending)).trimEnd()
    if (markdown) chunks.push(markdown)
    pending = []
  }

  for (const block of blocks as BlockLike[]) {
    if (isMathBlock(block)) {
      flushPending()
      chunks.push(displayMathMarkdown({ latex: block.props!.latex }))
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
