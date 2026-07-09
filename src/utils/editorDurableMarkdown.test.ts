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
      scripts: 'blocked',
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
        scripts: 'blocked',
      },
    })
  })

  it('round-trips sandboxed-script HTML fences through the durable editor pipeline', () => {
    const markdown = [
      '```html height="420" scripts="sandboxed"',
      '<div id="app"></div>',
      '<script>document.getElementById("app").textContent = "Ready"</script>',
      '```',
    ].join('\n')
    const preprocessed = preProcessDurableEditorMarkdown({ markdown })
    const [block] = injectDurableEditorMarkdownBlocks([
      { type: 'paragraph', content: [{ type: 'text', text: preprocessed, styles: {} }], children: [] },
    ]) as Array<{ type: string; props?: Record<string, string> }>

    expect(block).toMatchObject({
      type: HTML_BLOCK_TYPE,
      props: {
        height: '420',
        html: '<div id="app"></div>\n<script>document.getElementById("app").textContent = "Ready"</script>\n',
        scripts: 'sandboxed',
      },
    })

    const editor = {
      blocksToMarkdownLossy: vi.fn(() => ''),
    }

    expect(serializeDurableEditorBlocks(editor, [block])).toBe(markdown)
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

  it('restores HTML placeholders after Markdown-active token text passes through BlockNote', async () => {
    const editor = BlockNoteEditor.create({ schema })
    const markdown = [
      '```html height="920"',
      '<style>',
      '  .card { display: grid; gap: 8px; }',
      '</style>',
      '<main class="card">',
      '  <h1>{{default([[acceleration-whiplash]].title, "Acceleration whiplash")}}</h1>',
      '</main>',
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
      type: HTML_BLOCK_TYPE,
      props: {
        height: '920',
        html: [
          '<style>',
          '  .card { display: grid; gap: 8px; }',
          '</style>',
          '<main class="card">',
          '  <h1>{{default([[acceleration-whiplash]].title, "Acceleration whiplash")}}</h1>',
          '</main>',
          '',
        ].join('\n'),
        scripts: 'blocked',
      },
    })
  })
})
