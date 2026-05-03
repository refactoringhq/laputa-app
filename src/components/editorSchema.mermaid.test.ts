import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { MERMAID_BLOCK_TYPE } from '../utils/mermaidMarkdown'
import { schema } from './editorSchema'

describe('editor schema Mermaid parsing', () => {
  it('parses fenced Mermaid Markdown as a rendered Mermaid block', async () => {
    const editor = BlockNoteEditor.create({ schema })

    const blocks = await editor.tryParseMarkdownToBlocks([
      '```mermaid',
      'graph TD',
      'A --> B',
      '```',
    ].join('\n'))

    expect(blocks[0]).toMatchObject({
      type: MERMAID_BLOCK_TYPE,
      props: {
        diagram: 'graph TD\nA --> B\n',
        source: '```mermaid\ngraph TD\nA --> B\n```',
      },
    })
  })
})
