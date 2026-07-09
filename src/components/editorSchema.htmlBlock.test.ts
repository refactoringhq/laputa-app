import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { HTML_BLOCK_DEFAULT_HEIGHT, HTML_BLOCK_TYPE } from '../utils/htmlBlockMarkdown'
import { schema } from './editorSchema'

describe('editor schema HTML block parsing', () => {
  it('parses fenced HTML Markdown as a sandboxed HTML block', async () => {
    const editor = BlockNoteEditor.create({ schema })

    const blocks = await editor.tryParseMarkdownToBlocks([
      '```html',
      '<button>Click me</button>',
      '```',
    ].join('\n'))

    expect(blocks[0]).toMatchObject({
      type: HTML_BLOCK_TYPE,
      props: {
        height: HTML_BLOCK_DEFAULT_HEIGHT,
        html: '<button>Click me</button>\n',
        scripts: 'blocked',
      },
    })
  })
})
