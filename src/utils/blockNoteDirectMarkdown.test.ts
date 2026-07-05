import { describe, expect, it, vi } from 'vitest'
import {
  blocksToMarkdownDirect,
  installBlockNoteDirectMarkdown,
  serializeBlockNoteMarkdown,
  type DirectMarkdownCapableSerializer,
} from './blockNoteDirectMarkdown'
import { serializeRichEditorBodyToMarkdown } from './richEditorMarkdown'

function makeEditor(document: unknown[]): DirectMarkdownCapableSerializer & { document: unknown[] } {
  return {
    document,
    blocksToMarkdownLossy: vi.fn(() => 'legacy markdown\n'),
  }
}

describe('BlockNote direct Markdown serialization', () => {
  it('serializes common Tolaria BlockNote blocks without the HTML exporter', () => {
    const blocks = [
      {
        type: 'heading',
        props: { level: 1 },
        content: [{ type: 'text', text: 'Project Alpha', styles: {} }],
        children: [],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ', styles: {} },
          { type: 'wikilink', props: { target: 'Team/Beta|Beta' } },
          { type: 'text', text: ' and ', styles: {} },
          { type: 'link', props: { href: 'https://example.com' }, content: [{ type: 'text', text: 'docs', styles: {} }] },
          { type: 'text', text: '.', styles: {} },
        ],
        children: [],
      },
      {
        type: 'bulletListItem',
        content: [{ type: 'text', text: 'Bold item', styles: { bold: true } }],
        children: [{
          type: 'checkListItem',
          props: { checked: true },
          content: [{ type: 'text', text: 'Done', styles: {} }],
          children: [],
        }],
      },
      {
        type: 'codeBlock',
        props: { language: 'ts' },
        content: [{ type: 'text', text: 'const x = 1', styles: {} }],
        children: [],
      },
      {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [
            { cells: ['Name', 'Status'] },
            { cells: ['Alpha', { content: [{ type: 'text', text: 'Ready', styles: {} }] }] },
          ],
        },
        children: [],
      },
    ]

    expect(blocksToMarkdownDirect(blocks).markdown).toBe([
      '# Project Alpha',
      '',
      'See [[Team/Beta|Beta]] and [docs](https://example.com).',
      '',
      '- **Bold item**',
      '  - [x] Done',
      '',
      '```ts',
      'const x = 1',
      '```',
      '',
      '| Name | Status |',
      '| --- | --- |',
      '| Alpha | Ready |',
    ].join('\n'))
  })

  it('falls back to BlockNote legacy Markdown for unsupported block types', () => {
    const editor = makeEditor([{ type: 'unsupportedWidget', children: [] }])
    installBlockNoteDirectMarkdown(editor)

    expect(serializeBlockNoteMarkdown(editor, editor.document)).toBe('legacy markdown\n')
    expect(editor.blocksToMarkdownLossy).toHaveBeenCalledWith(editor.document)
    expect(editor.__tolariaLastDirectMarkdownMetrics?.fallbackReason).toBe('unsupported:unsupportedWidget')
  })

  it('escapes literal Markdown syntax without double-escaping table pipes', () => {
    const blocks = [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Literal *stars* `ticks` #tag!', styles: {} }],
        children: [],
      },
      {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [
            { cells: [{ content: [{ type: 'text', text: 'A|B', styles: {} }] }] },
          ],
        },
        children: [],
      },
    ]

    expect(blocksToMarkdownDirect(blocks).markdown).toBe([
      'Literal \\*stars\\* \\`ticks\\` \\#tag\\!',
      '',
      '| A\\|B |',
      '| --- |',
    ].join('\n'))
  })

  it('keeps fenced code block content literal during direct Markdown serialization', () => {
    const blocks = [
      {
        type: 'codeBlock',
        props: { language: 'yaml' },
        content: [{
          type: 'text',
          text: [
            'services:',
            '  server:',
            '    container_name: forgejo',
            '    environment:',
            '      - USER_UID=1000',
            '      - PATH_WITH_BACKSLASH=container\\_name',
            '      - markdown_chars=*_{}<>()#!',
          ].join('\n'),
          styles: {},
        }],
        children: [],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Literal *still escapes* outside code.', styles: {} }],
        children: [],
      },
    ]

    expect(blocksToMarkdownDirect(blocks).markdown).toBe([
      '```yaml',
      'services:',
      '  server:',
      '    container_name: forgejo',
      '    environment:',
      '      - USER_UID=1000',
      '      - PATH_WITH_BACKSLASH=container\\_name',
      '      - markdown_chars=*_{}<>()#!',
      '```',
      '',
      'Literal \\*still escapes\\* outside code.',
    ].join('\n'))
  })

  it('keeps plain prose parentheses unescaped while protecting links and code spans', () => {
    const blocks = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Use citations (Smith, 2024) and ', styles: {} },
          { type: 'text', text: 'inline_code(with_args)', styles: { code: true } },
          { type: 'text', text: ' with ', styles: {} },
          {
            type: 'link',
            props: { href: 'attachments/report (final).pdf' },
            content: [{ type: 'text', text: 'report (final)', styles: {} }],
          },
          { type: 'text', text: '.', styles: {} },
        ],
        children: [],
      },
    ]

    expect(blocksToMarkdownDirect(blocks).markdown).toBe(
      'Use citations (Smith, 2024) and `inline_code(with_args)` with [report (final)](<attachments/report (final).pdf>).',
    )
  })

  it('caches unchanged block objects across rich-editor body serialization', () => {
    const block = {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Keep [[Project Alpha]] fast.', styles: {} }],
      children: [],
    }
    const editor = makeEditor([block])
    installBlockNoteDirectMarkdown(editor)

    expect(serializeRichEditorBodyToMarkdown(editor as never)).toBe('Keep [[Project Alpha]] fast.\n')
    expect(serializeRichEditorBodyToMarkdown(editor as never)).toBe('Keep [[Project Alpha]] fast.\n')

    expect(editor.blocksToMarkdownLossy).not.toHaveBeenCalled()
    expect(editor.__tolariaLastDirectMarkdownMetrics?.cacheHits).toBeGreaterThan(0)
  })

  it('keeps ordered-list numbering correct when cached blocks are reused in different positions', () => {
    const item = {
      type: 'numberedListItem',
      content: [{ type: 'text', text: 'Step', styles: {} }],
      children: [],
    }
    const cache = new WeakMap<object, Map<string, string>>()

    expect(blocksToMarkdownDirect([item], cache).markdown).toBe('1. Step')
    expect(blocksToMarkdownDirect([item, item], cache).markdown).toBe('1. Step\n\n2. Step')
  })

  it('resets nested ordered-list numbering for separate parent list items', () => {
    const blocks = [
      {
        type: 'bulletListItem',
        content: [{ type: 'text', text: 'First parent', styles: {} }],
        children: [
          {
            type: 'numberedListItem',
            content: [{ type: 'text', text: 'First child step', styles: {} }],
            children: [],
          },
          {
            type: 'numberedListItem',
            content: [{ type: 'text', text: 'Second child step', styles: {} }],
            children: [],
          },
        ],
      },
      {
        type: 'bulletListItem',
        content: [{ type: 'text', text: 'Second parent', styles: {} }],
        children: [
          {
            type: 'numberedListItem',
            content: [{ type: 'text', text: 'Fresh child step', styles: {} }],
            children: [],
          },
        ],
      },
    ]

    expect(blocksToMarkdownDirect(blocks).markdown).toBe([
      '- First parent',
      '  1. First child step',
      '',
      '  2. Second child step',
      '',
      '- Second parent',
      '  1. Fresh child step',
    ].join('\n'))
  })
})
