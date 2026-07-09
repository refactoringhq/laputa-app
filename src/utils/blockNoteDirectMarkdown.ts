interface TextStyles {
  [style: string]: string | boolean | undefined
}

interface InlineItem {
  type?: string
  text?: string
  href?: string
  props?: Record<string, string | undefined>
  styles?: TextStyles
  content?: InlineItem[]
  [key: string]: unknown
}

interface TableCellLike {
  content?: InlineItem[]
  [key: string]: unknown
}

type TableCellValue = string | TableCellLike

interface TableRowLike {
  cells?: TableCellValue[]
  [key: string]: unknown
}

interface TableContentLike {
  type?: string
  rows?: TableRowLike[]
  [key: string]: unknown
}

interface BlockLike {
  type?: string
  content?: InlineItem[] | TableContentLike | unknown
  props?: Record<string, string | number | boolean | undefined>
  children?: BlockLike[]
  [key: string]: unknown
}

export interface BlockNoteDirectMarkdownMetrics {
  blockCount: number
  cacheHits: number
  cacheMisses: number
  durationMs: number
  fallbackReason: string | null
}

export interface BlockNoteDirectMarkdownResult {
  markdown: string
  metrics: BlockNoteDirectMarkdownMetrics
  supported: boolean
}

export interface DirectMarkdownCapableSerializer {
  blocksToMarkdownLossy: (blocks: unknown[]) => string
  blocksToMarkdownDirect?: (blocks: unknown[]) => BlockNoteDirectMarkdownResult
  __tolariaDirectMarkdownCache?: WeakMap<object, Map<string, string>>
  __tolariaLastDirectMarkdownMetrics?: BlockNoteDirectMarkdownMetrics
}

type MarkdownLinePrefix = {
  marker: string
  indent: string
}

interface SerializeContext {
  cache?: WeakMap<object, Map<string, string>>
  cacheHits: number
  cacheMisses: number
  fallbackReason: string | null
  numberedStack: number[]
}

