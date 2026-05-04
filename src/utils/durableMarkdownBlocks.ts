export interface InlineItem {
  type: string
  text?: string
  props?: Record<string, string>
  content?: unknown
  [key: string]: unknown
}

export interface BlockLike {
  type?: string
  content?: InlineItem[]
  props?: Record<string, string>
  children?: BlockLike[]
  [key: string]: unknown
}

export interface MarkdownSerializer {
  blocksToMarkdownLossy: (blocks: unknown[]) => string
}

export interface DurableFencePayloadInput {
  lines: string[]
  start: number
  end: number
  metadata: unknown
}

export interface DurableBlockCodec {
  tokenPrefix: string
  tokenSuffix: string
  readFenceMetadata: (info: string) => unknown | null
  buildPayload: (input: DurableFencePayloadInput) => unknown
  decodePayload: (payload: unknown) => unknown | null
  buildBlock: (block: BlockLike, payload: unknown) => BlockLike
  readCodeBlock?: (block: BlockLike) => unknown | null
  isBlock: (block: BlockLike) => boolean
  serializeBlock: (block: BlockLike) => string
}

type FenceCharacter = '`' | '~'

interface MarkdownLine {
  line: string
}

interface FenceOpening {
  character: FenceCharacter
  length: number
  metadata: unknown
}

interface MatchedFenceOpening {
  codec: DurableBlockCodec
  opening: FenceOpening
}

interface FenceSearch {
  lines: string[]
  start: number
  opening: FenceOpening
}

interface SerializeDurableBlocksOptions {
  blocks: unknown[]
  codecs: readonly DurableBlockCodec[]
  serializeOrdinaryBlocks: (blocks: unknown[]) => string
}

export function lineEnding({ line }: MarkdownLine): string {
  if (line.endsWith('\r\n')) return '\r\n'
  return line.endsWith('\n') ? '\n' : ''
}

export function lineText({ line }: MarkdownLine): string {
  const ending = lineEnding({ line })
  return ending ? line.slice(0, -ending.length) : line
}

function splitMarkdownLines(markdown: string): string[] {
  const lines = markdown.match(/[^\n]*(?:\n|$)/g) ?? []
  return lines.filter((line, index) => line !== '' || index < lines.length - 1)
}

function encodePayload(payload: unknown): string {
  return encodeURIComponent(JSON.stringify(payload))
}

function decodePayload(codec: DurableBlockCodec, encoded: string): unknown | null {
  try {
    return codec.decodePayload(JSON.parse(decodeURIComponent(encoded)))
  } catch {
    return null
  }
}

function durableToken(codec: DurableBlockCodec, payload: unknown): string {
  return `${codec.tokenPrefix}${encodePayload(payload)}${codec.tokenSuffix}`
}

function readDurableToken(codec: DurableBlockCodec, text: string): unknown | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith(codec.tokenPrefix) || !trimmed.endsWith(codec.tokenSuffix)) return null
  return decodePayload(codec, trimmed.slice(codec.tokenPrefix.length, -codec.tokenSuffix.length))
}

function readFenceOpening(line: string, codec: DurableBlockCodec): FenceOpening | null {
  const match = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/.exec(line)
  if (!match) return null

  const metadata = codec.readFenceMetadata(match[3])
  if (metadata === null) return null

  const fence = match[2]
  return {
    character: fence[0] as FenceCharacter,
    length: fence.length,
    metadata,
  }
}

function readMatchedFenceOpening(line: string, codecs: readonly DurableBlockCodec[]): MatchedFenceOpening | null {
  for (const codec of codecs) {
    const opening = readFenceOpening(line, codec)
    if (opening) return { codec, opening }
  }
  return null
}

function isClosingFence({ line, opening }: MarkdownLine & { opening: FenceOpening }): boolean {
  const match = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.exec(line)
  if (!match) return false

  const fence = match[2]
  return fence[0] === opening.character && fence.length >= opening.length
}

function findClosingFence({ lines, start, opening }: FenceSearch): number {
  for (let index = start + 1; index < lines.length; index++) {
    if (isClosingFence({ line: lineText({ line: lines[index] }), opening })) return index
  }

  return -1
}

