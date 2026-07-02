import type { Model } from '@ironcalc/workbook'
import { describe, expect, it, vi } from 'vitest'
import { applySheetStructureAction } from './sheetContextMenuState'

function singleRowDeleteModel(): Model {
  let rejectsNextDelete = true
  const deleteRow = vi.fn(() => {
    if (!rejectsNextDelete) return
    rejectsNextDelete = false
    throw new Error("Row number '1' is not valid.")
  })

  return {
    deleteColumn: vi.fn(),
    deleteRow,
    getSelectedView: () => ({
      column: 1,
      left_column: 1,
      range: [1, 1, 1, 1],
      row: 1,
      sheet: 0,
      top_row: 1,
    }),
    insertColumn: vi.fn(),
    insertRow: vi.fn(),
  } as unknown as Model
}

describe('applySheetStructureAction', () => {
  it('keeps deleting row 1 from a single-row sheet from surfacing the IronCalc row error', () => {
    const model = singleRowDeleteModel()

    expect(() => applySheetStructureAction(model, 'deleteRow')).not.toThrow()
    expect(model.insertRow).toHaveBeenCalledWith(0, 2)
    expect(model.deleteRow).toHaveBeenCalledTimes(2)
  })
})
