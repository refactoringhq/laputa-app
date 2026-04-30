import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { schema } from '../components/editorSchema'

type TiptapExtension = {
  name: string
  options?: {
    openOnClick?: unknown
  }
}

function findLinkExtension(editor: BlockNoteEditor<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>) {
  const extensions = editor._tiptapEditor.extensionManager.extensions as TiptapExtension[]
  return extensions.find((extension) => extension.name === 'link')
}

describe('patched BlockNote link click handling', () => {
  it('disables Tiptap direct window.open handling for editor links', () => {
    const editor = BlockNoteEditor.create({ schema })
    const linkExtension = findLinkExtension(editor)

    expect(linkExtension?.options?.openOnClick).toBe(false)

    editor._tiptapEditor.destroy()
  })
})
