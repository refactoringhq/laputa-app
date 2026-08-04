import {
  lineEnding,
  lineText,
  type BlockLike,
} from './durableMarkdownBlocks'
import {
  isVaultAttachmentUrl,
  portableAttachmentPathFromCurrentVaultAssetUrl,
  portableAttachmentPathFromCurrentVaultPath,
} from './vaultAttachments'
import { advanceMarkdownFence, type MarkdownFence } from './markdownFences'

interface FileAttachmentPayload {
  name: string
  url: string
  caption?: string
}

interface SerializeFileAttachmentBlocksOptions {
  blocks: unknown[]
  serializeOrdinaryBlocks: (blocks: unknown[]) => string
  vaultPath?: VaultPath
}

interface FlushOrdinaryBlocksOptions {
  chunks: string[]
  pending: unknown[]
  serializeOrdinaryBlocks: (blocks: unknown[]) => string
}

type FileAttachmentLineTransform = (payload: FileAttachmentPayload) => string | null
type AttachmentUrlReader = (value: unknown) => AttachmentUrl | null
type AttachmentUrl = string
type Markdown = string
type MarkdownLine = string
type MarkdownText = string
type VaultPath = string

interface PreProcessFileAttachmentMarkdownOptions {
  markdown: Markdown
}

interface TransformFileAttachmentLinksOptions {
  markdown: Markdown
  readUrl?: AttachmentUrlReader
  transform: FileAttachmentLineTransform
}

interface TransformLineOptions {
  fence: MarkdownFence | null
  line: MarkdownLine
  readUrl: AttachmentUrlReader
  transform: FileAttachmentLineTransform
}

interface TransformedLine {
  fence: MarkdownFence | null
  line: MarkdownLine
}

const FILE_ATTACHMENT_TOKEN_PREFIX = '@@TOLARIA_FILE_ATTACHMENT:'
const FILE_ATTACHMENT_TOKEN_SUFFIX = '@@'
const STANDALONE_ATTACHMENT_LINK_PATTERN = /^( {0,3})\[((?:\\.|[^\]\\\n])*)\]\((<[^>\n]+>|(?:\\.|[^)\s\n])+)(?:[ \t]+"((?:\\.|[^"\\\n])*)")?\)[ \t]*$/u

function splitMarkdownLines(markdown: Markdown): MarkdownLine[] {
  const lines = markdown.match(/[^\n]*(?:\n|$)/g) ?? []
  return lines.filter((line, index) => line !== '' || index < lines.length - 1)
}

