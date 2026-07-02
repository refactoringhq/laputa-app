import {
  serializeBlockNoteMarkdown,
  type DirectMarkdownCapableSerializer,
} from './blockNoteDirectMarkdown'

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

type MarkdownSerializer = DirectMarkdownCapableSerializer

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
  let changed = false

  for (const item of content) {
    if (isHighlightedTextItem(item)) {
      if (!openHighlight) restored.push(highlightMarker())
      restored.push(restoreHighlightedTextItem(item))
      openHighlight = true
      changed = true
      continue
    }

    if (openHighlight) restored.push(highlightMarker())
    restored.push(item)
    openHighlight = false
  }

  if (openHighlight) restored.push(highlightMarker())
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
  const rows = content.rows?.map(row => {
    let rowChanged = false
    const cells = row.cells?.map(cell => {
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

function shouldTransformBlockContent(block: BlockLike): boolean {
  return block.type !== 'codeBlock'
}

function transformBlock(block: BlockLike, transform: InlineContentTransform): BlockLike {
  const content = shouldTransformBlockContent(block)
    ? transformBlockContent(block.content, transform)
    : block.content
  const children = transformChildBlocks(block.children, child => transformBlock(child, transform))
  return content === block.content && children === block.children ? block : { ...block, content, children }
}

function transformChildBlocks(
  children: BlockLike[] | undefined,
  transform: (block: BlockLike) => BlockLike,
): BlockLike[] | undefined {
  if (!Array.isArray(children)) return children
  let changed = false
  const nextChildren = children.map(child => {
    const nextChild = transform(child)
    if (nextChild !== child) changed = true
    return nextChild
  })
  return changed ? nextChildren : children
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
  return serializeBlockNoteMarkdown(editor, restoreMarkdownHighlightsInBlocks(blocks)).trimEnd()
}
