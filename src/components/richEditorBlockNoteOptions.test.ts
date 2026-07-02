import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { schema } from './editorSchema'
import {
  RICH_EDITOR_BLOCKNOTE_PERFORMANCE_OPTIONS,
  RICH_EDITOR_DISABLED_BLOCKNOTE_EXTENSIONS,
} from './richEditorBlockNoteOptions'

type TiptapExtension = {
  name: string
}

describe('rich editor BlockNote performance options', () => {
  it('does not install BlockNote previous-block animation tracking', () => {
    expect(RICH_EDITOR_BLOCKNOTE_PERFORMANCE_OPTIONS.animations).toBe(false)
    expect(RICH_EDITOR_BLOCKNOTE_PERFORMANCE_OPTIONS.disableExtensions).toEqual(
      [...RICH_EDITOR_DISABLED_BLOCKNOTE_EXTENSIONS],
    )

    const editor = BlockNoteEditor.create({
      ...RICH_EDITOR_BLOCKNOTE_PERFORMANCE_OPTIONS,
      schema,
    })

    try {
      const blockNoteExtensions = Array.from(editor.extensions.keys())
      const tiptapExtensions = editor._tiptapEditor.extensionManager.extensions as TiptapExtension[]

      expect(blockNoteExtensions).not.toContain('previousBlockType')
      expect(tiptapExtensions.some((extension) => extension.name === 'previousBlockType')).toBe(false)
    } finally {
      editor._tiptapEditor.destroy()
    }
  })
})
