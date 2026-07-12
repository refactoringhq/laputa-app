import { describe, expect, it, vi } from 'vitest'
import {
  installRichEditorMarkdownSerializer,
  serializeRichEditorBodyToMarkdown,
  type RichEditorMarkdownSerializer,
} from './richEditorMarkdown'

describe('rich-editor Markdown serialization', () => {
  it('installs direct serialization through the shared rich-editor API', () => {
    const blocksToMarkdownLossy = vi.fn(() => 'legacy markdown\n')
    const editor: RichEditorMarkdownSerializer = {
      document: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Keep [[Project Alpha]] fast.', styles: {} }],
        children: [],
      }],
      blocksToMarkdownLossy,
    }

    installRichEditorMarkdownSerializer(editor)

    expect(serializeRichEditorBodyToMarkdown(editor)).toBe('Keep [[Project Alpha]] fast.\n')
    expect(blocksToMarkdownLossy).not.toHaveBeenCalled()
  })
})
