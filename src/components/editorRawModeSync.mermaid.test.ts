import { describe, expect, it, vi } from 'vitest'
import { MERMAID_BLOCK_TYPE } from '../utils/mermaidMarkdown'
import { serializeEditorDocumentToMarkdown } from './editorRawModeSync'

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
})
