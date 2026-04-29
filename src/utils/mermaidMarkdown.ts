import { serializeMathAwareBlocks } from './mathMarkdown'

export const MERMAID_BLOCK_TYPE = 'mermaidBlock'

const TOKEN_PREFIX = '@@TOLARIA_MERMAID_BLOCK:'
const TOKEN_SUFFIX = '@@'

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

interface MermaidPayload {
  source: string
  diagram: string
}

interface MermaidFenceStart {
  character: '`' | '~'
  length: number
}

interface MarkdownLine {
  line: string
}

interface EncodedPayload {
  encoded: string
}

interface TokenText {
  text: string
}

interface FenceSearch {
  lines: string[]
  start: number
  opening: MermaidFenceStart
}

interface FenceRange {
  lines: string[]
  start: number
  end: number
}

interface DiagramSource {
  diagram: string
}

interface CodeBlockSource {
  block: BlockLike
}

function lineEnding({ line }: MarkdownLine): string {
  if (line.endsWith('\r\n')) return '\r\n'
  return line.endsWith('\n') ? '\n' : ''
}

function lineText({ line }: MarkdownLine): string {
  const ending = lineEnding({ line })
  return ending ? line.slice(0, -ending.length) : line
}

function splitMarkdownLines(markdown: string): string[] {
  const lines = markdown.match(/[^\n]*(?:\n|$)/g) ?? []
  return lines.filter((line, index) => line !== '' || index < lines.length - 1)
}

function encodePayload(payload: MermaidPayload): string {
  return encodeURIComponent(JSON.stringify(payload))
}

function decodePayload({ encoded }: EncodedPayload): MermaidPayload | null {
  try {
    const payload = JSON.parse(decodeURIComponent(encoded)) as Partial<MermaidPayload>
    if (typeof payload.source !== 'string') return null
    if (typeof payload.diagram !== 'string') return null
    return { source: payload.source, diagram: payload.diagram }
  } catch {
    return null
  }
}

function mermaidToken(payload: MermaidPayload): string {
  return `${TOKEN_PREFIX}${encodePayload(payload)}${TOKEN_SUFFIX}`
}

function readMermaidToken({ text }: TokenText): MermaidPayload | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith(TOKEN_PREFIX) || !trimmed.endsWith(TOKEN_SUFFIX)) return null
  return decodePayload({ encoded: trimmed.slice(TOKEN_PREFIX.length, -TOKEN_SUFFIX.length) })
}

function readMermaidFenceStart({ line }: MarkdownLine): MermaidFenceStart | null {
  const match = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/.exec(line)
  if (!match) return null

  const fence = match[2]
  const language = match[3].trim().split(/\s+/)[0]?.toLowerCase()
  if (language !== 'mermaid') return null

  return {
    character: fence[0] as '`' | '~',
    length: fence.length,
  }
}

