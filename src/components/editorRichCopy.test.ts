import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { richEditorClipboardPayload } from './editorRichCopy'

function createMountedEditor() {
  const mount = globalThis.document.createElement('div')
  globalThis.document.body.appendChild(mount)
  const editor = BlockNoteEditor.create({
    initialContent: [
      {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [
            { cells: ['Name', 'Status'] },
            { cells: ['Copy', 'Rich'] },
          ],
        },
      },
      {
        type: 'bulletListItem',
        content: [
          {
            type: 'text',
            text: 'Bold bullet',
            styles: { bold: true },
          },
        ],
      },
    ],
  })
  editor.mount(mount)

  return {
    editor,
    cleanup: () => {
      editor.unmount()
      mount.remove()
    },
  }
}

describe('richEditorClipboardPayload', () => {
  it('preserves semantic table and list markup from a mounted BlockNote selection', () => {
    const { cleanup, editor } = createMountedEditor()

    try {
      editor._tiptapEditor.commands.selectAll()

      const payload = richEditorClipboardPayload(editor)

      expect(payload?.html).toContain('<table>')
      expect(payload?.html).toContain('<tr>')
      expect(payload?.html).toContain('<td ')
      expect(payload?.html).toContain('<ul>')
      expect(payload?.html).toContain('<li>')
      expect(payload?.html).toContain('<strong>Bold bullet</strong>')
      expect(payload?.blocknoteHtml).toContain('data-content-type="bulletListItem"')
    } finally {
      cleanup()
    }
  })

  it('skips empty selections so callers can fall back to DOM cloning', () => {
    const { cleanup, editor } = createMountedEditor()

    try {
      expect(richEditorClipboardPayload(editor)).toBeNull()
    } finally {
      cleanup()
    }
  })
})
