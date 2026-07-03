import { describe, expect, it } from 'vitest'
import {
  HTML_BLOCK_DEFAULT_HEIGHT,
  HTML_BLOCK_TYPE,
  htmlBlockMarkdown,
  htmlBlockMarkdownCodec,
  htmlFenceSource,
  injectHtmlBlockInBlocks,
  preProcessHtmlBlockMarkdown,
} from './htmlBlockMarkdown'

describe('HTML block markdown', () => {
  it('injects fenced html source into a dedicated HTML block', () => {
    const markdown = [
      '```html height="360"',
      '<article>',
      '  <h2>Hello</h2>',
      '</article>',
      '```',
    ].join('\n')
    const preprocessed = preProcessHtmlBlockMarkdown({ markdown })
    const [block] = injectHtmlBlockInBlocks([{
      type: 'paragraph',
      content: [{ type: 'text', text: preprocessed, styles: {} }],
      children: [],
    }]) as Array<{ type: string; props: { height: string; html: string } }>

    expect(block.type).toBe(HTML_BLOCK_TYPE)
    expect(block.props.height).toBe('360')
    expect(block.props.html).toBe('<article>\n  <h2>Hello</h2>\n</article>\n')
  })

  it('serializes an explicit portable height attribute', () => {
    expect(htmlFenceSource({ height: '480', html: '<div>Resizable</div>\n' })).toBe([
      '```html height="480"',
      '<div>Resizable</div>',
      '```',
    ].join('\n'))
  })

  it('uses a longer fence when HTML contains backticks', () => {
    expect(htmlFenceSource({ height: '320', html: '<code>```</code>\n' })).toBe([
      '````html height="320"',
      '<code>```</code>',
      '````',
    ].join('\n'))
  })

  it('normalizes unsafe or missing heights to the default', () => {
    const markdown = [
      '```html height="99999"',
      '<p>Tall</p>',
      '```',
    ].join('\n')
    const preprocessed = preProcessHtmlBlockMarkdown({ markdown })
    const [block] = injectHtmlBlockInBlocks([{
      type: 'paragraph',
      content: [{ type: 'text', text: preprocessed, styles: {} }],
      children: [],
    }]) as Array<{ props: { height: string } }>

    expect(block.props.height).toBe(HTML_BLOCK_DEFAULT_HEIGHT)
  })

  it('injects parsed html code blocks into dedicated blocks', () => {
    const block = htmlBlockMarkdownCodec.readCodeBlock?.({
      type: 'codeBlock',
      props: { language: 'html' },
      content: [{ type: 'text', text: '<button>Click</button>', styles: {} }],
      children: [],
    })

    expect(block).toEqual({
      height: HTML_BLOCK_DEFAULT_HEIGHT,
      html: '<button>Click</button>',
    })
  })

  it('serializes fallback markdown for blocks created by the slash command', () => {
    expect(htmlBlockMarkdown({
      type: HTML_BLOCK_TYPE,
      props: { height: '320', html: '<p>New</p>' },
      children: [],
    })).toBe([
      '```html height="320"',
      '<p>New</p>',
      '```',
    ].join('\n'))
  })
})
