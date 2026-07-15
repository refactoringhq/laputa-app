import { describe, expect, it, vi } from 'vitest'
import { createTrackedWikilinkInputTransform } from './wikilinkInputExtension'
import { trackEvent } from '../lib/telemetry'

vi.mock('../lib/telemetry', () => ({
  trackEvent: vi.fn(),
}))

function createTransaction() {
  const transaction = {
    replaceWith: vi.fn(() => transaction),
    scrollIntoView: vi.fn(() => transaction),
  }
  return transaction
}

function createView(beforeText: string, transaction: ReturnType<typeof createTransaction>) {
  const textblockStart = 1
  const wikilinkNode = { nodeSize: 1, type: 'wikilink' }
  const wikilinkType = {
    createChecked: vi.fn((attrs: Record<string, unknown>) => ({ ...wikilinkNode, attrs })),
  }
  const selection = {
    from: textblockStart + beforeText.length,
    to: textblockStart + beforeText.length,
    $from: {
      parent: {
        isTextblock: true,
        textBetween: vi.fn(() => beforeText),
        type: { name: 'paragraph' },
      },
      parentOffset: beforeText.length,
      marks: vi.fn(() => []),
    },
  }
  return {
    dispatch: vi.fn(),
    state: {
      schema: {
        nodes: {
          wikilink: wikilinkType,
        },
      },
      selection,
      storedMarks: null,
      tr: transaction,
    },
  }
}

function beforeInputEvent(overrides: Partial<InputEvent> = {}) {
  return {
    data: ']',
    inputType: 'insertText',
    preventDefault: vi.fn(),
    ...overrides,
  } as InputEvent
}

function runTransform(beforeText: string, event = beforeInputEvent()) {
  const transaction = createTransaction()
  const view = createView(beforeText, transaction)
  const transform = createTrackedWikilinkInputTransform()
  const result = transform.handleBeforeInput(event, { view: view as never })
  if (result) {
    view.dispatch(result.transaction)
    if (result.preventDefault) event.preventDefault()
  }
  return { event, result, transaction, view }
}

describe('createWikilinkInputTransform', () => {
  it('turns a typed completed wikilink into a rich editor wikilink node', () => {
    const { event, transaction, view } = runTransform('See [[Second Test]')

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(view.state.schema.nodes.wikilink.createChecked).toHaveBeenCalledWith({ target: 'Second Test' })
    expect(transaction.replaceWith).toHaveBeenCalledWith(5, 'See [[Second Test]'.length + 1, {
      attrs: { target: 'Second Test' },
      nodeSize: 1,
      type: 'wikilink',
    })
    expect(transaction.scrollIntoView).toHaveBeenCalledOnce()
    expect(trackEvent).toHaveBeenCalledWith('wikilink_inserted', { trigger: 'typed' })
  })

  it('ignores empty, multiline, and pasted wikilink text', () => {
    expect(runTransform('See [[]').result).toBeNull()
    expect(runTransform('See [[Line\nBreak]').result).toBeNull()
    expect(runTransform('See [[Second Test]', beforeInputEvent({ inputType: 'insertFromPaste' })).result).toBeNull()
  })
})
