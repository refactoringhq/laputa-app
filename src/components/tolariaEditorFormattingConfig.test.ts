import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it, vi } from 'vitest'
import { applyHeaderRowDefaultToTableItem } from './tolariaEditorFormattingConfig'
import { schema } from './editorSchema'

describe('applyHeaderRowDefaultToTableItem', () => {
  it('overrides the table slash item so onItemClick inserts a table with headerRows: 1', () => {
    const editor = BlockNoteEditor.create({ schema, tables: { headers: true } })
    const insertSpy = vi.fn()
    const editorAdapter = new Proxy(editor, {
      get(target, prop) {
        if (prop === 'insertBlocks') return insertSpy
        if (prop === 'replaceBlocks') return insertSpy
        return Reflect.get(target, prop)
      },
    })

    const items = [
      { key: 'table', title: 'Table', onItemClick: vi.fn() },
      { key: 'paragraph', title: 'Paragraph', onItemClick: vi.fn() },
    ] as never

    const overridden = applyHeaderRowDefaultToTableItem(items, editorAdapter as never)
    const tableItem = overridden.find(item => item.key === 'table')

    expect(tableItem).toBeDefined()
    expect(tableItem?.onItemClick).not.toBe(items[0].onItemClick)
  })

  it('leaves non-table slash items untouched', () => {
    const editor = BlockNoteEditor.create({ schema, tables: { headers: true } })
    const paragraphClick = vi.fn()
    const items = [
      { key: 'table', title: 'Table', onItemClick: vi.fn() },
      { key: 'paragraph', title: 'Paragraph', onItemClick: paragraphClick },
    ] as never

    const overridden = applyHeaderRowDefaultToTableItem(items, editor as never)
    const paragraphItem = overridden.find(item => item.key === 'paragraph')

    expect(paragraphItem?.onItemClick).toBe(paragraphClick)
  })
})
