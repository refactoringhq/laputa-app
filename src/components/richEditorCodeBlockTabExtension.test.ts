import { describe, expect, it, vi } from 'vitest'
import { createRichEditorCodeBlockTabExtension } from './richEditorCodeBlockTabExtension'

type KeyListener = (event: KeyboardEvent) => void

type MockTransaction = {
  insertText: ReturnType<typeof vi.fn>
}

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
    stopPropagation: vi.fn(),
    ...options,
  } as unknown as KeyboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>
    stopImmediatePropagation: ReturnType<typeof vi.fn>
    stopPropagation: ReturnType<typeof vi.fn>
  }
}

function createFixture({ blockType = 'codeBlock', editable = true, composing = false } = {}) {
  let keydownListener: KeyListener | null = null
  const transaction: MockTransaction = {
    insertText: vi.fn(),
  }
  const view = { composing }
  const editor = {
    _tiptapEditor: { view },
    getTextCursorPosition: vi.fn(() => ({
      block: { id: 'block-1', type: blockType },
    })),
    isEditable: editable,
    prosemirrorView: view,
    transact: vi.fn((callback: (tr: MockTransaction) => boolean) => callback(transaction)),
  }
  const dom = {
    addEventListener: vi.fn((type: string, listener: KeyListener) => {
      if (type === 'keydown') keydownListener = listener
    }),
  }
  const extension = createRichEditorCodeBlockTabExtension()({ editor: editor as never })

  return {
    dom,
    editor,
    fireKeydown(event = keyboardEvent()) {
      if (!keydownListener) {
        throw new Error('Rich code block Tab extension did not register keydown')
      }
      keydownListener(event)
      return event
    },
    mount() {
      const controller = new AbortController()
      extension.mount?.({
        dom: dom as never,
        root: document,
        signal: controller.signal,
      })
      return controller
    },
    transaction,
  }
}

describe('createRichEditorCodeBlockTabExtension', () => {
  it('registers a capture-phase keydown listener when the editor mounts', () => {
    const fixture = createFixture()

    fixture.mount()

    expect(fixture.dom.addEventListener).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function),
      expect.objectContaining({
        capture: true,
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('inserts code indentation and keeps focus inside source code blocks', () => {
    const fixture = createFixture()
    fixture.mount()

    const event = fixture.fireKeydown()

    expect(fixture.transaction.insertText).toHaveBeenCalledWith('  ')
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopImmediatePropagation).toHaveBeenCalled()
  })

  it('does not intercept Tab outside code blocks', () => {
    const fixture = createFixture({ blockType: 'paragraph' })
    fixture.mount()

    const event = fixture.fireKeydown()

    expect(fixture.transaction.insertText).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled()
  })

  it('leaves composing and read-only editor states alone', () => {
    const composingFixture = createFixture({ composing: true })
    composingFixture.mount()
    composingFixture.fireKeydown()
    expect(composingFixture.transaction.insertText).not.toHaveBeenCalled()

    const readonlyFixture = createFixture({ editable: false })
    readonlyFixture.mount()
    readonlyFixture.fireKeydown()
    expect(readonlyFixture.transaction.insertText).not.toHaveBeenCalled()
  })
})
