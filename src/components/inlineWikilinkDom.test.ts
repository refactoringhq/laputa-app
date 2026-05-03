import { describe, expect, it } from 'vitest'
import {
  applySelectionIndex,
  applySelectionRange,
  readSelectionIndex,
  readSelectionRange,
  serializeInlineNode,
} from './inlineWikilinkDom'

function createChip(target: string): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.dataset.chipTarget = target
  chip.textContent = target
  return chip
}

function createMixedInlineRoot(): HTMLDivElement {
  const root = document.createElement('div')
  root.append('A')
  root.append(createChip('Project'))
  root.append('B')
  document.body.append(root)
  return root
}

function setSelectionRange(
  startContainer: Node,
  startOffset: number,
  endContainer: Node,
  endOffset: number,
) {
  const selection = window.getSelection()
  const range = document.createRange()
  range.setStart(startContainer, startOffset)
  range.setEnd(endContainer, endOffset)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

describe('inlineWikilinkDom', () => {
  it('serializes text, chips, breaks, and nested content into inline markdown', () => {
    const root = document.createElement('div')
    const nested = document.createElement('span')

    root.append('A\u00A0B\u200B\n')
    root.append(createChip('Project'))
    root.append(document.createElement('br'))
    nested.textContent = 'Tail'
    root.append(nested)

    expect(serializeInlineNode(root)).toBe('A B\n[[Project]]Tail')
  })

  it('reads selections inside the editor and falls back to the editor end for outside selections', () => {
    const root = createMixedInlineRoot()
    const [startText, , endText] = Array.from(root.childNodes)
    const outside = document.createElement('div')

    outside.textContent = 'Outside'
    document.body.append(outside)

    setSelectionRange(startText as Node, 1, endText as Node, 1)

    expect(readSelectionRange(root)).toEqual({ start: 1, end: 13 })
    expect(readSelectionIndex(root)).toBe(13)

    setSelectionRange(outside.firstChild as Node, 0, outside.firstChild as Node, 7)

    expect(readSelectionRange(root)).toEqual({ start: 13, end: 13 })
  })

  it('applies selection ranges across chips and clamps to the editor end', () => {
    const root = createMixedInlineRoot()

    applySelectionRange(root, { start: 2, end: 999 })

    const selection = window.getSelection()

    expect(selection?.anchorNode?.textContent).toBe('B')
    expect(selection?.anchorOffset).toBe(0)
    expect(selection?.focusNode?.textContent).toBe('B')
    expect(selection?.focusOffset).toBe(1)
  })

  it('applies collapsed indices before leading chips without requiring text nodes', () => {
    const root = document.createElement('div')

    root.append(createChip('Task'))
    document.body.append(root)

    applySelectionIndex(root, 0)

    const selection = window.getSelection()

    expect(selection?.anchorNode).toBe(root)
    expect(selection?.anchorOffset).toBe(0)
    expect(selection?.focusNode).toBe(root)
    expect(selection?.focusOffset).toBe(0)
  })
})
