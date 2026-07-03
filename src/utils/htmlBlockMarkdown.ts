import {
  type BlockLike,
  type DurableBlockCodec,
  type DurableFencePayloadInput,
  injectDurableMarkdownBlocks,
  preProcessDurableMarkdownBlocks,
  readCodeBlockLanguage,
  readInlineText,
} from './durableMarkdownBlocks'

export const HTML_BLOCK_TYPE = 'htmlBlock'
export const HTML_BLOCK_DEFAULT_HEIGHT = '320'
export const HTML_BLOCK_MIN_HEIGHT = 180
export const HTML_BLOCK_MAX_HEIGHT = 960

const TOKEN_PREFIX = '@@TOLARIA_HTML_BLOCK:'
const TOKEN_SUFFIX = '@@'

interface HtmlBlockPayload {
  height: string
  html: string
}

interface HtmlFenceSource {
  height: string
  html: string
}

interface FenceAttributeRequest {
  info: string
  name: 'height'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readFenceAttribute({ info, name }: FenceAttributeRequest): string {
  for (const match of info.matchAll(/\b([A-Za-z][\w-]*)=(?:"([^"]+)"|'([^']+)'|([^\s]+))/gu)) {
    if (match.at(1) === name) return match.at(2) ?? match.at(3) ?? match.at(4) ?? ''
  }
  return ''
}

export function normalizeHtmlBlockHeight(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return HTML_BLOCK_DEFAULT_HEIGHT

  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return HTML_BLOCK_DEFAULT_HEIGHT
  if (parsed < HTML_BLOCK_MIN_HEIGHT || parsed > HTML_BLOCK_MAX_HEIGHT) return HTML_BLOCK_DEFAULT_HEIGHT
  return String(parsed)
}

export function clampHtmlBlockHeight(value: number): string {
  if (!Number.isFinite(value)) return HTML_BLOCK_DEFAULT_HEIGHT
  return String(Math.min(HTML_BLOCK_MAX_HEIGHT, Math.max(HTML_BLOCK_MIN_HEIGHT, Math.round(value))))
}

function decodeHtmlBlockPayload(payload: unknown): HtmlBlockPayload | null {
  if (!isRecord(payload)) return null
  if (typeof payload.html !== 'string') return null

  return {
    height: normalizeHtmlBlockHeight(payload.height),
    html: payload.html,
  }
}

function readHtmlFenceMetadata(info: string): Pick<HtmlBlockPayload, 'height'> | null {
  const [language = '', ...infoParts] = info.trim().split(/\s+/u)
  if (language.toLowerCase() !== 'html') return null

  return {
    height: normalizeHtmlBlockHeight(readFenceAttribute({
      info: infoParts.join(' '),
      name: 'height',
    })),
  }
}

function buildHtmlBlockPayload({ lines, start, end, metadata }: DurableFencePayloadInput): HtmlBlockPayload {
  const fenceMetadata = metadata as Pick<HtmlBlockPayload, 'height'>
  return {
    height: fenceMetadata.height,
    html: lines.slice(start + 1, end).join(''),
  }
}

function buildHtmlBlock(block: BlockLike, payload: HtmlBlockPayload): BlockLike {
  return {
    ...block,
    type: HTML_BLOCK_TYPE,
    props: {
      ...(block.props ?? {}),
      height: payload.height,
      html: payload.html,
    },
    content: undefined,
    children: [],
  }
}

function readHtmlCodeBlock(block: BlockLike): HtmlBlockPayload | null {
  if (block.type !== 'codeBlock') return null
  if (readCodeBlockLanguage({ block }) !== 'html') return null

  const html = readInlineText(block.content)
  return html === null ? null : {
    height: HTML_BLOCK_DEFAULT_HEIGHT,
    html,
  }
}

function fenceLengthForHtml({ html }: Pick<HtmlFenceSource, 'html'>): number {
  const longestRun = Math.max(0, ...Array.from(html.matchAll(/`+/gu), match => match[0].length))
  return Math.max(3, longestRun + 1)
}

function escapeFenceAttribute(value: string): string {
  return value.replace(/"/gu, '&quot;')
}

export function htmlFenceSource({ height, html }: HtmlFenceSource): string {
  const normalizedHeight = normalizeHtmlBlockHeight(height)
  const fence = '`'.repeat(fenceLengthForHtml({ html }))
  const body = html.endsWith('\n') ? html : `${html}\n`
  return `${fence}html height="${escapeFenceAttribute(normalizedHeight)}"\n${body}${fence}`
}

function isHtmlBlock(block: BlockLike): boolean {
  return block.type === HTML_BLOCK_TYPE
    && typeof block.props?.html === 'string'
    && typeof block.props?.height === 'string'
}

export function htmlBlockMarkdown(block: BlockLike): string {
  return htmlFenceSource({
    height: block.props?.height ?? HTML_BLOCK_DEFAULT_HEIGHT,
    html: block.props?.html ?? '',
  })
}

export const htmlBlockMarkdownCodec: DurableBlockCodec = {
  tokenPrefix: TOKEN_PREFIX,
  tokenSuffix: TOKEN_SUFFIX,
  readFenceMetadata: readHtmlFenceMetadata,
  buildPayload: buildHtmlBlockPayload,
  decodePayload: decodeHtmlBlockPayload,
  buildBlock: (block, payload) => buildHtmlBlock(block, payload as HtmlBlockPayload),
  readCodeBlock: readHtmlCodeBlock,
  isBlock: isHtmlBlock,
  serializeBlock: htmlBlockMarkdown,
}

export function preProcessHtmlBlockMarkdown({ markdown }: { markdown: string }): string {
  return preProcessDurableMarkdownBlocks({ markdown, codecs: [htmlBlockMarkdownCodec] })
}

export function injectHtmlBlockInBlocks(blocks: unknown[]): unknown[] {
  return injectDurableMarkdownBlocks({ blocks, codecs: [htmlBlockMarkdownCodec] })
}
