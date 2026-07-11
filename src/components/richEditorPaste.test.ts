import { describe, expect, it, vi } from 'vitest'
import { handleRichEditorPaste, type RichEditorPasteContext } from './richEditorPaste'

function clipboardDataFor(data: Record<string, string>): DataTransfer {
  return {
    getData: vi.fn((type: string) => data[type] ?? ''),
    types: Object.keys(data),
  } as unknown as DataTransfer
}

function pasteContext(data: Record<string, string>): RichEditorPasteContext {
  return {
    defaultPasteHandler: vi.fn(() => true),
    editor: { pasteText: vi.fn(() => true) },
    event: {
      clipboardData: clipboardDataFor(data),
    } as unknown as ClipboardEvent,
  }
}

describe('handleRichEditorPaste', () => {
  it('prioritizes pasted web HTML when it contains images', () => {
    const context = pasteContext({
      'text/html': '<article><p>Intro</p><img src="https://example.com/photo.png" alt="Photo"></article>',
      'text/plain': 'Intro',
    })

    expect(handleRichEditorPaste(context)).toBe(true)

    expect(context.defaultPasteHandler).toHaveBeenCalledWith({ prioritizeMarkdownOverHTML: false })
    expect(context.editor.pasteText).not.toHaveBeenCalled()
  })

  it('keeps internal BlockNote image clips on the regular paste path', () => {
    const context = pasteContext({
      'blocknote/html': '<div data-content-type="image"></div>',
      'text/html': '<img src="asset://localhost/photo.png">',
      'text/plain': '![photo](attachments/photo.png)',
    })

    expect(handleRichEditorPaste(context)).toBe(true)

    expect(context.defaultPasteHandler).toHaveBeenCalledWith()
  })
})
