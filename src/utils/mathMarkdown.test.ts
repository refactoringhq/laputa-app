import { describe, expect, it, vi } from 'vitest'
import {
  MATH_BLOCK_TYPE,
  MATH_INLINE_TYPE,
  injectMathInBlocks,
  preProcessMathMarkdown,
  readCompletedInlineMathAtEnd,
  serializeMathAwareBlocks,
} from './mathMarkdown'

describe('math markdown round-trip', () => {
  it('injects inline math placeholders into BlockNote inline content', () => {
    const preprocessed = preProcessMathMarkdown({ markdown: 'Energy is $E=mc^2$ in prose.' })
    const blocks = [{
      type: 'paragraph',
      content: [{ type: 'text', text: preprocessed, styles: {} }],
      children: [],
    }]

    const [block] = injectMathInBlocks(blocks) as Array<{ content: unknown[] }>

    expect(block.content).toEqual([
      { type: 'text', text: 'Energy is ', styles: {} },
      { type: MATH_INLINE_TYPE, props: { latex: 'E=mc^2' }, content: undefined },
      { type: 'text', text: ' in prose.', styles: {} },
    ])
  })

  it('injects display math placeholders into dedicated math blocks', () => {
    const preprocessed = preProcessMathMarkdown({ markdown: '$$\n\\int_0^1 x\\,dx\n$$' })
    const blocks = [{
      type: 'paragraph',
      content: [{ type: 'text', text: preprocessed, styles: {} }],
      children: [],
    }]

    const [block] = injectMathInBlocks(blocks) as Array<{ type: string; props: { latex: string } }>

    expect(block.type).toBe(MATH_BLOCK_TYPE)
    expect(block.props.latex).toBe('\\int_0^1 x\\,dx')
  })

  it('preprocesses single-line display math without rewinding later lines', () => {
    const preprocessed = preProcessMathMarkdown({
      markdown: 'Intro\n\n$$x^2$$\n\nDone',
    })
    const blocks = preprocessed.split('\n\n').map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text, styles: {} }],
      children: [],
    }))

    const [, block, afterBlock] = injectMathInBlocks(blocks) as Array<{
      type: string
      props?: { latex: string }
      content?: Array<{ text: string }>
    }>

    expect(block.type).toBe(MATH_BLOCK_TYPE)
    expect(block.props?.latex).toBe('x^2')
    expect(afterBlock.content?.[0]?.text).toBe('Done')
  })

  it('serializes math nodes back to Markdown-compatible source', () => {
    const editor = {
      blocksToMarkdownLossy: vi.fn((blocks: unknown[]) => {
        return (blocks as Array<{ content?: Array<{ text?: string }> }>)
          .map((block) => block.content?.map((item) => item.text ?? '').join('') ?? '')
          .join('\n\n')
      }),
    }
    const blocks = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Inline ', styles: {} },
          { type: MATH_INLINE_TYPE, props: { latex: 'a^2+b^2=c^2' } },
        ],
        children: [],
      },
      {
        type: MATH_BLOCK_TYPE,
        props: { latex: '\\frac{1}{2}' },
        children: [],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Done', styles: {} }],
        children: [],
      },
    ]

    expect(serializeMathAwareBlocks(editor, blocks)).toBe(
      'Inline $a^2+b^2=c^2$\n\n$$\n\\frac{1}{2}\n$$\n\nDone',
    )
  })

  it('round-trips inline math inside table cells', () => {
    const tableCellMath = preProcessMathMarkdown({ markdown: '$a+b$' })
    const blocks = [{
      type: 'table',
      content: {
        type: 'tableContent',
        rows: [{
          cells: [{
            type: 'tableCell',
            content: [{ type: 'text', text: tableCellMath, styles: {} }],
          }],
        }],
      },
      children: [],
    }]

    const [tableBlock] = injectMathInBlocks(blocks) as Array<{
      content: { rows: Array<{ cells: Array<{ content: unknown[] }> }> }
    }>

    expect(tableBlock.content.rows[0].cells[0].content).toEqual([{
      type: MATH_INLINE_TYPE,
      props: { latex: 'a+b' },
      content: undefined,
    }])

    const editor = {
      blocksToMarkdownLossy: vi.fn(() => '| Formula |\n| --- |\n| $a+b$ |'),
    }

    expect(serializeMathAwareBlocks(editor, [tableBlock])).toBe('| Formula |\n| --- |\n| $a+b$ |')
    expect(editor.blocksToMarkdownLossy).toHaveBeenCalledWith([{
      type: 'table',
      content: {
        type: 'tableContent',
        rows: [{
          cells: [{
            type: 'tableCell',
            content: [{ type: 'text', text: '$a+b$' }],
          }],
        }],
      },
      children: [],
    }])
  })

  it('leaves display-style math inside table cells as Markdown source', () => {
    expect(preProcessMathMarkdown({ markdown: '| Formula |\n| --- |\n| $$c$$ |' })).toBe(
      '| Formula |\n| --- |\n| $$c$$ |',
    )
  })

  it('leaves inline code and fenced code math-looking text untouched', () => {
    const markdown = [
      'Keep `$not_math$` literal.',
      '',
      '```',
      '$$',
      'x^2',
      '$$',
      '```',
    ].join('\n')

    expect(preProcessMathMarkdown({ markdown })).toBe(markdown)
  })

  it('recognizes completed inline math at the end of text', () => {
    expect(readCompletedInlineMathAtEnd({ text: 'Energy is $E=mc^2$' })).toEqual({
      latex: 'E=mc^2',
      start: 10,
      end: 17,
    })
  })

  it('ignores incomplete, escaped, and display-style dollar sequences at text end', () => {
    expect(readCompletedInlineMathAtEnd({ text: 'Energy is $E=mc^2' })).toBeNull()
    expect(readCompletedInlineMathAtEnd({ text: String.raw`Energy is $E=mc^2\$` })).toBeNull()
    expect(readCompletedInlineMathAtEnd({ text: '$$x^2$$' })).toBeNull()
  })
})
