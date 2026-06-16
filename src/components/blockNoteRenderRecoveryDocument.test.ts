import { describe, expect, it, vi } from 'vitest'
import { repairEditorDocumentForRenderRecovery } from './blockNoteRenderRecoveryDocument'
import type { BlockNoteRenderRecoveryReason } from './blockNoteRenderRecovery'

function block(id: string, type = 'paragraph', children: unknown[] = []) {
  return {
    id,
    type,
    content: [{ type: 'text', text: id, styles: {} }],
    children,
  }
}

function createEditor(document: unknown[]) {
  return {
    document,
    replaceBlocks: vi.fn(),
    blocksToHTMLLossy: vi.fn(() => '<p>Recovered</p>'),
    _tiptapEditor: {
      commands: {
        setContent: vi.fn(),
      },
    },
  }
}

function repair(editor: ReturnType<typeof createEditor>, reason: BlockNoteRenderRecoveryReason) {
  repairEditorDocumentForRenderRecovery(editor, reason)
}

describe('repairEditorDocumentForRenderRecovery', () => {
  it('rebuilds valid block trees with fresh ids after stale BlockNote render references', () => {
    const current = [
      block('heading-block', 'heading'),
      block('list-parent', 'bulletListItem', [block('list-child')]),
    ]
    const editor = createEditor(current)

    repair(editor, 'stale_block_reference')

    const nextBlocks = editor.replaceBlocks.mock.calls[0]?.[1] as typeof current
    expect(editor.replaceBlocks).toHaveBeenCalledWith(current, expect.any(Array))
    expect(nextBlocks).toHaveLength(2)
    expect(nextBlocks[0]).toMatchObject({ type: 'heading', content: current[0].content })
    expect(nextBlocks[1]).toMatchObject({
      type: 'bulletListItem',
      children: [expect.objectContaining({ type: 'paragraph' })],
    })
    expect(nextBlocks[0].id).not.toBe('heading-block')
    expect(nextBlocks[1].id).not.toBe('list-parent')
    expect(nextBlocks[1].children[0].id).not.toBe('list-child')
  })

  it('leaves already-valid documents alone for non-stale render recovery reasons', () => {
    const editor = createEditor([block('heading-block', 'heading')])

    repair(editor, 'block_type_mismatch')

    expect(editor.replaceBlocks).not.toHaveBeenCalled()
  })

  it('falls back to replacing the ProseMirror markup when BlockNote block replacement fails', () => {
    const current = [block('stale-block')]
    const editor = createEditor(current)
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    editor.replaceBlocks.mockImplementation(() => {
      throw new Error('Block with ID stale-block not found')
    })

    try {
      repair(editor, 'stale_block_reference')

      expect(editor.blocksToHTMLLossy).toHaveBeenCalledWith(expect.any(Array))
      expect(editor._tiptapEditor.commands.setContent).toHaveBeenCalledWith('<p>Recovered</p>')
    } finally {
      consoleWarn.mockRestore()
    }
  })
})
