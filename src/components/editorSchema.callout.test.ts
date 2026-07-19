import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { injectCalloutBlocks } from '../utils/calloutMarkdown'
import { serializeDurableEditorBlocks } from '../utils/editorDurableMarkdown'
import {
  injectRichEditorMarkdownBlocks,
  preProcessRichEditorMarkdown,
  serializeRichEditorBlocksToMarkdown,
} from '../utils/richEditorMarkdown'
import { schema } from './editorSchema'

async function roundTrip(markdown: string): Promise<string> {
  const editor = BlockNoteEditor.create({ schema })
  const parsed = await editor.tryParseMarkdownToBlocks(markdown)
  const injected = injectCalloutBlocks(parsed)
  editor.replaceBlocks(editor.document, injected as Parameters<typeof editor.replaceBlocks>[1])
  return serializeDurableEditorBlocks(editor, editor.document).trim()
}

describe('editor callout schema', () => {
  it('hydrates marker blockquotes as editable inline callouts', async () => {
    const editor = BlockNoteEditor.create({ schema })
    const parsed = await editor.tryParseMarkdownToBlocks([
      '> [!TIP] Read this',
      '> **bold** and [docs](https://example.com)',
    ].join('\n'))
    const [callout] = injectCalloutBlocks(parsed)

    expect(callout).toMatchObject({
      type: 'calloutBlock',
      props: { calloutType: 'tip', title: 'Read this' },
    })
    expect(JSON.stringify(callout)).toContain('bold')
    expect(JSON.stringify(callout)).toContain('https://example.com')
  })

  it('round-trips rich callout bodies and fold markers', async () => {
    const markdown = [
      '> [!example]- Resources',
      '> **bold** and [docs](https://example.com)',
    ].join('\n')

    expect(await roundTrip(markdown)).toBe(markdown)
  })

  it('leaves ordinary blockquotes unchanged', async () => {
    const editor = BlockNoteEditor.create({ schema })
    const parsed = await editor.tryParseMarkdownToBlocks('> ordinary quote')
    expect(injectCalloutBlocks(parsed).at(0)).toMatchObject({ type: 'quote' })
  })

  it('round-trips durable inline syntax inside callout bodies', async () => {
    const markdown = [
      '> [!note] Durable inline content',
      '> ==highlight==, $x+1$, and [[Target]]',
    ].join('\n')
    const editor = BlockNoteEditor.create({ schema })
    const preprocessed = preProcessRichEditorMarkdown(markdown)
    const parsed = await editor.tryParseMarkdownToBlocks(preprocessed)
    const injected = injectRichEditorMarkdownBlocks(parsed)
    editor.replaceBlocks(editor.document, injected as Parameters<typeof editor.replaceBlocks>[1])

    expect(serializeRichEditorBlocksToMarkdown({
      blocks: editor.document,
      editor,
    })).toBe(`${markdown}\n`)
  })
})
