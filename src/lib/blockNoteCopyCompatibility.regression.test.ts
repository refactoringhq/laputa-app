import { BlockNoteEditor } from '@blocknote/core'
import { afterEach, describe, expect, it } from 'vitest'

const arrayToReversedDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'toReversed')

function removeArrayToReversed() {
  Object.defineProperty(Array.prototype, 'toReversed', {
    configurable: true,
    writable: true,
    value: undefined,
  })
}

function restoreArrayToReversed() {
  if (arrayToReversedDescriptor) {
    Object.defineProperty(Array.prototype, 'toReversed', arrayToReversedDescriptor)
    return
  }

  delete Array.prototype.toReversed
}

afterEach(() => {
  restoreArrayToReversed()
})

describe('patched BlockNote rich text copy compatibility', () => {
  it('serializes marked rich text without Array.prototype.toReversed', () => {
    removeArrayToReversed()

    const editor = BlockNoteEditor.create({
      initialContent: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Copied rich text',
              styles: { bold: true, italic: true },
            },
          ],
        },
      ],
    })

    try {
      const html = editor.blocksToHTMLLossy(editor.document)
      const fullHtml = editor.blocksToFullHTML(editor.document)
      const markdown = editor.blocksToMarkdownLossy(editor.document)

      expect(html).toContain('Copied rich text')
      expect(fullHtml).toContain('Copied rich text')
      expect(markdown).toContain('Copied rich text')
    } finally {
      editor._tiptapEditor.destroy()
    }
  })
})
