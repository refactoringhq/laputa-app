import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import {
  injectMarkdownHighlightsInBlocks,
  MARKDOWN_HIGHLIGHT_STYLE,
  restoreMarkdownHighlightsInBlocks,
} from '../utils/markdownHighlightMarkdown'
import { schema } from './editorSchema'

describe('editor schema Markdown highlight parsing', () => {
  it('round-trips ==highlight== markers as a rich-editor style', async () => {
    const editor = BlockNoteEditor.create({ schema })
    const blocks = injectMarkdownHighlightsInBlocks(
      await editor.tryParseMarkdownToBlocks('Plain ==marked== text'),
    ) as Array<{ content?: Array<{ styles?: Record<string, unknown>; text?: string }> }>

    expect(blocks[0].content).toEqual([
      { type: 'text', text: 'Plain ', styles: {} },
      { type: 'text', text: 'marked', styles: { [MARKDOWN_HIGHLIGHT_STYLE]: true } },
      { type: 'text', text: ' text', styles: {} },
    ])
    expect(editor.blocksToMarkdownLossy(restoreMarkdownHighlightsInBlocks(blocks))).toContain(
      'Plain ==marked== text',
    )
  })

  it('keeps equality operators literal inside fenced code blocks', async () => {
    const editor = BlockNoteEditor.create({ schema })
    const markdown = [
      '```python',
      'if a == "1" and b == "2":',
      '```',
    ].join('\n')
    const blocks = injectMarkdownHighlightsInBlocks(await editor.tryParseMarkdownToBlocks(markdown))

    expect(editor.blocksToMarkdownLossy(restoreMarkdownHighlightsInBlocks(blocks))).toContain(
      'if a == "1" and b == "2":',
    )
  })

  it('round-trips Bear-style colored highlights through the default background color style', async () => {
    const editor = BlockNoteEditor.create({ schema })
    const markdown = '==🔴red== ==🔵blue== ==🟣purple== ==🟢green== ==yellow=='
    const blocks = injectMarkdownHighlightsInBlocks(
      await editor.tryParseMarkdownToBlocks(markdown),
    ) as Array<{ content?: Array<{ styles?: Record<string, unknown>; text?: string }> }>

    expect(blocks[0].content).toEqual([
      { type: 'text', text: 'red', styles: { highlight: true, backgroundColor: 'red' } },
      { type: 'text', text: ' ', styles: {} },
      { type: 'text', text: 'blue', styles: { highlight: true, backgroundColor: 'blue' } },
      { type: 'text', text: ' ', styles: {} },
      { type: 'text', text: 'purple', styles: { highlight: true, backgroundColor: 'purple' } },
      { type: 'text', text: ' ', styles: {} },
      { type: 'text', text: 'green', styles: { highlight: true, backgroundColor: 'green' } },
      { type: 'text', text: ' ', styles: {} },
      { type: 'text', text: 'yellow', styles: { highlight: true } },
    ])
    expect(editor.blocksToMarkdownLossy(restoreMarkdownHighlightsInBlocks(blocks))).toContain(markdown)
  })
})
