import { describe, expect, it } from 'vitest'
import { dispatchSheetInput, setFormulaInputValue } from './sheetEditorInputEvents'

describe('sheet editor input events', () => {
  it('notifies value changes without replaying inserted text data', () => {
    const input = document.createElement('input')
    const insertedData: Array<string | null> = []

    input.addEventListener('input', (event) => {
      insertedData.push(event instanceof InputEvent ? event.data : null)
    })

    setFormulaInputValue(input, '=SUM(')
    dispatchSheetInput(input)

    expect(input.value).toBe('=SUM(')
    expect(insertedData).toEqual([null])
  })
})
