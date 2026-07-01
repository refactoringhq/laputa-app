import { selectedDocumentBlocks } from './richEditorBlockSelectionDocument'
import {
  documentBlock,
  type ClipboardDataLike,
  type RichEditorBlockSelectionEditor,
} from './richEditorBlockSelectionTypes'

export const TOLARIA_BLOCK_CLIPBOARD_MIME = 'application/x-tolaria-blocknote-blocks+json'

function blockWithoutId(block: unknown): unknown {
  const source = documentBlock(block)
  if (!source) return block

  const clone: Record<string, unknown> = {}
  Object.entries(source).forEach(([key, value]) => {
    if (key === 'id') return
    clone[key] = key === 'children' && Array.isArray(value)
      ? value.map(blockWithoutId)
      : value
  })
  return clone
}

export function blocksWithoutIds(blocks: readonly unknown[]): unknown[] {
  return blocks.map(blockWithoutId)
}

export function writeSelectedBlocksToClipboard(
  editor: RichEditorBlockSelectionEditor,
  clipboardData: ClipboardDataLike,
  selectedBlockIds: readonly string[],
): boolean {
  const blocks = selectedDocumentBlocks(editor.document, selectedBlockIds)
  if (blocks.length === 0) return false

  const fullHTML = editor.blocksToFullHTML?.(blocks) ?? ''
  const externalHTML = editor.blocksToHTMLLossy?.(blocks) ?? fullHTML
  const markdown = editor.blocksToMarkdownLossy?.(blocks) ?? ''

  clipboardData.clearData()
  clipboardData.setData(TOLARIA_BLOCK_CLIPBOARD_MIME, JSON.stringify(blocks))
  if (fullHTML) clipboardData.setData('blocknote/html', fullHTML)
  if (externalHTML) clipboardData.setData('text/html', externalHTML)
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

function parseHTMLClipboardBlocks(
  editor: RichEditorBlockSelectionEditor,
  clipboardData: ClipboardDataLike,
  mimeType: string,
): unknown[] {
  const html = clipboardData.getData(mimeType)
  return html ? editor.tryParseHTMLToBlocks?.(html) ?? [] : []
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
    () => parseHTMLClipboardBlocks(editor, clipboardData, 'blocknote/html'),
    () => parseHTMLClipboardBlocks(editor, clipboardData, 'text/html'),
    () => parseMarkdownClipboardBlocks(editor, clipboardData),
  ])
}
