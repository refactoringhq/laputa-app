import { describe, expect, it, vi } from 'vitest'
import type { BlockLike, InlineItem } from './durableMarkdownBlocks'
import {
  buildCalloutBlock,
  calloutStartsExpanded,
  calloutVisualFamily,
  parseCalloutMarker,
  serializeCalloutBlock,
} from './calloutMarkdown'

function quote(content: InlineItem[]): BlockLike {
  return { type: 'quote', content }
}

describe('callout markers', () => {
  it('recognizes Obsidian and GFM alert markers case-insensitively', () => {
    expect(parseCalloutMarker('[!TIP] A useful tip')).toEqual({
      fold: '',
      title: 'A useful tip',
      type: 'tip',
    })
    expect(parseCalloutMarker('[!custom-alert]- Closed')).toEqual({
      fold: '-',
      title: 'Closed',
      type: 'custom-alert',
    })
    expect(parseCalloutMarker('[!123] Invalid')).toBeNull()
  })

  it('maps known aliases to semantic families and unknown types to note styling', () => {
    expect(calloutVisualFamily('TIP')).toBe('success')
    expect(calloutVisualFamily('caution')).toBe('warning')
    expect(calloutVisualFamily('bug')).toBe('error')
    expect(calloutVisualFamily('custom-alert')).toBe('note')
  })

  it('uses the fold marker as the initial disclosure state', () => {
    expect(calloutStartsExpanded('-')).toBe(false)
    expect(calloutStartsExpanded('+')).toBe(true)
    expect(calloutStartsExpanded('')).toBe(true)
  })
})

describe('callout block conversion', () => {
  it('keeps rich inline body content while removing the marker line', () => {
    const link: InlineItem = {
      type: 'link',
      props: { href: 'https://example.com' },
      content: [{ type: 'text', text: 'docs', styles: { italic: true } }],
    }
    const block = buildCalloutBlock(quote([
      { type: 'text', text: '[!tip] Read this\n' },
      { type: 'text', text: 'Bold body ', styles: { bold: true } },
      link,
    ]))

    expect(block).toMatchObject({
      type: 'calloutBlock',
      props: { calloutType: 'tip', fold: '', title: 'Read this' },
      content: [
        { type: 'text', text: 'Bold body ', styles: { bold: true } },
        link,
      ],
    })
  })

  it('serializes the marker and rich body through the editor serializer', () => {
    const editor = {
      blocksToMarkdownLossy: vi.fn().mockReturnValue('**Bold body** and [docs](https://example.com)'),
    }
    const markdown = serializeCalloutBlock(editor, {
      type: 'calloutBlock',
      props: { calloutType: 'tip', fold: '+', title: 'Read this' },
      content: [{ type: 'text', text: 'body' }],
    })

    expect(markdown).toBe([
      '> [!tip]+ Read this',
      '> **Bold body** and [docs](https://example.com)',
    ].join('\n'))
    expect(editor.blocksToMarkdownLossy).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'paragraph' }),
    ])
  })
})
