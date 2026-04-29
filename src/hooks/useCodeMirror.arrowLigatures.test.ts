import { act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { redo, undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { useCodeMirror, type CodeMirrorCallbacks } from './useCodeMirror'

const noop = () => {}
const noopCallbacks: CodeMirrorCallbacks = {
  onDocChange: noop,
  onCursorActivity: noop,
  onSave: noop,
  onEscape: () => false,
}

function applyTypedInput(view: EditorView, text: string) {
  const handler = view.state.facet(EditorView.inputHandler)[0]
  const selection = view.state.selection.main
  const insert = () => view.state.update({
    changes: { from: selection.from, to: selection.to, insert: text },
    selection: { anchor: selection.from + text.length },
    userEvent: 'input.type',
  })

  if (handler?.(view, selection.from, selection.to, text, insert)) {
    return
  }

  view.dispatch(insert())
}

function typeSequence(view: EditorView, inputs: readonly string[]) {
  act(() => {
    inputs.forEach((input) => applyTypedInput(view, input))
  })
}

function createView(container: HTMLDivElement, content = '') {
  const ref = { current: container }
  const { result } = renderHook(() =>
    useCodeMirror(ref, content, noopCallbacks),
  )
  return result.current.current!
}

describe('useCodeMirror arrow ligatures', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  it.each([
    {
      expected: '← → ↔',
      inputs: ['<', '-', ' ', '-', '>', ' ', '<', '-', '>'],
      title: 'replaces typed ASCII arrows with unicode arrows in the raw editor',
    },
    {
      expected: '<-> -> ->',
      inputs: ['\\', '<', '-', '>', ' ', '\\', '-', '>', ' ', '->'],
      title: 'preserves escaped ASCII arrows and leaves paste unchanged',
    },
  ])('$title', ({ expected, inputs }) => {
    const view = createView(container)

    typeSequence(view, inputs)

    expect(view.state.doc.toString()).toBe(expected)
  })

  it('keeps undo and redo behavior natural after a ligature replacement', () => {
    const view = createView(container)

    typeSequence(view, ['-', '>'])
    expect(view.state.doc.toString()).toBe('→')

    act(() => {
      undo(view)
    })
    expect(view.state.doc.toString()).toBe('')

    act(() => {
      redo(view)
    })
    expect(view.state.doc.toString()).toBe('→')
  })

  it('keeps Mermaid arrows literal while typing inside fenced code', () => {
    const content = [
      '```mermaid',
      'flowchart TD',
      'A --',
      '```',
    ].join('\n')
    const cursor = content.indexOf('A --') + 'A --'.length
    const view = createView(container, content)

    act(() => {
      view.dispatch({ selection: { anchor: cursor } })
    })
    typeSequence(view, ['>'])

    expect(view.state.doc.toString()).toContain('A -->')
  })
})
