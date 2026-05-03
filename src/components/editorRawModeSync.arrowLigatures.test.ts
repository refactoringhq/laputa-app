import { describe, expect, it, vi } from 'vitest'
import {
  rememberPendingRawExitContent,
  serializeEditorDocumentToMarkdown,
  syncActiveTabIntoRawBuffer,
} from './editorRawModeSync'

const mockEditor = {
  document: [{ id: 'paragraph-1', type: 'paragraph', content: [], props: {}, children: [] }],
  blocksToMarkdownLossy: vi.fn(),
}

describe('editorRawModeSync arrow ligatures', () => {
  it('preserves source markdown when raw mode opens without pending rich-editor edits', () => {
    const rawLatestContentRef = { current: null as string | null }
    const sourceContent = '---\ntitle: Pasted\n---\nFirst pasted line\nSecond pasted line\n'

    const result = syncActiveTabIntoRawBuffer({
      editor: mockEditor as never,
      activeTabPath: '/vault/pasted.md',
      activeTabContent: sourceContent,
      rawLatestContentRef,
      serializeRichEditorContent: false,
    })

    expect(result).toBe(sourceContent)
    expect(rawLatestContentRef.current).toBe(sourceContent)
    expect(mockEditor.blocksToMarkdownLossy).not.toHaveBeenCalled()
  })

  it('keeps unicode arrows intact when rich-editor content enters raw mode', () => {
    mockEditor.blocksToMarkdownLossy.mockReturnValueOnce('Flow → left ← both ↔\n')
    const rawLatestContentRef = { current: null as string | null }

    const result = syncActiveTabIntoRawBuffer({
      editor: mockEditor as never,
      activeTabPath: '/vault/flows.md',
      activeTabContent: '---\ntitle: Flows\n---\n\nFlow -> left <- both <->\n',
      rawLatestContentRef,
      serializeRichEditorContent: true,
    })

    expect(result).toBe('---\ntitle: Flows\n---\nFlow → left ← both ↔\n')
    expect(rawLatestContentRef.current).toBe(result)
  })

  it('keeps literal ASCII arrows intact when raw mode exits after an escaped edit', () => {
    const onContentChange = vi.fn()
    const rawAsciiContent = '---\ntitle: Flows\n---\nFlow <-> keeps <- and -> literal\n'

    const result = rememberPendingRawExitContent({
      activeTabPath: '/vault/flows.md',
      activeTabContent: '---\ntitle: Flows\n---\nFlow ↔ keeps ← and → rendered\n',
      rawInitialContent: '---\ntitle: Flows\n---\nFlow ↔ keeps ← and → rendered\n',
      rawLatestContentRef: { current: rawAsciiContent },
      onContentChange,
    })

    expect(result).toEqual({
      path: '/vault/flows.md',
      content: rawAsciiContent,
    })
    expect(onContentChange).toHaveBeenCalledWith('/vault/flows.md', rawAsciiContent)
  })

  it('serializes rich content with arrows without rewriting the characters', () => {
    mockEditor.blocksToMarkdownLossy.mockReturnValueOnce('A → B, B ← C, A ↔ C\n')

    expect(serializeEditorDocumentToMarkdown(
      mockEditor as never,
      '---\ntitle: Graph\n---\n',
    )).toBe('---\ntitle: Graph\n---\nA → B, B ← C, A ↔ C\n')
  })
})
