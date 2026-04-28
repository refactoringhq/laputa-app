import { splitFrontmatter } from '../utils/wikilinks'
import { slugifyNoteStem } from '../utils/noteSlug'

type MarkdownContent = string
type FilePath = string
type Frontmatter = string
type NoteTitle = string
type PathStem = string
type HeadingTextInline = { type?: string; text?: string }
type ParsedBlock = {
  type?: string
  props?: {
    url?: string
    previewWidth?: number
  }
  children?: unknown[]
}

const LOCAL_FILE_URL_PREFIXES = ['asset://localhost/', 'http://asset.localhost/']
const BROKEN_IMAGE_FALLBACK_MAX_WIDTH = 32

export function extractEditorBody(rawFileContent: MarkdownContent): MarkdownContent {
  const [, rawBody] = splitFrontmatter(rawFileContent)
  return rawBody.trimStart()
}

function extractH1Content(blocks: unknown[]): HeadingTextInline[] | null {
  const first = blocks?.[0] as {
    type?: string
    props?: { level?: number }
    content?: HeadingTextInline[]
  } | undefined

  if (!first) return null
  if (first.type !== 'heading') return null
  if (first.props?.level !== 1) return null
  if (!Array.isArray(first.content)) return null
  return first.content
}

export function getH1TextFromBlocks(blocks: unknown[]): NoteTitle | null {
  const content = extractH1Content(blocks)
  if (!content) return null

  let text = ''
  for (const item of content) {
    if (item.type === 'text') {
      text += item.text || ''
    }
  }

  const trimmed = text.trim()
  return trimmed || null
}

export function replaceTitleInFrontmatter(frontmatter: Frontmatter, newTitle: NoteTitle): Frontmatter {
  return frontmatter.replace(/^(title:\s*).+$/m, `$1${newTitle}`)
}

export function pathStem(path: FilePath): PathStem {
  const filename = path.split('/').pop() ?? path
  return filename.replace(/\.md$/, '')
}

export const slugifyPathStem = slugifyNoteStem

export function isUntitledPath(path: FilePath): boolean {
  return pathStem(path).startsWith('untitled-')
}

export function blankParagraphBlocks(): unknown[] {
  return [{ type: 'paragraph', content: [], children: [] }]
}

function isParsedBlock(value: unknown): value is ParsedBlock {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasLocalFileUrl(block: ParsedBlock): boolean {
  const url = block.props?.url
  return typeof url === 'string'
    && LOCAL_FILE_URL_PREFIXES.some(prefix => url.startsWith(prefix))
}

function hasSyntheticPreviewWidth(block: ParsedBlock): boolean {
  const previewWidth = block.props?.previewWidth
  return typeof previewWidth === 'number'
    && previewWidth > 0
    && previewWidth <= BROKEN_IMAGE_FALLBACK_MAX_WIDTH
}

function shouldClearLocalImagePreviewWidth(block: ParsedBlock): boolean {
  return block.type === 'image'
    && hasLocalFileUrl(block)
    && hasSyntheticPreviewWidth(block)
}

function normalizeParsedBlockChildren(block: ParsedBlock): unknown[] | undefined {
  if (!Array.isArray(block.children)) return block.children
  return block.children.map(normalizeParsedImageBlock)
}

function withNormalizedImageProps(
  block: ParsedBlock,
  shouldClearPreviewWidth: boolean,
): ParsedBlock['props'] {
  if (!shouldClearPreviewWidth) return block.props
  return { ...block.props, previewWidth: undefined }
}

function normalizeParsedImageBlock(block: unknown): unknown {
  if (!isParsedBlock(block)) return block

  const children = normalizeParsedBlockChildren(block)
  const shouldClearPreviewWidth = shouldClearLocalImagePreviewWidth(block)
  const props = withNormalizedImageProps(block, shouldClearPreviewWidth)

  if (!shouldClearPreviewWidth && children === block.children) return block

  return {
    ...block,
    ...(children === block.children ? {} : { children }),
    ...(props === block.props ? {} : { props }),
  }
}

export function normalizeParsedImageBlocks(blocks: unknown[]): unknown[] {
  return blocks.map(normalizeParsedImageBlock)
}
