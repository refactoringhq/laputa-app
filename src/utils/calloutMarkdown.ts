import type { BlockLike, InlineItem, MarkdownSerializer } from './durableMarkdownBlocks'

export const CALLOUT_BLOCK_TYPE = 'calloutBlock'

export type CalloutFold = '' | '+' | '-'
export type CalloutVisualFamily = 'error' | 'example' | 'note' | 'quote' | 'success' | 'warning'

export interface CalloutMarker {
  fold: CalloutFold
  title: string
  type: string
}

interface CalloutBlockProps {
  calloutType: string
  fold: CalloutFold
  title: string
}

const CALLOUT_MARKER = /^\[!([a-z][a-z0-9_-]*)\]([+-]?)[ \t]*(.*)$/iu
const SUCCESS_TYPES = new Set(['check', 'done', 'hint', 'success', 'tip'])
const WARNING_TYPES = new Set(['attention', 'caution', 'faq', 'help', 'important', 'question', 'warning'])
const ERROR_TYPES = new Set(['bug', 'danger', 'error', 'fail', 'failure', 'missing'])
const QUOTE_TYPES = new Set(['cite', 'quote'])

function normalizedCalloutType(type: string): string {
  return type.trim().toLowerCase()
}

export function parseCalloutMarker(line: string): CalloutMarker | null {
  const match = CALLOUT_MARKER.exec(line.trim())
  const type = match?.at(1)
  if (!type) return null

  const foldToken = match?.at(2)
  return {
    fold: foldToken === '+' || foldToken === '-' ? foldToken : '',
    title: (match?.at(3) ?? '').trim(),
    type: normalizedCalloutType(type),
  }
}

export function formatCalloutMarker(marker: CalloutMarker): string {
  const head = `[!${normalizedCalloutType(marker.type)}]${marker.fold}`
  return marker.title ? `${head} ${marker.title}` : head
}

export function calloutVisualFamily(type: string): CalloutVisualFamily {
  const normalized = normalizedCalloutType(type)
  if (SUCCESS_TYPES.has(normalized)) return 'success'
  if (WARNING_TYPES.has(normalized)) return 'warning'
  if (ERROR_TYPES.has(normalized)) return 'error'
  if (QUOTE_TYPES.has(normalized)) return 'quote'
  if (normalized === 'example') return 'example'
  return 'note'
}

export function calloutStartsExpanded(fold: CalloutFold): boolean {
  return fold !== '-'
}

export function calloutHeading(type: string, title: string): string {
  if (title) return title
  const normalized = normalizedCalloutType(type)
  return normalized.split(/[-_]+/u).filter(Boolean).map((part) => (
    `${part.charAt(0).toUpperCase()}${part.slice(1)}`
  )).join(' ') || 'Note'
}

function inlineItemText(item: InlineItem): string {
  if (item.type === 'text' && typeof item.text === 'string') return item.text
  if (!Array.isArray(item.content)) return ''
  return (item.content as InlineItem[]).map(inlineItemText).join('')
}

function inlineContentText(content: InlineItem[] | undefined): string | null {
  if (!Array.isArray(content)) return null
  return content.map(inlineItemText).join('')
}

interface DroppedInlineItem {
  item: InlineItem | null
  remaining: number
}

function dropTextPrefix(item: InlineItem, count: number): DroppedInlineItem {
  const text = item.text ?? ''
  if (count >= text.length) return { item: null, remaining: count - text.length }
  return { item: { ...item, text: text.slice(count) }, remaining: 0 }
}

function dropNestedPrefix(item: InlineItem, count: number): DroppedInlineItem {
  const nested = item.content as InlineItem[]
  const result = dropInlinePrefix(nested, count)
  if (result.content.length === 0) return { item: null, remaining: result.remaining }
  return { item: { ...item, content: result.content }, remaining: result.remaining }
}

