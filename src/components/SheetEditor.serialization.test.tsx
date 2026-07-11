import {
  activateWorkbookRoot,
  getIronCalcMock,
  markWorkbookDirtyForTest,
  resetSheetEditorTestState,
} from './SheetEditor.testUtils'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SheetEditor } from './SheetEditor'

const ironCalcMock = getIronCalcMock()

type SheetHarnessProps = Omit<ComponentProps<typeof SheetEditor>, 'content' | 'onContentChange' | 'path'>

interface SheetHarnessOptions {
  path?: string
  props?: SheetHarnessProps
}

interface ExpectedSheetSave extends SheetHarnessOptions {
  content: string
  editWorkbook: () => void
  expectedContent: string
}

function renderSheetHarness(content: string, options: SheetHarnessOptions = {}) {
  const onContentChange = vi.fn()
  const path = options.path ?? '/vault/budget.md'
  return {
    onContentChange,
    path,
    ...render(
      <SheetEditor
        content={content}
        path={path}
        onContentChange={onContentChange}
        {...options.props}
      />,
    ),
  }
}

function sheetWithA1Metadata(metadataLines: string[], body = 'Metric,January'): string {
  return [
    '---',
    'type: Sheet',
    '_sheet:',
    '  cells:',
    '    A1:',
    ...metadataLines.map((line) => `      ${line}`),
    '---',
    body,
  ].join('\n')
}

async function renderLoadedSheet(content: string, options: SheetHarnessOptions = {}) {
  const rendered = renderSheetHarness(content, options)
  await screen.findByTestId('ironcalc-workbook')
  return rendered
}

async function expectNoSaveOnUnmount(content: string, options: SheetHarnessOptions = {}) {
  const { onContentChange, unmount } = await renderLoadedSheet(content, options)

  unmount()

  expect(onContentChange).not.toHaveBeenCalled()
}

async function expectSaveAfterDirtyEdit({
  content,
  editWorkbook,
  expectedContent,
  path,
  props,
}: ExpectedSheetSave) {
  const rendered = await renderLoadedSheet(content, { path, props })
  editWorkbook()
  markWorkbookDirtyForTest()
  rendered.unmount()

  await waitFor(() => {
    expect(rendered.onContentChange).toHaveBeenCalledWith(rendered.path, expectedContent)
  })
}

