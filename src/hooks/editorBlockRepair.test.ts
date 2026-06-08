import { describe, expect, it } from 'vitest'
import { repairMalformedEditorBlocks } from './editorBlockRepair'

type TestBlock = {
  id: string
  type: string
  content: unknown[]
  children: TestBlock[]
}

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

function collectIds(blocks: TestBlock[]): string[] {
  return blocks.flatMap(item => [item.id, ...collectIds(item.children)])
}

describe('repairMalformedEditorBlocks', () => {
  it('promotes all children out of paragraph blocks', () => {
    const nestedParagraph = block('paragraph', 'Nested paragraph')
    const nestedList = block('numberedListItem', 'Step one', [
      block('numberedListItem', 'Nested step'),
    ])
    const paragraph = block('paragraph', 'Intro', [nestedParagraph, nestedList])
    const tail = block('paragraph', 'Tail')

    expect(repairMalformedEditorBlocks([paragraph, tail])).toEqual([
      {
        ...paragraph,
        children: [],
      },
      nestedParagraph,
      nestedList,
      tail,
    ])
  })

  it('keeps nested numbered-list children under numbered-list items', () => {
    const nested = block('numberedListItem', 'Nested step')
    const parent = block('numberedListItem', 'Step one', [nested])

    expect(repairMalformedEditorBlocks([parent])).toEqual([parent])
  })

  it('keeps nested toggle-list children under toggle-list items', () => {
    const nested = block('paragraph', 'Toggle detail')
    const parent = block('toggleListItem', 'Toggle summary', [nested])

    expect(repairMalformedEditorBlocks([parent])).toEqual([parent])
  })

  it('assigns fresh ids to duplicate blocks before render recovery retries', () => {
    const first = { ...block('paragraph', 'Intro'), id: 'duplicate-id' }
    const second = { ...block('mermaidBlock', 'Diagram'), id: 'duplicate-id' }
    const nested = { ...block('paragraph', 'Nested'), id: 'duplicate-id' }
    const parent = block('numberedListItem', 'Parent', [nested])

    const result = repairMalformedEditorBlocks([first, second, parent]) as TestBlock[]
    const ids = collectIds(result)

    expect(result[0].id).toBe('duplicate-id')
    expect(result[1]).toMatchObject({
      type: 'mermaidBlock',
      content: textContent('Diagram'),
    })
    expect(result[1].id).not.toBe('duplicate-id')
    expect(result[2].children[0].id).not.toBe('duplicate-id')
    expect(new Set(ids).size).toBe(ids.length)
  })
})
