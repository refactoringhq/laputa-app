import type { Model } from '@ironcalc/workbook'
import { describe, expect, it, vi } from 'vitest'
import { applySheetStructureAction } from './sheetContextMenuState'

function invalidRowDeleteModel(row: number): Model {
  let rejectsNextDelete = true
  const deleteRow = vi.fn((_sheet: number, deletedRow: number) => {
    if (!rejectsNextDelete) return
    rejectsNextDelete = false
    throw new Error(`Row number '${deletedRow}' is not valid.`)
  })

  return {
    deleteColumn: vi.fn(),
    deleteRow,
    getSelectedView: () => ({
      column: 1,
      left_column: 1,
      range: [1, 1, 1, 1],
      row,
      sheet: 0,
      top_row: 1,
    }),
    insertColumn: vi.fn(),
    insertRow: vi.fn(),
  } as unknown as Model
}

describe('applySheetStructureAction', () => {
  it('keeps deleting row 1 from an empty sheet from surfacing the IronCalc row error', () => {
    const model = invalidRowDeleteModel(1)

    expect(() => applySheetStructureAction(model, 'deleteRow')).not.toThrow()
    expect(model.insertRow).not.toHaveBeenCalled()
    expect(model.deleteRow).toHaveBeenCalledTimes(1)
  })

  it('keeps deleting an empty selected row from surfacing the IronCalc row error', () => {
    const model = invalidRowDeleteModel(2)

    expect(() => applySheetStructureAction(model, 'deleteRow')).not.toThrow()
  })

  it('surfaces IronCalc row delete errors for a different row', () => {
    const model = invalidRowDeleteModel(2)
    vi.mocked(model.deleteRow).mockImplementationOnce(() => {
      throw new Error("Row number '3' is not valid.")
    })

    expect(() => applySheetStructureAction(model, 'deleteRow')).toThrow("Row number '3' is not valid.")
  })
})