describe('SheetEditor serialization', () => {
  afterEach(() => {
    resetSheetEditorTestState()
  })

  it('flushes the current workbook content when unmounted before debounce runs', async () => {
    await expectSaveAfterDirtyEdit({
      content: '---\ntype: Sheet\n---\nMetric,January',
      editWorkbook: () => {
        ironCalcMock.state.lastModel?.setUserInput(0, 1, 1, 'Updated Metric')
      },
      expectedContent: '---\ntype: Sheet\n---\nUpdated Metric,January',
    })
  })

  it('does not pad ragged rows when an unchanged sheet is flushed', async () => {
    await expectNoSaveOnUnmount(
      '---\n_display: sheet\n---\nName,Value,Notes\nIntro\n,Only second column\nTotal,42',
      { path: '/vault/ragged-sheet.md' },
    )
  })

  it('does not rewrite unchanged sheets with explicit trailing empty cells', async () => {
    await expectNoSaveOnUnmount('---\n_display: sheet\n---\nMetric,January,,\nRevenue,1200,,')
  })

  it('keeps a replaced workbook model alive until the replacement can commit', async () => {
    const rendered = await renderLoadedSheet('---\n_display: sheet\n---\nMetric,January')
    const firstModel = ironCalcMock.state.lastModel
    expect(firstModel).not.toBeNull()

    vi.useFakeTimers()
    rendered.rerender(
      <SheetEditor
        content={'---\n_display: sheet\n---\nMetric,February'}
        path={rendered.path}
        onContentChange={rendered.onContentChange}
      />,
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(ironCalcMock.state.modelConstructs).toBe(2)
    expect(firstModel?.getSelectedSheet()).toBe(0)
    expect(ironCalcMock.state.freedModels.has(firstModel!)).toBe(false)

    act(() => {
      vi.runOnlyPendingTimers()
    })

    expect(ironCalcMock.state.freedModels.has(firstModel!)).toBe(true)
    expect(() => firstModel?.getSelectedSheet()).toThrow('null pointer passed to rust')
  })

  it('does not surface workbook release failures when a stale model is already freed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { unmount } = await renderLoadedSheet('---\n_display: sheet\n---\nMetric,January')
    const model = ironCalcMock.state.lastModel
    expect(model).not.toBeNull()
    vi.spyOn(model!, 'free').mockImplementation(() => {
      throw new Error('null pointer passed to rust')
    })

    vi.useFakeTimers()
    try {
      unmount()

      expect(() => {
        act(() => {
          vi.runOnlyPendingTimers()
        })
      }).not.toThrow()
      expect(warn).toHaveBeenCalledWith(
        '[sheet-editor] Failed to release workbook model:',
        expect.any(Error),
      )
    } finally {
      vi.useRealTimers()
      warn.mockRestore()
    }
  })

  it('does not surface workbook serialization when a stale model is already freed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { onContentChange, unmount } = await renderLoadedSheet('---\n_display: sheet\n---\nMetric,January')
    const model = ironCalcMock.state.lastModel
    expect(model).not.toBeNull()

    model?.setUserInput(0, 1, 1, 'Updated Metric')
    markWorkbookDirtyForTest()
    model?.free()

    try {
      expect(() => unmount()).not.toThrow()
      expect(onContentChange).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith(
        '[sheet-editor] Skipped stale workbook serialization:',
        expect.any(Error),
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('preserves trailing empty cells when saving an edited row', async () => {
    await expectSaveAfterDirtyEdit({
      content: '---\n_display: sheet\n---\nMetric,January,,\nRevenue,1200,,',
      editWorkbook: () => {
        ironCalcMock.state.lastModel?.setUserInput(0, 1, 1, 'Updated Metric')
      },
      expectedContent: '---\n_display: sheet\n---\nUpdated Metric,January,,\nRevenue,1200,,',
    })
  })

  it('preserves the CSV body exactly for formatting-only saves', async () => {
    const { onContentChange, unmount } = await renderLoadedSheet(
      '---\n_display: sheet\n---\nMetric,"January",,\nRevenue,1200,,',
    )
    const workbook = await screen.findByTestId('ironcalc-workbook')
    fireEvent.contextMenu(workbook, { button: 2, clientX: 16, clientY: 16 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Bold' }))
    unmount()

    await waitFor(() => {
      expect(onContentChange).toHaveBeenCalledWith(
        '/vault/budget.md',
        [
          '---',
          '_display: sheet',
          '_sheet:',
          '  cells:',
          '    A1:',
          '      bold: true',
          '---',
          'Metric,"January",,',
          'Revenue,1200,,',
        ].join('\n'),
      )
    })
  })

  it('registers a path-scoped sheet flush for note switch boundaries', async () => {
    const flushContentRef = { current: null as ((path: string) => void) | null }
    const { onContentChange, unmount } = await renderLoadedSheet(
      '---\ntype: Sheet\n---\nMetric,January',
      { props: { flushContentRef } },
    )

    ironCalcMock.state.lastModel?.setUserInput(0, 1, 1, 'Updated Metric')
    markWorkbookDirtyForTest()

    act(() => {
      flushContentRef.current?.('/vault/other.md')
    })
    expect(onContentChange).not.toHaveBeenCalled()

    act(() => {
      flushContentRef.current?.('/vault/budget.md')
    })
    expect(onContentChange).toHaveBeenCalledWith(
      '/vault/budget.md',
      '---\ntype: Sheet\n---\nUpdated Metric,January',
    )
    unmount()
  })

  it('commits active cell editor formulas when Escape precedes note-switch flush', async () => {
    const flushContentRef = { current: null as ((path: string) => void) | null }
    const { onContentChange, unmount } = await renderLoadedSheet(
      '---\n_display: sheet\n---\nMetric,January\nRevenue,1200,1300,1400',
      { props: { flushContentRef } },
    )
    await activateWorkbookRoot()
    const cellEditor = screen.getByLabelText<HTMLTextAreaElement>('Cell editor')
    cellEditor.focus()

    fireEvent.input(cellEditor, { target: { value: '=SUM(B2:D2)' } })
    fireEvent.keyDown(cellEditor, { key: 'Escape', code: 'Escape' })

    expect(ironCalcMock.state.lastModel?.getRawCellContent(0, 1, 1)).toBe('=SUM(B2:D2)')

    act(() => {
      flushContentRef.current?.('/vault/budget.md')
    })
    expect(onContentChange).toHaveBeenCalledWith(
      '/vault/budget.md',
      '---\n_display: sheet\n---\n=SUM(B2:D2),January\nRevenue,1200,1300,1400',
    )
    unmount()
  })

  it('does not serialize the workbook for pure pointer selection', async () => {
    const { onContentChange } = await renderLoadedSheet('---\ntype: Sheet\n---\nMetric,January')
    const workbook = screen.getByTestId('ironcalc-workbook')
    ironCalcMock.state.selectedView = {
      column: 1,
      left_column: 1,
      range: [1, 1, 50000, 200],
      row: 1,
      sheet: 0,
      top_row: 1,
    }

    vi.useFakeTimers()
    fireEvent.pointerDown(workbook)
    fireEvent.pointerUp(workbook)
    act(() => vi.advanceTimersByTime(1000))
    vi.useRealTimers()

    expect(onContentChange).not.toHaveBeenCalled()
    expect(ironCalcMock.state.columnsWithDataCalls).toBe(0)
    expect(ironCalcMock.state.rowsWithDataCalls).toBe(0)
  })

  it('normalizes markdown wrappers into plain-text metadata on save', async () => {
    await expectSaveAfterDirtyEdit({
      content: '---\ntype: Sheet\n---\nMetric,January',
      editWorkbook: () => {
        ironCalcMock.state.lastModel?.setUserInput(0, 1, 1, '**Updated Metric**')
      },
      expectedContent: [
        '---',
        'type: Sheet',
        '_sheet:',
        '  cells:',
        '    A1:',
        '      bold: true',
        '---',
        'Updated Metric,January',
      ].join('\n'),
    })
  })

  it('preserves workbook-level sheet settings in plain-text metadata', async () => {
    await expectSaveAfterDirtyEdit({
      content: [
        '---',
        'type: Sheet',
        '_sheet:',
        '  show_grid_lines: false',
        '  frozen_rows: 1',
        '  frozen_columns: 2',
        '  cells:',
        '    A1:',
        '      border_top: "thin #ff0000"',
        '---',
        'Metric,January',
      ].join('\n'),
      editWorkbook: () => {
        ironCalcMock.state.lastModel?.setUserInput(0, 1, 1, 'Updated Metric')
      },
      expectedContent: [
        '---',
        'type: Sheet',
        '_sheet:',
        '  show_grid_lines: false',
        '  frozen_rows: 1',
        '  frozen_columns: 2',
        '  cells:',
        '    A1:',
        '      border_top: "thin #ff0000"',
        '---',
        'Updated Metric,January',
      ].join('\n'),
    })
  })

  it('normalizes violet sheet metadata colors before applying them to IronCalc', async () => {
    await expectSaveAfterDirtyEdit({
      content: sheetWithA1Metadata([
        'font_color: violet',
        'fill_color: violet',
        'border_top: "thin violet"',
      ]),
      editWorkbook: () => {
        ironCalcMock.state.lastModel?.setUserInput(0, 1, 1, 'Updated Metric')
      },
      expectedContent: sheetWithA1Metadata([
        'font_color: "#ee82ee"',
        'fill_color: "#ee82ee"',
        'border_top: "thin #ee82ee"',
      ], 'Updated Metric,January'),
    })
  })

  it('preserves existing rows beyond the default serialization scan window', async () => {
    const rows = Array.from({ length: 1005 }, (_, index) => `Row ${index + 1}`)
    await expectSaveAfterDirtyEdit({
      content: `---\ntype: Sheet\n---\n${rows.join('\n')}`,
      editWorkbook: () => {
        ironCalcMock.state.lastModel?.setUserInput(0, 1, 1, 'Updated Row 1')
      },
      expectedContent: `---\ntype: Sheet\n---\nUpdated Row 1\n${rows.slice(1).join('\n')}`,
      path: '/vault/large-budget.md',
    })
  })

  it('serializes borders created in the workbook into cell metadata', async () => {
    await expectSaveAfterDirtyEdit({
      content: '---\ntype: Sheet\n---\nMetric,January',
      editWorkbook: () => {
        ironCalcMock.state.lastModel?.setAreaWithBorder(
          { column: 1, row: 1 },
          { item: { color: '#ff0000', style: 'thin' }, type: 'Top' },
        )
      },
      expectedContent: [
        '---',
        'type: Sheet',
        '_sheet:',
        '  cells:',
        '    A1:',
        '      border_top: "thin #ff0000"',
        '---',
        'Metric,January',
      ].join('\n'),
    })
  })
})
