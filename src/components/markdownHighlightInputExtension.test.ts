import { describe, expect, it, vi } from 'vitest'
import { MARKDOWN_HIGHLIGHT_STYLE } from '../utils/markdownHighlightMarkdown'
import {
  createMarkdownHighlightInputExtension,
  readMarkdownHighlightInputReplacement,
} from './markdownHighlightInputExtension'

function createTransaction() {
  const transaction = {
    addMark: vi.fn(() => transaction),
    delete: vi.fn(() => transaction),
    scrollIntoView: vi.fn(() => transaction),
  }
  return transaction
}

function createView(beforeText: string, parentStart = 0, parentTypeName = 'paragraph') {
  const cursor = parentStart + beforeText.length
  const transaction = createTransaction()
  const highlightMark = { type: { name: MARKDOWN_HIGHLIGHT_STYLE } }
  const highlightMarkType = { create: vi.fn(() => highlightMark) }
  const docNodes: Array<{
    node: {
      isText?: boolean
      marks?: Array<{ type: { name: string } }>
      nodeSize?: number
    }
    pos: number
  }> = []
  const view = {
    composing: false,
    dispatch: vi.fn(),
    state: {
      doc: {
        nodesBetween: vi.fn((
          from: number,
          to: number,
          visit: (
            node: { isText?: boolean; marks?: Array<{ type: { name: string } }>; nodeSize?: number },
            pos: number,
          ) => boolean | void,
        ) => {
          for (const item of docNodes) {
            const nodeEnd = item.pos + (item.node.nodeSize ?? 1)
            if (nodeEnd < from || item.pos > to) continue
            if (visit(item.node, item.pos) === false) return
          }
        }),
      },
      schema: {
        marks: {
          [MARKDOWN_HIGHLIGHT_STYLE]: highlightMarkType,
        },
      },
      selection: {
        from: cursor,
        to: cursor,
        $from: {
          parent: {
            isTextblock: true,
            type: { name: parentTypeName },
            textBetween: vi.fn(() => beforeText),
          },
          parentOffset: beforeText.length,
          marks: vi.fn(() => []),
        },
      },
      storedMarks: null as Array<{ type: { name: string } }> | null,
      tr: transaction,
    },
  }

  return {
    cursor,
    docNodes,
    highlightMark,
    highlightMarkType,
    transaction,
    view,
  }
}

function createFixture(beforeText = 'Plain ==marked=', parentStart = 0, parentTypeName = 'paragraph') {
  let beforeInputListener: EventListener | null = null
  const { docNodes, highlightMark, highlightMarkType, transaction, view } = createView(
    beforeText,
    parentStart,
    parentTypeName,
  )
  const dom = {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'beforeinput') {
        beforeInputListener = listener
      }
    }),
  }
  const editor = {
    _tiptapEditor: { view },
    prosemirrorView: view,
  }
  const extension = createMarkdownHighlightInputExtension()({ editor: editor as never })

  return {
    docNodes,
    dom,
    extension,
    fireInput(event: Partial<InputEvent> = {}) {
      if (!beforeInputListener) {
        throw new Error('Markdown highlight input extension did not register beforeinput')
      }

      const inputEvent = {
        data: '=',
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

function expectNoHighlightTransform(fixture: ReturnType<typeof createFixture>, event: Partial<InputEvent> = {}) {
  const inputEvent = fixture.fireInput(event)

  expect(fixture.transaction.delete).not.toHaveBeenCalled()
  expect(fixture.transaction.addMark).not.toHaveBeenCalled()
  expect(fixture.view.dispatch).not.toHaveBeenCalled()
  expect(inputEvent.preventDefault).not.toHaveBeenCalled()
}

describe('createMarkdownHighlightInputExtension', () => {
  it('reads a completed highlight pair before the final equals is inserted', () => {
    expect(readMarkdownHighlightInputReplacement({
      beforeText: 'Plain ==marked=',
      cursor: 15,
      parentStart: 0,
    })).toEqual({
      closingFrom: 14,
      closingTo: 15,
      contentFrom: 8,
      contentTo: 14,
      openingFrom: 6,
      openingTo: 8,
    })
  })

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

  it('turns typed ==highlight== syntax into the durable highlight mark', () => {
    const fixture = createFixture('Plain ==marked=', 20)
    fixture.mount()

    const event = fixture.fireInput()

    expect(fixture.transaction.delete).toHaveBeenNthCalledWith(1, 34, 35)
    expect(fixture.transaction.delete).toHaveBeenNthCalledWith(2, 26, 28)
    expect(fixture.highlightMarkType.create).toHaveBeenCalledWith()
    expect(fixture.transaction.addMark).toHaveBeenCalledWith(26, 32, fixture.highlightMark)
    expect(fixture.transaction.scrollIntoView).toHaveBeenCalled()
    expect(fixture.view.dispatch).toHaveBeenCalledWith(fixture.transaction)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('leaves highlight-looking syntax literal inside inline code', () => {
    const fixture = createFixture()
    fixture.view.state.storedMarks = [{ type: { name: 'code' } }]
    fixture.mount()

    expectNoHighlightTransform(fixture)
  })

  it('leaves completed highlight syntax literal inside code blocks', () => {
    const fixture = createFixture('if a=="1" and b=', 0, 'codeBlock')
    fixture.mount()

    expectNoHighlightTransform(fixture)
  })

  it('leaves highlight-looking syntax literal when existing content has code marks', () => {
    const fixture = createFixture()
    fixture.docNodes.push({
      node: {
        isText: true,
        marks: [{ type: { name: 'code' } }],
        nodeSize: 6,
      },
      pos: 8,
    })
    fixture.mount()

    expectNoHighlightTransform(fixture)
  })
})
