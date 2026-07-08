import { describe, expect, it } from 'vitest'
import {
  tryParseFastMarkdownBlocks,
  tryParseFastMarkdownBlocksOffThread,
} from './editorFastMarkdownBlocks'

describe('tryParseFastMarkdownBlocks', () => {
  it('parses common long-note Markdown blocks directly', () => {
    const markdown = [
      '# Project Alpha',
      '',
      'A paragraph with **bold**, *italic*, ~~strike~~, `code`, and [docs](https://example.com).',
      '',
      '- Parent',
      '  - Child',
      '- [x] Done',
      '1. First',
      '2. Second',
      '',
      '> Quote',
      '',
      '```ts',
      'const answer = 42',
      '```',
      '',
      '| Name | Status |',
      '| --- | --- |',
      '| Alpha | Ready |',
      '',
      '---',
    ].join('\n')

    const result = tryParseFastMarkdownBlocks(markdown)

    expect(result.supported).toBe(true)
    expect(result.blocks).toEqual([
      expect.objectContaining({ type: 'heading', props: expect.objectContaining({ level: 1 }) }),
      expect.objectContaining({
        type: 'paragraph',
        content: expect.arrayContaining([
          expect.objectContaining({ styles: expect.objectContaining({ bold: true }), text: 'bold' }),
          expect.objectContaining({ styles: expect.objectContaining({ italic: true }), text: 'italic' }),
          expect.objectContaining({ styles: expect.objectContaining({ strike: true }), text: 'strike' }),
          expect.objectContaining({ styles: expect.objectContaining({ code: true }), text: 'code' }),
          expect.objectContaining({ type: 'link', props: { href: 'https://example.com' } }),
        ]),
      }),
      expect.objectContaining({
        type: 'bulletListItem',
        children: [expect.objectContaining({ type: 'bulletListItem' })],
      }),
      expect.objectContaining({ type: 'checkListItem', props: expect.objectContaining({ checked: true }) }),
      expect.objectContaining({ type: 'numberedListItem' }),
      expect.objectContaining({ type: 'numberedListItem', props: expect.objectContaining({ start: 2 }) }),
      expect.objectContaining({ type: 'quote' }),
      expect.objectContaining({ type: 'codeBlock', props: expect.objectContaining({ language: 'ts' }) }),
      expect.objectContaining({ type: 'table' }),
      expect.objectContaining({ type: 'divider' }),
    ])
  })

  it('rejects Markdown constructs that need BlockNote parsing to preserve semantics', () => {
    const html = tryParseFastMarkdownBlocks('<aside>custom html</aside>')
    const referenceLink = tryParseFastMarkdownBlocks('[docs]: https://example.com')
    const image = tryParseFastMarkdownBlocks('![diagram](attachments/diagram.png)')

    expect(html.supported).toBe(false)
    expect(html.metrics.fallbackReason).toBe('html-block')
    expect(referenceLink.supported).toBe(false)
    expect(referenceLink.metrics.fallbackReason).toBe('reference-link')
    expect(image.supported).toBe(false)
    expect(image.metrics.fallbackReason).toBe('markdown-image')
  })

  it('parses bare task-list markers as empty checklist blocks', () => {
    const markdown = [
      '> 工作项',
      '',
      '- [ ]',
      '',
      '> 非工作项',
      '',
      '- [x]',
    ].join('\n')

    const result = tryParseFastMarkdownBlocks(markdown)
    const checklistBlocks = result.blocks.filter(block => block.type === 'checkListItem')

    expect(result.supported).toBe(true)
    expect(checklistBlocks).toEqual([
      expect.objectContaining({ content: [], props: expect.objectContaining({ checked: false }) }),
      expect.objectContaining({ content: [], props: expect.objectContaining({ checked: true }) }),
    ])
  })

  it('uses the same parser result through the off-thread wrapper fallback in tests', async () => {
    const result = await tryParseFastMarkdownBlocksOffThread('# Title\n\nBody')

    expect(result.supported).toBe(true)
    expect(result.blocks).toEqual([
      expect.objectContaining({ type: 'heading' }),
      expect.objectContaining({ type: 'paragraph' }),
    ])
  })
})