function safeDecode(value: MarkdownText): MarkdownText {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function escapeMarkdownLabel(value: MarkdownText): MarkdownText {
  return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
}

function escapeMarkdownTitle(value: MarkdownText): MarkdownText {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapeMarkdownDestination(value: AttachmentUrl): MarkdownText {
  if (/[\s<>]/u.test(value)) return `<${value.replace(/>/g, '%3E')}>`
  return value.replace(/\\/g, '\\\\').replace(/\)/g, '\\)')
}

function unescapeMarkdownDestination(value: MarkdownText): AttachmentUrl {
  const withoutAngles = value.startsWith('<') && value.endsWith('>')
    ? value.slice(1, -1)
    : value
  return withoutAngles.replace(/\\([\\()<>])/g, '$1')
}

function fileNameFromUrl(url: AttachmentUrl): MarkdownText {
  const path = safeDecode(url.split(/[?#]/u)[0] ?? url)
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? url
}

function serializeMarkdownFileLink(payload: FileAttachmentPayload): Markdown {
  const title = payload.caption ? ` "${escapeMarkdownTitle(payload.caption)}"` : ''
  return `[${escapeMarkdownLabel(payload.name)}](${escapeMarkdownDestination(payload.url)}${title})`
}

function encodePayload(payload: FileAttachmentPayload): MarkdownText {
  return encodeURIComponent(JSON.stringify(payload))
}

function fileAttachmentToken(payload: FileAttachmentPayload): MarkdownText {
  return `${FILE_ATTACHMENT_TOKEN_PREFIX}${encodePayload(payload)}${FILE_ATTACHMENT_TOKEN_SUFFIX}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNonEmptyText(value: unknown): MarkdownText | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readAttachmentUrl(value: unknown): AttachmentUrl | null {
  const url = readNonEmptyText(value)
  return url && isVaultAttachmentUrl({ url }) ? url : null
}

function readAnyLinkUrl(value: unknown): AttachmentUrl | null {
  return readNonEmptyText(value)
}

function readPayloadName(record: Record<string, unknown>, url: AttachmentUrl): MarkdownText {
  return readNonEmptyText(record.name) ?? fileNameFromUrl(url)
}

function readOptionalCaption(value: unknown): MarkdownText | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function fileAttachmentPayload(payload: FileAttachmentPayload): FileAttachmentPayload {
  return payload.caption
    ? payload
    : { name: payload.name, url: payload.url }
}

function normalizePayload(value: unknown): FileAttachmentPayload | null {
  if (!isRecord(value)) return null

  const url = readAttachmentUrl(value.url)
  if (!url) return null

  return fileAttachmentPayload({
    name: readPayloadName(value, url),
    url,
    caption: readOptionalCaption(value.caption),
  })
}

function readFileAttachmentToken(text: MarkdownText): FileAttachmentPayload | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith(FILE_ATTACHMENT_TOKEN_PREFIX)) return null
  if (!trimmed.endsWith(FILE_ATTACHMENT_TOKEN_SUFFIX)) return null

  const encoded = trimmed.slice(
    FILE_ATTACHMENT_TOKEN_PREFIX.length,
    -FILE_ATTACHMENT_TOKEN_SUFFIX.length,
  )
  try {
    return normalizePayload(JSON.parse(decodeURIComponent(encoded)))
  } catch {
    return null
  }
}

function matchedAttachmentUrl(match: RegExpExecArray, readUrl: AttachmentUrlReader): AttachmentUrl | null {
  return readUrl(unescapeMarkdownDestination(match[3] ?? ''))
}

function matchedAttachmentName(match: RegExpExecArray, url: AttachmentUrl): MarkdownText {
  return unescapeMarkdownText(match[2] ?? '') || fileNameFromUrl(url)
}

function matchedAttachmentCaption(match: RegExpExecArray): MarkdownText | undefined {
  return match[4] ? unescapeMarkdownText(match[4]) : undefined
}

function readStandaloneFileAttachmentLink(
  text: MarkdownText,
  readUrl: AttachmentUrlReader = readAttachmentUrl,
): FileAttachmentPayload | null {
  const match = STANDALONE_ATTACHMENT_LINK_PATTERN.exec(text)
  if (!match) return null

  const url = matchedAttachmentUrl(match, readUrl)
  if (!url) return null

  const name = matchedAttachmentName(match, url)
  const caption = matchedAttachmentCaption(match)
  return fileAttachmentPayload({ name, url, caption })
}

function transformAttachmentLine(
  line: MarkdownLine,
  readUrl: AttachmentUrlReader,
  transform: FileAttachmentLineTransform,
): MarkdownLine {
  const payload = readStandaloneFileAttachmentLink(lineText({ line }), readUrl)
  if (!payload) return line

  const transformed = transform(payload)
  return transformed ? `${transformed}${lineEnding({ line })}` : line
}

function transformFencedLine(line: MarkdownLine, text: MarkdownText, fence: MarkdownFence): TransformedLine {
  return {
    line,
    fence: advanceMarkdownFence(text, fence),
  }
}

function transformUnfencedLine(
  line: MarkdownLine,
  text: MarkdownText,
  readUrl: AttachmentUrlReader,
  transform: FileAttachmentLineTransform,
): TransformedLine {
  const opening = advanceMarkdownFence(text, null)
  if (opening) {
    return {
      line,
      fence: opening,
    }
  }

  const transformedLine = transformAttachmentLine(line, readUrl, transform)
  return {
    line: transformedLine,
    fence: null,
  }
}

function transformLine(options: TransformLineOptions): TransformedLine {
  const text = lineText({ line: options.line })
  if (options.fence) {
    return transformFencedLine(options.line, text, options.fence)
  }

  return transformUnfencedLine(options.line, text, options.readUrl, options.transform)
}

function transformStandaloneFileAttachmentLinks(options: TransformFileAttachmentLinksOptions): Markdown {
  const lines: MarkdownLine[] = []
  let fence: MarkdownFence | null = null
  const readUrl = options.readUrl ?? readAttachmentUrl

  for (const line of splitMarkdownLines(options.markdown)) {
    const transformed = transformLine({ line, fence, readUrl, transform: options.transform })
    lines.push(transformed.line)
    fence = transformed.fence
  }

  return lines.join('')
}

function readTokenPayload(block: BlockLike): FileAttachmentPayload | null {
  const content = block.content
  if (!Array.isArray(content) || content.length !== 1) return null

  const item = content[0]
  if (item?.type !== 'text' || typeof item.text !== 'string') return null
  return readFileAttachmentToken(item.text)
}

function buildFileAttachmentBlock(block: BlockLike, payload: FileAttachmentPayload): BlockLike {
  return {
    ...block,
    type: 'file',
    props: {
      ...block.props,
      backgroundColor: block.props?.backgroundColor ?? 'default',
      name: payload.name,
      url: payload.url,
      caption: payload.caption ?? '',
    },
    content: undefined,
    children: [],
  }
}

function injectFileAttachmentBlock(block: BlockLike): BlockLike {
  const payload = readTokenPayload(block)
  if (payload) return buildFileAttachmentBlock(block, payload)

  const children = Array.isArray(block.children)
    ? block.children.map(injectFileAttachmentBlock)
    : block.children
  return { ...block, children }
}

export function injectFileAttachmentBlocks(blocks: unknown[]): unknown[] {
  return (blocks as BlockLike[]).map(injectFileAttachmentBlock)
}

function readBlockAttachmentUrl(block: BlockLike, vaultPath?: VaultPath): AttachmentUrl | null {
  if (block.type !== 'file') return null

  const url = readAttachmentUrl(block.props?.url)
  if (url) return url

  const rawUrl = readNonEmptyText(block.props?.url)
  if (!rawUrl || !vaultPath) return null
  return portableAttachmentPathFromCurrentVaultPath({ path: rawUrl, vaultPath })
}

function readBlockAttachmentName(block: BlockLike, url: AttachmentUrl): MarkdownText {
  return block.props?.name?.trim() || fileNameFromUrl(url)
}

function readFileAttachmentBlockPayload(block: BlockLike, vaultPath?: VaultPath): FileAttachmentPayload | null {
  const url = readBlockAttachmentUrl(block, vaultPath)
  if (!url) return null

  return fileAttachmentPayload({
    name: readBlockAttachmentName(block, url),
    url,
    caption: block.props?.caption?.trim(),
  })
}

function flushOrdinaryBlocks({
  chunks,
  pending,
  serializeOrdinaryBlocks,
}: FlushOrdinaryBlocksOptions): unknown[] {
  if (pending.length === 0) return pending

  const markdown = serializeOrdinaryBlocks(pending).trimEnd()
  if (markdown) chunks.push(markdown)
  return []
}

export function serializeFileAttachmentBlocks({
  blocks,
  serializeOrdinaryBlocks,
  vaultPath,
}: SerializeFileAttachmentBlocksOptions): string {
  const chunks: string[] = []
  let pending: unknown[] = []

  for (const block of blocks as BlockLike[]) {
    const payload = readFileAttachmentBlockPayload(block, vaultPath)
    if (!payload) {
      pending.push(block)
      continue
    }

    pending = flushOrdinaryBlocks({ chunks, pending, serializeOrdinaryBlocks })
    chunks.push(serializeMarkdownFileLink(payload))
  }

  flushOrdinaryBlocks({ chunks, pending, serializeOrdinaryBlocks })
  return chunks.join('\n\n')
}

function hasFileAttachmentBlock(block: BlockLike): boolean {
  if (readFileAttachmentBlockPayload(block)) return true
  return Array.isArray(block.children)
    ? block.children.some(hasFileAttachmentBlock)
    : false
}

export function hasFileAttachmentBlocks(blocks: unknown[]): boolean {
  return (blocks as BlockLike[]).some(hasFileAttachmentBlock)
}

function portableAttachmentUrl(payload: FileAttachmentPayload, vaultPath: VaultPath): AttachmentUrl | null {
  return portableAttachmentPathFromCurrentVaultAssetUrl({ url: payload.url, vaultPath })
    ?? portableAttachmentPathFromCurrentVaultPath({ path: payload.url, vaultPath })
}

export function portableFileAttachmentUrls(markdown: Markdown, vaultPath: VaultPath): Markdown {
  if (!vaultPath) return markdown

  return transformStandaloneFileAttachmentLinks({
    markdown,
    readUrl: readAnyLinkUrl,
    transform: (payload) => {
      const url = portableAttachmentUrl(payload, vaultPath)
      return url ? serializeMarkdownFileLink({ ...payload, url }) : null
    },
  })
}

export function preProcessFileAttachmentMarkdown(
  options: PreProcessFileAttachmentMarkdownOptions,
): Markdown {
  return transformStandaloneFileAttachmentLinks({
    markdown: options.markdown,
    transform: fileAttachmentToken,
  })
}

function unescapeMarkdownText(value: MarkdownText): MarkdownText {
  return value.replace(/\\([\\\]"'])/g, '$1')
}
