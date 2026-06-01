import { describe, expect, it } from 'vitest'
import { inferCodeBlockLanguage, inferCodeBlockLanguages } from './codeBlockLanguage'

describe('code block language inference', () => {
  it('detects TypeScript interface snippets', () => {
    expect(inferCodeBlockLanguage([
      'interface VaultEntry {',
      '  path: string;',
      '  title: string;',
      '  status: string | null;',
      '}',
    ].join('\n'))).toBe('typescript')
  })

  it('detects JSON before JavaScript-like punctuation', () => {
    expect(inferCodeBlockLanguage('{ "id": "Demo", "count": 1 }')).toBe('json')
  })

  it('preserves explicit user-selected code block languages', () => {
    const blocks = inferCodeBlockLanguages([{
      type: 'codeBlock',
      props: { language: 'python' },
      content: [{ type: 'text', text: 'interface Demo { value: string }' }],
      children: [],
    }])

    expect(blocks[0]).toMatchObject({
      props: { language: 'python' },
    })
  })

  it('normalizes known fenced code block aliases from imported Markdown', () => {
    const blocks = inferCodeBlockLanguages([
      {
        type: 'codeBlock',
        props: { language: 'ps1' },
        content: [{ type: 'text', text: 'Get-ChildItem' }],
        children: [],
      },
      {
        type: 'codeBlock',
        props: { language: 'vb' },
        content: [{ type: 'text', text: 'MsgBox "Hello"' }],
        children: [],
      },
    ])

    expect(blocks[0]).toMatchObject({
      props: { language: 'powershell' },
    })
    expect(blocks[1]).toMatchObject({
      props: { language: 'vbscript' },
    })
  })

  it('leaves unsupported explicit code block languages unchanged', () => {
    const blocks = inferCodeBlockLanguages([{
      type: 'codeBlock',
      props: { language: 'foolang' },
      content: [{ type: 'text', text: 'demo' }],
      children: [],
    }])

    expect(blocks[0]).toMatchObject({
      props: { language: 'foolang' },
    })
  })

  it('updates unlabeled code blocks from plain text to the inferred language', () => {
    const blocks = inferCodeBlockLanguages([{
      type: 'codeBlock',
      props: { language: 'text' },
      content: [{ type: 'text', text: 'const total: number = 1' }],
      children: [],
    }])

    expect(blocks[0]).toMatchObject({
      props: { language: 'typescript' },
    })
  })
})
