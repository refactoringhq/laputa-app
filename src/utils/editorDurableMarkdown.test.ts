import { describe, expect, it, vi } from 'vitest'
import {
  injectDurableEditorMarkdownBlocks,
  preProcessDurableEditorMarkdown,
  serializeDurableEditorBlocks,
} from './editorDurableMarkdown'
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
})
