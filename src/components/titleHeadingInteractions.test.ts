import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEditorPasteHandler } from './titleHeadingInteractions'

function createEditor() {
  return {
    document: [{ id: 'heading-block', type: 'heading' }],
    focus: vi.fn(),
    insertInlineContent: vi.fn(),
    setTextCursorPosition: vi.fn(),
  }
}

function createTitleHeadingFixture() {
  const wrapper = document.createElement('div')
  wrapper.className = 'bn-block-outer'
  const block = document.createElement('div')
  block.className = 'bn-block'
  const heading = document.createElement('div')
  heading.setAttribute('data-content-type', 'heading')
  heading.setAttribute('data-level', '1')
  const inline = document.createElement('div')
  inline.className = 'bn-inline-content'
  const text = document.createTextNode('Sentry Fresh Paste Guard')

  inline.appendChild(text)
  heading.appendChild(inline)
  block.appendChild(heading)
  wrapper.appendChild(block)
  document.body.appendChild(wrapper)

  return { inline, text, wrapper }
}

function selectCollapsedText(node: Text, offset: number): void {
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function selectTextRange(node: Text, start: number, end: number): void {
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function richPasteEvent(target: HTMLElement) {
  return {
    clipboardData: {
      getData: vi.fn((format: string) => (
        format === 'text/plain'
          ? ' Rich Paste Payload'
          : '<h1>Rich <em>Paste</em> Payload</h1>'
      )),
      types: ['text/html', 'text/plain'],
    },
    currentTarget: document.body,
    preventDefault: vi.fn(),
    target,
  } as never
}

describe('useEditorPasteHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it.each([
    {
      expectedCursorMove: true,
      name: 'moves collapsed title-heading rich paste to the end before insertion',
      select: (text: Text) => selectCollapsedText(text, 'Sentry Fresh Paste '.length),
    },
    {
      expectedCursorMove: false,
      name: 'preserves selected title text during rich paste',
      select: (text: Text) => selectTextRange(text, 0, 'Sentry'.length),
    },
  ])('$name', ({ expectedCursorMove, select }) => {
    const editor = createEditor()
    const { inline, text } = createTitleHeadingFixture()
    select(text)
    const event = richPasteEvent(inline)
    const { result } = renderHook(() => useEditorPasteHandler({
      editable: true,
      editor,
      runEditorAction: (action) => action(),
    }))

    result.current(event)

    if (expectedCursorMove) {
      expect(editor.setTextCursorPosition).toHaveBeenCalledWith('heading-block', 'end')
    } else {
      expect(editor.setTextCursorPosition).not.toHaveBeenCalled()
      expect(editor.focus).toHaveBeenCalled()
    }
    expect(editor.insertInlineContent).toHaveBeenCalledWith(' Rich Paste Payload', { updateSelection: true })
  })
})
