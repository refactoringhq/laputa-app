import {
  hasDurableMarkdownBlocks,
  injectDurableMarkdownBlocks,
  preProcessDurableMarkdownBlocks,
  serializeDurableMarkdownBlocks,
  type MarkdownSerializer,
} from './durableMarkdownBlocks'
import {
  hasFileAttachmentBlocks,
  injectFileAttachmentBlocks,
  preProcessFileAttachmentMarkdown,
  serializeFileAttachmentBlocks,
} from './fileAttachmentMarkdown'
import { restoreMarkdownHighlightsInBlocks } from './markdownHighlightMarkdown'
import { serializeMathAwareBlocks } from './mathMarkdown'
import { htmlBlockMarkdownCodec } from './htmlBlockMarkdown'
import { mermaidMarkdownCodec } from './mermaidMarkdown'
import { tldrawMarkdownCodec } from './tldrawMarkdown'

const EDITOR_DURABLE_MARKDOWN_CODECS = [
  htmlBlockMarkdownCodec,
  mermaidMarkdownCodec,
  tldrawMarkdownCodec,
] as const

export function preProcessDurableEditorMarkdown({ markdown }: { markdown: string }): string {
  const withDurableBlocks = preProcessDurableMarkdownBlocks({
    markdown,
    codecs: EDITOR_DURABLE_MARKDOWN_CODECS,
  })
  return preProcessFileAttachmentMarkdown({ markdown: withDurableBlocks })
}

export function injectDurableEditorMarkdownBlocks(blocks: unknown[]): unknown[] {
  const withDurableBlocks = injectDurableMarkdownBlocks({
    blocks,
    codecs: EDITOR_DURABLE_MARKDOWN_CODECS,
  })
  return injectFileAttachmentBlocks(withDurableBlocks)
}

export function serializeDurableEditorBlocks(
  editor: MarkdownSerializer,
  blocks: unknown[],
  vaultPath?: string,
): string {
  return serializeFileAttachmentBlocks({
    blocks,
    vaultPath,
    serializeOrdinaryBlocks: ordinaryBlocks => serializeDurableMarkdownBlocks({
      blocks: ordinaryBlocks,
      codecs: EDITOR_DURABLE_MARKDOWN_CODECS,
      serializeOrdinaryBlocks: durableOrdinaryBlocks => serializeMathAwareBlocks(
        editor,
        restoreMarkdownHighlightsInBlocks(durableOrdinaryBlocks),
      ),
    }),
  })
}

export function hasDurableEditorBlocks(blocks: unknown[]): boolean {
  return hasFileAttachmentBlocks(blocks) || hasDurableMarkdownBlocks({
    blocks,
    codecs: EDITOR_DURABLE_MARKDOWN_CODECS,
  })
}
