import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it, vi } from 'vitest'
import { schema } from '../components/editorSchema'
import {
  blocksToMarkdownDirect,
  installBlockNoteDirectMarkdown,
  serializeBlockNoteMarkdown,
  type DirectMarkdownCapableSerializer,
} from './blockNoteDirectMarkdown'
import {
  injectRichEditorMarkdownBlocks,
  preProcessRichEditorMarkdown,
  serializeRichEditorBodyToMarkdown,
} from './richEditorMarkdown'

function makeEditor(document: unknown[]): DirectMarkdownCapableSerializer & { document: unknown[] } {
  return {
    document,
    blocksToMarkdownLossy: vi.fn(() => 'legacy markdown\n'),
  }
}

async function roundTripRichMarkdown(markdown: string): Promise<string> {
  const editor = BlockNoteEditor.create({ schema })
  const parsed = await editor.tryParseMarkdownToBlocks(preProcessRichEditorMarkdown(markdown))
  const blocks = injectRichEditorMarkdownBlocks(parsed)
  return blocksToMarkdownDirect(blocks).markdown
}

describe('BlockNote direct Markdown serialization', () => {
  it('keeps fenced code and continuation paragraphs inside their ordered list item', async () => {
    const markdown = [
      '1. This is a multi-paragraph point in Markdown.',
      '',
      '   ```typescript',
      '   "just a codeblock for illustration"',
      '   ```',
      '',
      '   This continuation is still part of point 1.',
      '',
      '2. Second item.',
    ].join('\n')
    const editor = BlockNoteEditor.create({ schema })
    const blocks = await editor.tryParseMarkdownToBlocks(markdown)

    expect(blocks[0]).toMatchObject({
      type: 'numberedListItem',
      children: [
        { type: 'codeBlock', props: { language: 'typescript' } },
        { type: 'paragraph' },
      ],
    })
    expect(blocksToMarkdownDirect(blocks).markdown).toBe(markdown)
  })

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

  it('serializes saved attachment media blocks with portable Markdown labels and destinations', () => {
    const blocks = [
      {
        type: 'image',
        props: { name: 'Launch shot.png', url: 'attachments/Launch shot.png' },
        children: [],
      },
      {
        type: 'file',
        props: { name: 'Briefing.pdf', url: 'attachments/Briefing (final).pdf' },
        children: [],
      },
      {
        type: 'video',
        props: { url: 'attachments/demo.mov' },
        children: [],
      },
    ]

    expect(blocksToMarkdownDirect(blocks).markdown).toBe([
      '![Launch shot.png](<attachments/Launch shot.png>)',
      '',
      '[Briefing.pdf](<attachments/Briefing (final).pdf>)',
      '',
      '[demo.mov](attachments/demo.mov)',
    ].join('\n'))
  })

  it('preserves an intentionally empty image label', () => {
    expect(blocksToMarkdownDirect([{
      type: 'image',
      props: { name: '', url: 'attachments/photo2.png' },
      children: [],
    }]).markdown).toBe('![](attachments/photo2.png)')
  })

  it('serializes empty paragraph blocks as intentional vertical spacing', () => {
    const blocks = [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'First paragraph.', styles: {} }],
        children: [],
      },
      {
        type: 'paragraph',
        content: [],
        children: [],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Second paragraph.', styles: {} }],
        children: [],
      },
    ]

    expect(blocksToMarkdownDirect(blocks).markdown).toBe('First paragraph.\n\n\nSecond paragraph.')
  })

  it('falls back to BlockNote legacy Markdown for unsupported block types', () => {
    const editor = makeEditor([{ type: 'unsupportedWidget', children: [] }])
    installBlockNoteDirectMarkdown(editor)

    expect(serializeBlockNoteMarkdown(editor, editor.document)).toBe('legacy markdown\n')
    expect(editor.blocksToMarkdownLossy).toHaveBeenCalledWith(editor.document)
    expect(editor.__tolariaLastDirectMarkdownMetrics?.fallbackReason).toBe('unsupported:unsupportedWidget')
  })

  it('keeps plain hash references and punctuation literal while escaping formatting syntax', () => {
    const blocks = [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Literal *stars* `ticks` #tag! {ok} <T>', styles: {} }],
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
      'Literal \\*stars\\* \\`ticks\\` #tag! {ok} <T>',
      '',
      '| A\\|B |',
      '| --- |',
    ].join('\n'))
  })

  it('keeps table-cell aliased wikilinks stable and repairs accumulated alias escapes', async () => {
    const stableMarkdown = [
      '| Link | Literal | Plain |',
      '| --- | --- | --- |',
      '| [[project/alpha|Project Alpha]] | A\\|B | [[project/beta]] |',
    ].join('\n')
    let markdown = stableMarkdown

    for (let cycle = 0; cycle < 3; cycle++) {
      markdown = await roundTripRichMarkdown(markdown)
      expect(markdown).toBe('| Link | Literal | Plain |\n| --- | --- | --- |\n| [[project/alpha|Project Alpha]] | A\\|B | [[project/beta]] |')
    }

    await expect(roundTripRichMarkdown(
      '| Link |\n| --- |\n| [[project/alpha\\\\\\|Project Alpha]] |',
    )).resolves.toBe('| Link |\n| --- |\n| [[project/alpha|Project Alpha]] |')
  })

  it('does not escape hash references inside saved heading titles', () => {
    const blocks = [
      {
        type: 'heading',
        props: { level: 1 },
        content: [{ type: 'text', text: 'Monday #216', styles: {} }],
        children: [],
      },
    ]

    expect(blocksToMarkdownDirect(blocks).markdown).toBe('# Monday #216')
  })

  it('escapes paragraph prefixes that would reopen as Markdown block syntax', () => {
    const blocks = [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '# Not a heading', styles: {} }],
        children: [],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '> Not a quote', styles: {} }],
        children: [],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '![not an image]', styles: {} }],
        children: [],
      },
    ]

    expect(blocksToMarkdownDirect(blocks).markdown).toBe([
      '\\# Not a heading',
      '',
      '\\> Not a quote',
      '',
      '\\![not an image]',
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
            '\tcontainer_name: forgejo',
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
      '\tcontainer_name: forgejo',
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

  it('indents nested list items by the ordered parent marker width', () => {
    const nestedList = (start: number) => [{
      type: 'numberedListItem',
      props: { start },
      content: [{ type: 'text', text: 'Parent', styles: {} }],
      children: [{
        type: 'numberedListItem',
        content: [{ type: 'text', text: 'Child', styles: {} }],
        children: [{
          type: 'bulletListItem',
          content: [{ type: 'text', text: 'Grandchild', styles: {} }],
          children: [],
        }],
      }],
    }]

    expect(blocksToMarkdownDirect(nestedList(1)).markdown).toBe([
      '1. Parent',
      '   1. Child',
      '      - Grandchild',
    ].join('\n'))
    expect(blocksToMarkdownDirect(nestedList(10)).markdown).toBe([
      '10. Parent',
      '    1. Child',
      '       - Grandchild',
    ].join('\n'))
  })
})
