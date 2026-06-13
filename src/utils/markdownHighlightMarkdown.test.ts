import { describe, expect, it, vi } from 'vitest'
import {
  injectMarkdownHighlightsInBlocks,
  MARKDOWN_HIGHLIGHT_STYLE,
  restoreMarkdownHighlightsInBlocks,
  serializeMarkdownHighlightAwareBlocks,
} from './markdownHighlightMarkdown'

describe('markdown highlight round-trip', () => {
  it('marks ==highlight== spans in parsed rich-editor inline content', () => {
    const blocks = injectMarkdownHighlightsInBlocks([{
      type: 'paragraph',
      content: [{ type: 'text', text: 'Keep ==important== visible.', styles: {} }],
      children: [],
    }])

    expect(blocks).toEqual([{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Keep ', styles: {} },
        { type: 'text', text: 'important', styles: { [MARKDOWN_HIGHLIGHT_STYLE]: true } },
        { type: 'text', text: ' visible.', styles: {} },
      ],
      children: [],
    }])
  })

  it('preserves existing inline styles inside ==highlight== markers', () => {
    const blocks = injectMarkdownHighlightsInBlocks([{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'A ==', styles: {} },
        { type: 'text', text: 'bold', styles: { bold: true } },
        { type: 'text', text: '== note', styles: {} },
      ],
      children: [],
    }])

    expect(blocks).toEqual([{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'A ', styles: {} },
        { type: 'text', text: 'bold', styles: { bold: true, [MARKDOWN_HIGHLIGHT_STYLE]: true } },
        { type: 'text', text: ' note', styles: {} },
      ],
      children: [],
    }])
  })

  it('leaves code-styled ==text== literal', () => {
    const blocks = injectMarkdownHighlightsInBlocks([{
      type: 'paragraph',
      content: [{ type: 'text', text: '==literal==', styles: { code: true } }],
      children: [],
    }])

    expect(blocks).toEqual([{
      type: 'paragraph',
      content: [{ type: 'text', text: '==literal==', styles: { code: true } }],
      children: [],
    }])
  })

  it('leaves fenced code block equality operators literal', () => {
    const blocks = injectMarkdownHighlightsInBlocks([{
      type: 'codeBlock',
      content: [{ type: 'text', text: 'if a == "1" and b == "2":', styles: {} }],
      children: [],
    }])

    expect(blocks).toEqual([{
      type: 'codeBlock',
      content: [{ type: 'text', text: 'if a == "1" and b == "2":', styles: {} }],
      children: [],
    }])
  })

  it('serializes highlighted inline content back to ==markdown== source', () => {
    const editor = {
      blocksToMarkdownLossy: vi.fn((blocks: unknown[]) => {
        return (blocks as Array<{ content?: Array<{ text?: string }> }>)
          .map((block) => block.content?.map((item) => item.text ?? '').join('') ?? '')
          .join('\n\n')
      }),
    }
    const blocks = [{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Keep ', styles: {} },
        { type: 'text', text: 'important', styles: { [MARKDOWN_HIGHLIGHT_STYLE]: true } },
        { type: 'text', text: ' visible.', styles: {} },
      ],
      children: [],
    }]

    expect(serializeMarkdownHighlightAwareBlocks(editor, blocks)).toBe('Keep ==important== visible.')
    expect(editor.blocksToMarkdownLossy).toHaveBeenCalledWith(restoreMarkdownHighlightsInBlocks(blocks))
  })
})
