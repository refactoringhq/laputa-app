import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SheetEditor } from './SheetEditor'
import { cacheNoteContent, clearNoteContentCache } from '../hooks/noteContentCache'
import type { VaultEntry } from '../types'

const nativeWorkerMock = vi.hoisted(() => ({
  canUse: false,
  resolve: vi.fn(async () => new Map()),
}))

vi.mock('../utils/sheetExternalFormulaWorker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/sheetExternalFormulaWorker')>()
  return {
    ...actual,
    canUseNativeSheetFormulaWorker: () => nativeWorkerMock.canUse,
    resolveExternalFormulaInputsWithNativeWorker: (...args: Parameters<typeof actual.resolveExternalFormulaInputsWithNativeWorker>) => (
      nativeWorkerMock.resolve(...args)
    ),
  }
})

interface MockCellStyle {
  alignment?: {
    horizontal?: string
    vertical?: string
    wrap_text?: boolean
  }
  border: {
    bottom?: { color?: string; style?: string }
    left?: { color?: string; style?: string }
    right?: { color?: string; style?: string }
    top?: { color?: string; style?: string }
  }
  fill: {
    fg_color?: string
    pattern_type: string
  }
  font: {
    b?: boolean
    color: string
    i?: boolean
    strike?: boolean
    sz: number
    u?: boolean
  }
  num_fmt: string
}

const ironCalcMock = vi.hoisted(() => {
  const state: {
    clearContentRanges: Array<{
      endColumn: number
      endRow: number
      sheet: number
      startColumn: number
      startRow: number
    }>
    columnsWithDataCalls: number
    deletedColumns: Array<{ column: number; sheet: number }>
    deletedRows: Array<{ row: number; sheet: number }>
    downMoves: number
    editStarts: number
    insertedColumns: Array<{ column: number; sheet: number }>
    insertedRows: Array<{ row: number; sheet: number }>
    lastModel: MockModel | null
    lastPointer: { clientX: number; clientY: number; pageX: number; pageY: number } | null
    modelConstructs: number
    rowsWithDataCalls: number
    selectedView: {
      column: number
      left_column: number
      range: [number, number, number, number]
      row: number
      sheet: number
      top_row: number
    }
    workbookRenders: number
  } = {
    clearContentRanges: [],
    columnsWithDataCalls: 0,
    deletedColumns: [],
    deletedRows: [],
    downMoves: 0,
    editStarts: 0,
    insertedColumns: [],
    insertedRows: [],
    lastModel: null,
    lastPointer: null,
    modelConstructs: 0,
    rowsWithDataCalls: 0,
    selectedView: {
      column: 1,
      left_column: 1,
      range: [1, 1, 1, 1],
      row: 1,
      sheet: 0,
      top_row: 1,
    },
    workbookRenders: 0,
  }

  function cellKey(row: number, column: number): string {
    return `${row}:${column}`
  }

  function defaultStyle(): MockCellStyle {
    return {
      border: {},
      fill: { pattern_type: 'none' },
      font: { color: '#000000', sz: 13 },
      num_fmt: 'general',
    }
  }

  class MockModel {
    readonly clearFormattingRanges: Array<{
      endColumn: number
      endRow: number
      sheet: number
      startColumn: number
      startRow: number
    }> = []
    private readonly cells = new Map<string, string>()
    private readonly styles = new Map<string, MockCellStyle>()
    private frozenColumns = 0
    private frozenRows = 0
    private showGridLines = true
    readonly styleUpdates: Array<{
      range: { column: number; height: number; row: number; sheet: number; width: number }
      stylePath: string
      value: string
    }> = []

    constructor() {
      state.modelConstructs += 1
      state.lastModel = this
    }

    pauseEvaluation(): void {}
    resumeEvaluation(): void {}
    evaluate(): void {}
    setSelectedSheet(): void {}
    free(): void {}

    setUserInput(_sheet: number, row: number, column: number, input: string): void {
      this.cells.set(cellKey(row, column), input)
    }

    getCellContent(_sheet: number, row: number, column: number): string {
      return this.cells.get(cellKey(row, column)) ?? ''
    }

    getRawCellContent(_sheet: number, row: number, column: number): string {
      return this.cells.get(cellKey(row, column)) ?? ''
    }

    getFormattedCellValue(_sheet: number, row: number, column: number): string {
      const content = this.cells.get(cellKey(row, column)) ?? ''
      if (!content.startsWith('=')) return content
      const formula = content.slice(1)
      if (/^-?\d+(?:\.\d+)?(?:\+-?\d+(?:\.\d+)?)*$/.test(formula)) {
        return String(formula.split('+').reduce((total, part) => total + Number(part), 0))
      }
      return content
    }

    getColumnsWithData(_sheet: number, row: number): Int32Array {
      state.columnsWithDataCalls += 1
      const columns = Array.from(this.cells.keys())
        .map((key) => key.split(':').map(Number))
        .filter(([cellRow]) => cellRow === row)
        .map(([, column]) => column)
        .sort((left, right) => left - right)
      return Int32Array.from(columns)
    }

    getRowsWithData(_sheet: number, column: number): Int32Array {
      state.rowsWithDataCalls += 1
      const rows = Array.from(this.cells.keys())
        .map((key) => key.split(':').map(Number))
        .filter(([, cellColumn]) => cellColumn === column)
        .map(([row]) => row)
        .sort((left, right) => left - right)
      return Int32Array.from(rows)
    }

    getColumnWidth(): number {
      return 125
    }

    getRowHeight(): number {
      return 28
    }

    setColumnsWidth(): void {}
    setRowsHeight(): void {}

    setAreaWithBorder(
      range: { column: number; row: number },
      borderArea: { item: { color?: string; style: string }; type: string },
    ): void {
      const key = cellKey(range.row, range.column)
      const current = this.styles.get(key) ?? defaultStyle()
      if (borderArea.type === 'Top') current.border.top = borderArea.item
      if (borderArea.type === 'Right') current.border.right = borderArea.item
      if (borderArea.type === 'Bottom') current.border.bottom = borderArea.item
      if (borderArea.type === 'Left') current.border.left = borderArea.item
      this.styles.set(key, current)
    }

    setFrozenRowsCount(_sheet: number, count: number): void {
      this.frozenRows = count
    }

    getFrozenRowsCount(): number {
      return this.frozenRows
    }

    setFrozenColumnsCount(_sheet: number, count: number): void {
      this.frozenColumns = count
    }

    getFrozenColumnsCount(): number {
      return this.frozenColumns
    }

    setShowGridLines(_sheet: number, show: boolean): void {
      this.showGridLines = show
    }

    getShowGridLines(): boolean {
      return this.showGridLines
    }

    getSelectedView() {
      return state.selectedView
    }

    rangeClearContents(
      sheet: number,
      startRow: number,
      startColumn: number,
      endRow: number,
      endColumn: number,
    ): void {
      state.clearContentRanges.push({ endColumn, endRow, sheet, startColumn, startRow })
      for (let row = startRow; row <= endRow; row += 1) {
        for (let column = startColumn; column <= endColumn; column += 1) {
          this.cells.delete(cellKey(row, column))
        }
      }
    }

    insertRow(sheet: number, row: number): void {
      state.insertedRows.push({ row, sheet })
    }

    insertColumn(sheet: number, column: number): void {
      state.insertedColumns.push({ column, sheet })
    }

    deleteRow(sheet: number, row: number): void {
      state.deletedRows.push({ row, sheet })
    }

    deleteColumn(sheet: number, column: number): void {
      state.deletedColumns.push({ column, sheet })
    }

    updateRangeStyle(
      range: { column: number; height: number; row: number; sheet: number; width: number },
      stylePath: string,
      value: string,
    ): void {
      this.styleUpdates.push({ range, stylePath, value })
      const key = cellKey(range.row, range.column)
      const current = this.styles.get(key) ?? defaultStyle()
      if (stylePath === 'font.b') current.font.b = value === 'true'
      if (stylePath === 'font.i') current.font.i = value === 'true'
      if (stylePath === 'num_fmt') current.num_fmt = value
      this.styles.set(key, current)
    }

    rangeClearFormatting(
      sheet: number,
      startRow: number,
      startColumn: number,
      endRow: number,
      endColumn: number,
    ): void {
      this.clearFormattingRanges.push({ endColumn, endRow, sheet, startColumn, startRow })
      this.styles.clear()
    }

    getCellStyle(_sheet: number, row: number, column: number): MockCellStyle {
      return this.styles.get(cellKey(row, column)) ?? defaultStyle()
    }
  }

  return { MockModel, state }
})

