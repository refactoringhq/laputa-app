import { describe, expect, it, vi } from 'vitest'
import { createRichEditorListTabExtension } from './richEditorListTabExtension'

type KeyListener = (event: KeyboardEvent) => void

function keyboardEvent(options: Partial<KeyboardEvent> = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    isComposing: false,
    key: 'Tab',
    keyCode: 9,
    metaKey: false,
    preventDefault: vi.fn(),
    shiftKey: false,
    stopImmediatePropagation: vi.fn(),
    ...options,
  } as unknown as KeyboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>
    stopImmediatePropagation: ReturnType<typeof vi.fn>
  }
}

function createFixture({
  blockType = 'bulletListItem',
  canNest = true,
  canUnnest = true,
  composing = false,
  editable = true,
} = {}) {
  let keydownListener: KeyListener | null = null
  const view = { composing }
  const editor = {
    _tiptapEditor: { view },
    canNestBlock: vi.fn(() => canNest),
    canUnnestBlock: vi.fn(() => canUnnest),
    getTextCursorPosition: vi.fn(() => ({ block: { type: blockType } })),
    isEditable: editable,
    nestBlock: vi.fn(),
    prosemirrorView: view,
    unnestBlock: vi.fn(),
  }
  const dom = {
    addEventListener: vi.fn((type: string, listener: KeyListener) => {
      if (type === 'keydown') keydownListener = listener
    }),
  }
  const extension = createRichEditorListTabExtension()({ editor: editor as never })
  extension.mount?.({
    dom: dom as never,
    root: document,
    signal: new AbortController().signal,
  })

  return {
    dom,
    editor,
    fire(options: Partial<KeyboardEvent> = {}) {
      if (!keydownListener) throw new Error('List Tab extension did not register keydown')
      const event = keyboardEvent(options)
      keydownListener(event)
      return event
    },
  }
}

describe('createRichEditorListTabExtension', () => {
  it('indents a list item and consumes Tab', () => {
    const fixture = createFixture()
    const event = fixture.fire()

    expect(fixture.editor.nestBlock).toHaveBeenCalledOnce()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce()
  })

  it('keeps Tab inside a list when no deeper indent is possible', () => {
    const fixture = createFixture({ canNest: false })
    const event = fixture.fire()

    expect(fixture.editor.nestBlock).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce()
  })

  it('outdents nested list items with Shift+Tab', () => {
    const fixture = createFixture()
    const event = fixture.fire({ shiftKey: true })

    expect(fixture.editor.unnestBlock).toHaveBeenCalledOnce()
    expect(fixture.editor.nestBlock).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('consumes Shift+Tab at the list root without changing nesting', () => {
    const fixture = createFixture({ canUnnest: false })
    const event = fixture.fire({ shiftKey: true })

    expect(fixture.editor.unnestBlock).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('leaves non-list, modified, composing, and read-only Tab events alone', () => {
    expect(createFixture({ blockType: 'paragraph' }).fire().preventDefault).not.toHaveBeenCalled()
    expect(createFixture().fire({ metaKey: true }).preventDefault).not.toHaveBeenCalled()
    expect(createFixture({ composing: true }).fire().preventDefault).not.toHaveBeenCalled()
    expect(createFixture({ editable: false }).fire().preventDefault).not.toHaveBeenCalled()
  })
})
