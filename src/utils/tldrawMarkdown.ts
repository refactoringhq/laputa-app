export const TLDRAW_BLOCK_TYPE = 'tldrawBlock'
export const TLDRAW_DEFAULT_HEIGHT = '520'

const TOKEN_PREFIX = '@@TOLARIA_TLDRAW_BLOCK:'
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

interface TldrawPayload {
  boardId: string
  height: string
  snapshot: string
  width: string
}

interface TldrawFenceStart {
  character: '`' | '~'
  length: number
  boardId: string
  height: string
  width: string
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
  opening: TldrawFenceStart
}

interface FenceRange {
  lines: string[]
  start: number
  end: number
  opening: TldrawFenceStart
}

interface SnapshotSource {
  snapshot: string
}

interface FenceAttribute {
  value: string
}

interface CodeBlockSource {
  block: BlockLike
}

interface FenceMetadata {
  info: string
}

interface FenceAttributeRequest {
  info: string
  name: 'height' | 'id' | 'width'
}

function lineEnding({ line }: MarkdownLine): string {
  if (line.endsWith('\r\n')) return '\r\n'
  return line.endsWith('\n') ? '\n' : ''
}

function lineText({ line }: MarkdownLine): string {
  const ending = lineEnding({ line })
  return ending ? line.slice(0, -ending.length) : line
}

function splitMarkdownLines({ markdown }: { markdown: string }): string[] {
  const lines = markdown.match(/[^\n]*(?:\n|$)/g) ?? []
  return lines.filter((line, index) => line !== '' || index < lines.length - 1)
}

function encodePayload(payload: TldrawPayload): string {
  return encodeURIComponent(JSON.stringify(payload))
}

function decodePayload({ encoded }: EncodedPayload): TldrawPayload | null {
  try {
    const payload = JSON.parse(decodeURIComponent(encoded)) as Partial<TldrawPayload>
    if (typeof payload.boardId !== 'string') return null
    if (typeof payload.snapshot !== 'string') return null
    return {
      boardId: payload.boardId,
      height: typeof payload.height === 'string' ? payload.height : TLDRAW_DEFAULT_HEIGHT,
      snapshot: payload.snapshot,
      width: typeof payload.width === 'string' ? payload.width : '',
    }
  } catch {
    return null
  }
}

function tldrawToken(payload: TldrawPayload): string {
  return `${TOKEN_PREFIX}${encodePayload(payload)}${TOKEN_SUFFIX}`
}

function readTldrawToken({ text }: TokenText): TldrawPayload | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith(TOKEN_PREFIX) || !trimmed.endsWith(TOKEN_SUFFIX)) return null
  return decodePayload({ encoded: trimmed.slice(TOKEN_PREFIX.length, -TOKEN_SUFFIX.length) })
}

function readFenceAttribute({ info, name }: FenceAttributeRequest): string {
  for (const match of info.matchAll(/\b([A-Za-z][\w-]*)=(?:"([^"]+)"|'([^']+)'|([^\s]+))/gu)) {
    if (match[1] === name) return match[2] ?? match[3] ?? match[4] ?? ''
  }
  return ''
}

function readFenceMetadata({ info }: FenceMetadata): Pick<TldrawPayload, 'boardId' | 'height' | 'width'> {
  return {
    boardId: readFenceAttribute({ info, name: 'id' }),
    height: readFenceAttribute({ info, name: 'height' }) || TLDRAW_DEFAULT_HEIGHT,
    width: readFenceAttribute({ info, name: 'width' }),
  }
}

function readTldrawFenceStart({ line }: MarkdownLine): TldrawFenceStart | null {
  const match = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/.exec(line)
  if (!match) return null

  const fence = match[2]
  const [language = '', ...infoParts] = match[3].trim().split(/\s+/u)
  if (language.toLowerCase() !== 'tldraw') return null
  const metadata = readFenceMetadata({ info: infoParts.join(' ') })

  return {
    character: fence[0] as '`' | '~',
    length: fence.length,
    ...metadata,
  }
}

function isClosingFence({ line, opening }: MarkdownLine & { opening: TldrawFenceStart }): boolean {
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

function buildPayload({ lines, start, end, opening }: FenceRange): TldrawPayload {
  return {
    boardId: opening.boardId,
    height: opening.height,
    snapshot: lines.slice(start + 1, end).join('').trim(),
    width: opening.width,
  }
}

export function preProcessTldrawMarkdown({ markdown }: { markdown: string }): string {
  const lines = splitMarkdownLines({ markdown })
  const result: string[] = []

  for (let index = 0; index < lines.length; index++) {
    const opening = readTldrawFenceStart({ line: lineText({ line: lines[index] }) })
    if (!opening) {
      result.push(lines[index])
      continue
    }

    const closingIndex = findClosingFence({ lines, start: index, opening })
    if (closingIndex === -1) {
      result.push(lines[index])
      continue
    }

    result.push(`${tldrawToken(buildPayload({ lines, start: index, end: closingIndex, opening }))}${lineEnding({ line: lines[closingIndex] })}`)
    index = closingIndex
  }

  return result.join('')
}

function readTldrawPayload(content: InlineItem[] | undefined): TldrawPayload | null {
  const onlyItem = content?.length === 1 ? content[0] : null
  if (onlyItem?.type !== 'text' || typeof onlyItem.text !== 'string') return null
  return readTldrawToken({ text: onlyItem.text })
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

function readCodeBlockLanguage({ block }: CodeBlockSource): string | null {
  const language = block.props?.language
  if (typeof language !== 'string') return null

  return language.trim().split(/\s+/u)[0]?.toLowerCase() ?? null
}

function readInlineText(content: InlineItem[] | undefined): string | null {
  if (!Array.isArray(content)) return null
  return content.map((item) => (
    item.type === 'text' && typeof item.text === 'string' ? item.text : ''
  )).join('')
}

function readTldrawCodeBlock({ block }: CodeBlockSource): TldrawPayload | null {
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

function injectTldrawInBlock(block: BlockLike): BlockLike {
  const payload = readTldrawPayload(block.content)
  if (payload) return buildTldrawBlock(block, payload)

  const codeBlockPayload = readTldrawCodeBlock({ block })
  if (codeBlockPayload) return buildTldrawBlock(block, codeBlockPayload)

  const children = Array.isArray(block.children) ? block.children.map(injectTldrawInBlock) : block.children
  return { ...block, children }
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

export function injectTldrawInBlocks(blocks: unknown[]): unknown[] {
  return (blocks as BlockLike[]).map(injectTldrawInBlock)
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