vi.mock('@ironcalc/workbook', () => ({
  init: vi.fn(() => Promise.resolve()),
  IronCalc: ({ model }: { model: MockModel }) => {
    ironCalcMock.state.lastModel = model
    ironCalcMock.state.workbookRenders += 1
    return (
      <div
        className="sheet-container"
        data-testid="ironcalc-workbook"
        onKeyDown={(event) => {
          if (event.key === 'F2') ironCalcMock.state.editStarts += 1
          if (event.key === 'Enter') ironCalcMock.state.downMoves += 1
        }}
        onPointerDown={(event) => {
          if (event.button === 2) {
            ironCalcMock.state.selectedView = {
              column: 9,
              left_column: 1,
              range: [9, 9, 9, 9],
              row: 9,
              sheet: 0,
              top_row: 1,
            }
          }
          ironCalcMock.state.lastPointer = {
            clientX: event.clientX,
            clientY: event.clientY,
            pageX: event.pageX,
            pageY: event.pageY,
          }
        }}
        tabIndex={0}
      >
        <canvas data-testid="mock-sheet-canvas" />
        <input aria-label="Formula" data-testid="mock-formula-input" style={{ caretColor: 'rgb(242, 153, 74)' }} />
        <div
          data-testid="mock-selection-outline"
          style={{
            background: 'none',
            border: '2px solid rgb(242, 153, 74)',
            height: '20px',
            lineHeight: '18px',
            width: '100px',
          }}
        />
        <div
          data-testid="mock-range-outline"
          style={{
            backgroundColor: 'rgba(242, 153, 74, 0.1)',
            border: '1px solid rgb(242, 153, 74)',
            borderRadius: '3px',
            height: '60px',
            position: 'absolute',
            width: '100px',
          }}
        />
        <div
          data-testid="mock-selection-handle"
          style={{
            backgroundColor: 'rgb(242, 153, 74)',
            cursor: 'crosshair',
            height: '5px',
            position: 'absolute',
            width: '5px',
          }}
        />
        <div
          data-testid="mock-editing-outline"
          style={{
            border: '2px solid rgb(242, 153, 74)',
            height: '20px',
            left: '10px',
            position: 'absolute',
            top: '20px',
            width: '100px',
          }}
        >
          <div>
            <textarea aria-label="Cell editor" />
          </div>
        </div>
      </div>
    )
  },
  Model: ironCalcMock.MockModel,
}))

function makeEntry(overrides: Partial<VaultEntry>): VaultEntry {
  return {
    path: '/vault/project-alpha.md',
    filename: 'project-alpha.md',
    title: 'Project Alpha',
    isA: 'Project',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    modifiedAt: null,
    createdAt: null,
    fileSize: 0,
    snippet: '',
    wordCount: 0,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    sidebarLabel: null,
    template: null,
    sort: null,
    view: null,
    visible: true,
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    outgoingLinks: [],
    properties: {},
    hasH1: false,
    fileKind: 'markdown',
    ...overrides,
  }
}

