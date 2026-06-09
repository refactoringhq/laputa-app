import {
  type BlockLike,
  type DurableBlockCodec,
  type DurableFencePayloadInput,
  injectDurableMarkdownBlocks,
  preProcessDurableMarkdownBlocks,
  readCodeBlockLanguage,
  readInlineText,
} from './durableMarkdownBlocks'

export const EXCALIDRAW_BLOCK_TYPE = 'excalidrawBlock'
export const EXCALIDRAW_DEFAULT_HEIGHT = '520'

const TOKEN_PREFIX = '@@TOLARIA_EXCALIDRAW_BLOCK:'
const TOKEN_SUFFIX = '@@'

interface ExcalidrawPayload {
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

function decodeExcalidrawPayload(payload: unknown): ExcalidrawPayload | null {
  if (!isRecord(payload)) return null
  if (typeof payload.boardId !== 'string') return null
  if (typeof payload.snapshot !== 'string') return null

  return {
    boardId: payload.boardId,
    height: typeof payload.height === 'string' ? payload.height : EXCALIDRAW_DEFAULT_HEIGHT,
    snapshot: payload.snapshot,
    width: typeof payload.width === 'string' ? payload.width : '',
  }
}

function readFenceAttribute({ info, name }: FenceAttributeRequest): string {
  for (const match of info.matchAll(/\b([A-Za-z][\w-]*)=(?:"([^"]+)"|'([^']+)'|([^\s]+))/gu)) {
    if (match.at(1) === name) return match.at(2) ?? match.at(3) ?? match.at(4) ?? ''
  }
  return ''
}

function readFenceMetadata(info: string): Pick<ExcalidrawPayload, 'boardId' | 'height' | 'width'> {
  return {
    boardId: readFenceAttribute({ info, name: 'id' }),
    height: readFenceAttribute({ info, name: 'height' }) || EXCALIDRAW_DEFAULT_HEIGHT,
    width: readFenceAttribute({ info, name: 'width' }),
  }
}

function readExcalidrawFenceMetadata(info: string): Pick<ExcalidrawPayload, 'boardId' | 'height' | 'width'> | null {
  const [language = '', ...infoParts] = info.trim().split(/\s+/u)
  if (language.toLowerCase() !== 'excalidraw') return null
  return readFenceMetadata(infoParts.join(' '))
}

function buildExcalidrawPayload({ lines, start, end, metadata }: DurableFencePayloadInput): ExcalidrawPayload {
  const fenceMetadata = metadata as Pick<ExcalidrawPayload, 'boardId' | 'height' | 'width'>
  return {
    ...fenceMetadata,
    snapshot: lines.slice(start + 1, end).join('').trim(),
  }
}

function buildExcalidrawBlock(block: BlockLike, payload: ExcalidrawPayload): BlockLike {
  return {
    ...block,
    type: EXCALIDRAW_BLOCK_TYPE,
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

function readExcalidrawCodeBlock(block: BlockLike): ExcalidrawPayload | null {
  if (block.type !== 'codeBlock') return null
  if (readCodeBlockLanguage({ block }) !== 'excalidraw') return null

  const snapshot = readInlineText(block.content)
  if (snapshot === null) return null

  return {
    boardId: '',
    height: EXCALIDRAW_DEFAULT_HEIGHT,
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

export function excalidrawFenceSource({ boardId, height, snapshot, width }: ExcalidrawPayload): string {
  const fence = '`'.repeat(fenceLengthForSnapshot({ snapshot }))
  const metadata = excalidrawFenceMetadata({ boardId, height, width })
  const body = snapshot.endsWith('\n') ? snapshot : `${snapshot}\n`
  return `${fence}excalidraw${metadata}\n${body}${fence}`
}

function excalidrawFenceMetadata({ boardId, height, width }: Omit<ExcalidrawPayload, 'snapshot'>): string {
  const attributes: string[] = []
  if (boardId) attributes.push(`id="${escapeFenceAttribute({ value: boardId })}"`)
  if (height) attributes.push(`height="${escapeFenceAttribute({ value: height })}"`)
  if (width) attributes.push(`width="${escapeFenceAttribute({ value: width })}"`)
  return attributes.length > 0 ? ` ${attributes.join(' ')}` : ''
}

export function isExcalidrawBlock(block: BlockLike): boolean {
  return block.type === EXCALIDRAW_BLOCK_TYPE
    && typeof block.props?.snapshot === 'string'
    && typeof block.props?.boardId === 'string'
}

function blockPropString(props: BlockLike['props'], key: string, fallback: string): string {
  const value = props?.[key]
  return typeof value === 'string' ? value : fallback
}

export function excalidrawMarkdown(block: BlockLike): string {
  return excalidrawFenceSource({
    boardId: blockPropString(block.props, 'boardId', ''),
    height: blockPropString(block.props, 'height', EXCALIDRAW_DEFAULT_HEIGHT),
    snapshot: blockPropString(block.props, 'snapshot', '{}'),
    width: blockPropString(block.props, 'width', ''),
  })
}

export const excalidrawMarkdownCodec: DurableBlockCodec = {
  tokenPrefix: TOKEN_PREFIX,
  tokenSuffix: TOKEN_SUFFIX,
  readFenceMetadata: readExcalidrawFenceMetadata,
  buildPayload: buildExcalidrawPayload,
  decodePayload: decodeExcalidrawPayload,
  buildBlock: (block, payload) => buildExcalidrawBlock(block, payload as ExcalidrawPayload),
  readCodeBlock: readExcalidrawCodeBlock,
  isBlock: isExcalidrawBlock,
  serializeBlock: excalidrawMarkdown,
}

export function preProcessExcalidrawMarkdown({ markdown }: { markdown: string }): string {
  return preProcessDurableMarkdownBlocks({ markdown, codecs: [excalidrawMarkdownCodec] })
}

export function injectExcalidrawInBlocks(blocks: unknown[]): unknown[] {
  return injectDurableMarkdownBlocks({ blocks, codecs: [excalidrawMarkdownCodec] })
}
