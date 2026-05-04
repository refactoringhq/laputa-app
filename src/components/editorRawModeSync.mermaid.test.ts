import { describe, expect, it, vi } from 'vitest'
import { MERMAID_BLOCK_TYPE } from '../utils/mermaidMarkdown'
import { TLDRAW_BLOCK_TYPE } from '../utils/tldrawMarkdown'
import { serializeEditorDocumentToMarkdown, syncActiveTabIntoRawBuffer } from './editorRawModeSync'

describe('editorRawModeSync Mermaid serialization', () => {
  it('keeps the original fenced Mermaid source when rich content enters raw mode', () => {
    const source = [
      '~~~mermaid',
      'flowchart LR',
      '  A["Draft"] --> B["Saved"]',
      '~~~',
    ].join('\n')
    const editor = {
      document: [{
        id: 'diagram-1',
        type: MERMAID_BLOCK_TYPE,
        props: {
          source,
          diagram: 'flowchart LR\n  A["Draft"] --> B["Saved"]\n',
        },
        children: [],
      }],
      blocksToMarkdownLossy: vi.fn(),
    }

    expect(serializeEditorDocumentToMarkdown(
      editor as never,
      '---\ntitle: Flow\n---\n\n# Flow\n',
    )).toBe(`---\ntitle: Flow\n---\n${source}\n`)
  })

  it('serializes durable blocks into raw mode even when no pending rich edit was flushed', () => {
    const rawLatestContentRef = { current: null as string | null }
    const editor = {
      document: [{
        id: 'board-1',
        type: TLDRAW_BLOCK_TYPE,
        props: {
          boardId: 'planning-map',
          height: '520',
          snapshot: '{}',
          width: '',
        },
        children: [],
      }],
      blocksToMarkdownLossy: vi.fn(),
    }

    const synced = syncActiveTabIntoRawBuffer({
      editor: editor as never,
      activeTabPath: 'note/whiteboard-embed.md',
      activeTabContent: [
        '# Whiteboard Embed',
        '',
        '```tldraw id="planning-map"',
        '{}',
        '```',
      ].join('\n'),
      rawLatestContentRef,
      serializeRichEditorContent: false,
    })

    expect(synced).toContain('```tldraw id="planning-map" height="520"')
    expect(rawLatestContentRef.current).toBe(synced)
  })
})
