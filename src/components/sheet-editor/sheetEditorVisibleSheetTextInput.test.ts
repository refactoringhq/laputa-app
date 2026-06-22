import { describe, expect, it } from 'vitest'
import { visibleSheetTextInput } from './sheetEditorVisibleSheetTextInput'

describe('visibleSheetTextInput', () => {
  it('does not fall back to an inactive visible formula bar input', () => {
    const container = globalThis.document.createElement('div')
    const input = globalThis.document.createElement('input')
    input.getBoundingClientRect = () => ({
      bottom: 20,
      height: 20,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    container.append(input)
    globalThis.document.body.append(container)

    try {
      expect(visibleSheetTextInput(container)).toBeNull()

      input.focus()
      expect(visibleSheetTextInput(container)).toBe(input)
    } finally {
      container.remove()
    }
  })
})
