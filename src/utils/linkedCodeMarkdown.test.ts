import { describe, expect, it } from 'vitest'
import { injectLinkedCodeInBlocks, preProcessLinkedCodeMarkdown } from './linkedCodeMarkdown'

describe('linked code Markdown', () => {
  it('protects linked code labels without touching fenced, escaped, or image syntax', () => {
    const markdown = [
      'See [`symbol`](https://example.com).',
      String.raw`\[\`escaped\`](https://example.com/escaped)`,
      '![`image`](https://example.com/image.png)',
      '```md',
      '[`fenced`](https://example.com/fenced)',
      '```',
    ].join('\n')

    const processed = preProcessLinkedCodeMarkdown(markdown)

    expect(processed).not.toContain('[`symbol`](https://example.com)')
    expect(processed).toContain(String.raw`\[\`escaped\`](https://example.com/escaped)`)
    expect(processed).toContain('![`image`](https://example.com/image.png)')
    expect(processed).toContain('[`fenced`](https://example.com/fenced)')
  })

  it('restores code styling inside links and preserves unchanged block identity', () => {
    const processed = preProcessLinkedCodeMarkdown('[`some-symbol`](https://example.com)')
    const token = /^\[([^\]]+)\]\(/u.exec(processed)?.at(1) ?? ''
    const linkedBlock = {
      type: 'paragraph',
      content: [{
        type: 'link',
        href: 'https://example.com',
        content: [{ type: 'text', text: token, styles: {} }],
      }],
    }
    const unchangedBlock = { type: 'paragraph', content: [{ type: 'text', text: 'plain' }] }

    const result = injectLinkedCodeInBlocks([linkedBlock, unchangedBlock]) as typeof linkedBlock[]

    expect(result[0]).not.toBe(linkedBlock)
    expect(result[0].content[0].content).toEqual([
      { type: 'text', text: 'some-symbol', styles: { code: true } },
    ])
    expect(result[1]).toBe(unchangedBlock)
  })

  it('restores linked code in nested table cells', () => {
    const processed = preProcessLinkedCodeMarkdown('[`cell`](https://example.com)')
    const token = /^\[([^\]]+)\]\(/u.exec(processed)?.at(1) ?? ''
    const blocks = [{
      type: 'table',
      content: {
        type: 'tableContent',
        rows: [{ cells: [{ content: [{
          type: 'link',
          href: 'https://example.com',
          content: [{ type: 'text', text: token }],
        }] }] }],
      },
      children: [{
        type: 'paragraph',
        content: [{
          type: 'link',
          href: 'https://example.com',
          content: [{ type: 'text', text: token }],
        }],
      }],
    }]

    const [result] = injectLinkedCodeInBlocks(blocks) as typeof blocks

    expect(result.content.rows[0].cells[0].content[0].content[0]).toMatchObject({
      text: 'cell',
      styles: { code: true },
    })
    expect(result.children[0].content[0].content[0]).toMatchObject({
      text: 'cell',
      styles: { code: true },
    })
  })
})
