import {
  hasDurableMarkdownBlocks,
  injectDurableMarkdownBlocks,
  preProcessDurableMarkdownBlocks,
  serializeDurableMarkdownBlocks,
  type MarkdownSerializer,
} from './durableMarkdownBlocks'
import { serializeMathAwareBlocks } from './mathMarkdown'
import { mermaidMarkdownCodec } from './mermaidMarkdown'
import { tldrawMarkdownCodec } from './tldrawMarkdown'

const EDITOR_DURABLE_MARKDOWN_CODECS = [
  mermaidMarkdownCodec,
  tldrawMarkdownCodec,
] as const

export function preProcessDurableEditorMarkdown({ markdown }: { markdown: string }): string {
  return preProcessDurableMarkdownBlocks({
    markdown,
    codecs: EDITOR_DURABLE_MARKDOWN_CODECS,
  })
}

export function injectDurableEditorMarkdownBlocks(blocks: unknown[]): unknown[] {
  return injectDurableMarkdownBlocks({
    blocks,
    codecs: EDITOR_DURABLE_MARKDOWN_CODECS,
  })
}

export function serializeDurableEditorBlocks(editor: MarkdownSerializer, blocks: unknown[]): string {
  return serializeDurableMarkdownBlocks({
    blocks,
    codecs: EDITOR_DURABLE_MARKDOWN_CODECS,
    serializeOrdinaryBlocks: ordinaryBlocks => serializeMathAwareBlocks(editor, ordinaryBlocks),
  })
}

export function hasDurableEditorBlocks(blocks: unknown[]): boolean {
  return hasDurableMarkdownBlocks({
    blocks,
    codecs: EDITOR_DURABLE_MARKDOWN_CODECS,
  })
}
