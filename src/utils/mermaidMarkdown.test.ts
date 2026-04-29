import { describe, expect, it, vi } from 'vitest'
import {
  MERMAID_BLOCK_TYPE,
  injectMermaidInBlocks,
  preProcessMermaidMarkdown,
  serializeMermaidAwareBlocks,
} from './mermaidMarkdown'

describe('mermaid markdown round-trip', () => {
  it('injects fenced Mermaid source into dedicated diagram blocks', () => {
    const markdown = [
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
    ].join('\n')
    const preprocessed = preProcessMermaidMarkdown({ markdown })
    const blocks = [{
      type: 'paragraph',
      content: [{ type: 'text', text: preprocessed, styles: {} }],
      children: [],
    }]

    const [block] = injectMermaidInBlocks(blocks) as Array<{
      type: string
      props: { source: string; diagram: string }
    }>

    expect(block.type).toBe(MERMAID_BLOCK_TYPE)
    expect(block.props.source).toBe(markdown)
    expect(block.props.diagram).toBe('flowchart LR\n  A --> B\n')
  })

  it('preserves multiple Mermaid blocks independently when serializing', () => {
    const editor = {
      blocksToMarkdownLossy: vi.fn((blocks: unknown[]) => {
        return (blocks as Array<{ content?: Array<{ text?: string }> }>)
          .map((block) => block.content?.map((item) => item.text ?? '').join('') ?? '')
          .join('\n\n')
      }),
    }
    const firstSource = '```mermaid\nflowchart TD\nA --> B\n```'
    const secondSource = '~~~mermaid\nsequenceDiagram\nAlice->>Bob: Hi\n~~~'
    const blocks = [
      { type: 'paragraph', content: [{ type: 'text', text: 'Intro' }], children: [] },
      { type: MERMAID_BLOCK_TYPE, props: { source: firstSource, diagram: 'flowchart TD\nA --> B\n' }, children: [] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Between' }], children: [] },
      { type: MERMAID_BLOCK_TYPE, props: { source: secondSource, diagram: 'sequenceDiagram\nAlice->>Bob: Hi\n' }, children: [] },
    ]

    expect(serializeMermaidAwareBlocks(editor, blocks)).toBe([
      'Intro',
      firstSource,
      'Between',
      secondSource,
    ].join('\n\n'))
  })

  it('injects parsed Mermaid code blocks into dedicated diagram blocks', () => {
    const [block] = injectMermaidInBlocks([{
      type: 'codeBlock',
      props: { language: 'mermaid' },
      content: [{ type: 'text', text: 'flowchart LR\n  A --> B', styles: {} }],
      children: [],
    }]) as Array<{
      type: string
      props: { source: string; diagram: string }
    }>

    expect(block.type).toBe(MERMAID_BLOCK_TYPE)
    expect(block.props.source).toBe('```mermaid\nflowchart LR\n  A --> B\n```')
    expect(block.props.diagram).toBe('flowchart LR\n  A --> B\n')
  })

  it('injects Mermaid-looking text code blocks when the parser drops the language', () => {
    const [block] = injectMermaidInBlocks([{
      type: 'codeBlock',
      props: { language: 'text' },
      content: [{
        type: 'text',
        text: [
          "%%{init: {'theme':'base'}}%%",
          'flowchart TD',
          '  A --> B',
        ].join('\n'),
        styles: {},
      }],
      children: [],
    }]) as Array<{
      type: string
      props: { source: string; diagram: string }
    }>

    expect(block.type).toBe(MERMAID_BLOCK_TYPE)
    expect(block.props.source).toContain('```mermaid\n')
    expect(block.props.diagram).toContain('flowchart TD\n  A --> B\n')
  })

  it('keeps ordinary text code blocks unchanged', () => {
    const [block] = injectMermaidInBlocks([{
      type: 'codeBlock',
      props: { language: 'text' },
      content: [{ type: 'text', text: 'const chart = "flowchart TD"', styles: {} }],
      children: [],
    }]) as Array<{ type: string }>

    expect(block.type).toBe('codeBlock')
  })

  it('leaves non-Mermaid and unclosed fences as normal Markdown', () => {
    const markdown = [
      '```ts',
      'const graph = "mermaid"',
      '```',
      '',
      '```mermaid',
      'flowchart LR',
    ].join('\n')

    expect(preProcessMermaidMarkdown({ markdown })).toBe(markdown)
  })

  it('serializes fallback source for Mermaid blocks created without original fence text', () => {
    const editor = { blocksToMarkdownLossy: vi.fn(() => '') }
    const blocks = [{
      type: MERMAID_BLOCK_TYPE,
      props: { source: '', diagram: 'flowchart LR\nA --> B' },
      children: [],
    }]

    expect(serializeMermaidAwareBlocks(editor, blocks)).toBe(
      '```mermaid\nflowchart LR\nA --> B\n```',
    )
  })
})
