import type { Model } from '@ironcalc/workbook'
import { describe, expect, it, vi } from 'vitest'
import {
  buildTolariaSheetClipboardPayload,
  shiftedClipboardCellInput,
  writeTolariaSheetClipboard,
} from './sheetClipboard'
import { SHEET_INDEX } from './sheetWorkbook'

function makeClipboardData(): DataTransfer {
  const values = new Map<string, string>()
  return {
    clearData: vi.fn((type?: string) => {
      if (type) {
        values.delete(type)
      } else {
        values.clear()
      }
    }),
    dropEffect: 'none',
    effectAllowed: 'uninitialized',
    files: [] as unknown as FileList,
    getData: vi.fn((type: string) => values.get(type) ?? ''),
    items: [] as unknown as DataTransferItemList,
    setData: vi.fn((type: string, value: string) => values.set(type, value)),
    setDragImage: vi.fn(),
    types: [] as unknown as readonly string[],
  }
}

function makeModel(cells: Record<string, string>): Model {
  return {
    getCellContent: (_sheet: number, row: number, column: number) => cells[`${row}:${column}`] ?? '',
    getSelectedView: () => ({
      column: 1,
      left_column: 1,
      range: [1, 1, 1, 1],
      row: 1,
      sheet: SHEET_INDEX,
      top_row: 1,
    }),
  } as unknown as Model
}

describe('sheet clipboard', () => {
  it('copies regular formulas as formula text in plain clipboard formats', () => {
    const payload = buildTolariaSheetClipboardPayload(
      makeModel({ '1:1': '=B2+C2' }),
      '/vault/budget.md',
      'copy',
      new Map(),
    )

    expect(payload?.cells).toEqual([['=B2+C2']])
    if (!payload) throw new Error('Expected formula copy to build a clipboard payload')
    const clipboardData = makeClipboardData()
    writeTolariaSheetClipboard(clipboardData, payload)
    expect(clipboardData.getData('text/plain')).toBe('=B2+C2')
    expect(clipboardData.getData('text/csv')).toBe('=B2+C2')
  })

  it('copies external formula sources even when the workbook cell contains the evaluated value', () => {
    const formula = '=C15*[[refactoring-newsletter-model-assumptions]].C19'
    const payload = buildTolariaSheetClipboardPayload(
      makeModel({ '1:1': '$23,527' }),
      '/vault/business-plan.md',
      'copy',
      new Map([['A1', { evaluated: '$23,527', source: formula }]]),
    )

    expect(payload?.cells).toEqual([[formula]])
    if (!payload) throw new Error('Expected external formula copy to build a clipboard payload')
    const clipboardData = makeClipboardData()
    writeTolariaSheetClipboard(clipboardData, payload)
    expect(clipboardData.getData('text/plain')).toBe(formula)
  })

  it('shifts local and external formula references when pasting copied formulas', () => {
    const payload = {
      action: 'copy' as const,
      cells: [['=C15*[[assumptions]].C19+A$1+$B2+$C$3']],
      source: {
        column: 3,
        height: 1,
        path: '/vault/model.md',
        row: 10,
        width: 1,
      },
      type: 'tolaria-sheet-clipboard' as const,
      version: 1,
    }

    expect(shiftedClipboardCellInput(payload.cells[0]![0]!, {
      columnOffset: 0,
      destinationColumn: 4,
      destinationRow: 11,
      payload,
      rowOffset: 0,
    })).toBe('=D16*[[assumptions]].D20+B$1+$B3+$C$3')
  })
})
