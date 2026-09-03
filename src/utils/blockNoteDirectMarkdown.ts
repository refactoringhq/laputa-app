import { restoreWikilinksInBlocks } from './wikilinks'
import { escapeInlineMarkdownText, wrapInlineMarkdown } from './blockNoteMarkdownInline'

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
  content?: unknown
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
  contentIndent: number
  marker: string
  indent: string
}

type MarkdownBlockIndent = {
  markdown: string
  width: number
}

interface SerializeContext {
  cache?: WeakMap<object, Map<string, string>>
  cacheHits: number
  cacheMisses: number
  fallbackReason: string | null
  indentStack: number[]
  numberedStack: number[]
}

type SerializedBlockListItem =
  | { kind: 'blankParagraph' }
  | { kind: 'empty' }
  | { kind: 'markdown'; markdown: string }

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


function now(): number {
  return globalThis.performance.now()
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

function blockChildren(block: BlockLike): BlockLike[] {
  return Array.isArray(block.children) ? block.children : []
}

function isEmptyParagraphBlock(block: BlockLike): boolean {
  return block.type === 'paragraph'
    && contentArray(block.content).length === 0
    && blockChildren(block).length === 0
}

function tableContent(content: unknown): TableContentLike | null {
  return isRecord(content) && content.type === 'tableContent' && Array.isArray(content.rows)
    ? content as TableContentLike
    : null
}

function escapeText(text: string): string {
  return escapeInlineMarkdownText(text)
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

function styledTextMarkdown(item: InlineItem): string {
  const source = item.text ?? ''
  const styles = item.styles ?? {}
  if (styles.code === true) return codeSpan(source)
  return applyInlineStyle(
    applyInlineStyle(
      applyInlineStyle(escapeText(source), styles.bold, '**'),
      styles.italic,
      '*',
    ),
    styles.strike,
    '~~',
  )
}

function applyInlineStyle(text: string, enabled: string | boolean | undefined, marker: string): string {
  return enabled === true ? wrapInlineMarkdown(text, marker) : text
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
  const indent = ' '.repeat(context.indentStack.at(depth) ?? 0)
  if (block.type === 'numberedListItem') return numberedListPrefix(block, depth, context, indent)
  context.numberedStack.splice(depth, 1, 1)
  switch (block.type) {
    case 'bulletListItem':
      return { contentIndent: 2, indent, marker: '- ' }
    case 'checkListItem':
      return { contentIndent: 2, indent, marker: checklistMarker(block) }
    default:
      return null
  }
}

function numberedListPrefix(
  block: BlockLike,
  depth: number,
  context: SerializeContext,
  indent: string,
): MarkdownLinePrefix {
  const next = context.numberedStack.at(depth) ?? Number(block.props?.start ?? 1)
  context.numberedStack.splice(depth, 1, next + 1)
  const marker = `${next}. `
  return { contentIndent: marker.length, indent, marker }
}

function checklistMarker(block: BlockLike): string {
  return block.props?.checked === true ? '- [x] ' : '- [ ] '
}

function advanceCachedBlockContext(block: BlockLike, depth: number, context: SerializeContext): void {
  if (block.type === 'numberedListItem') {
    const next = context.numberedStack.at(depth) ?? Number(block.props?.start ?? 1)
    context.numberedStack.splice(depth, 1, next + 1)
  } else {
    context.numberedStack.splice(depth, 1, 1)
  }
  context.indentStack.length = depth + 1
  context.numberedStack.length = depth + 1
}

function prependLinePrefix(markdown: string, prefix: MarkdownLinePrefix): string {
  const lines = markdown.split('\n')
  return lines.map((line, index) => (
    index === 0
      ? `${prefix.indent}${prefix.marker}${line}`
      : `${prefix.indent}${' '.repeat(prefix.contentIndent)}${line}`
  )).join('\n')
}

function prependBlockIndent({ markdown, width }: MarkdownBlockIndent): string {
  if (width === 0) return markdown
  const indent = ' '.repeat(width)
  return markdown.split('\n').map(line => `${indent}${line}`).join('\n')
}

function isListItemBlock(block: BlockLike | undefined): boolean {
  return block?.type === 'bulletListItem'
    || block?.type === 'checkListItem'
    || block?.type === 'numberedListItem'
}

function codeBlockMarkdown(block: BlockLike): string {
  const language = typeof block.props?.language === 'string' ? block.props.language : ''
  const code = literalTextContent(contentArray(block.content)).replace(/\n$/u, '')
  const fence = code.includes('```') ? '~~~' : '```'
  return `${fence}${language === 'text' ? '' : language}\n${code}\n${fence}`
}

function mediaLabel(name: string, url: string): string {
  if (name) return name
  return url.split('/').pop() ?? url
}

function mediaUrl(block: BlockLike): string {
  return typeof block.props?.url === 'string' ? block.props.url : ''
}

function mediaMarkdown(block: BlockLike): string {
  const url = mediaUrl(block)
  const name = typeof block.props?.name === 'string' ? block.props.name : ''
  if (!url) return name
  const label = block.type === 'image' ? name : mediaLabel(name, url)
  return block.type === 'image'
    ? `![${escapeText(label)}](${escapeLinkTarget(url)})`
    : `[${escapeText(label)}](${escapeLinkTarget(url)})`
}

function quoteMarkdown(block: BlockLike): string {
  const text = serializeInlineContent(contentArray(block.content))
  return text.split('\n').map(line => `> ${line}`).join('\n')
}

function escapeTableCellMarkdown(markdown: string): string {
  return markdown.replace(ESCAPE_TABLE_CELL_RE, character => character === '|' ? '\\|' : ' ')
}

function tableWikilinkMarkdown(item: InlineItem): string {
  const target = item.props?.target
  if (!target) return ''

  const aliasSeparator = target.indexOf('|')
  if (aliasSeparator < 0) return `[[${target}]]`

  let targetEnd = aliasSeparator
  while (target.charAt(targetEnd - 1) === '\\') targetEnd -= 1
  return `[[${target.slice(0, targetEnd)}${target.slice(aliasSeparator)}]]`
}

function tableInlineItemMarkdown(item: InlineItem): string {
  return item.type === 'wikilink'
    ? tableWikilinkMarkdown(item)
    : escapeTableCellMarkdown(serializeInlineItem(item))
}

function tableCellMarkdown(cell: TableCellValue): string {
  if (typeof cell === 'string') return escapeTableCellMarkdown(cell)
  return contentArray(cell.content).map(tableInlineItemMarkdown).join('')
}

function tableMarkdown(block: BlockLike): string | null {
  const content = tableContent(block.content)
  const rows = content?.rows ?? []
  if (rows.length === 0) return ''

  const cellRows = rows.map(row => row.cells?.map(tableCellMarkdown) ?? [])
  const width = Math.max(...cellRows.map(row => row.length), 0)
  if (width === 0) return ''

  const normalizedRows = cellRows.map(row => Array.from({ length: width }, (_, index) => row.at(index) ?? ''))
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

function specialBlockMarkdown(block: BlockLike, context: SerializeContext): string | null {
  switch (block.type) {
    case 'codeBlock': return codeBlockMarkdown(block)
    case 'divider': return '---'
    case 'heading': return headingMarkdown(block)
    case 'quote': return quoteMarkdown(block)
    case 'table': return tableMarkdown(block)
    default: return unsupportedBlockMarkdown(block, context)
  }
}

function blockMarkdownWithoutChildren(block: BlockLike, context: SerializeContext): string | null {
  if (typeof block.type !== 'string') return unsupportedBlockMarkdown(block, context)
  if (TEXT_CONTENT_BLOCK_TYPES.has(block.type)) return inlineBlockMarkdown(block)
  if (MEDIA_BLOCK_TYPES.has(block.type)) return mediaMarkdown(block)
  return specialBlockMarkdown(block, context)
}

function serializeChildren(
  block: BlockLike,
  depth: number,
  context: SerializeContext,
  prefix: MarkdownLinePrefix | null,
): string {
  const children = blockChildren(block)
  if (children.length === 0) return ''
  const childDepth = depth + 1
  const parentIndent = context.indentStack.at(depth) ?? 0
  context.indentStack.splice(childDepth, 1, parentIndent + (prefix?.contentIndent ?? 2))
  context.numberedStack.splice(childDepth, 1, 1)
  const markdown = serializeBlockList(children, childDepth, context)
  context.indentStack.length = childDepth
  context.numberedStack.length = childDepth
  return markdown
}

function blockCacheKey(block: BlockLike, depth: number, context: SerializeContext): string {
  return [
    depth,
    block.type ?? '',
    context.indentStack.at(depth) ?? '',
    context.numberedStack.at(depth) ?? '',
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
  const ownWithPrefix = prefix
    ? prependLinePrefix(ownMarkdown, prefix)
    : prependBlockIndent({ markdown: ownMarkdown, width: context.indentStack.at(depth) ?? 0 })
  const childMarkdown = serializeChildren(block, depth, context, prefix)
  if (!childMarkdown) return ownWithPrefix
  const separator = isListItemBlock(blockChildren(block).at(0)) ? '\n' : '\n\n'
  return `${ownWithPrefix}${separator}${childMarkdown}`
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

function serializeBlockListItem(
  block: BlockLike,
  depth: number,
  context: SerializeContext,
): SerializedBlockListItem | null {
  const markdown = serializeBlock(block, depth, context)
  if (markdown === null) return null
  if (markdown) return { kind: 'markdown', markdown }
  return depth === 0 && isEmptyParagraphBlock(block)
    ? { kind: 'blankParagraph' }
    : { kind: 'empty' }
}

function appendMarkdownChunk(
  chunks: string[],
  markdown: string,
  pendingBlankParagraphs: number,
): void {
  const separator = chunks.length === 0
    ? ''
    : `\n\n${'\n'.repeat(pendingBlankParagraphs)}`
  chunks.push(`${separator}${markdown}`)
}

function serializeBlockList(blocks: BlockLike[], depth: number, context: SerializeContext): string {
  const chunks: string[] = []
  let pendingBlankParagraphs = 0

  for (const value of blocks) {
    const block = blockObject(value)
    if (!block) {
      context.fallbackReason = 'unsupported:non-object-block'
      return ''
    }

    const item = serializeBlockListItem(block, depth, context)
    if (item === null) return ''
    if (item.kind === 'blankParagraph') {
      pendingBlankParagraphs++
      continue
    }
    if (item.kind === 'empty') {
      continue
    }

    appendMarkdownChunk(chunks, item.markdown, pendingBlankParagraphs)
    pendingBlankParagraphs = 0
  }

  return chunks.join('')
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
    indentStack: [0],
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
  const direct = editor.blocksToMarkdownDirect?.(blocks)
  if (direct?.supported) return direct.markdown
  return editor.blocksToMarkdownLossy(restoreWikilinksInBlocks(blocks))
}
