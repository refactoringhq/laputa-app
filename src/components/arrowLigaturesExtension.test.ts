import { describe, expect, it, vi } from 'vitest'
import { createArrowLigaturesExtension } from './arrowLigaturesExtension'

function createFixture() {
  let beforeInputListener: ((event: InputEvent) => void) | null = null
  const transaction = { insertText: vi.fn(() => transaction) }
  const paragraphNode = { type: { name: 'paragraph', spec: {} } }
  const view = {
    dispatch: vi.fn(),
    state: {
      doc: {
        textBetween: vi.fn(),
      },
      selection: {
        from: 2,
        to: 2,
        $from: {
          depth: 0,
          node: vi.fn(() => paragraphNode),
        },
      },
      tr: transaction,
    },
  }
  const dom = {
    addEventListener: vi.fn((type: string, listener: (event: InputEvent) => void) => {
      if (type === 'beforeinput') {
        beforeInputListener = listener
      }
    }),
  }
  const editor = {
    _tiptapEditor: { view },
    prosemirrorView: view,
  }
  const extension = createArrowLigaturesExtension()({ editor: editor as never })

  return {
    dom,
    editor,
    extension,
    fireInput(event: Partial<InputEvent> = {}) {
      if (!beforeInputListener) {
        throw new Error('Arrow ligatures extension did not register a beforeinput listener')
      }

      const inputEvent = {
        data: '>',
        inputType: 'insertText',
        preventDefault: vi.fn(),
        ...event,
      }

      beforeInputListener(inputEvent as InputEvent)
      return inputEvent
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
    view,
  }
}

describe('createArrowLigaturesExtension', () => {
  it('registers a beforeinput listener when the editor mounts', () => {
    const fixture = createFixture()

    fixture.mount()

    expect(fixture.dom.addEventListener).toHaveBeenCalledTimes(1)
    expect(fixture.dom.addEventListener).toHaveBeenCalledWith(
      'beforeinput',
      expect.any(Function),
      expect.objectContaining({
        capture: true,
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('replaces completed ASCII arrows through the mounted input listener', () => {
    const fixture = createFixture()
    fixture.mount()
    fixture.view.state.doc.textBetween.mockReturnValue('-')

    const event = fixture.fireInput()

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(fixture.transaction.insertText).toHaveBeenCalledWith('→', 1, 2)
    expect(fixture.view.dispatch).toHaveBeenCalledWith(fixture.transaction)
  })

  it('preserves escaped <-> as literal ASCII on the next keystroke', () => {
    const fixture = createFixture()
    fixture.mount()
    fixture.view.state.selection = { from: 3, to: 3 }

    fixture.view.state.doc.textBetween.mockReturnValueOnce('\\<')
    fixture.fireInput({ data: '-' })

    fixture.view.state.doc.textBetween.mockReturnValueOnce('<-')
    const event = fixture.fireInput({ data: '>' })

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(fixture.transaction.insertText).toHaveBeenCalledTimes(1)
    expect(fixture.transaction.insertText).toHaveBeenCalledWith('<-', 1, 3)
  })

  it('ignores non-text input so paste stays literal', () => {
    const fixture = createFixture()
    fixture.mount()

    const event = fixture.fireInput({ inputType: 'insertFromPaste' })

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(fixture.transaction.insertText).not.toHaveBeenCalled()
    expect(fixture.view.dispatch).not.toHaveBeenCalled()
  })

  it('does not replace arrows while typing inside code blocks', () => {
    const fixture = createFixture()
    fixture.mount()
    fixture.view.state.doc.textBetween.mockReturnValue('-')
    fixture.view.state.selection.$from.node.mockReturnValue({
      type: { name: 'codeBlock', spec: { code: true } },
    })

    const event = fixture.fireInput()

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(fixture.transaction.insertText).not.toHaveBeenCalled()
    expect(fixture.view.dispatch).not.toHaveBeenCalled()
  })

  it('ignores composing input so IME text is not rewritten', () => {
    const fixture = createFixture()
    fixture.mount()

    const event = fixture.fireInput({ isComposing: true })

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(fixture.transaction.insertText).not.toHaveBeenCalled()
    expect(fixture.view.dispatch).not.toHaveBeenCalled()
  })
})
