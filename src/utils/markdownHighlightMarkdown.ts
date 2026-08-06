import {
  serializeBlockNoteMarkdown,
  type DirectMarkdownCapableSerializer,
} from './blockNoteDirectMarkdown'

export const MARKDOWN_HIGHLIGHT_STYLE = 'highlight' as const
export const DEFAULT_MARKDOWN_HIGHLIGHT_COLOR = 'yellow' as const
export const MARKDOWN_HIGHLIGHT_COLORS = [
  DEFAULT_MARKDOWN_HIGHLIGHT_COLOR,
  'green',
  'red',
  'blue',
  'purple',
] as const

export type MarkdownHighlightColor = typeof MARKDOWN_HIGHLIGHT_COLORS[number]

const CUSTOM_MARKDOWN_HIGHLIGHT_PREFIXES = [
  { color: 'green', prefix: '🟢' },
  { color: 'red', prefix: '🔴' },
  { color: 'blue', prefix: '🔵' },
  { color: 'purple', prefix: '🟣' },
] as const satisfies ReadonlyArray<{
  color: Exclude<MarkdownHighlightColor, 'yellow'>
  prefix: string
}>

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

type BlockContent = unknown
type TableCellValue = TableCellLike | string
type InlineContentTransform = (content: InlineItem[]) => InlineItem[]
type InlineSegment = { kind: 'delimiter' } | { kind: 'item'; item: InlineItem }
type HighlightInjectionState = {
  color: MarkdownHighlightColor | null
  readsColorPrefix: boolean
}

function isTextItem(item: InlineItem): item is InlineItem & { text: string } {
  return item.type === 'text' && typeof item.text === 'string'
}

function isCodeTextItem(item: InlineItem): boolean {
  return item.styles?.code === true
}

function textItemWithText(item: InlineItem, text: string): InlineItem {
  return { ...item, text }
}

export function markdownHighlightPrefix(color: MarkdownHighlightColor): string {
  return CUSTOM_MARKDOWN_HIGHLIGHT_PREFIXES.find(option => option.color === color)?.prefix ?? ''
}

export function readMarkdownHighlightPrefix(text: string): {
  color: MarkdownHighlightColor
  text: string
} {
  const option = CUSTOM_MARKDOWN_HIGHLIGHT_PREFIXES.find(candidate => (
    text.startsWith(candidate.prefix)
  ))
  if (!option) return { color: DEFAULT_MARKDOWN_HIGHLIGHT_COLOR, text }

  return {
    color: option.color,
    text: text.slice(option.prefix.length),
  }
}

export function markdownHighlightColorFromStyles(styles: {
  backgroundColor?: unknown
  highlight?: unknown
} | undefined): MarkdownHighlightColor | null {
  if (styles?.highlight !== true) return null

  const customColor = CUSTOM_MARKDOWN_HIGHLIGHT_PREFIXES.find(option => (
    option.color === styles.backgroundColor
  ))
  return customColor?.color ?? DEFAULT_MARKDOWN_HIGHLIGHT_COLOR
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

function addHighlightStyle(item: InlineItem, color: MarkdownHighlightColor): InlineItem {
  if (!isTextItem(item)) return item
  const styles = { ...(item.styles ?? {}) }
  delete styles.backgroundColor

  return {
    ...item,
    styles: {
      ...styles,
      highlight: true,
      ...(color === DEFAULT_MARKDOWN_HIGHLIGHT_COLOR ? {} : { backgroundColor: color }),
    },
  }
}

function toggleInjectedHighlight(state: HighlightInjectionState): InlineItem[] {
  state.color = state.color === null ? DEFAULT_MARKDOWN_HIGHLIGHT_COLOR : null
  state.readsColorPrefix = state.color !== null
  return []
}

function consumeHighlightColorPrefix(
  item: InlineItem,
  state: HighlightInjectionState,
): InlineItem {
  if (state.color === null || !state.readsColorPrefix) return item

  state.readsColorPrefix = false
  if (!isTextItem(item)) return item

  const prefixed = readMarkdownHighlightPrefix(item.text)
  state.color = prefixed.color
  return textItemWithText(item, prefixed.text)
}

function isEmptyTextItem(item: InlineItem): boolean {
  return isTextItem(item) && item.text.length === 0
}

function injectHighlightSegment(
  segment: InlineSegment,
  state: HighlightInjectionState,
): InlineItem[] {
  if (segment.kind === 'delimiter') return toggleInjectedHighlight(state)

  const item = consumeHighlightColorPrefix(segment.item, state)
  state.readsColorPrefix = false
  if (isEmptyTextItem(item)) return []

  return [state.color === null ? item : addHighlightStyle(item, state.color)]
}

function injectMarkdownHighlights(content: InlineItem[]): InlineItem[] {
  const segments = content.flatMap(splitTextItemAtHighlightDelimiters)
  const delimiters = delimiterCount(segments)
  if (delimiters === 0 || delimiters % 2 !== 0) return content

  const state: HighlightInjectionState = { color: null, readsColorPrefix: false }
  return segments.flatMap(segment => injectHighlightSegment(segment, state))
}

function withoutHighlightStyle(styles: TextStyles | undefined): TextStyles {
  const rest = { ...(styles ?? {}) }
  const color = markdownHighlightColorFromStyles(rest)
  delete rest.highlight
  if (color !== DEFAULT_MARKDOWN_HIGHLIGHT_COLOR && rest.backgroundColor === color) {
    delete rest.backgroundColor
  }
  return rest
}

function isHighlightedTextItem(item: InlineItem): boolean {
  return isTextItem(item) && item.styles?.highlight === true
}

function highlightMarker(prefix = ''): InlineItem {
  return { type: 'text', text: `==${prefix}`, styles: {} }
}

function restoreHighlightedTextItem(item: InlineItem): InlineItem {
  return {
    ...item,
    styles: withoutHighlightStyle(item.styles),
  }
}

function restoreMarkdownHighlights(content: InlineItem[]): InlineItem[] {
  const restored: InlineItem[] = []
  let activeColor: MarkdownHighlightColor | null = null
  let changed = false

  for (const item of content) {
    if (isHighlightedTextItem(item)) {
      const color = markdownHighlightColorFromStyles(item.styles) ?? DEFAULT_MARKDOWN_HIGHLIGHT_COLOR
      if (activeColor !== color) {
        if (activeColor !== null) restored.push(highlightMarker())
        restored.push(highlightMarker(markdownHighlightPrefix(color)))
      }
      restored.push(restoreHighlightedTextItem(item))
      activeColor = color
      changed = true
      continue
    }

    if (activeColor !== null) restored.push(highlightMarker())
    restored.push(item)
    activeColor = null
  }

  if (activeColor !== null) restored.push(highlightMarker())
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
  const rows = content.rows?.map((row) => transformTableRow(row, transform))
  if (!rows || !content.rows || rows.every((row, index) => row === content.rows?.at(index))) return content
  return {
    ...content,
    rows,
  }
}

function transformTableRow(
  row: TableRowLike,
  transform: InlineContentTransform,
): TableRowLike {
  const cells = row.cells?.map((cell) => transformTableCell(cell, transform))
  if (!cells || !row.cells || cells.every((cell, index) => cell === row.cells?.at(index))) return row
  return { ...row, cells }
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
  const nextChildren = children.map(transform)
  return nextChildren.some((child, index) => child !== children.at(index)) ? nextChildren : children
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
