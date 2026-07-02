import { describe, expect, it, vi } from 'vitest'
import { clearParsedNoteBlockCache } from './editorParsedBlockCache'
import { resolveBlocksForTarget } from './editorBlockResolution'

function makeEditor() {
  return {
    tryParseMarkdownToBlocks: vi.fn(() => [{
      type: 'paragraph',
      content: [{ type: 'text', text: 'legacy parser', styles: {} }],
      children: [],
    }]),
  }
}

function longMarkdownBody(): string {
  const sections = Array.from({ length: 260 }, (_, index) => [
    `## Section ${index + 1}`,
    '',
    `Paragraph ${index + 1} with **bold** text and [[Project ${index + 1}]].`,
    '',
    '- One',
    '- Two',
  ].join('\n'))
  return `---\ntype: Note\n---\n\n# Large Note\n\n${sections.join('\n\n')}`
}

describe('resolveBlocksForTarget performance paths', () => {
  it('uses the direct Markdown parser for large common Markdown notes', async () => {
    const editor = makeEditor()
    const content = longMarkdownBody()

    const resolved = await resolveBlocksForTarget({
      editor: editor as never,
      cache: new Map(),
      targetPath: '/vault/large.md',
      content,
    })

    expect(editor.tryParseMarkdownToBlocks).not.toHaveBeenCalled()
    expect(resolved.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'heading' }),
      expect.objectContaining({ type: 'paragraph' }),
      expect.objectContaining({ type: 'bulletListItem' }),
    ]))
  })

  it('falls back to BlockNote parsing when direct Markdown parsing rejects a large note', async () => {
    const editor = makeEditor()
    const content = `${longMarkdownBody()}\n\n<aside>custom html</aside>`

    await resolveBlocksForTarget({
      editor: editor as never,
      cache: new Map(),
      targetPath: '/vault/html.md',
      content,
    })

    expect(editor.tryParseMarkdownToBlocks).toHaveBeenCalled()
  })

  it('falls back to BlockNote parsing for large notes with Markdown images', async () => {
    const editor = makeEditor()
    const content = `${longMarkdownBody()}\n\n![diagram](attachments/diagram.png)`

    await resolveBlocksForTarget({
      editor: editor as never,
      cache: new Map(),
      targetPath: '/vault/image.md',
      content,
    })

    expect(editor.tryParseMarkdownToBlocks).toHaveBeenCalled()
  })

  it('keeps parsed-cache reads ahead of direct parsing', async () => {
    clearParsedNoteBlockCache()
    const editor = makeEditor()
    const content = longMarkdownBody()
    const warmedBlocks = [{
      type: 'paragraph',
      content: [{ type: 'text', text: 'warmed', styles: {} }],
      children: [],
    }]

    const { cacheParsedNoteBlocks } = await import('./editorParsedBlockCache')
    cacheParsedNoteBlocks({
      path: '/vault/warmed.md',
      sourceContent: content,
      blocks: warmedBlocks,
      scrollTop: 12,
    })

    const resolved = await resolveBlocksForTarget({
      editor: editor as never,
      cache: new Map(),
      targetPath: '/vault/warmed.md',
      content,
    })

    expect(editor.tryParseMarkdownToBlocks).not.toHaveBeenCalled()
    expect(resolved.scrollTop).toBe(12)
    expect(resolved.blocks).toEqual(warmedBlocks)
  })
})
