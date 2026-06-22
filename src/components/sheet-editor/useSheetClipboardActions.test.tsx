import type { Model } from '@ironcalc/workbook'
import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SHEET_INDEX } from '../../utils/sheetWorkbook'
import { useSheetClipboardActions } from './useSheetClipboardActions'
import type { SheetWorkbookState } from './sheetEditorTypes'

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

function modelWithEvaluatedFormulaValue(value: string): Model {
  return {
    getCellContent: () => value,
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

function ClipboardHarness({ formula, value }: { formula: string; value: string }) {
  const workbookRef = useRef<SheetWorkbookState | null>({
    externalFormulaInputs: new Map([['A1', { evaluated: value, source: formula }]]),
    generation: 0,
    model: modelWithEvaluatedFormulaValue(value),
    path: '/vault/business-plan.md',
    refreshId: 0,
  })
  const { handleCopyCapture } = useSheetClipboardActions({
    refreshWorkbook: vi.fn(),
    scheduleSelectionChromePatch: vi.fn(),
    scheduleSerialize: vi.fn(),
    setFormulaAutocomplete: vi.fn(),
    setSheetContextMenu: vi.fn(),
    setWikilinkAutocomplete: vi.fn(),
    workbookRef,
    writeCellInputAt: vi.fn(() => ({ applied: true, pendingLoads: [] })),
  })

  return <div data-testid="sheet-root" onCopyCapture={handleCopyCapture} />
}

describe('useSheetClipboardActions', () => {
  it('copies external formula sources instead of evaluated cell values', () => {
    const formula = '=C15*[[refactoring-newsletter-model-assumptions]].C19'
    render(<ClipboardHarness formula={formula} value="$23,527" />)

    const clipboardData = makeClipboardData()
    fireEvent.copy(screen.getByTestId('sheet-root'), { clipboardData })

    expect(clipboardData.getData('text/plain')).toBe(formula)
  })
})
