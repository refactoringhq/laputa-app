import { describe, expect, it, vi } from 'vitest'
import { createMathInputExtension } from './mathInputExtension'

vi.mock('prosemirror-commands', () => ({
  splitBlock: vi.fn(),
}))

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
  const mathBlockNodeType = {}
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
      schema: { nodes: { mathBlock: mathBlockNodeType, mathInline: mathNodeType } },
      selection,
      storedMarks: null as Array<{ type: { name: string } }> | null,
      tr: transaction,
    },
  }

  return { mathBlockNodeType, mathNode, mathNodeType, view }
}

function createDom(
  registerBeforeInput: (listener: (event: InputEvent) => void) => void,
  registerInput: (listener: (event: InputEvent) => void) => void,
  registerCursorExit: (listener: () => void) => void,
) {
  const dom = {
    ownerDocument: document,
    addEventListener: vi.fn((type: string, listener: (event: InputEvent) => void) => {
      if (type === 'beforeinput') {
        registerBeforeInput(listener)
      }
      if (type === 'input') {
        registerInput(listener)
      }
      if (type === 'keyup' || type === 'mouseup') {
        registerCursorExit(listener as () => void)
      }
    }),
  }
  return dom
}

function createRoot(registerSelectionChange: (listener: () => void) => void) {
  const root = {
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === 'selectionchange') {
        registerSelectionChange(listener)
      }
    }),
  }
  return root
}

