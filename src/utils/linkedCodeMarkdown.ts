import { advanceMarkdownFence, type MarkdownFence } from './markdownFences'

const LINKED_CODE_START = '\u2039LINKED_CODE:'
const LINKED_CODE_END = '\u203A'
const LINKED_CODE_LABEL_RE = /(^|[^!\\])\[(`+)([^\r\n]*?)\2\](?=\()/gu
const LINKED_CODE_TOKEN_RE = /\u2039LINKED_CODE:([0-9a-f-]+)\u203A/giu

interface InlineItem {
  type: string
  text?: string
  styles?: Record<string, unknown>
  content?: InlineItem[]
  [key: string]: unknown
}

interface BlockLike {
  content?: BlockContent
  children?: BlockLike[]
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

type TableCellLike = string | { content?: InlineItem[]; [key: string]: unknown }
type BlockContent = InlineItem[] | TableContentLike | unknown
type ItemTransform<T> = (item: T) => T

function transformItems<T>(items: T[] | undefined, transform: ItemTransform<T>): T[] | undefined {
  if (!items) return items
  let changed = false
  const nextItems = items.map(item => {
    const nextItem = transform(item)
    if (nextItem !== item) changed = true
    return nextItem
  })
  return changed ? nextItems : items
}

function encodeCode(value: string): string {
  return Array.from(value, character => character.codePointAt(0)?.toString(16) ?? '').join('-')
}

function decodeCode(value: string): string {
  try {
    return value.split('-').map(part => String.fromCodePoint(Number.parseInt(part, 16))).join('')
  } catch {
    return value
  }
}

function linkedCodeToken(value: string): string {
  return `${LINKED_CODE_START}${encodeCode(value)}${LINKED_CODE_END}`
}

function replaceLinkedCodeLabels(line: string): string {
  return line.replace(LINKED_CODE_LABEL_RE, (_match, prefix: string, _delimiter, code: string) => (
    `${prefix}[${linkedCodeToken(code)}]`
  ))
}

function isLineEnding(part: string): boolean {
  return part === '\n' || part === '\r\n'
}

function processMarkdownPart(part: string, fence: MarkdownFence | null): [string, MarkdownFence | null] {
  if (isLineEnding(part)) return [part, fence]
  const nextFence = advanceMarkdownFence(part, fence)
  const shouldPreserve = nextFence !== fence || fence !== null
  return [shouldPreserve ? part : replaceLinkedCodeLabels(part), nextFence]
}

export function preProcessLinkedCodeMarkdown(markdown: string): string {
  let fence: MarkdownFence | null = null
  return markdown.split(/(\r?\n)/u).map(part => {
    const [processed, nextFence] = processMarkdownPart(part, fence)
    fence = nextFence
    return processed
  }).join('')
}

function linkedCodePart(item: InlineItem, part: string, index: number): InlineItem[] {
  if (!part) return []
  if (index % 2 === 0) return [{ ...item, text: part }]
  return [{ ...item, text: decodeCode(part), styles: { ...item.styles, code: true } }]
}

function expandLinkedCodeText(item: InlineItem): InlineItem[] {
  if (item.type !== 'text' || typeof item.text !== 'string') return [item]

  const parts = item.text.split(LINKED_CODE_TOKEN_RE)
  if (parts.length === 1) return [item]
  return parts.flatMap((part, index) => linkedCodePart(item, part, index))
}

function hasSameItems<T>(left: T[], right: T[]): boolean {
  if (left.length !== right.length) return false
  return right.every((item, index) => item === left.at(index))
}

function injectLinkedCodeInItem(item: InlineItem): InlineItem {
  if (item.type !== 'link' || !Array.isArray(item.content)) return item
  const content = item.content.flatMap(expandLinkedCodeText)
  return hasSameItems(item.content, content) ? item : { ...item, content }
}

function injectLinkedCodeInContent(content: InlineItem[]): InlineItem[] {
  return transformItems(content, injectLinkedCodeInItem) ?? content
}

function transformTableContent(content: TableContentLike): TableContentLike {
  const rows = transformItems(content.rows, transformTableRow)
  return rows === content.rows ? content : { ...content, rows }
}

function transformTableRow(row: TableRowLike): TableRowLike {
  const cells = transformItems(row.cells, transformTableCell)
  return cells === row.cells ? row : { ...row, cells }
}

function transformTableCell(cell: TableCellLike): TableCellLike {
  if (typeof cell === 'string' || !Array.isArray(cell.content)) return cell
  const content = injectLinkedCodeInContent(cell.content)
  return content === cell.content ? cell : { ...cell, content }
}

function transformBlockContent(content: BlockContent): BlockContent {
  if (Array.isArray(content)) return injectLinkedCodeInContent(content)
  if (isTableContent(content)) return transformTableContent(content)
  return content
}

function injectLinkedCodeInBlock(block: BlockLike): BlockLike {
  const content = transformBlockContent(block.content)
  const children = transformItems(block.children, injectLinkedCodeInBlock)
  return content === block.content && children === block.children ? block : { ...block, content, children }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTableContent(content: BlockContent): content is TableContentLike {
  return isRecord(content) && content.type === 'tableContent'
}

export function injectLinkedCodeInBlocks(blocks: unknown[]): unknown[] {
  return transformItems(blocks as BlockLike[], injectLinkedCodeInBlock) ?? blocks
}
