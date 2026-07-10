import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { createMathInputExtension } from './mathInputExtension'
import { trackEvent } from '../lib/telemetry'
import { MATH_BLOCK_TYPE, MATH_INLINE_TYPE } from '../utils/mathMarkdown'

vi.mock('../lib/telemetry', () => ({
  trackEvent: vi.fn(),
}))

function transformError(message = 'Invalid math transform') {
  const error = new Error(message)
  error.name = 'TransformError'
  return error
}

function createTransaction() {
  const transaction = {
    replaceWith: vi.fn(() => transaction),
    insertText: vi.fn(() => transaction),
    scrollIntoView: vi.fn(() => transaction),
  }
  return transaction
}

function createMathNode(type: string, latex: string, nodeSize = 1) {
  return {
    attrs: { latex },
    nodeSize,
    type: { name: type },
  }
}

function createView(beforeText: string, transaction: ReturnType<typeof createTransaction>) {
  const mathNode = { nodeSize: 1 }
  const textNodeFor = vi.fn((text: string) => ({ text, type: 'text' }))
  const paragraphNodeType = {
    createChecked: vi.fn((attrs: Record<string, unknown>, content: unknown) => ({
      attrs,
      content,
      type: 'paragraph',
    })),
  }
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
  const docNodes: Array<{ node: ReturnType<typeof createMathNode>; pos: number }> = []
  const doc = {
    content: { size: 100 },
    nodesBetween: vi.fn((
      from: number,
      to: number,
      visit: (node: ReturnType<typeof createMathNode>, pos: number) => boolean | void,
    ) => {
      for (const item of docNodes) {
        const nodeEnd = item.pos + item.node.nodeSize
        if (nodeEnd < from || item.pos > to) continue
        if (visit(item.node, item.pos) === false) return
      }
    }),
  }
  const view = {
    composing: false,
    dispatch: vi.fn(),
    posAtDOM: vi.fn(() => 0),
    state: {
      doc,
      schema: {
        nodes: {
          mathInline: mathNodeType,
          paragraph: paragraphNodeType,
        },
        text: textNodeFor,
      },
      selection,
      storedMarks: null as Array<{ type: { name: string } }> | null,
      tr: transaction,
    },
  }

  return { docNodes, mathNode, mathNodeType, paragraphNodeType, textNodeFor, view }
}

function createDom(registerListener: (type: string, listener: EventListener) => void) {
  const dom = {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      registerListener(type, listener)
    }),
  }
  return dom
}

