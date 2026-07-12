import { compactMarkdown } from './compact-markdown'
import {
  hasDurableEditorBlocks,
  injectDurableEditorMarkdownBlocks,
  preProcessDurableEditorMarkdown,
  serializeDurableEditorBlocks,
} from './editorDurableMarkdown'
import { portableFileAttachmentUrls } from './fileAttachmentMarkdown'
import { logRichEditorSerializationTrace } from './editorPerformanceTrace'
import { injectMarkdownHighlightsInBlocks } from './markdownHighlightMarkdown'
import { injectMathInBlocks, preProcessMathMarkdown } from './mathMarkdown'
import { preProcessSingleTildeStrikethrough } from './markdownStrikethrough'
import { normalizeBareImageUrls, portableImageUrls, resolveImageUrls } from './vaultImages'
import { injectWikilinks, preProcessWikilinks, restoreWikilinksInBlocks, splitFrontmatter } from './wikilinks'
import type {
  BlockNoteDirectMarkdownMetrics,
  DirectMarkdownCapableSerializer,
} from './blockNoteDirectMarkdown'
import { installBlockNoteDirectMarkdown } from './blockNoteDirectMarkdown'

type EditorBlocksSnapshot = unknown[]
type MarkdownBody = string
type NotePath = string
type PreprocessedMarkdown = string
type VaultPath = string

export interface RichEditorMarkdownSerializer extends DirectMarkdownCapableSerializer {
  document: EditorBlocksSnapshot
}

interface RichEditorDocumentSerializationOptions {
  blocks?: EditorBlocksSnapshot
  editor: RichEditorMarkdownSerializer
  notePath?: string
  tabContent: string
  vaultPath?: string
}

interface RichEditorBlockSerializationOptions {
  blocks: EditorBlocksSnapshot
  editor: DirectMarkdownCapableSerializer
  notePath?: string
  vaultPath?: string
}

const EMPTY_CHECKLIST_ITEM_FILLER = '\u200B'
const EMPTY_CHECKLIST_ITEM_LINE_RE = /^([ \t]*[-*+][ \t]+\[[ xX]\])[ \t]*$/u

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

function readDirectMarkdownMetrics(
  editor: DirectMarkdownCapableSerializer,
): BlockNoteDirectMarkdownMetrics | undefined {
  return editor.__tolariaLastDirectMarkdownMetrics
}

export function installRichEditorMarkdownSerializer(editor: unknown): void {
  if (!isDirectMarkdownCapableSerializer(editor)) return
  installBlockNoteDirectMarkdown(editor)
}

function isDirectMarkdownCapableSerializer(editor: unknown): editor is DirectMarkdownCapableSerializer {
  return typeof editor === 'object'
    && editor !== null
    && 'blocksToMarkdownLossy' in editor
    && typeof editor.blocksToMarkdownLossy === 'function'
}

export function preProcessRichEditorMarkdown(
  markdown: MarkdownBody,
  vaultPath?: VaultPath,
  notePath?: NotePath,
): PreprocessedMarkdown {
  const withDurableBlocks = preProcessDurableEditorMarkdown({ markdown })
  const withEmptyChecklists = preProcessEmptyChecklistItems(withDurableBlocks)
  const withBareImages = normalizeBareImageUrls(withEmptyChecklists)
  const withImages = vaultPath ? resolveImageUrls(withBareImages, vaultPath, notePath) : withBareImages
  const withWikilinks = preProcessWikilinks(withImages)
  const withMath = preProcessMathMarkdown({ markdown: withWikilinks })
  return preProcessSingleTildeStrikethrough({ markdown: withMath })
}

export function injectRichEditorMarkdownBlocks(blocks: EditorBlocksSnapshot): EditorBlocksSnapshot {
  const withWikilinks = injectWikilinks(blocks)
  const withMath = injectMathInBlocks(withWikilinks)
  const withHighlights = injectMarkdownHighlightsInBlocks(withMath)
  return injectDurableEditorMarkdownBlocks(withHighlights)
}

export function hasRichEditorDurableBlocks(blocks: EditorBlocksSnapshot): boolean {
  return hasDurableEditorBlocks(blocks)
}

export function serializeRichEditorBodyToMarkdown(
  editor: RichEditorMarkdownSerializer,
  vaultPath?: string,
): string {
  return serializeRichEditorBlocksToMarkdown({ blocks: editor.document, editor, vaultPath })
}

export function serializeRichEditorBlocksToMarkdown({
  blocks,
  editor,
  notePath,
  vaultPath,
}: RichEditorBlockSerializationOptions): string {
  return serializeRichEditorBodyToMarkdownWithTrace(editor, vaultPath, notePath, blocks)
}

function serializeRichEditorBodyToMarkdownWithTrace(
  editor: DirectMarkdownCapableSerializer,
  vaultPath?: string,
  notePath?: string,
  blocks: EditorBlocksSnapshot = [],
): string {
  const startedAt = now()
  const directEditor = editor as DirectMarkdownCapableSerializer
  delete directEditor.__tolariaLastDirectMarkdownMetrics
  const document = blocks
  const restored = restoreWikilinksInBlocks(document)
  const body = compactMarkdown(serializeDurableEditorBlocks(editor, restored, vaultPath))
  const metrics = readDirectMarkdownMetrics(directEditor)
  logRichEditorSerializationTrace({
    blockCount: metrics?.blockCount ?? document.length,
    cacheHits: metrics?.cacheHits,
    cacheMisses: metrics?.cacheMisses,
    durationMs: now() - startedAt,
    fallbackReason: metrics?.fallbackReason,
    notePath,
  })
  return body
}

function preProcessEmptyChecklistItems(markdown: MarkdownBody): MarkdownBody {
  return markdown.split(/(\r?\n)/u).map(part => {
    if (part === '\n' || part === '\r\n') return part
    return preProcessEmptyChecklistLine(part)
  }).join('')
}

function preProcessEmptyChecklistLine(line: MarkdownBody): MarkdownBody {
  const match = EMPTY_CHECKLIST_ITEM_LINE_RE.exec(line)
  return match ? `${match[1]} ${EMPTY_CHECKLIST_ITEM_FILLER}` : line
}

export function serializeRichEditorDocumentToMarkdown({
  blocks,
  editor,
  notePath,
  tabContent,
  vaultPath,
}: RichEditorDocumentSerializationOptions): string {
  const rawBodyMarkdown = serializeRichEditorBlocksToMarkdown({
    blocks: blocks ?? editor.document,
    editor,
    notePath,
    vaultPath,
  })
  const bodyMarkdown = vaultPath
    ? portableFileAttachmentUrls(
      portableImageUrls(rawBodyMarkdown, vaultPath, notePath),
      vaultPath,
    )
    : rawBodyMarkdown
  const [frontmatter] = splitFrontmatter(tabContent)
  return `${frontmatter}${bodyMarkdown}`
}
