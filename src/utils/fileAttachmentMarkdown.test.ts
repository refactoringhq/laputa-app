import { describe, expect, it, vi } from 'vitest'
import {
  injectDurableEditorMarkdownBlocks,
  preProcessDurableEditorMarkdown,
} from './editorDurableMarkdown'
import { preProcessFileAttachmentMarkdown } from './fileAttachmentMarkdown'
import { serializeRichEditorDocumentToMarkdown } from './richEditorMarkdown'

function makeEditor(document: unknown[], markdownLossy = '') {
  return {
    document,
    blocksToMarkdownLossy: vi.fn(() => markdownLossy),
  }
}

function fileBlock(name: string, url: string) {
  return {
    children: [],
    props: { name, url },
    type: 'file',
  }
}

function serializeFileBlocks(blocks: unknown[], markdownLossy = '') {
  return serializeRichEditorDocumentToMarkdown({
    editor: makeEditor(blocks, markdownLossy) as never,
    notePath: 'a.md',
    tabContent: '---\ntitle: Note A\n---\n',
    vaultPath: '/vault',
  })
}

function parsePreprocessedParagraph(markdown: string) {
  return [{
    type: 'paragraph',
    content: [{ type: 'text', text: markdown.trim(), styles: {} }],
    children: [],
  }]
}

function attachmentTokenCount(markdown: string): number {
  return markdown.match(/@@TOLARIA_FILE_ATTACHMENT:/gu)?.length ?? 0
}

describe('file attachment Markdown roundtrip', () => {
  it('serializes file blocks as portable attachment links', () => {
    expect(serializeFileBlocks([
      fileBlock('report.pdf', 'asset://localhost/%2Fvault%2Fattachments%2Freport.pdf'),
    ])).toBe('---\ntitle: Note A\n---\n[report.pdf](attachments/report.pdf)\n')
  })

  it('normalizes embedded file paths from the current attachments folder', () => {
    const pdfPath = '/vault/attachments/project brief.pdf'
    const editor = makeEditor([
      fileBlock('project brief.pdf', pdfPath),
    ], 'unreachable lossy markdown')

    expect(serializeRichEditorDocumentToMarkdown({
      editor: editor as never,
      notePath: 'a.md',
      tabContent: '---\ntitle: Note A\n---\n',
      vaultPath: '/vault',
    })).toBe('---\ntitle: Note A\n---\n[project brief.pdf](<attachments/project brief.pdf>)\n')
    expect(editor.blocksToMarkdownLossy).not.toHaveBeenCalled()
  })

  it('keeps embedded file paths outside the current attachments folder untouched', () => {
    const pdfPath = '/shared/attachments/project brief.pdf'
    expect(serializeFileBlocks([
      fileBlock('project brief.pdf', pdfPath),
    ], `[project brief.pdf](<${pdfPath}>)`)).toBe(
      '---\ntitle: Note A\n---\n[project brief.pdf](</shared/attachments/project brief.pdf>)\n',
    )
  })

  it('rebuilds file blocks from standalone attachment links', () => {
    const preprocessed = preProcessDurableEditorMarkdown({
      markdown: '[report.pdf](attachments/report.pdf)\n',
    })

    expect(injectDurableEditorMarkdownBlocks(parsePreprocessedParagraph(preprocessed))).toEqual([
      expect.objectContaining({
        type: 'file',
        props: expect.objectContaining({
          name: 'report.pdf',
          url: 'attachments/report.pdf',
        }),
      }),
    ])
  })

  it('does not rebuild attachment links inside backtick or tilde fenced code', () => {
    const markdown = [
      '[outside.pdf](attachments/outside.pdf)',
      '```md',
      '[inside.pdf](attachments/inside.pdf)',
      '```',
      '~~~md',
      '[inside-tilde.pdf](attachments/inside-tilde.pdf)',
      '~~~',
      '[after.pdf](attachments/after.pdf)',
    ].join('\n')

    const preprocessed = preProcessFileAttachmentMarkdown({ markdown })

    expect(attachmentTokenCount(preprocessed)).toBe(2)
    expect(preprocessed).toContain('[inside.pdf](attachments/inside.pdf)')
    expect(preprocessed).toContain('[inside-tilde.pdf](attachments/inside-tilde.pdf)')
    expect(preprocessed).not.toContain('[outside.pdf](attachments/outside.pdf)')
    expect(preprocessed).not.toContain('[after.pdf](attachments/after.pdf)')
  })

  it('requires a closing fence to be at least as long as the opening fence', () => {
    const markdown = [
      '````md',
      '[inside.pdf](attachments/inside.pdf)',
      '```',
      '[still-inside.pdf](attachments/still-inside.pdf)',
      '````',
      '[outside.pdf](attachments/outside.pdf)',
    ].join('\n')

    const preprocessed = preProcessFileAttachmentMarkdown({ markdown })

    expect(attachmentTokenCount(preprocessed)).toBe(1)
    expect(preprocessed).toContain('[inside.pdf](attachments/inside.pdf)')
    expect(preprocessed).toContain('[still-inside.pdf](attachments/still-inside.pdf)')
    expect(preprocessed).not.toContain('[outside.pdf](attachments/outside.pdf)')
  })
})
