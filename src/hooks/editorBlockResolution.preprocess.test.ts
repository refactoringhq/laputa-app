import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlockNoteEditor } from '@blocknote/core'
import { schema } from '../components/editorSchema'
import {
  installRichEditorMarkdownSerializer,
  preProcessRichEditorMarkdown,
  serializeRichEditorDocumentToMarkdown,
} from '../utils/richEditorMarkdown'
import { resolveBlocksForTarget } from './editorBlockResolution'

const tauriMode = vi.hoisted(() => ({ enabled: false }))

vi.mock('../mock-tauri', async (importOriginal) => ({
  ...await importOriginal<typeof import('../mock-tauri')>(),
  isTauri: () => tauriMode.enabled,
}))

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tauri-apps/api/core')>(),
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}))

afterEach(() => {
  tauriMode.enabled = false
})

async function reloadRichEditorMarkdown(content: string, targetPath: string) {
  const editor = BlockNoteEditor.create({ schema })
  installRichEditorMarkdownSerializer(editor)
  const resolved = await resolveBlocksForTarget({
    cache: new Map(),
    content,
    editor,
    targetPath,
  })
  const markdown = serializeRichEditorDocumentToMarkdown({
    blocks: resolved.blocks,
    editor,
    tabContent: content,
  })
  return { blocks: resolved.blocks, markdown }
}

