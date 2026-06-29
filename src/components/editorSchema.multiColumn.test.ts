import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { schema } from './editorSchema'

describe('editor schema multi-column support', () => {
  it('creates native BlockNote column list blocks', () => {
    const editor = BlockNoteEditor.create({
      schema,
      initialContent: [{
        type: 'columnList',
        children: [
          {
            type: 'column',
            children: [{ type: 'paragraph', content: 'Left' }],
          },
          {
            type: 'column',
            children: [{ type: 'paragraph', content: 'Right' }],
          },
        ],
      }],
    })

    expect(editor.document[0]).toMatchObject({
      type: 'columnList',
      children: [
        {
          type: 'column',
          children: [expect.objectContaining({ type: 'paragraph' })],
        },
        {
          type: 'column',
          children: [expect.objectContaining({ type: 'paragraph' })],
        },
      ],
    })
  })
})
