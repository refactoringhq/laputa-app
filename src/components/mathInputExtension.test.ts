import { describe, expect, it, vi } from 'vitest'
import { createMathInputExtension } from './mathInputExtension'

function createTransaction() {
  const transaction = {
    replaceWith: vi.fn(() => transaction),
    insertText: vi.fn(() => transaction),
    scrollIntoView: vi.fn(() => transaction),
  }
  return transaction
}

function createView(beforeText: string, transaction: ReturnType<typeof createTransaction>) {
  const mathNode = { nodeSize: 1 }
  const selection = {
    from: beforeText.length,
    to: beforeText.length,
    $from: {
      parent: {
        isTextblock: true,
        textBetween: vi.fn(() => beforeText),
      },
      parentOffset: beforeText.length,
      marks: vi.fn(() => []),
    },
  }
  const mathNodeType = { createChecked: vi.fn(() => mathNode) }
  const view = {
    composing: false,
    dispatch: vi.fn(),
    state: {
      schema: { nodes: { mathInline: mathNodeType } },
      selection,
      storedMarks: null as Array<{ type: { name: string } }> | null,
      tr: transaction,
    },
  }

  return { mathNode, mathNodeType, view }
}

function createDom(registerBeforeInput: (listener: (event: InputEvent) => void) => void) {
  const dom = {
    addEventListener: vi.fn((type: string, listener: (event: InputEvent) => void) => {
      if (type === 'beforeinput') {
        registerBeforeInput(listener)
      }
    }),
  }
  return dom
}

function createFixture(beforeText = 'Inline $x^2$') {
  let beforeInputListener: ((event: InputEvent) => void) | null = null
  const transaction = createTransaction()
  const { mathNode, mathNodeType, view } = createView(beforeText, transaction)
  const dom = createDom((listener) => {
    beforeInputListener = listener
  })
  const editor = {
    _tiptapEditor: { view },
    prosemirrorView: view,
  }
  const extension = createMathInputExtension()({ editor: editor as never })

  return {
    dom,
    extension,
    fireInput(event: Partial<InputEvent> = {}) {
      if (!beforeInputListener) {
        throw new Error('Math input extension did not register a beforeinput listener')
      }

      const inputEvent = {
        data: ' ',
        inputType: 'insertText',
        isComposing: false,
        preventDefault: vi.fn(),
        ...event,
      }

      beforeInputListener(inputEvent as InputEvent)
      return inputEvent
    },
    mathNode,
    mathNodeType,
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

describe('createMathInputExtension', () => {
  it('registers a beforeinput listener when the editor mounts', () => {
    const fixture = createFixture()

    fixture.mount()

    expect(fixture.dom.addEventListener).toHaveBeenCalledWith(
      'beforeinput',
      expect.any(Function),
      expect.objectContaining({
        capture: true,
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('replaces completed inline math before inserting whitespace', () => {
    const fixture = createFixture()
    fixture.mount()

    const event = fixture.fireInput()

    expect(fixture.mathNodeType.createChecked).toHaveBeenCalledWith({ latex: 'x^2' })
    expect(fixture.transaction.replaceWith).toHaveBeenCalledWith(7, 12, fixture.mathNode)
    expect(fixture.transaction.insertText).toHaveBeenCalledWith(' ', 8)
    expect(fixture.transaction.scrollIntoView).toHaveBeenCalled()
    expect(fixture.view.dispatch).toHaveBeenCalledWith(fixture.transaction)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('replaces completed inline math before a new paragraph without swallowing the newline', () => {
    const fixture = createFixture()
    fixture.mount()

    const event = fixture.fireInput({ data: null, inputType: 'insertParagraph' })

    expect(fixture.transaction.replaceWith).toHaveBeenCalledWith(7, 12, fixture.mathNode)
    expect(fixture.transaction.insertText).not.toHaveBeenCalled()
    expect(fixture.view.dispatch).toHaveBeenCalledWith(fixture.transaction)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('ignores non-whitespace text input', () => {
    const fixture = createFixture()
    fixture.mount()

    const event = fixture.fireInput({ data: '.', inputType: 'insertText' })

    expect(fixture.transaction.replaceWith).not.toHaveBeenCalled()
    expect(fixture.view.dispatch).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('ignores math-looking input inside inline code', () => {
    const fixture = createFixture()
    fixture.view.state.storedMarks = [{ type: { name: 'code' } }]
    fixture.mount()

    const event = fixture.fireInput()

    expect(fixture.transaction.replaceWith).not.toHaveBeenCalled()
    expect(fixture.view.dispatch).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
