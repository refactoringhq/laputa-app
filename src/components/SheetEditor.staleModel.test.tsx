import { act, fireEvent, render, screen } from '@testing-library/react'
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

function dispatchWorkbookError(error: Error): ErrorEvent {
  const event = new ErrorEvent('error', {
    cancelable: true,
    error,
    message: error.message,
  })
  window.dispatchEvent(event)
  return event
}

const expectReleasedModelInteractionIsSkipped = async (
  interaction: () => void,
  warning: string,
): Promise<void> => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  renderSheetEditor()
  await screen.findByTestId('ironcalc-workbook')
  ironCalcMock.state.lastModel?.free()

  try {
    expect(interaction).not.toThrow()
    expect(warn).toHaveBeenCalledWith(warning, expect.any(Error))
  } finally {
    warn.mockRestore()
  }
}

describe('SheetEditor stale workbook model recovery', () => {
  afterEach(() => {
    resetSheetEditorTestState()
  })

  it('does not surface stale workbook selection reads after native model release', async () => {
    await expectReleasedModelInteractionIsSkipped(
      () => fireEvent.input(screen.getByLabelText<HTMLInputElement>('Formula')),
      '[sheet-editor] Skipped stale workbook selection read:',
    )
  })

  it('does not surface stale workbook pointer interactions after native model release', async () => {
    await expectReleasedModelInteractionIsSkipped(
      () => fireEvent.pointerDown(screen.getByTestId('sheet-editor')),
      '[sheet-editor] Skipped stale workbook interaction:',
    )
  })

  it('recovers child workbook event failures before global error listeners observe them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const observedDefaultPrevented: boolean[] = []
    const sentryLikeListener = (event: ErrorEvent) => {
      observedDefaultPrevented.push(event.defaultPrevented)
    }
    window.addEventListener('error', sentryLikeListener)

    try {
      renderSheetEditor()
      await screen.findByTestId('ironcalc-workbook')

      let errorEvent: ErrorEvent | null = null
      act(() => {
        expect(() => {
          errorEvent = dispatchWorkbookError(new Error('null pointer passed to rust'))
        }).not.toThrow()
      })

      expect(errorEvent?.defaultPrevented).toBe(true)
      expect(observedDefaultPrevented).toEqual([true])
      expect(screen.queryByTestId('ironcalc-workbook')).not.toBeInTheDocument()
      expect(screen.getByTestId('sheet-editor')).toHaveTextContent('null pointer passed to rust')
      expect(warn).toHaveBeenCalledWith(
        '[sheet-editor] Recovered IronCalc WASM bridge event failure:',
        expect.any(Error),
      )
    } finally {
      warn.mockRestore()
      window.removeEventListener('error', sentryLikeListener)
    }
  })

  it('does not intercept unrelated global errors', async () => {
    renderSheetEditor()
    await screen.findByTestId('ironcalc-workbook')

    const errorEvent = dispatchWorkbookError(new Error('Unexpected workbook error'))

    expect(errorEvent.defaultPrevented).toBe(false)
    expect(screen.getByTestId('ironcalc-workbook')).toBeInTheDocument()
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