function dropInlineItemPrefix(item: InlineItem, count: number): DroppedInlineItem {
  if (count === 0) return { item, remaining: 0 }
  if (item.type === 'text' && typeof item.text === 'string') return dropTextPrefix(item, count)
  if (Array.isArray(item.content)) return dropNestedPrefix(item, count)
  return { item: null, remaining: count }
}

function dropInlinePrefix(
  content: InlineItem[],
  count: number,
): { content: InlineItem[]; remaining: number } {
  const result: InlineItem[] = []
  let remaining = count

  for (const item of content) {
    const dropped = dropInlineItemPrefix(item, remaining)
    remaining = dropped.remaining
    if (dropped.item) result.push(dropped.item)
  }
  return { content: result, remaining }
}

function readQuoteCallout(block: BlockLike): { bodyOffset: number; marker: CalloutMarker } | null {
  if (block.type !== 'quote') return null
  const text = inlineContentText(block.content)
  if (text === null) return null

  const newlineIndex = text.indexOf('\n')
  const firstLine = newlineIndex === -1 ? text : text.slice(0, newlineIndex)
  const marker = parseCalloutMarker(firstLine)
  if (!marker) return null
  return {
    bodyOffset: newlineIndex === -1 ? text.length : newlineIndex + 1,
    marker,
  }
}

export function buildCalloutBlock(block: BlockLike): BlockLike {
  const parsed = readQuoteCallout(block)
  if (!parsed) return block

  const props: CalloutBlockProps = {
    calloutType: parsed.marker.type,
    fold: parsed.marker.fold,
    title: parsed.marker.title,
  }
  const body = dropInlinePrefix(block.content ?? [], parsed.bodyOffset).content
  return {
    ...block,
    content: body,
    props: { ...(block.props ?? {}), ...props },
    type: CALLOUT_BLOCK_TYPE,
  }
}

export function isCalloutBlock(block: BlockLike): boolean {
  return block.type === CALLOUT_BLOCK_TYPE
}

function readCalloutProps(block: BlockLike): CalloutBlockProps {
  const calloutType = block.props?.calloutType
  const fold = block.props?.fold
  const title = block.props?.title
  return {
    calloutType: typeof calloutType === 'string' ? normalizedCalloutType(calloutType) : 'note',
    fold: fold === '+' || fold === '-' ? fold : '',
    title: typeof title === 'string' ? title : '',
  }
}

function quoteLine(line: string): string {
  return line ? `> ${line}` : '>'
}

function serializeCalloutBody(editor: MarkdownSerializer, block: BlockLike): string {
  if (!Array.isArray(block.content) || block.content.length === 0) return ''
  return editor.blocksToMarkdownLossy([{
    content: block.content,
    props: {},
    type: 'paragraph',
  }]).trim()
}

export function serializeCalloutBlock(editor: MarkdownSerializer, block: BlockLike): string {
  const props = readCalloutProps(block)
  const marker = formatCalloutMarker({
    fold: props.fold,
    title: props.title,
    type: props.calloutType,
  })
  const body = serializeCalloutBody(editor, block)
  const lines = body ? [marker, ...body.split('\n')] : [marker]
  return lines.map(quoteLine).join('\n')
}

function injectCalloutBlock(block: BlockLike): BlockLike {
  const converted = buildCalloutBlock(block)
  if (!Array.isArray(converted.children)) return converted
  return { ...converted, children: converted.children.map(injectCalloutBlock) }
}

export function injectCalloutBlocks(blocks: unknown[]): unknown[] {
  return (blocks as BlockLike[]).map(injectCalloutBlock)
}

function hasCalloutBlock(block: BlockLike): boolean {
  if (isCalloutBlock(block)) return true
  return Array.isArray(block.children) && block.children.some(hasCalloutBlock)
}

export function hasCalloutBlocks(blocks: unknown[]): boolean {
  return (blocks as BlockLike[]).some(hasCalloutBlock)
}
