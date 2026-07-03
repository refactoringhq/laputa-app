import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it, vi } from 'vitest'
import { schema } from '../components/editorSchema'
import {
  injectDurableEditorMarkdownBlocks,
  preProcessDurableEditorMarkdown,
  serializeDurableEditorBlocks,
} from './editorDurableMarkdown'
import { HTML_BLOCK_DEFAULT_HEIGHT, HTML_BLOCK_TYPE } from './htmlBlockMarkdown'
import { MERMAID_BLOCK_TYPE } from './mermaidMarkdown'
import { TLDRAW_BLOCK_TYPE } from './tldrawMarkdown'

describe('editor durable markdown blocks', () => {
  it('round-trips Mermaid and tldraw blocks through one durable pipeline', () => {
    const markdown = [
      'Intro',
      '',
      '```tldraw id="map" height="640" width="900"',
      '{ "store": {} }',
      '```',
      '',
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
    ].join('\n')
    const preprocessed = preProcessDurableEditorMarkdown({ markdown })
    const blocks = injectDurableEditorMarkdownBlocks([
      { type: 'paragraph', content: [{ type: 'text', text: 'Intro', styles: {} }], children: [] },
      { type: 'paragraph', content: [{ type: 'text', text: preprocessed.split('\n\n')[1], styles: {} }], children: [] },
      { type: 'paragraph', content: [{ type: 'text', text: preprocessed.split('\n\n')[2], styles: {} }], children: [] },
    ]) as Array<{ type: string; props?: Record<string, string>; content?: Array<{ text?: string }> }>

    expect(blocks.map(block => block.type)).toEqual(['paragraph', TLDRAW_BLOCK_TYPE, MERMAID_BLOCK_TYPE])
    expect(blocks[1].props).toMatchObject({ boardId: 'map', height: '640', snapshot: '{ "store": {} }', width: '900' })
    expect(blocks[2].props).toMatchObject({ diagram: 'flowchart LR\n  A --> B\n' })

    const editor = {
      blocksToMarkdownLossy: vi.fn((ordinaryBlocks: unknown[]) => {
        return (ordinaryBlocks as Array<{ content?: Array<{ text?: string }> }>)
          .map(block => block.content?.map(item => item.text ?? '').join('') ?? '')
          .join('\n\n')
      }),
    }

    expect(serializeDurableEditorBlocks(editor, blocks)).toBe(markdown)
  })

  it('round-trips fenced HTML blocks through the durable editor pipeline', () => {
    const markdown = [
      'Intro',
      '',
      '```html height="420"',
      '<section class="card">',
      '  <h2>Hello Tolaria</h2>',
      '  <details><summary>More</summary>Safe static content</details>',
      '</section>',
      '```',
    ].join('\n')
    const preprocessed = preProcessDurableEditorMarkdown({ markdown })
    const blocks = injectDurableEditorMarkdownBlocks([
      { type: 'paragraph', content: [{ type: 'text', text: 'Intro', styles: {} }], children: [] },
      { type: 'paragraph', content: [{ type: 'text', text: preprocessed.split('\n\n')[1], styles: {} }], children: [] },
    ]) as Array<{ type: string; props?: Record<string, string>; content?: Array<{ text?: string }> }>

    expect(blocks.map(block => block.type)).toEqual(['paragraph', HTML_BLOCK_TYPE])
    expect(blocks[1].props).toMatchObject({
      height: '420',
      html: [
        '<section class="card">',
        '  <h2>Hello Tolaria</h2>',
        '  <details><summary>More</summary>Safe static content</details>',
        '</section>',
        '',
      ].join('\n'),
    })

    const editor = {
      blocksToMarkdownLossy: vi.fn((ordinaryBlocks: unknown[]) => {
        return (ordinaryBlocks as Array<{ content?: Array<{ text?: string }> }>)
          .map(block => block.content?.map(item => item.text ?? '').join('') ?? '')
          .join('\n\n')
      }),
    }

    expect(serializeDurableEditorBlocks(editor, blocks)).toBe(markdown)
  })

  it('uses the default HTML block height for existing plain html fences', () => {
    const markdown = [
      '```html',
      '<button>Click me</button>',
      '```',
    ].join('\n')
    const preprocessed = preProcessDurableEditorMarkdown({ markdown })
    const [block] = injectDurableEditorMarkdownBlocks([
      { type: 'paragraph', content: [{ type: 'text', text: preprocessed, styles: {} }], children: [] },
    ]) as Array<{ type: string; props?: Record<string, string> }>

    expect(block).toMatchObject({
      type: HTML_BLOCK_TYPE,
      props: {
        height: HTML_BLOCK_DEFAULT_HEIGHT,
        html: '<button>Click me</button>\n',
      },
    })
  })

  it('restores Mermaid placeholders after Markdown-active diagram text passes through BlockNote', async () => {
    const editor = BlockNoteEditor.create({ schema })
    const markdown = [
      '```mermaid',
      'flowchart TB',
      '  a["events: run.* thread.* and field_value"] --> b["ok"]',
      '```',
    ].join('\n')

    const parsed = await editor.tryParseMarkdownToBlocks(
      preProcessDurableEditorMarkdown({ markdown }),
    )
    const [block] = injectDurableEditorMarkdownBlocks(parsed) as Array<{
      type: string
      props?: Record<string, string>
    }>

    expect(block).toMatchObject({
      type: MERMAID_BLOCK_TYPE,
      props: {
        source: markdown,
        diagram: 'flowchart TB\n  a["events: run.* thread.* and field_value"] --> b["ok"]\n',
      },
    })
  })
})
