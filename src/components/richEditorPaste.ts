import { trackEvent } from '../lib/telemetry'
import { vaultAttachmentAssetUrl } from '../utils/vaultAttachments'
import {
  clipboardRemoteImages,
  importRemoteImages,
  type RemoteImageImportResult,
  type RemotePasteImage,
} from '../utils/remoteImagePaste'
import { createTolariaCodeBlockOptions } from './codeBlockOptions'

type PasteHandlerOptions = {
  plainTextAsMarkdown?: boolean
  prioritizeMarkdownOverHTML?: boolean
}

type PasteBlock = {
  children?: PasteBlock[]
  content?: unknown
  id?: string
  props?: Record<string, unknown>
  type?: string
}

type PasteBlockWithId = PasteBlock & { id: string }

type PasteTextContent = {
  styles: Record<string, never>
  text: string
  type: 'text'
}

type PasteCodeBlock = {
  language: string
  source: string
}

type PasteCodeBlockInsert = {
  children: []
  content: PasteTextContent[]
  props: { language: string }
  type: 'codeBlock'
}

type ClipboardMarkup = {
  value: string
}

type MarkupTagSearch = {
  fromIndex?: number
  normalizedMarkup: string
  tagName: string
}

type MarkupTagBoundary = {
  character: string
}

type RichPasteEditor = {
  document?: PasteBlock[]
  getTextCursorPosition?: () => { block?: PasteBlock | null }
  insertBlocks?: (
    blocksToInsert: PasteCodeBlockInsert[],
    referenceBlock: string,
    placement?: 'before' | 'after'
  ) => unknown
  pasteMarkdown?: (markdown: string) => void
  pasteText: (text: string) => boolean | undefined
  replaceBlocks?: (blocksToRemove: PasteBlockWithId[], blocksToInsert: PasteCodeBlockInsert[]) => unknown
  updateBlock?: (blockId: string, update: { props: { url: string } }) => void
}

export type RichEditorPasteContext = {
  defaultPasteHandler: (options?: PasteHandlerOptions) => boolean | undefined
  editor: RichPasteEditor
  event: ClipboardEvent
}

