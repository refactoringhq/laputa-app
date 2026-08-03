import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClipboardData, getIronCalcMock, resetSheetEditorTestState } from './SheetEditor.testUtils'
import { SheetEditor } from './SheetEditor'
import { TOLARIA_SHEET_CLIPBOARD_MIME } from '../utils/sheetClipboard'

const ironCalcMock = getIronCalcMock()
const sheetContent = '---\ntype: Sheet\n---\nMetric,January'
const sheetPath = '/vault/budget.md'

function renderSheetEditor() {
  return render(
    <SheetEditor
      content={sheetContent}
      path={sheetPath}
      onContentChange={vi.fn()}
    />,
  )
}

describe('SheetEditor stale workbook model recovery', () => {
  afterEach(() => {
    resetSheetEditorTestState()
  })

  it('does not surface stale workbook selection reads after native model release', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderSheetEditor()

    await screen.findByTestId('ironcalc-workbook')
    const formulaInput = screen.getByLabelText<HTMLInputElement>('Formula')
    ironCalcMock.state.lastModel?.free()

    try {
      expect(() => {
        fireEvent.input(formulaInput)
      }).not.toThrow()
      expect(warn).toHaveBeenCalledWith(
        '[sheet-editor] Skipped stale workbook selection read:',
        expect.any(Error),
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('does not surface stale workbook pointer interactions after native model release', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderSheetEditor()

    await screen.findByTestId('ironcalc-workbook')
    const editor = screen.getByTestId('sheet-editor')
    ironCalcMock.state.lastModel?.free()

    try {
      expect(() => {
        fireEvent.pointerDown(editor)
      }).not.toThrow()
      expect(warn).toHaveBeenCalledWith(
        '[sheet-editor] Skipped stale workbook interaction:',
        expect.any(Error),
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('does not surface queued paste work after native model release', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderSheetEditor()

    await screen.findByTestId('ironcalc-workbook')
    const editor = screen.getByTestId('sheet-editor')
    const clipboardData = createClipboardData()
    clipboardData.setData(TOLARIA_SHEET_CLIPBOARD_MIME, JSON.stringify({
      action: 'copy',
      cells: [['queued paste']],
      source: {
        column: 1,
        height: 1,
        path: sheetPath,
        row: 1,
        width: 1,
      },
      type: 'tolaria-sheet-clipboard',
      version: 1,
    }))

    try {
      vi.useFakeTimers()
      fireEvent.paste(editor, { clipboardData })
      ironCalcMock.state.lastModel?.free()

      expect(() => {
        vi.runOnlyPendingTimers()
      }).not.toThrow()
      expect(warn).toHaveBeenCalledWith(
        '[sheet-editor] Skipped stale workbook paste:',
        expect.any(Error),
      )
    } finally {
      warn.mockRestore()
    }
  })
})
