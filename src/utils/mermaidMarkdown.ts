import {
  type BlockLike,
  type DurableBlockCodec,
  type DurableFencePayloadInput,
  injectDurableMarkdownBlocks,
  preProcessDurableMarkdownBlocks,
  readCodeBlockLanguage,
  readInlineText,
} from './durableMarkdownBlocks'

export const MERMAID_BLOCK_TYPE = 'mermaidBlock'

const TOKEN_PREFIX = '@@TOLARIA_MERMAID_BLOCK:'
const TOKEN_SUFFIX = '@@'

interface MermaidPayload {
  source: string
  diagram: string
}

interface DiagramSource {
  diagram: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeMermaidPayload(payload: unknown): MermaidPayload | null {
  if (!isRecord(payload)) return null
  if (typeof payload.source !== 'string') return null
  if (typeof payload.diagram !== 'string') return null
  return { source: payload.source, diagram: payload.diagram }
}

function readMermaidFenceMetadata(info: string): Record<string, never> | null {
  const language = info.trim().split(/\s+/u)[0]?.toLowerCase()
  return language === 'mermaid' ? {} : null
}

function buildMermaidPayload({ lines, start, end }: DurableFencePayloadInput): MermaidPayload {
  return {
    source: lines.slice(start, end + 1).join(''),
    diagram: lines.slice(start + 1, end).join(''),
  }
}

function buildMermaidBlock(block: BlockLike, payload: MermaidPayload): BlockLike {
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

function looksLikeMermaidDiagram(diagram: string): boolean {
  const firstStatement = diagram
    .split(/\r?\n/u)
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

function readMermaidCodeBlock(block: BlockLike): MermaidPayload | null {
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

export const mermaidMarkdownCodec: DurableBlockCodec = {
  tokenPrefix: TOKEN_PREFIX,
  tokenSuffix: TOKEN_SUFFIX,
  readFenceMetadata: readMermaidFenceMetadata,
  buildPayload: buildMermaidPayload,
  decodePayload: decodeMermaidPayload,
  buildBlock: (block, payload) => buildMermaidBlock(block, payload as MermaidPayload),
  readCodeBlock: readMermaidCodeBlock,
  isBlock: isMermaidBlock,
  serializeBlock: mermaidMarkdown,
}

export function preProcessMermaidMarkdown({ markdown }: { markdown: string }): string {
  return preProcessDurableMarkdownBlocks({ markdown, codecs: [mermaidMarkdownCodec] })
}

export function injectMermaidInBlocks(blocks: unknown[]): unknown[] {
  return injectDurableMarkdownBlocks({ blocks, codecs: [mermaidMarkdownCodec] })
}
