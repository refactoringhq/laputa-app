import { fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activateWorkbookRoot,
  getIronCalcMock,
  resetSheetEditorTestState,
} from './SheetEditor.testUtils'
import { SheetEditor } from './SheetEditor'
import { MAX_SHEET_COLUMNS, MAX_SHEET_ROWS } from '../utils/sheetWorkbook'

const ironCalcMock = getIronCalcMock()

function renderSheetEditor() {
  render(
    <SheetEditor
      content={'---\ntype: Sheet\n---\nMetric,January'}
      path="/vault/budget.md"
      onContentChange={vi.fn()}
    />,
  )
}

function selectInteriorCell() {
  ironCalcMock.state.selectedView = {
    column: 4,
    left_column: 2,
    range: [8, 4, 8, 4],
    row: 8,
    sheet: 0,
    top_row: 3,
  }
}

describe('SheetEditor edge navigation', () => {
  afterEach(() => {
    resetSheetEditorTestState()
  })

  it('handles command-arrow sheet edge navigation before IronCalc placeholder handlers run', async () => {
    renderSheetEditor()
    const { workbookRoot } = await activateWorkbookRoot()
    selectInteriorCell()

    expect(() => {
      fireEvent.keyDown(workbookRoot, { key: 'ArrowRight', metaKey: true })
    }).not.toThrow()
    expect(ironCalcMock.state.selectedView).toMatchObject({
      column: MAX_SHEET_COLUMNS,
      left_column: MAX_SHEET_COLUMNS,
      row: 8,
      top_row: 3,
    })

    expect(() => {
      fireEvent.keyDown(workbookRoot, { key: 'ArrowDown', metaKey: true })
    }).not.toThrow()
    expect(ironCalcMock.state.selectedView).toMatchObject({
      column: MAX_SHEET_COLUMNS,
      left_column: MAX_SHEET_COLUMNS,
      row: MAX_SHEET_ROWS,
      top_row: MAX_SHEET_ROWS,
    })

    expect(() => {
      fireEvent.keyDown(workbookRoot, { key: 'ArrowLeft', ctrlKey: true })
    }).not.toThrow()
    expect(ironCalcMock.state.selectedView).toMatchObject({
      column: 1,
      left_column: 1,
      row: MAX_SHEET_ROWS,
      top_row: MAX_SHEET_ROWS,
    })

    expect(() => {
      fireEvent.keyDown(workbookRoot, { key: 'ArrowUp', ctrlKey: true })
    }).not.toThrow()
    expect(ironCalcMock.state.selectedView).toMatchObject({
      column: 1,
      left_column: 1,
      row: 1,
      top_row: 1,
    })
  })
})
