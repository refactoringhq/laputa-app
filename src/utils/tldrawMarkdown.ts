import {
  type BlockLike,
  type DurableBlockCodec,
  type DurableFencePayloadInput,
  injectDurableMarkdownBlocks,
  preProcessDurableMarkdownBlocks,
  readCodeBlockLanguage,
  readInlineText,
} from './durableMarkdownBlocks'

export const TLDRAW_BLOCK_TYPE = 'tldrawBlock'
export const TLDRAW_DEFAULT_HEIGHT = '520'

const TOKEN_PREFIX = '@@TOLARIA_TLDRAW_BLOCK:'
const TOKEN_SUFFIX = '@@'

interface TldrawPayload {
  boardId: string
  height: string
  snapshot: string
  width: string
}

interface SnapshotSource {
  snapshot: string
}

interface FenceAttribute {
  value: string
}

interface FenceAttributeRequest {
  info: string
  name: 'height' | 'id' | 'width'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeTldrawPayload(payload: unknown): TldrawPayload | null {
  if (!isRecord(payload)) return null
  if (typeof payload.boardId !== 'string') return null
  if (typeof payload.snapshot !== 'string') return null

  return {
    boardId: payload.boardId,
    height: typeof payload.height === 'string' ? payload.height : TLDRAW_DEFAULT_HEIGHT,
    snapshot: payload.snapshot,
    width: typeof payload.width === 'string' ? payload.width : '',
  }
}

function readFenceAttribute({ info, name }: FenceAttributeRequest): string {
  for (const match of info.matchAll(/\b([A-Za-z][\w-]*)=(?:"([^"]+)"|'([^']+)'|([^\s]+))/gu)) {
    if (match[1] === name) return match[2] ?? match[3] ?? match[4] ?? ''
  }
  return ''
}

function readFenceMetadata(info: string): Pick<TldrawPayload, 'boardId' | 'height' | 'width'> {
  return {
    boardId: readFenceAttribute({ info, name: 'id' }),
    height: readFenceAttribute({ info, name: 'height' }) || TLDRAW_DEFAULT_HEIGHT,
    width: readFenceAttribute({ info, name: 'width' }),
  }
}

function readTldrawFenceMetadata(info: string): Pick<TldrawPayload, 'boardId' | 'height' | 'width'> | null {
  const [language = '', ...infoParts] = info.trim().split(/\s+/u)
  if (language.toLowerCase() !== 'tldraw') return null
  return readFenceMetadata(infoParts.join(' '))
}

function buildTldrawPayload({ lines, start, end, metadata }: DurableFencePayloadInput): TldrawPayload {
  const fenceMetadata = metadata as Pick<TldrawPayload, 'boardId' | 'height' | 'width'>
  return {
    ...fenceMetadata,
    snapshot: lines.slice(start + 1, end).join('').trim(),
  }
}

function buildTldrawBlock(block: BlockLike, payload: TldrawPayload): BlockLike {
  return {
    ...block,
    type: TLDRAW_BLOCK_TYPE,
    props: {
      ...(block.props ?? {}),
      boardId: payload.boardId,
      height: payload.height,
      snapshot: payload.snapshot,
      width: payload.width,
    },
    content: undefined,
    children: [],
  }
}

function readTldrawCodeBlock(block: BlockLike): TldrawPayload | null {
  if (block.type !== 'codeBlock') return null
  if (readCodeBlockLanguage({ block }) !== 'tldraw') return null

  const snapshot = readInlineText(block.content)
  if (snapshot === null) return null

  return {
    boardId: '',
    height: TLDRAW_DEFAULT_HEIGHT,
    snapshot: snapshot.trim(),
    width: '',
  }
}

function fenceLengthForSnapshot({ snapshot }: SnapshotSource): number {
  const longestRun = Math.max(0, ...Array.from(snapshot.matchAll(/`+/gu), match => match[0].length))
  return Math.max(3, longestRun + 1)
}

function escapeFenceAttribute({ value }: FenceAttribute): string {
  return value.replace(/"/gu, '&quot;')
}

export function tldrawFenceSource({ boardId, height, snapshot, width }: TldrawPayload): string {
  const fence = '`'.repeat(fenceLengthForSnapshot({ snapshot }))
  const metadata = tldrawFenceMetadata({ boardId, height, width })
  const body = snapshot.endsWith('\n') ? snapshot : `${snapshot}\n`
  return `${fence}tldraw${metadata}\n${body}${fence}`
}

function tldrawFenceMetadata({ boardId, height, width }: Omit<TldrawPayload, 'snapshot'>): string {
  const attributes: string[] = []
  if (boardId) attributes.push(`id="${escapeFenceAttribute({ value: boardId })}"`)
  if (height) attributes.push(`height="${escapeFenceAttribute({ value: height })}"`)
  if (width) attributes.push(`width="${escapeFenceAttribute({ value: width })}"`)
  return attributes.length > 0 ? ` ${attributes.join(' ')}` : ''
}

export function isTldrawBlock(block: BlockLike): boolean {
  return block.type === TLDRAW_BLOCK_TYPE
    && typeof block.props?.snapshot === 'string'
    && typeof block.props?.boardId === 'string'
}

export function tldrawMarkdown(block: BlockLike): string {
  return tldrawFenceSource({
    boardId: block.props?.boardId ?? '',
    height: block.props?.height ?? TLDRAW_DEFAULT_HEIGHT,
    snapshot: block.props?.snapshot ?? '{}',
    width: block.props?.width ?? '',
  })
}

export const tldrawMarkdownCodec: DurableBlockCodec = {
  tokenPrefix: TOKEN_PREFIX,
  tokenSuffix: TOKEN_SUFFIX,
  readFenceMetadata: readTldrawFenceMetadata,
  buildPayload: buildTldrawPayload,
  decodePayload: decodeTldrawPayload,
  buildBlock: (block, payload) => buildTldrawBlock(block, payload as TldrawPayload),
  readCodeBlock: readTldrawCodeBlock,
  isBlock: isTldrawBlock,
  serializeBlock: tldrawMarkdown,
}

export function preProcessTldrawMarkdown({ markdown }: { markdown: string }): string {
  return preProcessDurableMarkdownBlocks({ markdown, codecs: [tldrawMarkdownCodec] })
}

export function injectTldrawInBlocks(blocks: unknown[]): unknown[] {
  return injectDurableMarkdownBlocks({ blocks, codecs: [tldrawMarkdownCodec] })
}
