import DOMPurify from 'dompurify'
import { selectedDocumentBlocks } from './richEditorBlockSelectionDocument'
import {
  documentBlock,
  type ClipboardDataLike,
  type RichEditorBlockSelectionEditor,
} from './richEditorBlockSelectionTypes'

export const TOLARIA_BLOCK_CLIPBOARD_MIME = 'application/x-tolaria-blocknote-blocks+json'

function sanitizeMarkup(markup: string): string {
  return DOMPurify.sanitize(markup)
}

function blockWithoutId(block: unknown): unknown {
  const source = documentBlock(block)
  if (!source) return block

  const clone: Record<string, unknown> = {}
  Object.entries(source).forEach(([key, value]) => {
    if (key === 'id') return
    Reflect.set(clone, key, key === 'children' && Array.isArray(value)
      ? value.map(blockWithoutId)
      : value)
  })
  return clone
}

export function blocksWithoutIds(blocks: readonly unknown[]): unknown[] {
  return blocks.map(blockWithoutId)
}

function blocksToMarkdown(editor: RichEditorBlockSelectionEditor, blocks: unknown[]): string {
  return editor.blocksToMarkdownLossy?.(blocks) ?? ''
}

export function writeSelectedBlocksToClipboard(
  editor: RichEditorBlockSelectionEditor,
  clipboardData: ClipboardDataLike,
  selectedBlockIds: readonly string[],
): boolean {
  const blocks = selectedDocumentBlocks(editor.document, selectedBlockIds)
  if (blocks.length === 0) return false

  const fullMarkup = editor.blocksToFullHTML
    ? sanitizeMarkup(editor.blocksToFullHTML(blocks))
    : ''
  const externalMarkup = editor.blocksToHTMLLossy
    ? sanitizeMarkup(editor.blocksToHTMLLossy(blocks))
    : fullMarkup
  const markdown = blocksToMarkdown(editor, blocks)

  clipboardData.clearData()
  clipboardData.setData(TOLARIA_BLOCK_CLIPBOARD_MIME, JSON.stringify(blocks))
  if (fullMarkup) clipboardData.setData('blocknote/html', fullMarkup)
  if (externalMarkup) clipboardData.setData('text/html', externalMarkup)
  if (markdown) {
    clipboardData.setData('text/markdown', markdown)
    clipboardData.setData('text/plain', markdown)
  }
  return true
}

function parseTolariaClipboardBlocks(clipboardData: ClipboardDataLike): unknown[] {
  const serialized = clipboardData.getData(TOLARIA_BLOCK_CLIPBOARD_MIME)
  if (!serialized) return []

  try {
    const parsed = JSON.parse(serialized)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function emptyParsedBlocks(): unknown[] {
  return []
}

function parseHtmlBlocks(editor: RichEditorBlockSelectionEditor, markup: string): unknown[] {
  const { tryParseHTMLToBlocks = emptyParsedBlocks } = editor
  return tryParseHTMLToBlocks.call(editor, markup)
}

function parseMarkupClipboardBlocks(
  editor: RichEditorBlockSelectionEditor,
  clipboardData: ClipboardDataLike,
  mimeType: string,
): unknown[] {
  const markup = sanitizeMarkup(clipboardData.getData(mimeType))
  if (!markup) return []
  return parseHtmlBlocks(editor, markup)
}

function parseMarkdownClipboardBlocks(
  editor: RichEditorBlockSelectionEditor,
  clipboardData: ClipboardDataLike,
): unknown[] {
  const markdown = clipboardData.getData('text/markdown') || clipboardData.getData('text/plain')
  return markdown ? editor.tryParseMarkdownToBlocks?.(markdown) ?? [] : []
}

function firstParsedClipboardBlocks(parsers: readonly (() => unknown[])[]): unknown[] {
  for (const parse of parsers) {
    const blocks = parse()
    if (blocks.length > 0) return blocks
  }

  return []
}

export function parseClipboardBlocks(
  editor: RichEditorBlockSelectionEditor,
  clipboardData: ClipboardDataLike,
): unknown[] {
  return firstParsedClipboardBlocks([
    () => parseTolariaClipboardBlocks(clipboardData),
    () => parseMarkupClipboardBlocks(editor, clipboardData, 'blocknote/html'),
    () => parseMarkupClipboardBlocks(editor, clipboardData, 'text/html'),
    () => parseMarkdownClipboardBlocks(editor, clipboardData),
  ])
}