describe('preProcessRichEditorMarkdown', () => {
  it('normalizes bare image paths for BlockNote parsing while preserving fenced code', () => {
    const markdown = [
      '```md',
      '![example](attachments/code.png)',
      '```',
      '',
      '![shot](attachments/shot.png)',
    ].join('\n')

    expect(preProcessRichEditorMarkdown(markdown)).toBe([
      '```md',
      '![example](attachments/code.png)',
      '```',
      '',
      '![shot](./attachments/shot.png)',
    ].join('\n'))
  })

  it('prepares currency prose without single-tilde strike or inline math placeholders', () => {
    const markdown = [
      '# Finance',
      '',
      '### 6. Stop new Pro/Business customers from quitting in months 1-2 (~$1.5k/mo now, ~$3k/mo by autumn)',
      '',
      'Monthly subscribers are worth ~$115 lifetime vs ~$223 for old Creator.',
      '',
      'Keep ~~deleted~~ marked.',
    ].join('\n')

    const preprocessed = preProcessRichEditorMarkdown(markdown)

    expect(preprocessed).toContain('\\~$1.5k/mo now, \\~$3k/mo')
    expect(preprocessed).toContain('\\~$115 lifetime vs \\~$223')
    expect(preprocessed).toContain('~~deleted~~')
    expect(preprocessed).not.toContain('TOLARIA_MATH_INLINE')
  })

  it('renders bare task-list markers as empty checklist blocks', async () => {
    const editor = BlockNoteEditor.create({ schema })
    const content = [
      '> 工作项',
      '',
      '- [ ]',
      '',
      '> 非工作项',
      '',
      '- [ ]',
    ].join('\n')

    const resolved = await resolveBlocksForTarget({
      cache: new Map(),
      content,
      editor,
      targetPath: 'checklist-ui-error.md',
    })
    const checklistBlocks = resolved.blocks.filter(block => block.type === 'checkListItem')

    expect(checklistBlocks).toEqual([
      expect.objectContaining({ content: [], props: expect.objectContaining({ checked: false }) }),
      expect.objectContaining({ content: [], props: expect.objectContaining({ checked: false }) }),
    ])
    expect(resolved.blocks).not.toContainEqual(
      expect.objectContaining({
        content: [expect.objectContaining({ text: '[ ]' })],
        type: 'bulletListItem',
      }),
    )
  })

  it('resolves untitled note callouts into schema blocks', async () => {
    const editor = BlockNoteEditor.create({ schema })
    const resolved = await resolveBlocksForTarget({
      cache: new Map(),
      content: [
        '# Callout localization QA',
        '',
        '> [!note]',
        '> This untitled callout uses localized copy.',
      ].join('\n'),
      editor,
      targetPath: 'callout-localization-qa.md',
    })

    expect(resolved.blocks).toContainEqual(expect.objectContaining({
      type: 'calloutBlock',
      props: expect.objectContaining({ calloutType: 'note', title: '' }),
    }))
  })

  it('preserves fenced code literals through resolve and save after reload', async () => {
    const editor = BlockNoteEditor.create({ schema })
    installRichEditorMarkdownSerializer(editor)
    const content = [
      '---',
      'title: SQL repro',
      '---',
      '```sql',
      'alter table db_sys.crm_client add client_csm_factor decimal(5, 2) null;',
      'select PATH_WITH_BACKSLASH from container\\_name;',
      '```',
    ].join('\n')

    const resolved = await resolveBlocksForTarget({
      cache: new Map(),
      content,
      editor,
      targetPath: 'sql-repro.md',
    })

    expect(serializeRichEditorDocumentToMarkdown({
      blocks: resolved.blocks,
      editor,
      tabContent: content,
    })).toBe(`${content}\n`)
  })

  it('preserves linked inline code through a small-note rich-editor round trip', async () => {
    const content = 'See [`some-symbol`](https://example.com) for details.'

    const resolved = await reloadRichEditorMarkdown(content, 'linked-inline-code.md')

    expect(resolved.blocks).toContainEqual(expect.objectContaining({
      type: 'paragraph',
      content: expect.arrayContaining([
        expect.objectContaining({
          type: 'link',
          href: 'https://example.com',
          content: [expect.objectContaining({
            type: 'text',
            text: 'some-symbol',
            styles: expect.objectContaining({ code: true }),
          })],
        }),
      ]),
    }))
    expect(resolved.markdown).toBe(`${content}\n`)
  })

  it('preserves linked inline code when another block requires BlockNote parsing', async () => {
    const content = [
      'See [`some-symbol`](https://example.com) for details.',
      '',
      '![Diagram](https://example.com/diagram.png)',
    ].join('\n')

    const resolved = await reloadRichEditorMarkdown(content, 'linked-inline-code-with-image.md')

    expect(resolved.markdown).toBe(`${content}\n`)
  })

  it('keeps underscored wikilinks stable across repeated rich-editor reloads', async () => {
    const editor = BlockNoteEditor.create({ schema })
    installRichEditorMarkdownSerializer(editor)
    const content = [
      '# Wikilink reload',
      '',
      'Keep [[a_b]], [[2026-05-29_meeting_notes]], and [[path\\target_under_score]] stable.',
    ].join('\n')

    const firstResolution = await resolveBlocksForTarget({
      cache: new Map(),
      content,
      editor,
      targetPath: 'wikilink-reload.md',
    })
    const firstSave = serializeRichEditorDocumentToMarkdown({
      blocks: firstResolution.blocks,
      editor,
      tabContent: content,
    })
    const secondResolution = await resolveBlocksForTarget({
      cache: new Map(),
      content: firstSave,
      editor,
      targetPath: 'wikilink-reload.md',
    })

    expect(serializeRichEditorDocumentToMarkdown({
      blocks: secondResolution.blocks,
      editor,
      tabContent: firstSave,
    })).toBe(`${content}\n`)
  })

  it('keeps empty-alt image embeds as editable image blocks', async () => {
    tauriMode.enabled = true
    const editor = BlockNoteEditor.create({ schema })
    installRichEditorMarkdownSerializer(editor)
    const content = '![](attachments/photo2.png)'
    const targetPath = '/vault/empty-alt-image.md'
    const imageUrl = `asset://localhost/${encodeURIComponent('/vault/attachments/photo2.png')}`

    const resolved = await resolveBlocksForTarget({
      cache: new Map(),
      content,
      editor,
      targetPath,
      vaultPath: '/vault',
    })

    expect(resolved.blocks).toContainEqual(expect.objectContaining({
      type: 'image',
      props: expect.objectContaining({
        name: '',
        url: imageUrl,
      }),
    }))
    expect(serializeRichEditorDocumentToMarkdown({
      blocks: resolved.blocks,
      editor,
      notePath: targetPath,
      tabContent: content,
      vaultPath: '/vault',
    })).toBe(`${content}\n`)
  })

  it.each([
    {
      content: ['First paragraph.', '', '', 'Second paragraph.'].join('\n'),
      expectedType: 'paragraph',
      name: 'manually inserted blank paragraphs through rich/raw round-trips',
      targetPath: 'blank-paragraph-spacing.md',
    },
    {
      content: ['> First quoted paragraph.', '>', '> Second quoted paragraph.'].join('\n'),
      expectedType: 'quote',
      name: 'blank quoted paragraphs through rich-editor reloads',
      targetPath: 'blockquote-paragraph-spacing.md',
    },
  ])('preserves $name', async ({ content, expectedType, targetPath }) => {
    const resolved = await reloadRichEditorMarkdown(content, targetPath)

    expect(resolved.blocks).toEqual([
      expect.objectContaining({ type: expectedType, content: expect.any(Array) }),
      expect.objectContaining({ type: expectedType, content: [] }),
      expect.objectContaining({ type: expectedType, content: expect.any(Array) }),
    ])
    expect(resolved.markdown).toBe(`${content}\n`)
  })
})
