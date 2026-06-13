export const MARKDOWN_HIGHLIGHT_STYLE = 'highlight' as const

interface TextStyles {
  [style: string]: string | boolean | undefined
}

interface InlineItem {
  type: string
  text?: string
  styles?: TextStyles
  content?: unknown
  props?: Record<string, string>
  [key: string]: unknown
}

interface BlockLike {
  type?: string
  content?: BlockContent
  props?: Record<string, string>
  children?: BlockLike[]
  [key: string]: unknown
}

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

interface MarkdownSerializer {
  blocksToMarkdownLossy: (blocks: unknown[]) => string
}

type BlockContent = InlineItem[] | TableContentLike | unknown
type TableCellValue = TableCellLike | string
type InlineContentTransform = (content: InlineItem[]) => InlineItem[]
type InlineSegment = { kind: 'delimiter' } | { kind: 'item'; item: InlineItem }

function isTextItem(item: InlineItem): item is InlineItem & { text: string } {
  return item.type === 'text' && typeof item.text === 'string'
}

function isCodeTextItem(item: InlineItem): boolean {
  return item.styles?.code === true
}

function textItemWithText(item: InlineItem, text: string): InlineItem {
  return { ...item, text }
}

function pushTextSegment(segments: InlineSegment[], item: InlineItem, text: string): void {
  if (text) segments.push({ kind: 'item', item: textItemWithText(item, text) })
}

function splitTextItemAtHighlightDelimiters(item: InlineItem): InlineSegment[] {
  if (!isTextItem(item) || isCodeTextItem(item)) return [{ kind: 'item', item }]

  const segments: InlineSegment[] = []
  let cursor = 0
  let delimiterIndex = item.text.indexOf('==')

  while (delimiterIndex !== -1) {
    pushTextSegment(segments, item, item.text.slice(cursor, delimiterIndex))
    segments.push({ kind: 'delimiter' })
    cursor = delimiterIndex + 2
    delimiterIndex = item.text.indexOf('==', cursor)
  }

  pushTextSegment(segments, item, item.text.slice(cursor))
  return segments
}

function delimiterCount(segments: InlineSegment[]): number {
  return segments.filter(segment => segment.kind === 'delimiter').length
}

function addHighlightStyle(item: InlineItem): InlineItem {
  if (!isTextItem(item)) return item
  return {
    ...item,
    styles: {
      ...(item.styles ?? {}),
      [MARKDOWN_HIGHLIGHT_STYLE]: true,
    },
  }
}

function injectMarkdownHighlights(content: InlineItem[]): InlineItem[] {
  const segments = content.flatMap(splitTextItemAtHighlightDelimiters)
  const delimiters = delimiterCount(segments)
  if (delimiters === 0 || delimiters % 2 !== 0) return content

  let highlighted = false
  return segments.flatMap((segment) => {
    if (segment.kind === 'delimiter') {
      highlighted = !highlighted
      return []
    }
    return [highlighted ? addHighlightStyle(segment.item) : segment.item]
  })
}

function withoutHighlightStyle(styles: TextStyles | undefined): TextStyles {
  const rest = { ...(styles ?? {}) }
  delete rest[MARKDOWN_HIGHLIGHT_STYLE]
  return rest
}

function isHighlightedTextItem(item: InlineItem): boolean {
  return isTextItem(item) && item.styles?.[MARKDOWN_HIGHLIGHT_STYLE] === true
}

function highlightMarker(): InlineItem {
  return { type: 'text', text: '==', styles: {} }
}

function restoreHighlightedTextItem(item: InlineItem): InlineItem {
  return {
    ...item,
    styles: withoutHighlightStyle(item.styles),
  }
}

function restoreMarkdownHighlights(content: InlineItem[]): InlineItem[] {
  const restored: InlineItem[] = []
  let openHighlight = false

  for (const item of content) {
    if (isHighlightedTextItem(item)) {
      if (!openHighlight) restored.push(highlightMarker())
      restored.push(restoreHighlightedTextItem(item))
      openHighlight = true
      continue
    }

    if (openHighlight) restored.push(highlightMarker())
    restored.push(item)
    openHighlight = false
  }

  if (openHighlight) restored.push(highlightMarker())
  return restored
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
  return { ...cell, content: transform(cell.content) }
}

function transformTableContent(
  content: TableContentLike,
  transform: InlineContentTransform,
): TableContentLike {
  return {
    ...content,
    rows: content.rows?.map(row => ({
      ...row,
      cells: row.cells?.map(cell => transformTableCell(cell, transform)),
    })),
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

function shouldTransformBlockContent(block: BlockLike): boolean {
  return block.type !== 'codeBlock'
}

function transformBlock(block: BlockLike, transform: InlineContentTransform): BlockLike {
  const content = shouldTransformBlockContent(block)
    ? transformBlockContent(block.content, transform)
    : block.content
  const children = Array.isArray(block.children)
    ? block.children.map(child => transformBlock(child, transform))
    : block.children
  return { ...block, content, children }
}

export function injectMarkdownHighlightsInBlocks(blocks: unknown[]): unknown[] {
  return (blocks as BlockLike[]).map(block => transformBlock(block, injectMarkdownHighlights))
}

export function restoreMarkdownHighlightsInBlocks(blocks: unknown[]): unknown[] {
  return (blocks as BlockLike[]).map(block => transformBlock(block, restoreMarkdownHighlights))
}

export function serializeMarkdownHighlightAwareBlocks(
  editor: MarkdownSerializer,
  blocks: unknown[],
): string {
  return editor.blocksToMarkdownLossy(restoreMarkdownHighlightsInBlocks(blocks)).trimEnd()
}
