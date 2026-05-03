import { describe, expect, it } from 'vitest'
import {
  TLDRAW_BLOCK_TYPE,
  injectTldrawInBlocks,
  preProcessTldrawMarkdown,
  tldrawFenceSource,
} from './tldrawMarkdown'

describe('tldraw markdown round-trip', () => {
  it('injects fenced tldraw source into dedicated whiteboard blocks', () => {
    const snapshot = '{ "store": {} }'
    const markdown = [
      '```tldraw id="onboarding-flow"',
      snapshot,
      '```',
    ].join('\n')
    const preprocessed = preProcessTldrawMarkdown({ markdown })
    const blocks = [{
      type: 'paragraph',
      content: [{ type: 'text', text: preprocessed, styles: {} }],
      children: [],
    }]

    const [block] = injectTldrawInBlocks(blocks) as Array<{
      type: string
      props: { boardId: string; height: string; snapshot: string; width: string }
    }>

    expect(block.type).toBe(TLDRAW_BLOCK_TYPE)
    expect(block.props.boardId).toBe('onboarding-flow')
    expect(block.props.height).toBe('520')
    expect(block.props.snapshot).toBe(snapshot)
    expect(block.props.width).toBe('')
  })

  it('reads persisted whiteboard dimensions from fence metadata', () => {
    const preprocessed = preProcessTldrawMarkdown({
      markdown: [
        '```tldraw id="map" height="720" width="980"',
        '{}',
        '```',
      ].join('\n'),
    })

    const [block] = injectTldrawInBlocks([{
      type: 'paragraph',
      content: [{ type: 'text', text: preprocessed, styles: {} }],
      children: [],
    }]) as Array<{
      props: { height: string; width: string }
    }>

    expect(block.props.height).toBe('720')
    expect(block.props.width).toBe('980')
  })

  it('preserves ordinary and unclosed fences as normal Markdown', () => {
    const markdown = [
      '```ts',
      'const language = "tldraw"',
      '```',
      '',
      '```tldraw',
      '{ "store": {} }',
    ].join('\n')

    expect(preProcessTldrawMarkdown({ markdown })).toBe(markdown)
  })

  it('injects parsed tldraw code blocks into dedicated whiteboard blocks', () => {
    const [block] = injectTldrawInBlocks([{
      type: 'codeBlock',
      props: { language: 'tldraw' },
      content: [{ type: 'text', text: '{ "store": {} }', styles: {} }],
      children: [],
    }]) as Array<{
      type: string
      props: { height: string; snapshot: string; width: string }
    }>

    expect(block.type).toBe(TLDRAW_BLOCK_TYPE)
    expect(block.props.height).toBe('520')
    expect(block.props.snapshot).toBe('{ "store": {} }')
    expect(block.props.width).toBe('')
  })

  it('keeps ordinary code blocks unchanged', () => {
    const [block] = injectTldrawInBlocks([{
      type: 'codeBlock',
      props: { language: 'json' },
      content: [{ type: 'text', text: '{ "store": {} }', styles: {} }],
      children: [],
    }]) as Array<{ type: string }>

    expect(block.type).toBe('codeBlock')
  })

  it('uses a longer fence when the board JSON contains backticks', () => {
    expect(tldrawFenceSource({
      boardId: 'quoted',
      height: '640',
      snapshot: '{ "text": "```" }',
      width: '900',
    })).toBe([
      '````tldraw id="quoted" height="640" width="900"',
      '{ "text": "```" }',
      '````',
    ].join('\n'))
  })
})
