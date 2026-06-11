import { describe, expect, it, vi } from 'vitest'
import { MARKDOWN_HIGHLIGHT_STYLE } from '../utils/markdownHighlightMarkdown'
import { createRichEditorInputTransformExtension } from './richEditorInputTransform'
import { createRichEditorMarkdownInputTransformExtension } from './richEditorInputTransformExtension'

function createTransaction() {
  const transaction = {
    addMark: vi.fn(() => transaction),
    delete: vi.fn(() => transaction),
    insertText: vi.fn(() => transaction),
    replaceWith: vi.fn(() => transaction),
    scrollIntoView: vi.fn(() => transaction),
  }
  return transaction
}

function createFixture() {
  let beforeInputListener: EventListener | null = null
  let beforeText = ''
  let parentStart = 0
  let arrowPrefix = ''
  const transaction = createTransaction()
  const mathNode = { nodeSize: 1, type: 'mathInline' }
  const highlightMark = { type: { name: MARKDOWN_HIGHLIGHT_STYLE } }
  const highlightMarkType = { create: vi.fn(() => highlightMark) }
  const view = {
    composing: false,
    dispatch: vi.fn(),
    dom: { isConnected: true },
    state: {
      doc: {
        nodesBetween: vi.fn(),
        textBetween: vi.fn(() => arrowPrefix),
      },
      schema: {
        marks: {
          [MARKDOWN_HIGHLIGHT_STYLE]: highlightMarkType,
        },
        nodes: {
          mathInline: {
            createChecked: vi.fn(() => mathNode),
          },
        },
      },
      selection: {
        from: 0,
        to: 0,
        $from: {
          depth: 0,
          marks: vi.fn(() => []),
          node: vi.fn(() => ({ type: { name: 'paragraph', spec: {} } })),
          parent: {
            isTextblock: true,
            textBetween: vi.fn(() => beforeText),
          },
          parentOffset: 0,
        },
      },
      storedMarks: null,
      tr: transaction,
    },
  }
  const dom = {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'beforeinput') beforeInputListener = listener
    }),
  }
  const editor = {
    _tiptapEditor: { view },
    prosemirrorView: view,
  }
  const extension = createRichEditorMarkdownInputTransformExtension()({ editor: editor as never })

  function setCursorText(nextBeforeText: string, nextParentStart = 0) {
    beforeText = nextBeforeText
    parentStart = nextParentStart
    view.state.selection.from = parentStart + beforeText.length
    view.state.selection.to = parentStart + beforeText.length
    view.state.selection.$from.parentOffset = beforeText.length
  }

  return {
    dom,
    fireBeforeInput(event: Partial<InputEvent>) {
      if (!beforeInputListener) throw new Error('Combined input transform did not mount beforeinput')
      const inputEvent = {
        data: null,
        inputType: 'insertText',
        isComposing: false,
        preventDefault: vi.fn(),
        ...event,
      }

      beforeInputListener(inputEvent as InputEvent)
      return inputEvent
    },
    highlightMark,
    highlightMarkType,
    mathNode,
    mount() {
      const controller = new AbortController()
      extension.mount?.({
        dom: dom as never,
        root: document,
        signal: controller.signal,
      })
      return controller
    },
    setArrowPrefix(nextArrowPrefix: string) {
      arrowPrefix = nextArrowPrefix
    },
    setCursorText,
    transaction,
    view,
  }
}

describe('createRichEditorMarkdownInputTransformExtension', () => {
  it('mounts one beforeinput listener for all markdown input transforms', () => {
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

  it('routes arrow, inline math, and highlight syntax through the shared listener', () => {
    const fixture = createFixture()
    fixture.mount()

    fixture.setArrowPrefix('-')
    fixture.setCursorText('-', 0)
    const arrowEvent = fixture.fireBeforeInput({ data: '>' })

    expect(fixture.transaction.insertText).toHaveBeenCalledWith('→', 0, 1)
    expect(fixture.view.dispatch).toHaveBeenLastCalledWith(fixture.transaction)
    expect(arrowEvent.preventDefault).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    fixture.setCursorText('Inline $x^2$', 0)
    const mathEvent = fixture.fireBeforeInput({ data: ' ' })

    expect(fixture.view.state.schema.nodes.mathInline.createChecked).toHaveBeenCalledWith({ latex: 'x^2' })
    expect(fixture.transaction.replaceWith).toHaveBeenCalledWith(7, 12, fixture.mathNode)
    expect(fixture.transaction.insertText).toHaveBeenCalledWith(' ', 8)
    expect(fixture.view.dispatch).toHaveBeenLastCalledWith(fixture.transaction)
    expect(mathEvent.preventDefault).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    fixture.setCursorText('Plain ==marked=', 20)
    const highlightEvent = fixture.fireBeforeInput({ data: '=' })

    expect(fixture.transaction.delete).toHaveBeenNthCalledWith(1, 34, 35)
    expect(fixture.transaction.delete).toHaveBeenNthCalledWith(2, 26, 28)
    expect(fixture.highlightMarkType.create).toHaveBeenCalledWith()
    expect(fixture.transaction.addMark).toHaveBeenCalledWith(26, 32, fixture.highlightMark)
    expect(fixture.view.dispatch).toHaveBeenLastCalledWith(fixture.transaction)
    expect(highlightEvent.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('lets Chinese IME punctuation commits bypass rich-editor markdown transforms', () => {
    let beforeInputListener: EventListener | null = null
    const transaction = createTransaction()
    const handleBeforeInput = vi.fn(() => ({
      preventDefault: true,
      transaction,
    }))
    const view = {
      composing: false,
      dispatch: vi.fn(),
      dom: { isConnected: true },
    }
    const dom = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (type === 'beforeinput') beforeInputListener = listener
      }),
    }
    const editor = {
      _tiptapEditor: { view },
      prosemirrorView: view,
    }
    const extension = createRichEditorInputTransformExtension({
      createTransforms: () => [{ handleBeforeInput }],
      key: 'testTransform',
    })()({ editor: editor as never })
    const controller = new AbortController()
    extension.mount?.({
      dom: dom as never,
      root: document,
      signal: controller.signal,
    })

    if (!beforeInputListener) throw new Error('Input transform did not mount beforeinput')

    const event = {
      data: '，',
      inputType: 'insertCompositionText',
      isComposing: false,
      preventDefault: vi.fn(),
    } as unknown as InputEvent

    beforeInputListener(event)

    expect(handleBeforeInput).not.toHaveBeenCalled()
    expect(view.dispatch).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