function createFixture(beforeText = 'Inline $x^2$') {
  const listeners = new Map<string, EventListener>()
  const transaction = createTransaction()
  const { docNodes, mathNode, mathNodeType, paragraphNodeType, textNodeFor, view } = createView(beforeText, transaction)
  const dom = createDom((type, listener) => {
    listeners.set(type, listener)
  })
  dom.addEventListener.mockImplementation((type: string, listener: EventListener) => {
    listeners.set(type, listener)
  })
  const setTextSelection = vi.fn()
  const editor = {
    _tiptapEditor: { commands: { setTextSelection }, view },
    prosemirrorView: view,
  }
  const extension = createMathInputExtension()({ editor: editor as never })

  return {
    docNodes,
    dom,
    editor,
    extension,
    fireInput(event: Partial<InputEvent> = {}) {
      const beforeInputListener = listeners.get('beforeinput')
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
    fireKeyDown(event: Partial<KeyboardEvent> = {}) {
      const keyDownListener = listeners.get('keydown')
      if (!keyDownListener) {
        throw new Error('Math input extension did not register a keydown listener')
      }

      const keyDownEvent = {
        key: 'F2',
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        ...event,
      }

      keyDownListener(keyDownEvent as KeyboardEvent)
      return keyDownEvent
    },
    fireMathDoubleClick(target: EventTarget) {
      const doubleClickListener = listeners.get('dblclick')
      if (!doubleClickListener) {
        throw new Error('Math input extension did not register a dblclick listener')
      }

      const event = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        target,
      }

      doubleClickListener(event as unknown as MouseEvent)
      return event
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
    paragraphNodeType,
    setTextSelection,
    textNodeFor,
    transaction,
    view,
  }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

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

  it('falls back to native input when an inline math transform is stale', () => {
    const fixture = createFixture()
    fixture.transaction.replaceWith.mockImplementation(() => {
      throw transformError()
    })
    fixture.mount()

    const event = fixture.fireInput()

    expect(fixture.view.dispatch).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith('rich_editor_transform_error_recovered', {
      reason: 'transform_error',
    })
  })

  it('restores rendered inline math source on double click', () => {
    const fixture = createFixture()
    const latex = 'x^2'
    const mathElement = document.createElement('span')
    mathElement.className = 'math math--inline'
    mathElement.dataset.latex = latex
    const glyphText = document.createTextNode('x')
    mathElement.append(glyphText)
    const renderedNode = createMathNode(MATH_INLINE_TYPE, latex)
    fixture.docNodes.push({ node: renderedNode, pos: 7 })
    fixture.view.posAtDOM.mockReturnValue(7)
    fixture.mount()

    const event = fixture.fireMathDoubleClick(glyphText)

    expect(fixture.textNodeFor).toHaveBeenCalledWith('$x^2$')
    expect(fixture.transaction.replaceWith).toHaveBeenCalledWith(7, 8, {
      text: '$x^2$',
      type: 'text',
    })
    expect(fixture.transaction.scrollIntoView).toHaveBeenCalled()
    expect(fixture.view.dispatch).toHaveBeenCalledWith(fixture.transaction)
    expect(fixture.setTextSelection).toHaveBeenCalledWith({ from: 8, to: 11 })
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith('math_source_edit_reopened', {
      activation: 'pointer',
      math_mode: 'inline',
    })
  })

  it('recovers stale selection transactions after rendered inline math source is restored', () => {
    const fixture = createFixture()
    const latex = 'x^2'
    const mathElement = document.createElement('span')
    mathElement.className = 'math math--inline'
    mathElement.dataset.latex = latex
    const glyphText = document.createTextNode('x')
    mathElement.append(glyphText)
    const renderedNode = createMathNode(MATH_INLINE_TYPE, latex)
    fixture.docNodes.push({ node: renderedNode, pos: 7 })
    fixture.view.posAtDOM.mockReturnValue(7)
    fixture.setTextSelection.mockImplementation(() => {
      throw new RangeError('Applying a mismatched transaction')
    })
    fixture.mount()

    const event = fixture.fireMathDoubleClick(glyphText)

    expect(fixture.view.dispatch).toHaveBeenCalledWith(fixture.transaction)
    expect(fixture.setTextSelection).toHaveBeenCalledWith({ from: 8, to: 11 })
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith('rich_editor_transform_error_recovered', {
      reason: 'mismatched_transaction',
    })
    expect(trackEvent).toHaveBeenCalledWith('math_source_edit_reopened', {
      activation: 'pointer',
      math_mode: 'inline',
    })
  })

  it('leaves rendered block math intact on double click', () => {
    const fixture = createFixture()
    const latex = '\\sqrt{x}'
    const mathElement = document.createElement('span')
    mathElement.className = 'math math--block'
    mathElement.dataset.latex = latex
    const renderedNode = createMathNode(MATH_BLOCK_TYPE, latex)
    fixture.docNodes.push({ node: renderedNode, pos: 20 })
    fixture.view.posAtDOM.mockReturnValue(20)
    fixture.mount()

    const event = fixture.fireMathDoubleClick(mathElement)

    expect(fixture.transaction.replaceWith).not.toHaveBeenCalled()
    expect(fixture.setTextSelection).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalledWith('math_source_edit_reopened', {
      activation: 'pointer',
      math_mode: 'block',
    })
  })

  it('restores selected math source from the keyboard', () => {
    const fixture = createFixture()
    const latex = 'E=mc^2'
    const selectedNode = createMathNode(MATH_INLINE_TYPE, latex)
    fixture.view.state.selection = {
      from: 12,
      node: selectedNode,
      to: 13,
    }
    fixture.mount()

    const event = fixture.fireKeyDown({ key: 'Enter' })

    expect(fixture.transaction.replaceWith).toHaveBeenCalledWith(12, 13, {
      text: '$E=mc^2$',
      type: 'text',
    })
    expect(fixture.setTextSelection).toHaveBeenCalledWith({ from: 13, to: 19 })
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith('math_source_edit_reopened', {
      activation: 'keyboard',
      math_mode: 'inline',
    })
  })

  it('leaves selected block math intact from the keyboard', () => {
    const fixture = createFixture()
    const selectedNode = createMathNode(MATH_BLOCK_TYPE, '\\sqrt{x}')
    fixture.view.state.selection = {
      from: 12,
      node: selectedNode,
      to: 13,
    }
    fixture.mount()

    const event = fixture.fireKeyDown({ key: 'Enter' })

    expect(fixture.transaction.replaceWith).not.toHaveBeenCalled()
    expect(fixture.setTextSelection).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
  })
})
