import { describe, expect, it, vi } from 'vitest'
import { TextSelection } from '@tiptap/pm/state'
import {
  adjacentCodeLineOffset,
  createRichEditorCodeBlockArrowNavigationExtension,
} from './richEditorCodeBlockArrowNavigationExtension'

vi.mock('@tiptap/pm/state', () => ({
  TextSelection: {
    create: vi.fn((_doc: unknown, position: number) => ({ position })),
  },
}))

type KeyListener = (event: KeyboardEvent) => void
type ViewFixtureOptions = {
  blockType: string
  offset: number
  source: string
}

function keyboardEvent(key: 'ArrowDown' | 'ArrowUp', options: Partial<KeyboardEvent> = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    isComposing: false,
    key,
    keyCode: key === 'ArrowDown' ? 40 : 38,
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

function createViewFixture({ blockType, offset, source }: ViewFixtureOptions) {
  const selection = {
    $from: {
      parent: { textContent: source, type: { name: blockType } },
      parentOffset: offset,
      start: () => 100,
    },
    empty: true,
  }
  const viewTransaction = {
    setSelection: vi.fn().mockReturnThis(),
  }
  const viewDocument = {
    resolve: vi.fn(() => ({ parent: { type: { name: 'codeBlock' } } })),
  }
  const view = {
    composing: false,
    dom: document.createElement('div'),
    dispatch: vi.fn(),
    posAtDOM: vi.fn(),
    state: {
      doc: viewDocument,
      selection: {
        ...selection,
        $from: {
          ...selection.$from,
          end: () => 200,
        },
        from: offset + 100,
      },
      tr: viewTransaction,
    },
  }
  return { selection, view }
}

function createFixture({
  blockType = 'codeBlock',
  editable = true,
  offset = 6,
  source = 'alpha\nbravo\ncharlie',
} = {}) {
  let keydownListener: KeyListener | null = null
  const nextBlock = { id: 'next', type: 'paragraph' }
  const prevBlock = { id: 'previous', type: 'paragraph' }
  const { selection, view } = createViewFixture({ blockType, offset, source })
  const transaction = {
    doc: {},
    selection,
    setSelection: vi.fn(),
  }
  const editor = {
    _tiptapEditor: { view },
    getTextCursorPosition: vi.fn(() => ({
      block: { id: 'code', type: blockType },
      nextBlock,
      prevBlock,
    })),
    isEditable: editable,
    prosemirrorView: view,
    setTextCursorPosition: vi.fn(),
    transact: vi.fn((callback: (tr: typeof transaction) => boolean) => callback(transaction)),
  }
  const dom = {
    addEventListener: vi.fn((type: string, listener: KeyListener) => {
      if (type === 'keydown') keydownListener = listener
    }),
  }
  const extension = createRichEditorCodeBlockArrowNavigationExtension()({ editor: editor as never })
  const controller = new AbortController()
  extension.mount?.({ dom: dom as never, root: document, signal: controller.signal })

  return {
    editor,
    fire(key: 'ArrowDown' | 'ArrowUp', options: Partial<KeyboardEvent> = {}) {
      if (!keydownListener) throw new Error('Arrow navigation listener was not registered')
      const event = keyboardEvent(key, options)
      keydownListener(event)
      return event
    },
    transaction,
    view,
  }
}

describe('adjacentCodeLineOffset', () => {
  it('preserves the source column while moving between logical lines', () => {
    expect(adjacentCodeLineOffset('alpha\nbravo\ncharlie', 8, 'ArrowDown')).toBe(14)
    expect(adjacentCodeLineOffset('alpha\nbravo\ncharlie', 14, 'ArrowUp')).toBe(8)
  })

  it('clamps short lines and reports code block boundaries', () => {
    expect(adjacentCodeLineOffset('alpha\nb\ncharlie', 4, 'ArrowDown')).toBe(7)
    expect(adjacentCodeLineOffset('alpha\nb\ncharlie', 0, 'ArrowUp')).toBeNull()
    expect(adjacentCodeLineOffset('alpha\nb\ncharlie', 15, 'ArrowDown')).toBeNull()
  })
})

describe('createRichEditorCodeBlockArrowNavigationExtension', () => {
  it('moves down one logical code line instead of escaping the code block', () => {
    const fixture = createFixture()
    const event = fixture.fire('ArrowDown')

    expect(TextSelection.create).toHaveBeenCalledWith({}, 112)
    expect(fixture.transaction.setSelection).toHaveBeenCalledWith({ position: 112 })
    expect(fixture.editor.setTextCursorPosition).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopImmediatePropagation).toHaveBeenCalled()
  })

  it('keeps the browser-computed move when it stays on a wrapped code row', () => {
    const fixture = createFixture()
    const codeBlock = document.createElement('div')
    codeBlock.dataset.contentType = 'codeBlock'
    const source = document.createTextNode('wrapped source')
    codeBlock.appendChild(source)
    fixture.view.dom.appendChild(codeBlock)
    document.body.appendChild(fixture.view.dom)

    const selection = document.getSelection()
    if (!selection) throw new Error('Expected a document selection')
    const initialRange = document.createRange()
    initialRange.setStart(source, 1)
    initialRange.collapse(true)
    selection.removeAllRanges()
    selection.addRange(initialRange)
    const previousModify = selection.modify
    Object.defineProperty(selection, 'modify', {
      configurable: true,
      value: vi.fn(() => {
        const nextRange = document.createRange()
        nextRange.setStart(source, 2)
        nextRange.collapse(true)
        selection.removeAllRanges()
        selection.addRange(nextRange)
      }),
    })
    fixture.view.posAtDOM.mockReturnValue(130)

    fixture.fire('ArrowDown')

    expect(TextSelection.create).toHaveBeenCalledWith(fixture.view.state.doc, 130)
    expect(fixture.view.dispatch).toHaveBeenCalledWith(fixture.view.state.tr)
    expect(fixture.editor.transact).not.toHaveBeenCalled()

    Object.defineProperty(selection, 'modify', { configurable: true, value: previousModify })
    selection.removeAllRanges()
    fixture.view.dom.remove()
  })

  it('moves to the immediately adjacent block only at a code boundary', () => {
    const downFixture = createFixture({ offset: 19 })
    downFixture.fire('ArrowDown')
    expect(downFixture.editor.setTextCursorPosition).toHaveBeenCalledWith(
      { id: 'next', type: 'paragraph' },
      'start',
    )

    const upFixture = createFixture({ offset: 0 })
    upFixture.fire('ArrowUp')
    expect(upFixture.editor.setTextCursorPosition).toHaveBeenCalledWith(
      { id: 'previous', type: 'paragraph' },
      'end',
    )
  })

  it('leaves modified, composing, read-only, and non-code arrow keys alone', () => {
    const modified = createFixture()
    expect(modified.fire('ArrowDown', { shiftKey: true }).preventDefault).not.toHaveBeenCalled()

    const composing = createFixture()
    expect(composing.fire('ArrowDown', { isComposing: true }).preventDefault).not.toHaveBeenCalled()

    const readonly = createFixture({ editable: false })
    expect(readonly.fire('ArrowDown').preventDefault).not.toHaveBeenCalled()

    const paragraph = createFixture({ blockType: 'paragraph' })
    expect(paragraph.fire('ArrowDown').preventDefault).not.toHaveBeenCalled()
  })
})