export function preProcessDurableMarkdownBlocks({
  markdown,
  codecs,
}: {
  markdown: string
  codecs: readonly DurableBlockCodec[]
}): string {
  const lines = splitMarkdownLines(markdown)
  const result: string[] = []

  for (let index = 0; index < lines.length; index++) {
    const matched = readMatchedFenceOpening(lineText({ line: lines[index] }), codecs)
    if (!matched) {
      result.push(lines[index])
      continue
    }

    const closingIndex = findClosingFence({ lines, start: index, opening: matched.opening })
    if (closingIndex === -1) {
      result.push(lines[index])
      continue
    }

    const payload = matched.codec.buildPayload({
      lines,
      start: index,
      end: closingIndex,
      metadata: matched.opening.metadata,
    })
    result.push(`${durableToken(matched.codec, payload)}${lineEnding({ line: lines[closingIndex] })}`)
    index = closingIndex
  }

  return result.join('')
}

function readSingleTextContent(content: InlineItem[] | undefined): string | null {
  const onlyItem = content?.length === 1 ? content[0] : null
  if (onlyItem?.type !== 'text' || typeof onlyItem.text !== 'string') return null
  return onlyItem.text
}

function readTokenPayload(block: BlockLike, codecs: readonly DurableBlockCodec[]): { codec: DurableBlockCodec; payload: unknown } | null {
  const text = readSingleTextContent(block.content)
  if (text === null) return null

  for (const codec of codecs) {
    const payload = readDurableToken(codec, text)
    if (payload !== null) return { codec, payload }
  }
  return null
}

function readCodeBlockPayload(block: BlockLike, codecs: readonly DurableBlockCodec[]): { codec: DurableBlockCodec; payload: unknown } | null {
  for (const codec of codecs) {
    const payload = codec.readCodeBlock?.(block) ?? null
    if (payload !== null) return { codec, payload }
  }
  return null
}

function injectDurableMarkdownBlock(block: BlockLike, codecs: readonly DurableBlockCodec[]): BlockLike {
  const tokenPayload = readTokenPayload(block, codecs)
  if (tokenPayload) return tokenPayload.codec.buildBlock(block, tokenPayload.payload)

  const codeBlockPayload = readCodeBlockPayload(block, codecs)
  if (codeBlockPayload) return codeBlockPayload.codec.buildBlock(block, codeBlockPayload.payload)

  const children = Array.isArray(block.children)
    ? block.children.map(child => injectDurableMarkdownBlock(child, codecs))
    : block.children
  return { ...block, children }
}

export function injectDurableMarkdownBlocks({
  blocks,
  codecs,
}: {
  blocks: unknown[]
  codecs: readonly DurableBlockCodec[]
}): unknown[] {
  return (blocks as BlockLike[]).map(block => injectDurableMarkdownBlock(block, codecs))
}

function findBlockCodec(block: BlockLike, codecs: readonly DurableBlockCodec[]): DurableBlockCodec | null {
  return codecs.find(codec => codec.isBlock(block)) ?? null
}

function hasDurableMarkdownBlock(block: BlockLike, codecs: readonly DurableBlockCodec[]): boolean {
  if (findBlockCodec(block, codecs)) return true
  return Array.isArray(block.children)
    ? block.children.some(child => hasDurableMarkdownBlock(child, codecs))
    : false
}

export function hasDurableMarkdownBlocks({
  blocks,
  codecs,
}: {
  blocks: unknown[]
  codecs: readonly DurableBlockCodec[]
}): boolean {
  return (blocks as BlockLike[]).some(block => hasDurableMarkdownBlock(block, codecs))
}

export function serializeDurableMarkdownBlocks({
  blocks,
  codecs,
  serializeOrdinaryBlocks,
}: SerializeDurableBlocksOptions): string {
  const chunks: string[] = []
  let pending: unknown[] = []

  const flushPending = () => {
    if (pending.length === 0) return

    const markdown = serializeOrdinaryBlocks(pending).trimEnd()
    if (markdown) chunks.push(markdown)
    pending = []
  }

  for (const block of blocks as BlockLike[]) {
    const codec = findBlockCodec(block, codecs)
    if (!codec) {
      pending.push(block)
      continue
    }

    flushPending()
    chunks.push(codec.serializeBlock(block))
  }

  flushPending()
  return chunks.join('\n\n')
}

export function readCodeBlockLanguage({ block }: { block: BlockLike }): string | null {
  const language = block.props?.language
  if (typeof language !== 'string') return null

  return language.trim().split(/\s+/u)[0]?.toLowerCase() ?? null
}

export function readInlineText(content: InlineItem[] | undefined): string | null {
  if (!Array.isArray(content)) return null
  return content.map((item) => (
    item.type === 'text' && typeof item.text === 'string' ? item.text : ''
  )).join('')
}
