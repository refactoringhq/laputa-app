import { act, fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { clearNoteContentCache } from '../hooks/noteContentCache'
import type { VaultEntry } from '../types'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

type NativeWorkerResolver = typeof import('../utils/sheetExternalFormulaWorker').resolveExternalFormulaInputsWithNativeWorker

const nativeWorkerMock = vi.hoisted(() => ({
  canUse: false,
  resolve: vi.fn<NativeWorkerResolver>(async () => new Map()),
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

type SheetIndex = number
type RowIndex = number
type ColumnIndex = number
type ScreenCoordinate = number

interface CellRange {
  endColumn: ColumnIndex
  endRow: RowIndex
  sheet: SheetIndex
  startColumn: ColumnIndex
  startRow: RowIndex
}

interface ColumnMutation {
  column: ColumnIndex
  sheet: SheetIndex
}

interface RowMutation {
  row: RowIndex
  sheet: SheetIndex
}

interface PointerSnapshot {
  clientX: ScreenCoordinate
  clientY: ScreenCoordinate
  pageX: ScreenCoordinate
  pageY: ScreenCoordinate
}

interface SelectedView {
  column: ColumnIndex
  left_column: ColumnIndex
  range: [RowIndex, ColumnIndex, RowIndex, ColumnIndex]
  row: RowIndex
  sheet: SheetIndex
  top_row: RowIndex
}

interface StyleRange {
  column: ColumnIndex
  height: number
  row: RowIndex
  sheet: SheetIndex
  width: number
}

interface StyleUpdate {
  range: StyleRange
  stylePath: string
  value: string
}

interface MockSheetModel {
  readonly clearFormattingRanges: CellRange[]
  readonly styleUpdates: StyleUpdate[]
  deleteColumn(sheet: SheetIndex, column: ColumnIndex): void
  deleteRow(sheet: SheetIndex, row: RowIndex): void
  evaluate(): void
  free(): void
  getCellContent(sheet: SheetIndex, row: RowIndex, column: ColumnIndex): string
  getCellStyle(sheet: SheetIndex, row: RowIndex, column: ColumnIndex): MockCellStyle
  getColumnWidth(): number
  getColumnsWithData(sheet: SheetIndex, row: RowIndex): Int32Array
  getFormattedCellValue(sheet: SheetIndex, row: RowIndex, column: ColumnIndex): string
  getFrozenColumnsCount(): number
  getFrozenRowsCount(): number
  getRawCellContent(sheet: SheetIndex, row: RowIndex, column: ColumnIndex): string
  getRowHeight(): number
  getRowsWithData(sheet: SheetIndex, column: ColumnIndex): Int32Array
  getSelectedSheet(): SheetIndex
  getSelectedView(): SelectedView
  getShowGridLines(): boolean
  insertColumn(sheet: SheetIndex, column: ColumnIndex): void
  insertRow(sheet: SheetIndex, row: RowIndex): void
  pauseEvaluation(): void
  rangeClearContents(...rangeArgs: SheetRangeArgs): void
  rangeClearFormatting(...rangeArgs: SheetRangeArgs): void
  resumeEvaluation(): void
  setAreaWithBorder(
    range: { column: ColumnIndex; row: RowIndex },
    borderArea: { item: { color?: string; style: string }; type: string },
  ): void
  setColumnsWidth(): void
  setFrozenColumnsCount(sheet: SheetIndex, count: ColumnIndex): void
  setFrozenRowsCount(sheet: SheetIndex, count: RowIndex): void
  setRowsHeight(): void
  setSelectedSheet(): void
  setTopLeftVisibleCell(topRow: RowIndex, leftColumn: ColumnIndex): void
  setShowGridLines(sheet: SheetIndex, show: boolean): void
  setUserInput(sheet: SheetIndex, row: RowIndex, column: ColumnIndex, input: string): void
  updateRangeStyle(range: StyleRange, stylePath: string, value: string): void
}

interface SheetEditorMockState {
  clearContentRanges: CellRange[]
  columnsWithDataCalls: number
  deletedColumns: ColumnMutation[]
  deletedRows: RowMutation[]
  downMoves: number
  editStarts: number
  focusBeforeGuardOnRender: boolean
  freedModels: Set<MockSheetModel>
  insertedColumns: ColumnMutation[]
  insertedRows: RowMutation[]
  lastModel: MockSheetModel | null
  lastPointer: PointerSnapshot | null
  modelConstructs: number
  rowsWithDataCalls: number
  selectedView: SelectedView
  workbookRenders: number
}

type SheetRangeArgs = [
  sheet: SheetIndex,
  startRow: RowIndex,
  startColumn: ColumnIndex,
  endRow: RowIndex,
  endColumn: ColumnIndex,
]

function sheetRangeFromArgs([
  sheet,
  startRow,
  startColumn,
  endRow,
  endColumn,
]: SheetRangeArgs) {
  return { endColumn, endRow, sheet, startColumn, startRow }
}

const ironCalcMock = vi.hoisted(() => {
  function defaultSelectedView(): SelectedView {
    return {
      column: 1,
      left_column: 1,
      range: [1, 1, 1, 1],
      row: 1,
      sheet: 0,
      top_row: 1,
    }
  }

  const state: SheetEditorMockState = {
    clearContentRanges: [],
    columnsWithDataCalls: 0,
    deletedColumns: [],
    deletedRows: [],
    downMoves: 0,
    editStarts: 0,
    focusBeforeGuardOnRender: false,
    freedModels: new Set(),
    insertedColumns: [],
    insertedRows: [],
    lastModel: null,
    lastPointer: null,
    modelConstructs: 0,
    rowsWithDataCalls: 0,
    selectedView: defaultSelectedView(),
    workbookRenders: 0,
  }

  function cellKey(row: RowIndex, column: ColumnIndex): string {
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

  function rejectUnsupportedIronCalcColor(color: string | undefined): void {
    if (color !== undefined && !/^#[0-9a-f]{6}$/i.test(color)) {
      throw new Error(`Invalid color: '${color}'.`)
    }
  }

  class MockModel implements MockSheetModel {
    readonly clearFormattingRanges: CellRange[] = []
    private readonly cells = new Map<string, string>()
    private readonly styles = new Map<string, MockCellStyle>()
    private frozenColumns = 0
    private frozenRows = 0
    private showGridLines = true
    readonly styleUpdates: StyleUpdate[] = []

    constructor() {
      state.modelConstructs += 1
      state.lastModel = this
    }

    pauseEvaluation(): void {}
    resumeEvaluation(): void {}
    evaluate(): void {}
    setSelectedSheet(): void {}
    getSelectedSheet(): SheetIndex {
      this.assertLive()
      return state.selectedView.sheet
    }
    free(): void {
      state.freedModels.add(this)
    }

    private assertLive(): void {
      if (state.freedModels.has(this)) throw new Error('null pointer passed to rust')
    }

    setUserInput(_sheet: SheetIndex, row: RowIndex, column: ColumnIndex, input: string): void {
      this.assertLive()
      this.cells.set(cellKey(row, column), input)
    }

    getCellContent(_sheet: SheetIndex, row: RowIndex, column: ColumnIndex): string {
      this.assertLive()
      return this.cells.get(cellKey(row, column)) ?? ''
    }

    getRawCellContent(_sheet: SheetIndex, row: RowIndex, column: ColumnIndex): string {
      this.assertLive()
      return this.cells.get(cellKey(row, column)) ?? ''
    }

    getFormattedCellValue(_sheet: SheetIndex, row: RowIndex, column: ColumnIndex): string {
      const content = this.cells.get(cellKey(row, column)) ?? ''
      if (!content.startsWith('=')) return content
      const formula = content.slice(1)
      if (/^-?\d+(?:\.\d+)?(?:\+-?\d+(?:\.\d+)?)*$/.test(formula)) {
        return String(formula.split('+').reduce((total, part) => total + Number(part), 0))
      }
      return content
    }

    getColumnsWithData(_sheet: SheetIndex, row: RowIndex): Int32Array {
      state.columnsWithDataCalls += 1
      const columns = Array.from(this.cells.keys())
        .map((key) => key.split(':').map(Number))
        .filter(([cellRow]) => cellRow === row)
        .map(([, column]) => column)
        .sort((left, right) => left - right)
      return Int32Array.from(columns)
    }

    getRowsWithData(_sheet: SheetIndex, column: ColumnIndex): Int32Array {
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
      range: { column: ColumnIndex; row: RowIndex },
      borderArea: { item: { color?: string; style: string }; type: string },
    ): void {
      rejectUnsupportedIronCalcColor(borderArea.item.color)
      const key = cellKey(range.row, range.column)
      const current = this.styles.get(key) ?? defaultStyle()
      if (borderArea.type === 'Top') current.border.top = borderArea.item
      if (borderArea.type === 'Right') current.border.right = borderArea.item
      if (borderArea.type === 'Bottom') current.border.bottom = borderArea.item
      if (borderArea.type === 'Left') current.border.left = borderArea.item
      this.styles.set(key, current)
    }

    setFrozenRowsCount(_sheet: SheetIndex, count: RowIndex): void {
      this.frozenRows = count
    }

    getFrozenRowsCount(): number {
      return this.frozenRows
    }

    setFrozenColumnsCount(_sheet: SheetIndex, count: ColumnIndex): void {
      this.frozenColumns = count
    }

    getFrozenColumnsCount(): number {
      return this.frozenColumns
    }

    setShowGridLines(_sheet: SheetIndex, show: boolean): void {
      this.showGridLines = show
    }

    getShowGridLines(): boolean {
      return this.showGridLines
    }

    getSelectedView() {
      return state.selectedView
    }

    setTopLeftVisibleCell(topRow: RowIndex, leftColumn: ColumnIndex): void {
      state.selectedView = {
        ...state.selectedView,
        left_column: leftColumn,
        top_row: topRow,
      }
    }

    rangeClearContents(...rangeArgs: SheetRangeArgs): void {
      const { endColumn, endRow, sheet, startColumn, startRow } = sheetRangeFromArgs(rangeArgs)
      state.clearContentRanges.push({ endColumn, endRow, sheet, startColumn, startRow })
      for (let row = startRow; row <= endRow; row += 1) {
        for (let column = startColumn; column <= endColumn; column += 1) {
          this.cells.delete(cellKey(row, column))
        }
      }
    }

    insertRow(sheet: SheetIndex, row: RowIndex): void {
      state.insertedRows.push({ row, sheet })
    }

    insertColumn(sheet: SheetIndex, column: ColumnIndex): void {
      state.insertedColumns.push({ column, sheet })
    }

    deleteRow(sheet: SheetIndex, row: RowIndex): void {
      state.deletedRows.push({ row, sheet })
    }

    deleteColumn(sheet: SheetIndex, column: ColumnIndex): void {
      state.deletedColumns.push({ column, sheet })
    }

    updateRangeStyle(
      range: StyleRange,
      stylePath: string,
      value: string,
    ): void {
      if (stylePath === 'font.color' || stylePath === 'fill.fg_color') rejectUnsupportedIronCalcColor(value)
      this.styleUpdates.push({ range, stylePath, value })
      const key = cellKey(range.row, range.column)
      const current = this.styles.get(key) ?? defaultStyle()
      if (stylePath === 'font.b') current.font.b = value === 'true'
      if (stylePath === 'font.i') current.font.i = value === 'true'
      if (stylePath === 'font.color') current.font.color = value
      if (stylePath === 'fill.fg_color') current.fill.fg_color = value
      if (stylePath === 'num_fmt') current.num_fmt = value
      this.styles.set(key, current)
    }

    rangeClearFormatting(...rangeArgs: SheetRangeArgs): void {
      const { endColumn, endRow, sheet, startColumn, startRow } = sheetRangeFromArgs(rangeArgs)
      this.clearFormattingRanges.push({ endColumn, endRow, sheet, startColumn, startRow })
      this.styles.clear()
    }

    getCellStyle(_sheet: SheetIndex, row: RowIndex, column: ColumnIndex): MockCellStyle {
      return this.styles.get(cellKey(row, column)) ?? defaultStyle()
    }
  }

  return { MockModel, defaultSelectedView, state }
})

export function getNativeWorkerMock() {
  return nativeWorkerMock
}

export function getIronCalcMock() {
  return ironCalcMock
}

function focusMockWorkbookOnRender(node: HTMLDivElement | null): void {
  if (node && ironCalcMock.state.focusBeforeGuardOnRender) node.focus()
}

function handleMockWorkbookKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
  if (event.key === 'F2') ironCalcMock.state.editStarts += 1
  if (event.key === 'Enter') ironCalcMock.state.downMoves += 1
}

function resetFrozenPaneScroll(model: MockSheetModel, target: HTMLElement): void {
  if (model.getFrozenColumnsCount() === 0 && model.getFrozenRowsCount() === 0) return
  const scroll = target.closest<HTMLElement>('.scroll')
  if (!scroll) return
  scroll.scrollLeft = 0
  scroll.scrollTop = 0
}

function selectMockContextCell(): void {
  ironCalcMock.state.selectedView = {
    column: 9,
    left_column: 1,
    range: [9, 9, 9, 9],
    row: 9,
    sheet: 0,
    top_row: 1,
  }
}

function selectMockPointerCell(event: ReactPointerEvent<HTMLDivElement>): void {
  if (event.button !== 0 || document.activeElement !== event.currentTarget) return
  const column = Math.max(1, Math.floor(event.clientX / 100))
  const row = Math.max(1, Math.floor(event.clientY / 30))
  ironCalcMock.state.selectedView = {
    column,
    left_column: 1,
    range: [row, column, row, column],
    row,
    sheet: 0,
    top_row: 1,
  }
}

function recordMockPointer(event: ReactPointerEvent<HTMLDivElement>): void {
  ironCalcMock.state.lastPointer = {
    clientX: event.clientX,
    clientY: event.clientY,
    pageX: event.pageX,
    pageY: event.pageY,
  }
}

function handleMockWorkbookPointerDown(
  event: ReactPointerEvent<HTMLDivElement>,
  model: MockSheetModel,
): void {
  resetFrozenPaneScroll(model, event.currentTarget)
  if (event.button === 2) selectMockContextCell()
  selectMockPointerCell(event)
  recordMockPointer(event)
}

vi.mock('@ironcalc/workbook', () => ({
  init: vi.fn(() => Promise.resolve()),
  IronCalc: ({ model }: { model: MockSheetModel }) => {
    ironCalcMock.state.lastModel = model
    ironCalcMock.state.workbookRenders += 1
    return (
      <div className="scroll" data-testid="mock-sheet-scroll">
        <div
          className="sheet-container"
          data-testid="ironcalc-workbook"
          ref={focusMockWorkbookOnRender}
          onKeyDown={handleMockWorkbookKeyDown}
          onPointerDown={(event) => handleMockWorkbookPointerDown(event, model)}
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
      </div>
    )
  },
  Model: ironCalcMock.MockModel,
}))

import { SheetEditor } from './SheetEditor'

export async function activateWorkbookRoot() {
  const editor = await screen.findByTestId('sheet-editor')
  const workbookRoot = await screen.findByTestId('ironcalc-workbook')
  act(() => {
    fireEvent.pointerDown(editor)
    workbookRoot.focus()
  })
  return { editor, workbookRoot }
}

export function focusFormulaInputForTest(formulaInput: HTMLInputElement) {
  fireEvent.pointerDown(formulaInput)
  formulaInput.focus()
}

export function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
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

export function createClipboardData(): DataTransfer {
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

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

export async function openFormulaAutocomplete(value = '=su'): Promise<HTMLInputElement> {
  render(
    <SheetEditor
      content={'---\ntype: Sheet\n---\nMetric,January'}
      path="/vault/budget.md"
      onContentChange={vi.fn()}
    />,
  )

  await screen.findByTestId('ironcalc-workbook')
  const formulaInput = screen.getByLabelText<HTMLInputElement>('Formula')
  focusFormulaInputForTest(formulaInput)
  formulaInput.value = value
  formulaInput.setSelectionRange(value.length, value.length)
  fireEvent.input(formulaInput)
  await screen.findByRole('listbox')
  return formulaInput
}

export function markWorkbookDirtyForTest(): void {
  fireEvent.input(screen.getByLabelText('Formula'))
}

export function resetSheetEditorTestState(): void {
  vi.useRealTimers()
  ironCalcMock.state.clearContentRanges = []
  ironCalcMock.state.columnsWithDataCalls = 0
  ironCalcMock.state.deletedColumns = []
  ironCalcMock.state.deletedRows = []
  ironCalcMock.state.downMoves = 0
  ironCalcMock.state.editStarts = 0
  ironCalcMock.state.focusBeforeGuardOnRender = false
  ironCalcMock.state.freedModels = new Set()
  ironCalcMock.state.insertedColumns = []
  ironCalcMock.state.insertedRows = []
  ironCalcMock.state.lastModel = null
  ironCalcMock.state.lastPointer = null
  ironCalcMock.state.modelConstructs = 0
  ironCalcMock.state.rowsWithDataCalls = 0
  ironCalcMock.state.selectedView = ironCalcMock.defaultSelectedView()
  ironCalcMock.state.workbookRenders = 0
  nativeWorkerMock.canUse = false
  nativeWorkerMock.resolve.mockReset()
  nativeWorkerMock.resolve.mockResolvedValue(new Map())
  document.documentElement.style.removeProperty('zoom')
  clearNoteContentCache()
}