function createFixture(beforeText = 'Inline $x^2$') {
  let beforeInputListener: ((event: InputEvent) => void) | null = null
  let inputListener: ((event: InputEvent) => void) | null = null
  const cursorExitListeners: Array<() => void> = []
  let selectionChangeListener: (() => void) | null = null
  const transaction = createTransaction()
  const { mathNode, mathNodeType, view } = createView(beforeText, transaction)
  const currentBlock = { id: 'block-1', type: 'paragraph' }
  const updatedBlock = { id: 'block-1', type: 'mathBlock' }
  const nextBlock = { id: 'block-2', type: 'paragraph' }
  const dom = createDom(
    (listener) => { beforeInputListener = listener },
    (listener) => { inputListener = listener },
    (listener) => { cursorExitListeners.push(listener) },
  )
  const root = createRoot((listener) => { selectionChangeListener = listener })
  const editor = {
    _tiptapEditor: { view },
    getTextCursorPosition: vi.fn(() => ({ block: currentBlock })),
    insertBlocks: vi.fn(() => [nextBlock]),
    prosemirrorView: view,
    setTextCursorPosition: vi.fn(),
    updateBlock: vi.fn(() => updatedBlock),
  }
  const extension = createMathInputExtension()({ editor: editor as never })

  return {
    dom,
    editor,
    extension,
    fireCursorExit(listenerIndex = 0) {
      const listener = cursorExitListeners[listenerIndex]
      if (!listener) {
        throw new Error('Math input extension did not register a cursor-exit listener')
      }
      listener()
    },
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
    fireInsertedInput(event: Partial<InputEvent> = {}) {
      if (!inputListener) {
        throw new Error('Math input extension did not register an input listener')
      }

      const inputEvent = {
        data: '$',
        inputType: 'insertText',
        isComposing: false,
        preventDefault: vi.fn(),
        ...event,
      }

      inputListener(inputEvent as InputEvent)
      return inputEvent
    },
    fireSelectionChange() {
      if (!selectionChangeListener) {
        throw new Error('Math input extension did not register a selectionchange listener')
      }
      selectionChangeListener()
    },
    mathNode,
    mathNodeType,
    nextBlock,
    mount() {
      const controller = new AbortController()
      extension.mount?.({
        dom: dom as never,
        root: root as never,
        signal: controller.signal,
      })
      return controller
    },
    root,
    transaction,
    updatedBlock,
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
    expect(fixture.dom.addEventListener).toHaveBeenCalledWith(
      'input',
      expect.any(Function),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    )
    expect(fixture.dom.addEventListener).toHaveBeenCalledWith(
      'keyup',
      expect.any(Function),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    )
    expect(fixture.dom.addEventListener).toHaveBeenCalledWith(
      'mouseup',
      expect.any(Function),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    )
    expect(fixture.root.addEventListener).toHaveBeenCalledWith(
      'selectionchange',
      expect.any(Function),
      expect.objectContaining({
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

  it('replaces completed inline math immediately after the closing dollar is inserted', () => {
    const fixture = createFixture('Inline $x^2$')
    fixture.mount()

    const event = fixture.fireInsertedInput()

    expect(fixture.mathNodeType.createChecked).toHaveBeenCalledWith({ latex: 'x^2' })
    expect(fixture.transaction.replaceWith).toHaveBeenCalledWith(7, 12, fixture.mathNode)
    expect(fixture.transaction.insertText).not.toHaveBeenCalled()
    expect(fixture.view.dispatch).toHaveBeenCalledWith(fixture.transaction)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('replaces completed inline math before inserting the closing dollar', () => {
    const fixture = createFixture('Inline $x^2')
    fixture.mount()

    const event = fixture.fireInput({ data: '$' })

    expect(fixture.mathNodeType.createChecked).toHaveBeenCalledWith({ latex: 'x^2' })
    expect(fixture.transaction.replaceWith).toHaveBeenCalledWith(7, 11, fixture.mathNode)
    expect(fixture.transaction.insertText).not.toHaveBeenCalled()
    expect(fixture.view.dispatch).toHaveBeenCalledWith(fixture.transaction)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('replaces completed inline math after the cursor exits the closing dollar', () => {
    const fixture = createFixture('Inline $x^2$')
    fixture.mount()

    fixture.fireSelectionChange()

    expect(fixture.mathNodeType.createChecked).toHaveBeenCalledWith({ latex: 'x^2' })
    expect(fixture.transaction.replaceWith).toHaveBeenCalledWith(7, 12, fixture.mathNode)
    expect(fixture.view.dispatch).toHaveBeenCalledWith(fixture.transaction)
  })

  it('replaces completed inline math after keyboard cursor movement exits the closing dollar', () => {
    const fixture = createFixture('Inline $x$')
    fixture.mount()

    fixture.fireCursorExit()

    expect(fixture.mathNodeType.createChecked).toHaveBeenCalledWith({ latex: 'x' })
    expect(fixture.transaction.replaceWith).toHaveBeenCalledWith(7, 10, fixture.mathNode)
    expect(fixture.view.dispatch).toHaveBeenCalledWith(fixture.transaction)
  })

  it('replaces completed inline math before a new paragraph and splits the block', () => {
    const fixture = createFixture()
    fixture.mount()

    const event = fixture.fireInput({ data: null, inputType: 'insertParagraph' })

    expect(fixture.transaction.replaceWith).toHaveBeenCalledWith(7, 12, fixture.mathNode)
    expect(fixture.transaction.insertText).not.toHaveBeenCalled()
    expect(fixture.view.dispatch).toHaveBeenCalledWith(fixture.transaction)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('replaces completed display math with a rendered math block before inserting whitespace', () => {
    const fixture = createFixture('$$x^2$$')
    fixture.mount()

    const event = fixture.fireInput()

    expect(fixture.editor.updateBlock).toHaveBeenCalledWith(
      { id: 'block-1', type: 'paragraph' },
      { type: 'mathBlock', props: { latex: 'x^2' } },
    )
    expect(fixture.transaction.replaceWith).not.toHaveBeenCalled()
    expect(fixture.view.dispatch).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('replaces completed display math immediately after the closing dollars are inserted', () => {
    const fixture = createFixture('$$x^2$$')
    fixture.mount()

    const event = fixture.fireInsertedInput()

    expect(fixture.editor.updateBlock).toHaveBeenCalledWith(
      { id: 'block-1', type: 'paragraph' },
      { type: 'mathBlock', props: { latex: 'x^2' } },
    )
    expect(fixture.editor.insertBlocks).toHaveBeenCalledWith(
      [{ type: 'paragraph' }],
      fixture.updatedBlock,
      'after',
    )
    expect(fixture.editor.setTextCursorPosition).toHaveBeenCalledWith(fixture.nextBlock, 'start')
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('adds a paragraph after completed display math before a new paragraph input', () => {
    const fixture = createFixture('$$x^2$$')
    fixture.mount()

    const event = fixture.fireInput({ data: null, inputType: 'insertParagraph' })

    expect(fixture.editor.updateBlock).toHaveBeenCalledWith(
      { id: 'block-1', type: 'paragraph' },
      { type: 'mathBlock', props: { latex: 'x^2' } },
    )
    expect(fixture.editor.insertBlocks).toHaveBeenCalledWith(
      [{ type: 'paragraph' }],
      fixture.updatedBlock,
      'after',
    )
    expect(fixture.editor.setTextCursorPosition).toHaveBeenCalledWith(fixture.nextBlock, 'start')
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('ignores non-whitespace text input', () => {
    const fixture = createFixture()
    fixture.mount()

    const event = fixture.fireInput({ data: '.', inputType: 'insertText' })

    expect(fixture.transaction.replaceWith).not.toHaveBeenCalled()
    expect(fixture.view.dispatch).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('ignores inserted non-dollar text after input', () => {
    const fixture = createFixture('Inline $x^2')
    fixture.mount()

    fixture.fireInsertedInput({ data: '2' })

    expect(fixture.transaction.replaceWith).not.toHaveBeenCalled()
    expect(fixture.view.dispatch).not.toHaveBeenCalled()
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
