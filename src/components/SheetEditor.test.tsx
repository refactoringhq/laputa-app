import {
  activateWorkbookRoot,
  createClipboardData,
  deferred,
  focusFormulaInputForTest,
  getIronCalcMock,
  getNativeWorkerMock,
  makeEntry,
  markWorkbookDirtyForTest,
  openFormulaAutocomplete,
  resetSheetEditorTestState,
} from './SheetEditor.testUtils'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SheetEditor } from './SheetEditor'
import { cacheNoteContent } from '../hooks/noteContentCache'

const ironCalcMock = getIronCalcMock()
const nativeWorkerMock = getNativeWorkerMock()

describe('SheetEditor', () => {
  afterEach(() => {
    resetSheetEditorTestState()
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
    focusFormulaInputForTest(formulaInput)

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
    focusFormulaInputForTest(formulaInput)
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
    focusFormulaInputForTest(formulaInput)
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
    focusFormulaInputForTest(formulaInput)

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
    focusFormulaInputForTest(formulaInput)

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
    focusFormulaInputForTest(formulaInput)
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
    focusFormulaInputForTest(formulaInput)

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

    const { workbookRoot } = await activateWorkbookRoot()
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

    await activateWorkbookRoot()
    const aiPrompt = screen.getByLabelText('AI prompt')
    act(() => {
      fireEvent.pointerDown(aiPrompt)
      aiPrompt.focus()
    })
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
    act(() => {
      fireEvent.pointerDown(editor)
      panelInput.focus()
    })

    await waitFor(() => {
      expect(document.activeElement).toBe(panelInput)
    })
  })

  it('releases passive workbook focus claimed before the guard layout effect runs', async () => {
    ironCalcMock.state.focusBeforeGuardOnRender = true
    render(
      <SheetEditor
        content={'---\ntype: Sheet\n---\nMetric,January'}
        path="/vault/budget.md"
        onContentChange={vi.fn()}
      />,
    )

    await screen.findByTestId('ironcalc-workbook')

    await waitFor(() => {
      expect(document.activeElement).toBe(document.body)
    })
  })

  it('redirects passive workbook arrow navigation back to the global app handler', async () => {
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
      fireEvent.keyDown(workbookRoot, { code: 'ArrowDown', key: 'ArrowDown' })

      expect(windowKeyDown).toHaveBeenCalledTimes(1)
      expect(windowKeyDown.mock.calls[0]?.[0]).toMatchObject({ key: 'ArrowDown' })
    } finally {
      window.removeEventListener('keydown', windowKeyDown)
    }
  })

  it('promotes a passive sheet to grid-active focus when clicking a cell', async () => {
    const windowKeyDown = vi.fn()
    window.addEventListener('keydown', windowKeyDown)

    try {
      render(
        <div>
          <input aria-label="Note list focus" />
          <SheetEditor
            content={'---\ntype: Sheet\n---\nMetric,January'}
            path="/vault/budget.md"
            onContentChange={vi.fn()}
          />
        </div>,
      )

      const noteListFocus = screen.getByLabelText('Note list focus')
      const editor = await screen.findByTestId('sheet-editor')
      const workbookRoot = await screen.findByTestId('ironcalc-workbook')

      act(() => {
        noteListFocus.focus()
      })
      act(() => {
        fireEvent.pointerDown(workbookRoot, {
          clientX: 320,
          clientY: 180,
          pageX: 320,
          pageY: 180,
        })
      })

      await waitFor(() => {
        expect(document.activeElement).toBe(workbookRoot)
        expect(editor).toHaveClass('sheet-editor--keyboard-active')
      })
      expect(ironCalcMock.state.selectedView).toEqual({
        column: 3,
        left_column: 1,
        range: [6, 3, 6, 3],
        row: 6,
        sheet: 0,
        top_row: 1,
      })

      fireEvent.keyDown(workbookRoot, { key: 'ArrowDown' })
      expect(windowKeyDown).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', windowKeyDown)
    }
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
    focusFormulaInputForTest(formulaInput)

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

    const { editor, workbookRoot } = await activateWorkbookRoot()
    fireEvent.keyDown(workbookRoot, { key: 'Enter' })

    expect(ironCalcMock.state.editStarts).toBe(1)
    expect(ironCalcMock.state.downMoves).toBe(0)
    expect(editor).toContainElement(document.activeElement)
  })

  it('returns from cell editing to grid focus before Escape releases the sheet', async () => {
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

      const { editor, workbookRoot } = await activateWorkbookRoot()
      const cellEditor = screen.getByLabelText<HTMLTextAreaElement>('Cell editor')

      cellEditor.focus()
      fireEvent.keyDown(cellEditor, { key: 'Escape' })

      await waitFor(() => {
        expect(document.activeElement).toBe(workbookRoot)
      })
      expect(editor).toHaveClass('sheet-editor--keyboard-active')

      fireEvent.keyDown(workbookRoot, { key: 'Escape' })

      await waitFor(() => {
        expect(document.activeElement).toBe(document.body)
      })
      expect(editor).toHaveClass('sheet-editor--passive')
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

    const { workbookRoot } = await activateWorkbookRoot()
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

  it.each([
    {
      canvasSize: null,
      expectedPointer: {
        clientX: 200,
        clientY: 140,
        pageX: 200,
        pageY: 140,
      },
      name: 'normalizes IronCalc pointer coordinates when app zoom is active',
      pointer: {
        clientX: 250,
        clientY: 190,
        pageX: 250,
        pageY: 190,
      },
      rect: {
        bottom: 440,
        height: 400,
        left: 100,
        right: 700,
        top: 40,
        width: 600,
        x: 100,
        y: 40,
      },
      zoom: '150%',
    },
    {
      canvasSize: {
        height: 860,
        width: 1600,
      },
      expectedPointer: {
        clientX: 592.5,
        clientY: 214.5,
        pageX: 592.5,
        pageY: 214.5,
      },
      name: 'uses the rendered canvas scale when normalizing zoomed pointer coordinates',
      pointer: {
        clientX: 474,
        clientY: 178,
        pageX: 474,
        pageY: 178,
      },
      rect: {
        bottom: 720,
        height: 688,
        left: 0,
        right: 1280,
        top: 32,
        width: 1280,
        x: 0,
        y: 32,
      },
      zoom: '80%',
    },
  ])('$name', async ({ canvasSize, expectedPointer, pointer, rect, zoom }) => {
    const originalGetComputedStyle = window.getComputedStyle.bind(window)
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
      const style = originalGetComputedStyle(element, pseudoElement)
      if (element === document.documentElement) {
        Object.defineProperty(style, 'zoom', {
          configurable: true,
          value: zoom,
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
      if (canvasSize) {
        Object.defineProperty(canvas, 'clientWidth', {
          configurable: true,
          value: canvasSize.width,
        })
        Object.defineProperty(canvas, 'clientHeight', {
          configurable: true,
          value: canvasSize.height,
        })
      }
      canvas.getBoundingClientRect = () => ({
        ...rect,
        toJSON: () => ({}),
      })

      fireEvent.pointerDown(workbookRoot, {
        ...pointer,
        pointerId: 1,
        pointerType: 'mouse',
      })

      expect(ironCalcMock.state.lastPointer).toEqual(expectedPointer)
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