function createClipboardData(): DataTransfer {
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
    setData: vi.fn((type: string, value: string) => {
      values.set(type, value)
    }),
    setDragImage: vi.fn(),
    types: [] as unknown as readonly string[],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

async function openFormulaAutocomplete(value = '=su'): Promise<HTMLInputElement> {
  render(
    <SheetEditor
      content={'---\ntype: Sheet\n---\nMetric,January'}
      path="/vault/budget.md"
      onContentChange={vi.fn()}
    />,
  )

  await screen.findByTestId('ironcalc-workbook')
  const formulaInput = screen.getByLabelText<HTMLInputElement>('Formula')
  formulaInput.focus()
  formulaInput.value = value
  formulaInput.setSelectionRange(value.length, value.length)
  fireEvent.input(formulaInput)
  await screen.findByRole('listbox')
  return formulaInput
}

function markWorkbookDirtyForTest(): void {
  fireEvent.input(screen.getByLabelText('Formula'))
}

describe('SheetEditor', () => {
  afterEach(() => {
    vi.useRealTimers()
    ironCalcMock.state.clearContentRanges = []
    ironCalcMock.state.columnsWithDataCalls = 0
    ironCalcMock.state.deletedColumns = []
    ironCalcMock.state.deletedRows = []
    ironCalcMock.state.downMoves = 0
    ironCalcMock.state.editStarts = 0
    ironCalcMock.state.insertedColumns = []
    ironCalcMock.state.insertedRows = []
    ironCalcMock.state.lastModel = null
    ironCalcMock.state.lastPointer = null
    ironCalcMock.state.modelConstructs = 0
    ironCalcMock.state.rowsWithDataCalls = 0
    ironCalcMock.state.selectedView = {
      column: 1,
      left_column: 1,
      range: [1, 1, 1, 1],
      row: 1,
      sheet: 0,
      top_row: 1,
    }
    ironCalcMock.state.workbookRenders = 0
    nativeWorkerMock.canUse = false
    nativeWorkerMock.resolve.mockReset()
    nativeWorkerMock.resolve.mockResolvedValue(new Map())
    document.documentElement.style.removeProperty('zoom')
    clearNoteContentCache()
  })

  it('flushes the current workbook content when unmounted before debounce runs', async () => {
    const onContentChange = vi.fn()
    const { unmount } = render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January'}
        path="/vault/budget.md"
        onContentChange={onContentChange}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
    ironCalcMock.state.lastModel?.setUserInput(0, 1, 1, 'Updated Metric')
    markWorkbookDirtyForTest()
    unmount()

    await waitFor(() => {
      expect(onContentChange).toHaveBeenCalledWith(
        '/vault/budget.md',
        '---\ntype: Sheet\n---\nUpdated Metric,January',
      )
    })
  })

  it('does not pad ragged rows when an unchanged sheet is flushed', async () => {
    const onContentChange = vi.fn()
    const { unmount } = render(
      <SheetEditor
        content={'---\n_display: sheet\n---\nName,Value,Notes\nIntro\n,Only second column\nTotal,42'}
        path="/vault/ragged-sheet.md"
        onContentChange={onContentChange}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
    unmount()

    expect(onContentChange).not.toHaveBeenCalled()
  })

  it('does not rewrite unchanged sheets with explicit trailing empty cells', async () => {
    const onContentChange = vi.fn()
    const { unmount } = render(
      <SheetEditor
        content={'---\n_display: sheet\n---\nMetric,January,,\nRevenue,1200,,'}
        path="/vault/budget.md"
        onContentChange={onContentChange}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
    unmount()

    expect(onContentChange).not.toHaveBeenCalled()
  })

  it('preserves trailing empty cells when saving an edited row', async () => {
    const onContentChange = vi.fn()
    const { unmount } = render(
      <SheetEditor
        content={'---\n_display: sheet\n---\nMetric,January,,\nRevenue,1200,,'}
        path="/vault/budget.md"
        onContentChange={onContentChange}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
    ironCalcMock.state.lastModel?.setUserInput(0, 1, 1, 'Updated Metric')
    markWorkbookDirtyForTest()
    unmount()

    await waitFor(() => {
      expect(onContentChange).toHaveBeenCalledWith(
        '/vault/budget.md',
        '---\n_display: sheet\n---\nUpdated Metric,January,,\nRevenue,1200,,',
      )
    })
  })

  it('preserves the CSV body exactly for formatting-only saves', async () => {
    const onContentChange = vi.fn()
    const { unmount } = render(
      <SheetEditor
        content={'---\n_display: sheet\n---\nMetric,"January",,\nRevenue,1200,,'}
        path="/vault/budget.md"
        onContentChange={onContentChange}
      />,
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
    const onContentChange = vi.fn()
    const flushContentRef = { current: null as ((path: string) => void) | null }
    const { unmount } = render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January'}
        flushContentRef={flushContentRef}
        path="/vault/budget.md"
        onContentChange={onContentChange}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
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

  it('does not serialize the workbook for pure pointer selection', async () => {
    const onContentChange = vi.fn()
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January'}
        path="/vault/budget.md"
        onContentChange={onContentChange}
      />,
    )

    const workbook = await screen.findByTestId('ironcalc-workbook')
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
    const onContentChange = vi.fn()
    const { unmount } = render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January'}
        path="/vault/budget.md"
        onContentChange={onContentChange}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
    ironCalcMock.state.lastModel?.setUserInput(0, 1, 1, '**Updated Metric**')
    markWorkbookDirtyForTest()
    unmount()

    await waitFor(() => {
      expect(onContentChange).toHaveBeenCalledWith(
        '/vault/budget.md',
        [
          '---',
          'type: Sheet',
          '_sheet:',
          '  cells:',
          '    A1:',
          '      bold: true',
          '---',
          'Updated Metric,January',
        ].join('\n'),
      )
    })
  })

  it('preserves workbook-level sheet settings in plain-text metadata', async () => {
    const onContentChange = vi.fn()
    const { unmount } = render(
      <SheetEditor
        content={[
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
        ].join('\n')}
        path="/vault/budget.md"
        onContentChange={onContentChange}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
    ironCalcMock.state.lastModel?.setUserInput(0, 1, 1, 'Updated Metric')
    markWorkbookDirtyForTest()
    unmount()

    await waitFor(() => {
      expect(onContentChange).toHaveBeenCalledWith(
        '/vault/budget.md',
        [
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
      )
    })
  })

  it('preserves existing rows beyond the default serialization scan window', async () => {
    const onContentChange = vi.fn()
    const rows = Array.from({ length: 1005 }, (_, index) => `Row ${index + 1}`)
    const { unmount } = render(
      <SheetEditor
        content={`---\ntype: Sheet\n---\n${rows.join('\n')}`}
        path="/vault/large-budget.md"
        onContentChange={onContentChange}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
    ironCalcMock.state.lastModel?.setUserInput(0, 1, 1, 'Updated Row 1')
    markWorkbookDirtyForTest()
    unmount()

    await waitFor(() => {
      expect(onContentChange).toHaveBeenCalledWith(
        '/vault/large-budget.md',
        `---\ntype: Sheet\n---\nUpdated Row 1\n${rows.slice(1).join('\n')}`,
      )
    })
  })

  it('serializes borders created in the workbook into cell metadata', async () => {
    const onContentChange = vi.fn()
    const { unmount } = render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January'}
        path="/vault/budget.md"
        onContentChange={onContentChange}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
    ironCalcMock.state.lastModel?.setAreaWithBorder(
      { column: 1, row: 1 },
      { item: { color: '#ff0000', style: 'thin' }, type: 'Top' },
    )
    markWorkbookDirtyForTest()
    unmount()

    await waitFor(() => {
      expect(onContentChange).toHaveBeenCalledWith(
        '/vault/budget.md',
        [
          '---',
          'type: Sheet',
          '_sheet:',
          '  cells:',
          '    A1:',
          '      border_top: "thin #ff0000"',
          '---',
          'Metric,January',
        ].join('\n'),
      )
    })
  })

  it('applies formula suggestions from the inline autocomplete', async () => {
    const formulaInput = await openFormulaAutocomplete()
    fireEvent.keyDown(formulaInput, { key: 'Enter' })

    expect(formulaInput.value).toBe('=SUM(')
  })

  it('opens note autocomplete from a sheet cell wikilink trigger and inserts the selected wikilink', async () => {
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January'}
        entries={[
          makeEntry({ path: '/vault/project-alpha.md', filename: 'project-alpha.md', title: 'Project Alpha' }),
          makeEntry({ path: '/vault/project-beta.md', filename: 'project-beta.md', title: 'Project Beta' }),
        ]}
        path="/vault/budget.md"
        sourceEntry={makeEntry({ path: '/vault/budget.md', filename: 'budget.md', title: 'Budget' })}
        vaultPath="/vault"
        onContentChange={vi.fn()}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
    const formulaInput = screen.getByLabelText<HTMLInputElement>('Formula')
    formulaInput.focus()

    formulaInput.value = '[['
    formulaInput.setSelectionRange(2, 2)
    fireEvent.input(formulaInput)

    expect(await screen.findByTestId('sheet-wikilink-autocomplete')).toBeInTheDocument()
    expect(screen.getByText('Project Alpha')).toBeInTheDocument()

    formulaInput.value = '[[Pro'
    formulaInput.setSelectionRange(5, 5)
    fireEvent.input(formulaInput)
    fireEvent.keyDown(formulaInput, { key: 'Enter' })

    expect(formulaInput.value).toBe('[[project-alpha]]')
    expect(ironCalcMock.state.lastModel?.getCellContent(0, 1, 1)).toBe('[[project-alpha]]')
    expect(ironCalcMock.state.lastModel?.styleUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({ stylePath: 'font.color', value: '#155dff' }),
      expect.objectContaining({ stylePath: 'font.u', value: 'true' }),
    ]))
    expect(screen.queryByTestId('sheet-wikilink-autocomplete')).not.toBeInTheDocument()
  })

  it('keeps the keyboard-selected wikilink suggestion after keyup refreshes the autocomplete', async () => {
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January'}
        entries={[
          makeEntry({ path: '/vault/project-alpha.md', filename: 'project-alpha.md', title: 'Project Alpha' }),
          makeEntry({ path: '/vault/project-beta.md', filename: 'project-beta.md', title: 'Project Beta' }),
        ]}
        path="/vault/budget.md"
        sourceEntry={makeEntry({ path: '/vault/budget.md', filename: 'budget.md', title: 'Budget' })}
        vaultPath="/vault"
        onContentChange={vi.fn()}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
    const formulaInput = screen.getByLabelText<HTMLInputElement>('Formula')
    formulaInput.focus()
    formulaInput.value = '[[Pro'
    formulaInput.setSelectionRange(5, 5)
    fireEvent.input(formulaInput)

    expect(await screen.findByTestId('sheet-wikilink-autocomplete')).toBeInTheDocument()
    fireEvent.keyDown(formulaInput, { key: 'ArrowDown' })
    fireEvent.keyUp(formulaInput, { key: 'ArrowDown' })
    fireEvent.keyDown(formulaInput, { key: 'Enter' })

    expect(formulaInput.value).toBe('[[project-beta]]')
    expect(ironCalcMock.state.lastModel?.getCellContent(0, 1, 1)).toBe('[[project-beta]]')
  })

  it('inserts a clicked sheet wikilink autocomplete suggestion into the selected cell', async () => {
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January'}
        entries={[
          makeEntry({ path: '/vault/sheet-prototype.md', filename: 'sheet-prototype.md', title: 'Sheet Prototype', isA: 'Sheet' }),
          makeEntry({ path: '/vault/sheet.md', filename: 'sheet.md', title: 'Sheet', isA: 'Type' }),
        ]}
        path="/vault/budget.md"
        sourceEntry={makeEntry({ path: '/vault/budget.md', filename: 'budget.md', title: 'Budget', isA: 'Sheet' })}
        vaultPath="/vault"
        onContentChange={vi.fn()}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
    const formulaInput = screen.getByLabelText<HTMLInputElement>('Formula')
    formulaInput.focus()
    formulaInput.value = '[[Shee'
    formulaInput.setSelectionRange(7, 7)
    fireEvent.input(formulaInput)

    expect(await screen.findByTestId('sheet-wikilink-autocomplete')).toBeInTheDocument()
    const suggestionButton = screen.getByText('Sheet Prototype').closest('button')
    expect(suggestionButton).not.toBeNull()
    fireEvent.pointerDown(suggestionButton!)

    expect(formulaInput.value).toBe('[[sheet-prototype]]')
    expect(ironCalcMock.state.lastModel?.getCellContent(0, 1, 1)).toBe('[[sheet-prototype]]')
    expect(screen.queryByTestId('sheet-wikilink-autocomplete')).not.toBeInTheDocument()
  })

  it('opens note autocomplete from a formula wikilink trigger without styling the formula cell', async () => {
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January'}
        entries={[
          makeEntry({
            path: '/vault/revenue-sheet.md',
            filename: 'revenue-sheet.md',
            title: 'Revenue Sheet',
            isA: 'Sheet',
          }),
        ]}
        path="/vault/budget.md"
        sourceEntry={makeEntry({ path: '/vault/budget.md', filename: 'budget.md', title: 'Budget' })}
        vaultPath="/vault"
        onContentChange={vi.fn()}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
    const formulaInput = screen.getByLabelText<HTMLInputElement>('Formula')
    formulaInput.focus()

    formulaInput.value = '=[['
    formulaInput.setSelectionRange(3, 3)
    fireEvent.input(formulaInput)

    expect(await screen.findByTestId('sheet-wikilink-autocomplete')).toBeInTheDocument()
    expect(screen.getByText('Revenue Sheet')).toBeInTheDocument()

    formulaInput.value = '=[[Rev'
    formulaInput.setSelectionRange(6, 6)
    fireEvent.input(formulaInput)
    fireEvent.keyDown(formulaInput, { key: 'Enter' })

    expect(formulaInput.value).toBe('=[[revenue-sheet]]')
    expect(ironCalcMock.state.lastModel?.styleUpdates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ stylePath: 'font.color', value: '#155dff' }),
    ]))
  })

  it('does not open sheet wikilink autocomplete inside a quoted formula string', async () => {
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January'}
        entries={[makeEntry({ title: 'Project Alpha' })]}
        path="/vault/budget.md"
        onContentChange={vi.fn()}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
    const formulaInput = screen.getByLabelText<HTMLInputElement>('Formula')
    formulaInput.focus()

    formulaInput.value = '=CONCAT("[[Pr")'
    formulaInput.setSelectionRange(formulaInput.value.length, formulaInput.value.length)
    fireEvent.input(formulaInput)

    expect(screen.queryByTestId('sheet-wikilink-autocomplete')).not.toBeInTheDocument()
  })

  it('evaluates external sheet cell references while preserving the wikilink formula in plain text', async () => {
    const onContentChange = vi.fn()
    const targetEntry = makeEntry({
      path: '/vault/revenue-sheet.md',
      filename: 'revenue-sheet.md',
      title: 'Revenue Sheet',
      isA: 'Sheet',
    })
    cacheNoteContent(targetEntry.path, '---\ntype: Sheet\n---\nMetric,January\nRevenue,1200', targetEntry)
    const { unmount } = render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nTotal\n=[[revenue-sheet]].B2+5'}
        entries={[targetEntry]}
        path="/vault/budget.md"
        sourceEntry={makeEntry({ path: '/vault/budget.md', filename: 'budget.md', title: 'Budget', isA: 'Sheet' })}
        onContentChange={onContentChange}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')

    expect(ironCalcMock.state.lastModel?.getCellContent(0, 2, 1)).toBe('=[[revenue-sheet]].B2+5')
    expect(ironCalcMock.state.lastModel?.getFormattedCellValue(0, 2, 1)).toBe('1205')

    unmount()

    expect(onContentChange).not.toHaveBeenCalled()
  })

  it('evaluates external references to CSV-like note content without requiring sheet display metadata', async () => {
    const targetEntry = makeEntry({
      path: '/vault/model-assumptions.md',
      filename: 'model-assumptions.md',
      title: 'Model Assumptions',
      isA: 'Note',
    })
    cacheNoteContent(
      targetEntry.path,
      '---\ntype: Note\n---\nMetric,Value\nSubscriber growth,0.07',
      targetEntry,
    )
    render(
      <SheetEditor
        content={'---\ntype: Note\n_display: sheet\n---\nMetric,Jul-2026\nSubscriber growth rate applied,=[[model-assumptions]].B2'}
        entries={[targetEntry]}
        path="/vault/business-plan.md"
        sourceEntry={makeEntry({ path: '/vault/business-plan.md', filename: 'business-plan.md', title: 'Business Plan', isA: 'Note' })}
        onContentChange={vi.fn()}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')

    expect(ironCalcMock.state.lastModel?.getCellContent(0, 2, 2)).toBe('=[[model-assumptions]].B2')
    expect(ironCalcMock.state.lastModel?.getFormattedCellValue(0, 2, 2)).toBe('0.07')
  })

  it('compiles current sheet wikilink references to local formulas while preserving the source formula', async () => {
    const currentEntry = makeEntry({
      path: '/vault/current-sheet.md',
      filename: 'current-sheet.md',
      title: 'Current Sheet',
      isA: 'Sheet',
    })
    const onContentChange = vi.fn()
    const { unmount } = render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January\nRevenue,1200\nMirror,=[[current-sheet]].B2+5'}
        entries={[]}
        path={currentEntry.path}
        sourceEntry={currentEntry}
        onContentChange={onContentChange}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')

    expect(ironCalcMock.state.modelConstructs).toBe(1)
    expect(ironCalcMock.state.lastModel?.getRawCellContent(0, 3, 2)).toBe('=B2+5')
    expect(ironCalcMock.state.lastModel?.getCellContent(0, 3, 2)).toBe('=[[current-sheet]].B2+5')

    unmount()

    expect(onContentChange).not.toHaveBeenCalled()
  })

  it('reuses one external workbook build for repeated references to the same sheet', async () => {
    const targetEntry = makeEntry({
      path: '/vault/revenue-sheet.md',
      filename: 'revenue-sheet.md',
      title: 'Revenue Sheet',
      isA: 'Sheet',
    })
    cacheNoteContent(
      targetEntry.path,
      '---\ntype: Sheet\n---\nMetric,January\nRevenue,1200\nExpansion,1300',
      targetEntry,
    )

    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nTotal\n=[[revenue-sheet]].B2+[[revenue-sheet]].B3'}
        entries={[targetEntry]}
        path="/vault/budget.md"
        sourceEntry={makeEntry({ path: '/vault/budget.md', filename: 'budget.md', title: 'Budget', isA: 'Sheet' })}
        onContentChange={vi.fn()}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')

    expect(ironCalcMock.state.modelConstructs).toBe(2)
    expect(ironCalcMock.state.lastModel?.getCellContent(0, 2, 1)).toBe(
      '=[[revenue-sheet]].B2+[[revenue-sheet]].B3',
    )
    expect(ironCalcMock.state.lastModel?.getFormattedCellValue(0, 2, 1)).toBe('2500')
  })

  it('evaluates transitive external sheet references when the whole dependency chain is loaded', async () => {
    const assumptionsEntry = makeEntry({
      path: '/vault/assumptions.md',
      filename: 'assumptions.md',
      title: 'Assumptions',
      isA: 'Note',
    })
    const modelEntry = makeEntry({
      path: '/vault/model.md',
      filename: 'model.md',
      title: 'Model',
      isA: 'Note',
    })
    cacheNoteContent(
      assumptionsEntry.path,
      '---\ntype: Note\n---\nMetric,Value\nGrowth,0.12',
      assumptionsEntry,
    )
    cacheNoteContent(
      modelEntry.path,
      '---\ntype: Note\n---\nMetric,Value\nGrowth from assumptions,=[[assumptions]].B2',
      modelEntry,
    )

    render(
      <SheetEditor
        content={'---\ntype: Note\n_display: sheet\n---\nMetric,Value\nProjected growth,=[[model]].B2'}
        entries={[modelEntry, assumptionsEntry]}
        path="/vault/business-plan.md"
        sourceEntry={makeEntry({ path: '/vault/business-plan.md', filename: 'business-plan.md', title: 'Business Plan', isA: 'Note' })}
        onContentChange={vi.fn()}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')

    expect(ironCalcMock.state.lastModel?.getCellContent(0, 2, 2)).toBe('=[[model]].B2')
    expect(ironCalcMock.state.lastModel?.getFormattedCellValue(0, 2, 2)).toBe('0.12')
  })

  it('updates transitive external references as dependency sheet contents load', async () => {
    const assumptionsEntry = makeEntry({
      path: '/vault/assumptions.md',
      filename: 'assumptions.md',
      title: 'Assumptions',
      isA: 'Note',
    })
    const modelEntry = makeEntry({
      path: '/vault/model.md',
      filename: 'model.md',
      title: 'Model',
      isA: 'Note',
    })

    render(
      <SheetEditor
        content={'---\ntype: Note\n_display: sheet\n---\nMetric,Value\nProjected growth,=[[model]].B2'}
        entries={[modelEntry, assumptionsEntry]}
        path="/vault/business-plan.md"
        sourceEntry={makeEntry({ path: '/vault/business-plan.md', filename: 'business-plan.md', title: 'Business Plan', isA: 'Note' })}
        onContentChange={vi.fn()}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')

    act(() => {
      cacheNoteContent(
        modelEntry.path,
        '---\ntype: Note\n---\nMetric,Value\nGrowth from assumptions,=[[assumptions]].B2',
        modelEntry,
      )
    })
    act(() => {
      cacheNoteContent(
        assumptionsEntry.path,
        '---\ntype: Note\n---\nMetric,Value\nGrowth,0.15',
        assumptionsEntry,
      )
    })

    await waitFor(() => {
      expect(ironCalcMock.state.lastModel?.getFormattedCellValue(0, 2, 2)).toBe('0.15')
    })
    expect(ironCalcMock.state.lastModel?.getCellContent(0, 2, 2)).toBe('=[[model]].B2')
  })

  it('keeps live external sheet formulas editable while evaluating them through IronCalc', async () => {
    const targetEntry = makeEntry({
      path: '/vault/revenue-sheet.md',
      filename: 'revenue-sheet.md',
      title: 'Revenue Sheet',
      isA: 'Sheet',
    })
    cacheNoteContent(targetEntry.path, '---\ntype: Sheet\n---\nMetric,January\nRevenue,1200', targetEntry)
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nTotal'}
        entries={[targetEntry]}
        path="/vault/budget.md"
        sourceEntry={makeEntry({ path: '/vault/budget.md', filename: 'budget.md', title: 'Budget', isA: 'Sheet' })}
        onContentChange={vi.fn()}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
    const formulaInput = screen.getByLabelText<HTMLInputElement>('Formula')
    formulaInput.focus()
    formulaInput.value = '=[[revenue-sheet]].B2+5'
    formulaInput.setSelectionRange(formulaInput.value.length, formulaInput.value.length)

    fireEvent.keyDown(formulaInput, { key: 'Enter' })

    expect(ironCalcMock.state.lastModel?.getCellContent(0, 1, 1)).toBe('=[[revenue-sheet]].B2+5')
    expect(ironCalcMock.state.lastModel?.getFormattedCellValue(0, 1, 1)).toBe('1205')
  })

  it('copies external sheet formulas as formulas and shifts relative external references on paste', async () => {
    const targetEntry = makeEntry({
      path: '/vault/revenue-sheet.md',
      filename: 'revenue-sheet.md',
      title: 'Revenue Sheet',
      isA: 'Sheet',
    })
    cacheNoteContent(targetEntry.path, '---\ntype: Sheet\n---\nMetric,January\nRevenue,1200\nExpansion,1300', targetEntry)
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\n=[[revenue-sheet]].B2+5'}
        entries={[targetEntry]}
        path="/vault/budget.md"
        sourceEntry={makeEntry({ path: '/vault/budget.md', filename: 'budget.md', title: 'Budget', isA: 'Sheet' })}
        onContentChange={vi.fn()}
      />,
    )

    const workbookRoot = await screen.findByTestId('ironcalc-workbook')
    const clipboardData = createClipboardData()
    fireEvent.copy(workbookRoot, { clipboardData })

    ironCalcMock.state.selectedView = {
      column: 1,
      left_column: 1,
      range: [2, 1, 2, 1],
      row: 2,
      sheet: 0,
      top_row: 1,
    }
    fireEvent.paste(workbookRoot, { clipboardData })

    await waitFor(() => {
      expect(ironCalcMock.state.lastModel?.getCellContent(0, 2, 1)).toBe('=[[revenue-sheet]].B3+5')
    })
    expect(ironCalcMock.state.lastModel?.getFormattedCellValue(0, 2, 1)).toBe('1305')
  })

  it('keeps the initial workbook hidden while native external formula resolution is pending', async () => {
    nativeWorkerMock.canUse = true
    const targetEntry = makeEntry({
      path: '/vault/revenue-sheet.md',
      filename: 'revenue-sheet.md',
      title: 'Revenue Sheet',
      isA: 'Sheet',
    })
    cacheNoteContent(targetEntry.path, '---\ntype: Sheet\n---\nMetric,January\nRevenue,1200', targetEntry)
    const pendingResolution = deferred<Map<string, { evaluated: string; source: string }>>()
    nativeWorkerMock.resolve.mockReturnValueOnce(pendingResolution.promise)

    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\n=[[revenue-sheet]].B2'}
        entries={[targetEntry]}
        path="/vault/budget.md"
        sourceEntry={makeEntry({ path: '/vault/budget.md', filename: 'budget.md', title: 'Budget', isA: 'Sheet' })}
        onContentChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(nativeWorkerMock.resolve).toHaveBeenCalled()
    })
    expect(screen.queryByTestId('ironcalc-workbook')).not.toBeInTheDocument()

    await act(async () => {
      pendingResolution.resolve(new Map([
        ['A1', { evaluated: '=1200', source: '=[[revenue-sheet]].B2' }],
      ]))
    })

    await screen.findByTestId('ironcalc-workbook')
    expect(ironCalcMock.state.lastModel?.getCellContent(0, 1, 1)).toBe('=[[revenue-sheet]].B2')
    expect(ironCalcMock.state.lastModel?.getFormattedCellValue(0, 1, 1)).toBe('1200')
  })

  it('rebuilds external sheet formulas when a referenced sheet body is loaded', async () => {
    const targetEntry = makeEntry({
      path: '/vault/revenue-sheet.md',
      filename: 'revenue-sheet.md',
      title: 'Revenue Sheet',
      isA: 'Sheet',
    })
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nTotal\n=[[revenue-sheet]].B2'}
        entries={[targetEntry]}
        path="/vault/budget.md"
        sourceEntry={makeEntry({ path: '/vault/budget.md', filename: 'budget.md', title: 'Budget', isA: 'Sheet' })}
        onContentChange={vi.fn()}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
    expect(ironCalcMock.state.lastModel?.getCellContent(0, 2, 1)).toBe('=[[revenue-sheet]].B2')

    act(() => {
      cacheNoteContent(targetEntry.path, '---\ntype: Sheet\n---\nMetric,January\nRevenue,99', targetEntry)
    })

    await waitFor(() => {
      expect(ironCalcMock.state.lastModel?.getCellContent(0, 2, 1)).toBe('=[[revenue-sheet]].B2')
    })
    expect(ironCalcMock.state.lastModel?.getFormattedCellValue(0, 2, 1)).toBe('99')
  })

  it('styles loaded wikilink cells without serializing default wikilink styling metadata', async () => {
    const onContentChange = vi.fn()
    const { unmount } = render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\n[[project-alpha]],January'}
        path="/vault/budget.md"
        onContentChange={onContentChange}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')

    expect(ironCalcMock.state.lastModel?.styleUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({ stylePath: 'font.color', value: '#155dff' }),
      expect.objectContaining({ stylePath: 'font.u', value: 'true' }),
    ]))

    unmount()

    expect(onContentChange).not.toHaveBeenCalled()
  })

  it('renders wikilink cells as note titles while preserving raw cell content', async () => {
    const entry = makeEntry({
      icon: '📈',
      path: '/vault/project-alpha.md',
      filename: 'project-alpha.md',
      title: 'Project Alpha',
    })

    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\n[[project-alpha]],January'}
        entries={[entry]}
        path="/vault/budget.md"
        sourceEntry={makeEntry({ path: '/vault/budget.md', filename: 'budget.md', title: 'Budget' })}
        onContentChange={vi.fn()}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')

    expect(ironCalcMock.state.lastModel?.getCellContent(0, 1, 1)).toBe('[[project-alpha]]')
    expect(ironCalcMock.state.lastModel?.getFormattedCellValue(0, 1, 1)).toBe('📈 Project Alpha')
  })

  it('opens a wikilink target on command-click without changing raw cell content', async () => {
    const onNavigateWikilink = vi.fn()
    const onContentChange = vi.fn()
    const { unmount } = render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\n[[project-alpha]],January'}
        entries={[
          makeEntry({ path: '/vault/project-alpha.md', filename: 'project-alpha.md', title: 'Project Alpha' }),
        ]}
        path="/vault/budget.md"
        sourceEntry={makeEntry({ path: '/vault/budget.md', filename: 'budget.md', title: 'Budget' })}
        onContentChange={onContentChange}
        onNavigateWikilink={onNavigateWikilink}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
    ironCalcMock.state.lastModel?.setUserInput(0, 1, 2, 'Updated January')
    markWorkbookDirtyForTest()
    const canvas = screen.getByTestId('mock-sheet-canvas')
    canvas.getBoundingClientRect = vi.fn(() => ({
      bottom: 500,
      height: 500,
      left: 0,
      right: 500,
      top: 0,
      width: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }))

    fireEvent.pointerDown(canvas, { button: 0, buttons: 1, clientX: 40, clientY: 40, metaKey: true })

    expect(onContentChange).toHaveBeenCalledWith(
      '/vault/budget.md',
      '---\ntype: Sheet\n---\n[[project-alpha]],Updated January',
    )
    expect(onContentChange.mock.invocationCallOrder[0]).toBeLessThan(onNavigateWikilink.mock.invocationCallOrder[0])
    expect(onNavigateWikilink).toHaveBeenCalledWith('project-alpha')
    expect(ironCalcMock.state.lastModel?.getCellContent(0, 1, 1)).toBe('[[project-alpha]]')
    unmount()
  })

  it('keeps the workbook mounted and focused when formula autocomplete appears', async () => {
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January'}
        path="/vault/budget.md"
        onContentChange={vi.fn()}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
    const formulaInput = screen.getByLabelText<HTMLInputElement>('Formula')
    const rendersBeforeAutocomplete = ironCalcMock.state.workbookRenders
    formulaInput.focus()

    formulaInput.value = '=su'
    formulaInput.setSelectionRange(3, 3)
    fireEvent.input(formulaInput)

    await screen.findByRole('listbox')
    expect(ironCalcMock.state.workbookRenders).toBe(rendersBeforeAutocomplete)
    expect(document.activeElement).toBe(formulaInput)
  })

  it('keeps the keyboard-selected formula suggestion after keyup refreshes the autocomplete', async () => {
    const formulaInput = await openFormulaAutocomplete('=SU')
    fireEvent.keyDown(formulaInput, { key: 'ArrowDown' })
    fireEvent.keyUp(formulaInput, { key: 'ArrowDown' })
    fireEvent.keyDown(formulaInput, { key: 'Enter' })

    expect(formulaInput.value).toBe('=SUMIF(')
  })

  it('applies common formatting through the sheet context menu', async () => {
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January'}
        path="/vault/budget.md"
        onContentChange={vi.fn()}
      />,
    )

    const editor = await screen.findByTestId('sheet-editor')
    fireEvent.contextMenu(editor, { clientX: 32, clientY: 48 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Percentage' }))

    expect(ironCalcMock.state.lastModel?.styleUpdates.at(-1)).toEqual({
      range: { column: 1, height: 1, row: 1, sheet: 0, width: 1 },
      stylePath: 'num_fmt',
      value: '0.00%',
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('keeps a multi-cell range selected when opening the sheet context menu with right-click', async () => {
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January\nRevenue,1200\nExpansion,1300'}
        path="/vault/budget.md"
        onContentChange={vi.fn()}
      />,
    )

    const workbookRoot = await screen.findByTestId('ironcalc-workbook')
    ironCalcMock.state.selectedView = {
      column: 2,
      left_column: 1,
      range: [2, 2, 4, 3],
      row: 2,
      sheet: 0,
      top_row: 1,
    }

    fireEvent.pointerDown(workbookRoot, { button: 2, buttons: 2 })
    fireEvent.contextMenu(workbookRoot, { clientX: 32, clientY: 48 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Percentage' }))

    expect(ironCalcMock.state.lastPointer).toBeNull()
    expect(ironCalcMock.state.lastModel?.styleUpdates.at(-1)).toEqual({
      range: { column: 2, height: 3, row: 2, sheet: 0, width: 2 },
      stylePath: 'num_fmt',
      value: '0.00%',
    })
  })

  it('applies row, column, freeze, and wrap actions through the sheet context menu', async () => {
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January\nRevenue,1200\nExpansion,1300'}
        path="/vault/budget.md"
        onContentChange={vi.fn()}
      />,
    )

    const workbookRoot = await screen.findByTestId('ironcalc-workbook')
    ironCalcMock.state.selectedView = {
      column: 2,
      left_column: 1,
      range: [3, 2, 3, 2],
      row: 3,
      sheet: 0,
      top_row: 1,
    }

    const openMenu = async () => {
      fireEvent.contextMenu(workbookRoot, { clientX: 32, clientY: 48 })
      return screen.findByRole('menu')
    }

    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert 1 row below' }))
    expect(ironCalcMock.state.insertedRows).toEqual([{ row: 4, sheet: 0 }])
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert 1 column left' }))
    expect(ironCalcMock.state.insertedColumns).toEqual([{ column: 2, sheet: 0 }])

    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Freeze up to row 3' }))
    expect(ironCalcMock.state.lastModel?.getFrozenRowsCount()).toBe(3)

    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Freeze up to column B' }))
    expect(ironCalcMock.state.lastModel?.getFrozenColumnsCount()).toBe(2)

    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Wrap text' }))
    expect(ironCalcMock.state.lastModel?.styleUpdates.at(-1)).toEqual({
      range: { column: 2, height: 1, row: 3, sheet: 0, width: 1 },
      stylePath: 'alignment.wrap_text',
      value: 'true',
    })

    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete row 3' }))
    expect(ironCalcMock.state.deletedRows).toEqual([{ row: 3, sheet: 0 }])

    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete column B' }))
    expect(ironCalcMock.state.deletedColumns).toEqual([{ column: 2, sheet: 0 }])
  })

  it('keeps spreadsheet keyboard navigation from bubbling while the sheet is active', async () => {
    const onParentKeyDown = vi.fn()
    render(
      <div onKeyDown={onParentKeyDown}>
        <SheetEditor
          content={'---\ntype: Sheet\n---\nMetric,January'}
          path="/vault/budget.md"
          onContentChange={vi.fn()}
        />
      </div>,
    )

    const editor = await screen.findByTestId('sheet-editor')
    const workbookRoot = await screen.findByTestId('ironcalc-workbook')
    fireEvent.pointerDown(editor)
    workbookRoot.focus()
    fireEvent.keyDown(workbookRoot, { key: 'ArrowDown', shiftKey: true })

    expect(onParentKeyDown).not.toHaveBeenCalled()
  })

  it('releases spreadsheet keyboard capture after focusing outside the sheet', async () => {
    const onParentKeyDown = vi.fn()
    render(
      <div onKeyDown={onParentKeyDown}>
        <SheetEditor
          content={'---\ntype: Sheet\n---\nMetric,January'}
          path="/vault/budget.md"
          onContentChange={vi.fn()}
        />
        <input aria-label="AI prompt" />
      </div>,
    )

    const editor = await screen.findByTestId('sheet-editor')
    const workbookRoot = await screen.findByTestId('ironcalc-workbook')
    const aiPrompt = screen.getByLabelText('AI prompt')
    fireEvent.pointerDown(editor)
    workbookRoot.focus()
    fireEvent.pointerDown(aiPrompt)
    aiPrompt.focus()
    fireEvent.keyDown(aiPrompt, { key: 'a' })

    await waitFor(() => {
      expect(document.activeElement).toBe(aiPrompt)
    })
    expect(onParentKeyDown).toHaveBeenCalledTimes(1)
  })

  it('does not steal focus back from app panels after a sheet focus request', async () => {
    render(
      <div>
        <SheetEditor
          content={'---\ntype: Sheet\n---\nMetric,January'}
          path="/vault/budget.md"
          onContentChange={vi.fn()}
        />
        <input aria-label="Panel input" />
      </div>,
    )

    const editor = await screen.findByTestId('sheet-editor')
    const panelInput = screen.getByLabelText('Panel input')
    fireEvent.pointerDown(editor)
    panelInput.focus()

    await waitFor(() => {
      expect(document.activeElement).toBe(panelInput)
    })
  })

  it('does not steal focus from the active formula editor when clicking another cell', async () => {
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January'}
        path="/vault/budget.md"
        onContentChange={vi.fn()}
      />,
    )

    const canvas = await screen.findByTestId('mock-sheet-canvas')
    const formulaInput = screen.getByLabelText<HTMLInputElement>('Formula')
    formulaInput.focus()

    fireEvent.pointerDown(canvas)

    await waitFor(() => {
      expect(document.activeElement).toBe(formulaInput)
    })
  })

  it('starts editing the selected cell on Enter instead of moving down', async () => {
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January'}
        path="/vault/budget.md"
        onContentChange={vi.fn()}
      />,
    )

    const editor = await screen.findByTestId('sheet-editor')
    const workbookRoot = await screen.findByTestId('ironcalc-workbook')
    workbookRoot.focus()
    fireEvent.keyDown(workbookRoot, { key: 'Enter' })

    expect(ironCalcMock.state.editStarts).toBe(1)
    expect(ironCalcMock.state.downMoves).toBe(0)
    expect(editor).toContainElement(document.activeElement)
  })

  it('keeps workbook focus after Escape exits active cell editing', async () => {
    const windowKeyDown = vi.fn()
    window.addEventListener('keydown', windowKeyDown)

    try {
      render(
        <SheetEditor
          content={'---\ntype: Sheet\n---\nMetric,January'}
          path="/vault/budget.md"
          onContentChange={vi.fn()}
        />,
      )

      const workbookRoot = await screen.findByTestId('ironcalc-workbook')
      const cellEditor = screen.getByLabelText<HTMLTextAreaElement>('Cell editor')

      fireEvent.pointerDown(workbookRoot)
      cellEditor.focus()
      fireEvent.keyDown(cellEditor, { key: 'Escape' })

      await waitFor(() => {
        expect(document.activeElement).toBe(workbookRoot)
      })
      expect(windowKeyDown).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', windowKeyDown)
    }
  })

  it('clears the whole selected range on plain Delete and Backspace', async () => {
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January'}
        path="/vault/budget.md"
        onContentChange={vi.fn()}
      />,
    )

    const workbookRoot = await screen.findByTestId('ironcalc-workbook')
    workbookRoot.focus()
    ironCalcMock.state.selectedView = {
      column: 2,
      left_column: 1,
      range: [2, 2, 4, 3],
      row: 4,
      sheet: 0,
      top_row: 1,
    }

    fireEvent.keyDown(workbookRoot, { key: 'Delete' })
    fireEvent.keyDown(workbookRoot, { key: 'Backspace' })

    expect(ironCalcMock.state.clearContentRanges).toEqual([
      { endColumn: 3, endRow: 4, sheet: 0, startColumn: 2, startRow: 2 },
      { endColumn: 3, endRow: 4, sheet: 0, startColumn: 2, startRow: 2 },
    ])
  })

  it('retints IronCalc selection chrome, squares its corners, expands borders, and hides the fill handle', async () => {
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January'}
        path="/vault/budget.md"
        onContentChange={vi.fn()}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')
    const outline = screen.getByTestId('mock-selection-outline')
    const rangeOutline = screen.getByTestId('mock-range-outline')
    const editingOutline = screen.getByTestId('mock-editing-outline')
    const handle = screen.getByTestId('mock-selection-handle')
    const formulaInput = screen.getByTestId('mock-formula-input')

    await waitFor(() => {
      expect(outline.style.borderTopColor).toBe('var(--accent-blue)')
    })
    expect(outline.style.borderRightColor).toBe('var(--accent-blue)')
    expect(outline.style.borderBottomColor).toBe('var(--accent-blue)')
    expect(outline.style.borderLeftColor).toBe('var(--accent-blue)')
    expect(outline.style.boxSizing).toBe('border-box')
    expect(outline.style.width).toBe('104px')
    expect(outline.style.height).toBe('24px')
    expect(outline.style.borderRadius).toBe('0px')
    expect(outline.style.boxShadow).toBe('')
    expect(rangeOutline.style.borderTopColor).toBe('var(--accent-blue)')
    expect(rangeOutline.style.borderRightColor).toBe('var(--accent-blue)')
    expect(rangeOutline.style.borderBottomColor).toBe('var(--accent-blue)')
    expect(rangeOutline.style.borderLeftColor).toBe('var(--accent-blue)')
    expect(rangeOutline.style.backgroundColor).toBe('var(--accent-blue-light)')
    expect(rangeOutline.style.boxSizing).toBe('border-box')
    expect(rangeOutline.style.width).toBe('102px')
    expect(rangeOutline.style.height).toBe('62px')
    expect(rangeOutline.style.borderRadius).toBe('0px')
    expect(editingOutline.style.borderTopColor).toBe('var(--accent-blue)')
    expect(editingOutline.style.borderRightColor).toBe('var(--accent-blue)')
    expect(editingOutline.style.borderBottomColor).toBe('var(--accent-blue)')
    expect(editingOutline.style.borderLeftColor).toBe('var(--accent-blue)')
    expect(editingOutline.style.boxSizing).toBe('border-box')
    expect(editingOutline.style.left).toBe('9px')
    expect(editingOutline.style.top).toBe('19px')
    expect(editingOutline.style.width).toBe('106px')
    expect(editingOutline.style.height).toBe('26px')
    expect(editingOutline.style.borderRadius).toBe('0px')
    expect(handle.style.visibility).toBe('hidden')
    expect(handle.style.pointerEvents).toBe('none')
    expect(formulaInput.style.caretColor).toBe('var(--accent-blue)')
  })

  it('normalizes IronCalc pointer coordinates when app zoom is active', async () => {
    const originalGetComputedStyle = window.getComputedStyle.bind(window)
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
      const style = originalGetComputedStyle(element, pseudoElement)
      if (element === document.documentElement) {
        Object.defineProperty(style, 'zoom', {
          configurable: true,
          value: '150%',
        })
      }
      return style
    })

    try {
      render(
        <SheetEditor
          content={'---\ntype: Sheet\n---\nMetric,January'}
          path="/vault/budget.md"
          onContentChange={vi.fn()}
        />,
      )

      const workbookRoot = await screen.findByTestId('ironcalc-workbook')
      const canvas = screen.getByTestId('mock-sheet-canvas')
      canvas.getBoundingClientRect = () => ({
        bottom: 440,
        height: 400,
        left: 100,
        right: 700,
        top: 40,
        width: 600,
        x: 100,
        y: 40,
        toJSON: () => ({}),
      })

      fireEvent.pointerDown(workbookRoot, {
        clientX: 250,
        clientY: 190,
        pageX: 250,
        pageY: 190,
        pointerId: 1,
        pointerType: 'mouse',
      })

      expect(ironCalcMock.state.lastPointer).toEqual({
        clientX: 200,
        clientY: 140,
        pageX: 200,
        pageY: 140,
      })
    } finally {
      getComputedStyleSpy.mockRestore()
    }
  })

  it('uses the rendered canvas scale when normalizing zoomed pointer coordinates', async () => {
    const originalGetComputedStyle = window.getComputedStyle.bind(window)
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
      const style = originalGetComputedStyle(element, pseudoElement)
      if (element === document.documentElement) {
        Object.defineProperty(style, 'zoom', {
          configurable: true,
          value: '80%',
        })
      }
      return style
    })

    try {
      render(
        <SheetEditor
          content={'---\ntype: Sheet\n---\nMetric,January'}
          path="/vault/budget.md"
          onContentChange={vi.fn()}
        />,
      )

      const workbookRoot = await screen.findByTestId('ironcalc-workbook')
      const canvas = screen.getByTestId('mock-sheet-canvas')
      Object.defineProperty(canvas, 'clientWidth', {
        configurable: true,
        value: 1600,
      })
      Object.defineProperty(canvas, 'clientHeight', {
        configurable: true,
        value: 860,
      })
      canvas.getBoundingClientRect = () => ({
        bottom: 720,
        height: 688,
        left: 0,
        right: 1280,
        top: 32,
        width: 1280,
        x: 0,
        y: 32,
        toJSON: () => ({}),
      })

      fireEvent.pointerDown(workbookRoot, {
        clientX: 474,
        clientY: 178,
        pageX: 474,
        pageY: 178,
        pointerId: 1,
        pointerType: 'mouse',
      })

      expect(ironCalcMock.state.lastPointer).toEqual({
        clientX: 592.5,
        clientY: 214.5,
        pageX: 592.5,
        pageY: 214.5,
      })
    } finally {
      getComputedStyleSpy.mockRestore()
    }
  })

  it('refreshes the workbook when app zoom changes', async () => {
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January'}
        path="/vault/budget.md"
        onContentChange={vi.fn()}
      />,
    )

    const editor = await screen.findByTestId('sheet-editor')
    const rendersBeforeZoom = ironCalcMock.state.workbookRenders
    const originalGetComputedStyle = window.getComputedStyle.bind(window)
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
      const style = originalGetComputedStyle(element, pseudoElement)
      if (element === document.documentElement) {
        Object.defineProperty(style, 'zoom', {
          configurable: true,
          value: '80%',
        })
      }
      return style
    })

    try {
      fireEvent(window, new Event('laputa-zoom-change'))

      await waitFor(() => {
        expect(ironCalcMock.state.workbookRenders).toBeGreaterThan(rendersBeforeZoom)
      })
      expect(editor.style.width).toBe('')
      expect(editor.style.height).toBe('')
      expect(editor.style.flex).toBe('')
    } finally {
      getComputedStyleSpy.mockRestore()
    }
  })
})
