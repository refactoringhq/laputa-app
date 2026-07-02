import type { useCreateBlockNote } from '@blocknote/react'
import { compactMarkdown } from './compact-markdown'
import { serializeDurableEditorBlocks } from './editorDurableMarkdown'
import { portableFileAttachmentUrls } from './fileAttachmentMarkdown'
import { logRichEditorSerializationTrace } from './editorPerformanceTrace'
import { portableImageUrls } from './vaultImages'
import { restoreWikilinksInBlocks, splitFrontmatter } from './wikilinks'
import type {
  BlockNoteDirectMarkdownMetrics,
  DirectMarkdownCapableSerializer,
} from './blockNoteDirectMarkdown'

type EditorBlocksSnapshot = unknown[]

interface RichEditorDocumentSerializationOptions {
  blocks?: EditorBlocksSnapshot
  editor: ReturnType<typeof useCreateBlockNote>
  notePath?: string
  tabContent: string
  vaultPath?: string
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

function readDirectMarkdownMetrics(
  editor: DirectMarkdownCapableSerializer,
): BlockNoteDirectMarkdownMetrics | undefined {
  return editor.__tolariaLastDirectMarkdownMetrics
}

export function serializeRichEditorBodyToMarkdown(
  editor: ReturnType<typeof useCreateBlockNote>,
  vaultPath?: string,
): string {
  return serializeRichEditorBodyToMarkdownWithTrace(editor, vaultPath)
}

function serializeRichEditorBodyToMarkdownWithTrace(
  editor: ReturnType<typeof useCreateBlockNote>,
  vaultPath?: string,
  notePath?: string,
  blocks?: EditorBlocksSnapshot,
): string {
  const startedAt = now()
  const directEditor = editor as DirectMarkdownCapableSerializer
  delete directEditor.__tolariaLastDirectMarkdownMetrics
  const document = blocks ?? editor.document
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

export function serializeRichEditorDocumentToMarkdown({
  blocks,
  editor,
  notePath,
  tabContent,
  vaultPath,
}: RichEditorDocumentSerializationOptions): string {
  const rawBodyMarkdown = serializeRichEditorBodyToMarkdownWithTrace(editor, vaultPath, notePath, blocks)
  const bodyMarkdown = vaultPath
    ? portableFileAttachmentUrls(
      portableImageUrls(rawBodyMarkdown, vaultPath, notePath),
      vaultPath,
    )
    : rawBodyMarkdown
  const [frontmatter] = splitFrontmatter(tabContent)
  return `${frontmatter}${bodyMarkdown}`
}
