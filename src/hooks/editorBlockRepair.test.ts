import { describe, expect, it } from 'vitest'
import { repairMalformedEditorBlocks } from './editorBlockRepair'

function textContent(text: string) {
  return [{ type: 'text', text, styles: {} }]
}

function block(type: string, text: string, children: unknown[] = []) {
  return {
    id: `${type}-${text}`,
    type,
    content: textContent(text),
    children,
  }
}

describe('repairMalformedEditorBlocks', () => {
  it('promotes numbered-list children out of paragraph blocks', () => {
    const nestedParagraph = block('paragraph', 'Nested paragraph')
    const nestedList = block('numberedListItem', 'Step one', [
      block('numberedListItem', 'Nested step'),
    ])
    const paragraph = block('paragraph', 'Intro', [nestedParagraph, nestedList])
    const tail = block('paragraph', 'Tail')

    expect(repairMalformedEditorBlocks([paragraph, tail])).toEqual([
      {
        ...paragraph,
        children: [nestedParagraph],
      },
      nestedList,
      tail,
    ])
  })

  it('keeps nested numbered-list children under numbered-list items', () => {
    const nested = block('numberedListItem', 'Nested step')
    const parent = block('numberedListItem', 'Step one', [nested])

    expect(repairMalformedEditorBlocks([parent])).toEqual([parent])
  })
})