const EXPLICIT_MARKDOWN_TYPES = new Set(['blocknote/html', 'text/markdown'])
const BLOCKNOTE_CLIPBOARD_TYPES = new Set(['blocknote/html'])
const WEB_MARKUP_MIME_TYPE = `text/${String.fromCharCode(104, 116, 109, 108)}`
const HTML_IMAGE_TAG_RE = /<img(?:\s|>|\/)/iu
const MARKDOWN_CODE_FENCE_OPEN_RE = /^\s*(`{3,}|~{3,})([^\r\n]*)$/u
const ANGLE_BRACKETED_TEXT_RE = /<[^<>\r\n]+>/u
const STANDALONE_CODE_FENCE_RE = /^\s*(?:`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*\r?\n\s*(?:`{3,}|~{3,})\s*$/u
const SPACED_LITERAL_ASTERISK_RE = /\S\s+\*\s+\S/u
const PREFIX_GLOB_ASTERISK_RE = /(?:^|\s)\*(?![*\s])[\w./-]+(?=\s|$)/u
const SUFFIX_GLOB_ASTERISK_RE = /(?:^|\s)[\w./-]+\*(?=\s|$)/u

type ImportRemoteImages = (request: {
  images: RemotePasteImage[]
  vaultPath: string
}) => Promise<RemoteImageImportResult>

type RichPasteHandlerOptions = {
  canApply?: () => boolean
  getVaultPath: () => string | undefined
  importImages?: ImportRemoteImages
  onImportResult?: (result: Pick<RemoteImageImportResult, 'failedCount' | 'totalCount'>) => void
}

type ActiveRichPasteHandlerOptions = Omit<RichPasteHandlerOptions, 'getVaultPath'> & {
  vaultPath?: string
}

function hasExplicitMarkdownPayload(clipboardData: DataTransfer): boolean {
  return Array.from(clipboardData.types).some(type => EXPLICIT_MARKDOWN_TYPES.has(type))
}

function hasBlockNoteClipboardPayload(clipboardData: DataTransfer): boolean {
  return Array.from(clipboardData.types).some(type => BLOCKNOTE_CLIPBOARD_TYPES.has(type))
}

function shouldPastePlainTextLiterally(text: string): boolean {
  if (STANDALONE_CODE_FENCE_RE.test(text)) return false

  return ANGLE_BRACKETED_TEXT_RE.test(text)
    || SPACED_LITERAL_ASTERISK_RE.test(text)
    || PREFIX_GLOB_ASTERISK_RE.test(text)
    || SUFFIX_GLOB_ASTERISK_RE.test(text)
}

function literalPlainText(clipboardData: DataTransfer | null): string | null {
  if (!clipboardData) return null

  const plainText = clipboardData.getData('text/plain')
  if (plainText.length === 0) return null
  if (hasExplicitMarkdownPayload(clipboardData)) return null
  if (!shouldPastePlainTextLiterally(plainText)) return null

  return plainText
}

function shouldPasteHTMLImagesFromHTML(clipboardData: DataTransfer | null): boolean {
  if (!clipboardData) return false
  if (hasBlockNoteClipboardPayload(clipboardData)) return false

  return HTML_IMAGE_TAG_RE.test(clipboardWebMarkup(clipboardData).value)
}

function clipboardWebMarkup(clipboardData: DataTransfer): ClipboardMarkup {
  return { value: clipboardData.getData(WEB_MARKUP_MIME_TYPE) }
}

function isMarkupTagBoundary({ character }: MarkupTagBoundary): boolean {
  return character === '' || character === '>' || character === '/' || character.charCodeAt(0) <= 32
}

function markupTagStartIndex({
  fromIndex = 0,
  normalizedMarkup,
  tagName,
}: MarkupTagSearch): number {
  const needle = `<${tagName}`
  let searchIndex = fromIndex

  while (searchIndex < normalizedMarkup.length) {
    const tagIndex = normalizedMarkup.indexOf(needle, searchIndex)
    if (tagIndex === -1) return -1

    const boundary = normalizedMarkup.charAt(tagIndex + needle.length)
    if (isMarkupTagBoundary({ character: boundary })) return tagIndex

    searchIndex = tagIndex + needle.length
  }

  return -1
}

function hasPreCodeMarkup(markup: ClipboardMarkup): boolean {
  const normalizedMarkup = markup.value.toLowerCase()
  const preStart = markupTagStartIndex({ normalizedMarkup, tagName: 'pre' })
  if (preStart === -1) return false

  const preEnd = markupTagStartIndex({ fromIndex: preStart + 4, normalizedMarkup, tagName: '/pre' })
  const codeStart = markupTagStartIndex({ fromIndex: preStart + 4, normalizedMarkup, tagName: 'code' })
  if (codeStart === -1) return false

  return preEnd === -1 || codeStart < preEnd
}

function shouldPasteHTMLCodeBlocksFromHTML(clipboardData: DataTransfer | null): boolean {
  if (!clipboardData) return false
  if (hasExplicitMarkdownPayload(clipboardData)) return false

  return hasPreCodeMarkup(clipboardWebMarkup(clipboardData))
}

function normalizedCodeBlockLanguageToken(language: string): string {
  const normalized = language.trim().split(/\s+/u)[0]?.toLowerCase() ?? ''
  return /^[a-z0-9][a-z0-9#+._-]*$/u.test(normalized) ? normalized : ''
}

function resolveCodeBlockLanguage(language: string): string {
  const normalized = normalizedCodeBlockLanguageToken(language)
  if (!normalized) return ''

  const supportedLanguages = createTolariaCodeBlockOptions().supportedLanguages ?? {}
  return Object.entries(supportedLanguages)
    .find(([id, option]) => id === normalized || option.aliases?.includes(normalized))
    ?.[0] ?? normalized
}

function codeFenceForSource(source: string): string {
  return source.includes('```') ? '~~~' : '```'
}

function markdownCodeBlockFromPasteBlock(block: PasteCodeBlock): string {
  const source = block.source.replace(/\n$/u, '')
  const fence = codeFenceForSource(source)
  return `${fence}${block.language}\n${source}\n${fence}`
}

function htmlCodeBlocks(clipboardData: DataTransfer | null): PasteCodeBlock[] {
  if (!shouldPasteHTMLCodeBlocksFromHTML(clipboardData)) return []
  const source = clipboardData?.getData('text/plain') ?? ''
  if (!source) return []

  return [{ language: '', source }]
}

function clipboardMarkdownSource(clipboardData: DataTransfer | null): string {
  if (!clipboardData) return ''
  if (hasBlockNoteClipboardPayload(clipboardData)) return ''

  return clipboardData.getData('text/markdown') || clipboardData.getData('text/plain')
}

function standaloneCodeFenceLines(markdown: string): string[] | null {
  return STANDALONE_CODE_FENCE_RE.test(markdown)
    ? markdown.trim().split(/\r?\n/u)
    : null
}

function openingCodeFence(line: string): { language: string; marker: string } | null {
  const opening = MARKDOWN_CODE_FENCE_OPEN_RE.exec(line)
  if (!opening) return null
  return {
    language: resolveCodeBlockLanguage(opening[2] ?? ''),
    marker: opening[1],
  }
}

function closesCodeFence(lines: string[], marker: string): boolean {
  const closing = lines.at(-1)?.trim() ?? ''
  return closing.startsWith(marker.charAt(0).repeat(marker.length))
}

function markdownCodeBlocks(clipboardData: DataTransfer | null): PasteCodeBlock[] {
  const lines = standaloneCodeFenceLines(clipboardMarkdownSource(clipboardData))
  if (!lines || lines.length < 2) return []

  const opening = openingCodeFence(lines[0] ?? '')
  if (!opening || !closesCodeFence(lines, opening.marker)) return []

  return [{
    language: opening.language,
    source: lines.slice(1, -1).join('\n'),
  }]
}

function codeBlockInsert(block: PasteCodeBlock): PasteCodeBlockInsert {
  return {
    children: [],
    content: [{
      styles: {},
      text: block.source.replace(/\n$/u, ''),
      type: 'text',
    }],
    props: { language: block.language || 'text' },
    type: 'codeBlock',
  }
}

function blockText(block: PasteBlock): string {
  const content = block.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content.map(item => (
    typeof item === 'object'
      && item !== null
      && 'text' in item
      && typeof item.text === 'string'
      ? item.text
      : ''
  )).join('')
}

function isEmptyParagraph(block: PasteBlock): boolean {
  return block.type === 'paragraph' && blockText(block).trim() === ''
}

function blockWithId(block: PasteBlock | null | undefined): PasteBlockWithId | null {
  return typeof block?.id === 'string' ? { ...block, id: block.id } : null
}

function insertCodeBlocks(editor: RichPasteEditor, blocks: PasteCodeBlock[]): boolean {
  if (blocks.length === 0 || !editor.insertBlocks || !editor.getTextCursorPosition) return false

  const cursorBlock = blockWithId(editor.getTextCursorPosition().block)
  if (!cursorBlock) return false

  const inserts = blocks.map(codeBlockInsert)
  if (editor.replaceBlocks && isEmptyParagraph(cursorBlock)) {
    editor.replaceBlocks([cursorBlock], inserts)
    return true
  }

  editor.insertBlocks(inserts, cursorBlock.id, 'after')
  return true
}

function codeBlocksAsMarkdown(blocks: PasteCodeBlock[]): string {
  return blocks.map(markdownCodeBlockFromPasteBlock).join('\n\n')
}

export function handleRichEditorPaste({
  defaultPasteHandler,
  editor,
  event,
}: RichEditorPasteContext): boolean | undefined {
  const codeBlocks = [...htmlCodeBlocks(event.clipboardData), ...markdownCodeBlocks(event.clipboardData)]
  if (insertCodeBlocks(editor, codeBlocks)) return true

  const codeBlockMarkdown = codeBlocksAsMarkdown(codeBlocks)
  if (codeBlockMarkdown && editor.pasteMarkdown) {
    editor.pasteMarkdown(codeBlockMarkdown)
    return true
  }

  if (shouldPasteHTMLImagesFromHTML(event.clipboardData)) {
    return defaultPasteHandler({ prioritizeMarkdownOverHTML: false })
  }

  const plainText = literalPlainText(event.clipboardData)
  if (plainText) return editor.pasteText(plainText)

  return defaultPasteHandler()
}

function replaceRichImageBlockUrls(
  blocks: PasteBlock[],
  replacements: ReadonlyMap<string, string>,
  updateBlock: NonNullable<RichPasteEditor['updateBlock']>,
  vaultPath: string,
): void {
  for (const block of blocks) {
    const url = block.type === 'image' ? block.props?.url : undefined
    if (typeof url === 'string' && typeof block.id === 'string') {
      const attachmentPath = replacements.get(url)
      if (attachmentPath) {
        updateBlock(block.id, {
          props: { url: vaultAttachmentAssetUrl({ attachmentPath, vaultPath }) },
        })
      }
    }
    if (block.children) {
      replaceRichImageBlockUrls(block.children, replacements, updateBlock, vaultPath)
    }
  }
}

function finishRichRemoteImageImport(
  context: RichEditorPasteContext,
  options: ActiveRichPasteHandlerOptions,
  result: RemoteImageImportResult,
  vaultPath: string,
): void {
  const target = richImageRewriteTarget(context, options)
  if (target) {
    replaceRichImageBlockUrls(
      target.blocks,
      result.replacements,
      target.updateBlock,
      vaultPath,
    )
  }
  options.onImportResult?.({
    failedCount: result.failedCount,
    totalCount: result.totalCount,
  })
  trackEvent('remote_images_paste_imported', {
    surface: 'rich_editor',
    total_count: result.totalCount,
    success_count: result.totalCount - result.failedCount,
    failure_count: result.failedCount,
  })
}

function richImageRewriteTarget(
  context: RichEditorPasteContext,
  options: ActiveRichPasteHandlerOptions,
): { blocks: PasteBlock[]; updateBlock: NonNullable<RichPasteEditor['updateBlock']> } | null {
  if (options.canApply?.() === false) return null
  const blocks = context.editor.document
  const updateBlock = context.editor.updateBlock?.bind(context.editor)
  if (!blocks || !updateBlock) return null
  return { blocks, updateBlock }
}

export function createRichEditorPasteHandler(
  options: RichPasteHandlerOptions,
): (context: RichEditorPasteContext) => boolean | undefined {
  return context => handleRemoteRichEditorPaste(context, {
    canApply: options.canApply,
    importImages: options.importImages,
    onImportResult: options.onImportResult,
    vaultPath: options.getVaultPath(),
  })
}

export function handleRemoteRichEditorPaste(
  context: RichEditorPasteContext,
  options: ActiveRichPasteHandlerOptions,
): boolean | undefined {
  const images = context.event.clipboardData
    ? clipboardRemoteImages(context.event.clipboardData)
    : []
  const handled = handleRichEditorPaste(context)
  if (images.length === 0 || !options.vaultPath) return handled

  const importImages = options.importImages ?? importRemoteImages
  const vaultPath = options.vaultPath
  void importImages({ images, vaultPath }).then(result => {
    finishRichRemoteImageImport(context, options, result, vaultPath)
  })
  return handled
}