const DIRECT_MARKDOWN_METHOD = 'blocksToMarkdownDirect'
const ESCAPE_INLINE_TEXT_RE = /([\\`*_])/g
const IMAGE_MARKER_BANG_RE = /!(?=\[)/g
const LEADING_ATX_HEADING_RE = /^([ \t]{0,3})(#{1,6})(?=\s|$)/gm
const LEADING_BLOCKQUOTE_RE = /^([ \t]{0,3})>/gm
const ESCAPE_TABLE_CELL_RE = /[|\n\r]/g
const TEXT_CONTENT_BLOCK_TYPES = new Set([
  'bulletListItem',
  'checkListItem',
  'numberedListItem',
  'paragraph',
])
const MEDIA_BLOCK_TYPES = new Set(['audio', 'file', 'image', 'video'])

type BlockMarkdownHandler = (block: BlockLike, context: SerializeContext) => string | null

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function blockObject(value: unknown): BlockLike | null {
  return isRecord(value) ? value as BlockLike : null
}

function contentArray(content: unknown): InlineItem[] {
  return Array.isArray(content) ? content as InlineItem[] : []
}

function tableContent(content: unknown): TableContentLike | null {
  return isRecord(content) && content.type === 'tableContent' && Array.isArray(content.rows)
    ? content as TableContentLike
    : null
}

function escapeText(text: string): string {
  return text
    .replace(ESCAPE_INLINE_TEXT_RE, '\\$1')
    .replace(IMAGE_MARKER_BANG_RE, '\\!')
    .replace(LEADING_ATX_HEADING_RE, '$1\\$2')
    .replace(LEADING_BLOCKQUOTE_RE, '$1\\>')
}

function escapeLinkTarget(target: string): string {
  return target.includes(' ') || target.includes(')') ? `<${target.replace(/>/g, '%3E')}>` : target
}

function inlineText(item: InlineItem): string {
  if (item.type === 'text') return item.text ?? ''
  if (item.type === 'link') return linkMarkdown(item)
  if (item.type === 'wikilink') return wikilinkMarkdown(item)
  if (item.type === 'mathInline') return item.props?.latex ? `$${item.props.latex}$` : ''
  if (Array.isArray(item.content)) return serializeInlineContent(item.content)
  return ''
}

function linkMarkdown(item: InlineItem): string {
  const content = Array.isArray(item.content)
    ? serializeInlineContent(item.content)
    : escapeText(item.text ?? item.props?.title ?? item.props?.href ?? '')
  const href = item.props?.href ?? item.href
  return href ? `[${content}](${escapeLinkTarget(href)})` : content
}

function wikilinkMarkdown(item: InlineItem): string {
  const target = item.props?.target
  return target ? `[[${target}]]` : ''
}

function wrapInlineMarkdown(text: string, marker: string): string {
  if (!text) return text
  return `${marker}${text}${marker}`
}

function styledTextMarkdown(item: InlineItem): string {
  let text = escapeText(item.text ?? '')
  const styles = item.styles ?? {}
  if (styles.code === true) return codeSpan(item.text ?? '')
  if (styles.bold === true) text = wrapInlineMarkdown(text, '**')
  if (styles.italic === true) text = wrapInlineMarkdown(text, '*')
  if (styles.strike === true) text = wrapInlineMarkdown(text, '~~')
  return text
}

function codeSpan(text: string): string {
  const marker = text.includes('`') ? '``' : '`'
  const needsPadding = marker === '``' && (text.startsWith('`') || text.endsWith('`'))
  return needsPadding ? `${marker} ${text} ${marker}` : `${marker}${text}${marker}`
}

function serializeInlineItem(item: InlineItem): string {
  return item.type === 'text' ? styledTextMarkdown(item) : inlineText(item)
}

export function serializeInlineContent(content: InlineItem[] | undefined): string {
  return content?.map(serializeInlineItem).join('') ?? ''
}

function literalInlineText(item: InlineItem): string {
  if (typeof item.text === 'string') return item.text
  if (Array.isArray(item.content)) return literalTextContent(item.content)
  return ''
}

function literalTextContent(content: InlineItem[] | undefined): string {
  return content?.map(literalInlineText).join('') ?? ''
}

function blockPrefix(block: BlockLike, depth: number, context: SerializeContext): MarkdownLinePrefix | null {
  const indent = '  '.repeat(depth)
  if (block.type === 'numberedListItem') {
    const next = context.numberedStack[depth] ?? Number(block.props?.start ?? 1)
    context.numberedStack[depth] = next + 1
    return { indent, marker: `${next}. ` }
  }
  context.numberedStack[depth] = 1
  if (block.type === 'bulletListItem') return { indent, marker: '- ' }
  if (block.type === 'checkListItem') return { indent, marker: block.props?.checked === true ? '- [x] ' : '- [ ] ' }
  return null
}

function advanceCachedBlockContext(block: BlockLike, depth: number, context: SerializeContext): void {
  if (block.type === 'numberedListItem') {
    const next = context.numberedStack[depth] ?? Number(block.props?.start ?? 1)
    context.numberedStack[depth] = next + 1
  } else {
    context.numberedStack[depth] = 1
  }
  context.numberedStack.length = depth + 1
}

function prependLinePrefix(markdown: string, prefix: MarkdownLinePrefix): string {
  const lines = markdown.split('\n')
  return lines.map((line, index) => (
    index === 0
      ? `${prefix.indent}${prefix.marker}${line}`
      : `${prefix.indent}  ${line}`
  )).join('\n')
}

function codeBlockMarkdown(block: BlockLike): string {
  const language = typeof block.props?.language === 'string' ? block.props.language : ''
  const code = literalTextContent(contentArray(block.content)).replace(/\n$/u, '')
  const fence = code.includes('```') ? '~~~' : '```'
  return `${fence}${language === 'text' ? '' : language}\n${code}\n${fence}`
}

function mediaLabel(name: string, url: string): string {
  return name || url.split('/').pop() || url
}

function mediaUrl(block: BlockLike): string {
  return typeof block.props?.url === 'string' ? block.props.url : ''
}

function mediaMarkdown(block: BlockLike): string {
  const url = mediaUrl(block)
  const name = typeof block.props?.name === 'string' ? block.props.name : ''
  if (!url) return name
  const label = mediaLabel(name, url)
  return block.type === 'image'
    ? `![${escapeText(label)}](${escapeLinkTarget(url)})`
    : `[${escapeText(label)}](${escapeLinkTarget(url)})`
}

function quoteMarkdown(block: BlockLike): string {
  const text = serializeInlineContent(contentArray(block.content))
  return text.split('\n').map(line => `> ${line}`).join('\n')
}

function tableCellMarkdown(cell: TableCellValue): string {
  const text = typeof cell === 'string'
    ? cell
    : serializeInlineContent(contentArray(cell.content))
  return text.replace(ESCAPE_TABLE_CELL_RE, character => character === '|' ? '\\|' : ' ')
}

function tableMarkdown(block: BlockLike): string | null {
  const content = tableContent(block.content)
  const rows = content?.rows ?? []
  if (rows.length === 0) return ''

  const cellRows = rows.map(row => row.cells?.map(tableCellMarkdown) ?? [])
  const width = Math.max(...cellRows.map(row => row.length), 0)
  if (width === 0) return ''

  const normalizedRows = cellRows.map(row => Array.from({ length: width }, (_, index) => row[index] ?? ''))
  const [head, ...body] = normalizedRows
  return [
    `| ${head.join(' | ')} |`,
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...body.map(row => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function inlineBlockMarkdown(block: BlockLike): string {
  return serializeInlineContent(contentArray(block.content))
}

function headingMarkdown(block: BlockLike): string {
  const level = Math.max(1, Math.min(6, Number(block.props?.level ?? 1)))
  return `${'#'.repeat(level)} ${serializeInlineContent(contentArray(block.content))}`.trimEnd()
}

function unsupportedBlockMarkdown(block: BlockLike, context: SerializeContext): null {
  context.fallbackReason = typeof block.type === 'string' ? `unsupported:${block.type}` : 'unsupported:unknown'
  return null
}

const BLOCK_MARKDOWN_HANDLERS: Record<string, BlockMarkdownHandler> = {
  codeBlock: codeBlockMarkdown,
  divider: () => '---',
  heading: headingMarkdown,
  quote: quoteMarkdown,
  table: tableMarkdown,
}

function blockMarkdownWithoutChildren(block: BlockLike, context: SerializeContext): string | null {
  if (typeof block.type !== 'string') return unsupportedBlockMarkdown(block, context)
  if (TEXT_CONTENT_BLOCK_TYPES.has(block.type)) return inlineBlockMarkdown(block)
  if (MEDIA_BLOCK_TYPES.has(block.type)) return mediaMarkdown(block)
  return BLOCK_MARKDOWN_HANDLERS[block.type]?.(block, context) ?? unsupportedBlockMarkdown(block, context)
}

function serializeChildren(block: BlockLike, depth: number, context: SerializeContext): string {
  const children = Array.isArray(block.children) ? block.children : []
  if (children.length === 0) return ''
  const childDepth = depth + 1
  context.numberedStack[childDepth] = 1
  const markdown = serializeBlockList(children, childDepth, context)
  context.numberedStack.length = childDepth
  return markdown
}

function blockCacheKey(block: BlockLike, depth: number, context: SerializeContext): string {
  return [
    depth,
    block.type ?? '',
    context.numberedStack[depth] ?? '',
  ].join(':')
}

function cachedBlockMarkdown(block: BlockLike, cacheKey: string, context: SerializeContext): string | null {
  const cached = context.cache?.get(block as object)?.get(cacheKey)
  if (cached === undefined) return null
  context.cacheHits++
  return cached
}

function storeCachedBlockMarkdown(
  block: BlockLike,
  cacheKey: string,
  markdown: string,
  context: SerializeContext,
): void {
  if (!context.cache) return
  const existing = context.cache.get(block as object)
  if (existing) {
    existing.set(cacheKey, markdown)
    return
  }
  context.cache.set(block as object, new Map([[cacheKey, markdown]]))
}

function renderUncachedBlock(block: BlockLike, depth: number, context: SerializeContext): string | null {
  context.cacheMisses++
  const ownMarkdown = blockMarkdownWithoutChildren(block, context)
  if (ownMarkdown === null) return null

  const prefix = blockPrefix(block, depth, context)
  const ownWithPrefix = prefix ? prependLinePrefix(ownMarkdown, prefix) : ownMarkdown
  const childMarkdown = serializeChildren(block, depth, context)
  return childMarkdown ? `${ownWithPrefix}\n${childMarkdown}` : ownWithPrefix
}

function serializeBlock(block: BlockLike, depth: number, context: SerializeContext): string | null {
  const cacheKey = blockCacheKey(block, depth, context)
  const cached = cachedBlockMarkdown(block, cacheKey, context)
  if (cached !== null) {
    advanceCachedBlockContext(block, depth, context)
    return cached
  }
  const markdown = renderUncachedBlock(block, depth, context)
  if (markdown === null) return null
  storeCachedBlockMarkdown(block, cacheKey, markdown, context)
  return markdown
}

function serializeBlockList(blocks: BlockLike[], depth: number, context: SerializeContext): string {
  const chunks: string[] = []
  for (const value of blocks) {
    const block = blockObject(value)
    if (!block) {
      context.fallbackReason = 'unsupported:non-object-block'
      return ''
    }

    const markdown = serializeBlock(block, depth, context)
    if (markdown === null) return ''
    if (markdown) chunks.push(markdown)
  }
  return chunks.join('\n\n')
}

export function blocksToMarkdownDirect(
  blocks: unknown[],
  cache?: WeakMap<object, Map<string, string>>,
): BlockNoteDirectMarkdownResult {
  const startedAt = now()
  const context: SerializeContext = {
    cache,
    cacheHits: 0,
    cacheMisses: 0,
    fallbackReason: null,
    numberedStack: [],
  }
  const markdown = serializeBlockList(blocks as BlockLike[], 0, context)
  const durationMs = now() - startedAt
  return {
    markdown,
    supported: context.fallbackReason === null,
    metrics: {
      blockCount: blocks.length,
      cacheHits: context.cacheHits,
      cacheMisses: context.cacheMisses,
      durationMs,
      fallbackReason: context.fallbackReason,
    },
  }
}

export function installBlockNoteDirectMarkdown(editor: DirectMarkdownCapableSerializer): void {
  if (typeof editor.blocksToMarkdownDirect === 'function') return

  const cache = new WeakMap<object, Map<string, string>>()
  editor.__tolariaDirectMarkdownCache = cache
  editor.blocksToMarkdownDirect = (blocks: unknown[]) => {
    const result = blocksToMarkdownDirect(blocks, cache)
    editor.__tolariaLastDirectMarkdownMetrics = result.metrics
    return result
  }
}

export function serializeBlockNoteMarkdown(
  editor: DirectMarkdownCapableSerializer,
  blocks: unknown[],
): string {
  const direct = editor[DIRECT_MARKDOWN_METHOD]?.(blocks)
  if (direct?.supported) return direct.markdown
  return editor.blocksToMarkdownLossy(blocks)
}