function isClosingFence({ line, opening }: MarkdownLine & { opening: MermaidFenceStart }): boolean {
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

function buildPayload({ lines, start, end }: FenceRange): MermaidPayload {
  return {
    source: lines.slice(start, end + 1).join(''),
    diagram: lines.slice(start + 1, end).join(''),
  }
}

export function preProcessMermaidMarkdown({ markdown }: { markdown: string }): string {
  const lines = splitMarkdownLines(markdown)
  const result: string[] = []

  for (let index = 0; index < lines.length; index++) {
    const opening = readMermaidFenceStart({ line: lineText({ line: lines[index] }) })
    if (!opening) {
      result.push(lines[index])
      continue
    }

    const closingIndex = findClosingFence({ lines, start: index, opening })
    if (closingIndex === -1) {
      result.push(lines[index])
      continue
    }

    const payload = buildPayload({ lines, start: index, end: closingIndex })
    result.push(`${mermaidToken(payload)}${lineEnding({ line: lines[closingIndex] })}`)
    index = closingIndex
  }

  return result.join('')
}

function readMermaidPayload(content: InlineItem[] | undefined): MermaidPayload | null {
  const onlyItem = content?.length === 1 ? content[0] : null
  if (onlyItem?.type !== 'text' || typeof onlyItem.text !== 'string') return null
  return readMermaidToken({ text: onlyItem.text })
}

function buildMermaidBlock({ block, payload }: { block: BlockLike; payload: MermaidPayload }): BlockLike {
  return {
    ...block,
    type: MERMAID_BLOCK_TYPE,
    props: {
      ...(block.props ?? {}),
      source: payload.source,
      diagram: payload.diagram,
    },
    content: undefined,
    children: [],
  }
}

export function mermaidFenceSource({ diagram }: DiagramSource): string {
  const body = diagram.endsWith('\n') ? diagram : `${diagram}\n`
  return `\`\`\`mermaid\n${body}\`\`\``
}

function readCodeBlockLanguage({ block }: CodeBlockSource): string | null {
  const language = block.props?.language
  if (typeof language !== 'string') return null

  return language.trim().split(/\s+/)[0]?.toLowerCase() ?? null
}

function readInlineText(content: InlineItem[] | undefined): string | null {
  if (!Array.isArray(content)) return null
  return content.map((item) => (
    item.type === 'text' && typeof item.text === 'string' ? item.text : ''
  )).join('')
}

function looksLikeMermaidDiagram(diagram: string): boolean {
  const firstStatement = diagram
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length > 0 && !line.startsWith('%%'))

  return typeof firstStatement === 'string'
    && /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|requirementDiagram|gitGraph|C4Context|C4Container|C4Component|C4Dynamic|sankey-beta|xychart-beta)\b/.test(firstStatement)
}

function shouldInjectCodeBlockAsMermaid({
  diagram,
  language,
}: {
  diagram: string
  language: string | null
}): boolean {
  if (language === 'mermaid') return true
  if (language !== null && language !== 'text' && language !== 'plain' && language !== 'plaintext') return false

  return looksLikeMermaidDiagram(diagram)
}

function readMermaidCodeBlock({ block }: CodeBlockSource): MermaidPayload | null {
  if (block.type !== 'codeBlock') return null

  const diagram = readInlineText(block.content)
  if (diagram === null) return null
  if (!shouldInjectCodeBlockAsMermaid({ diagram, language: readCodeBlockLanguage({ block }) })) return null

  const normalizedDiagram = diagram.endsWith('\n') ? diagram : `${diagram}\n`
  return {
    diagram: normalizedDiagram,
    source: mermaidFenceSource({ diagram: normalizedDiagram }),
  }
}

function injectMermaidInBlock(block: BlockLike): BlockLike {
  const payload = readMermaidPayload(block.content)
  if (payload) return buildMermaidBlock({ block, payload })

  const codeBlockPayload = readMermaidCodeBlock({ block })
  if (codeBlockPayload) return buildMermaidBlock({ block, payload: codeBlockPayload })

  const children = Array.isArray(block.children) ? block.children.map(injectMermaidInBlock) : block.children
  return { ...block, children }
}

function isMermaidBlock(block: BlockLike): boolean {
  return block.type === MERMAID_BLOCK_TYPE
    && typeof block.props?.source === 'string'
    && typeof block.props?.diagram === 'string'
}

function mermaidMarkdown(block: BlockLike): string {
  const source = block.props?.source
  if (source) return source

  return mermaidFenceSource({ diagram: block.props?.diagram ?? '' })
}

export function injectMermaidInBlocks(blocks: unknown[]): unknown[] {
  return (blocks as BlockLike[]).map(injectMermaidInBlock)
}

export function serializeMermaidAwareBlocks(editor: MarkdownSerializer, blocks: unknown[]): string {
  const chunks: string[] = []
  let pending: unknown[] = []

  const flushPending = () => {
    if (pending.length === 0) return

    const markdown = serializeMathAwareBlocks(editor, pending).trimEnd()
    if (markdown) chunks.push(markdown)
    pending = []
  }

  for (const block of blocks as BlockLike[]) {
    if (isMermaidBlock(block)) {
      flushPending()
      chunks.push(mermaidMarkdown(block))
    } else {
      pending.push(block)
    }
  }

  flushPending()
  return chunks.join('\n\n')
}
