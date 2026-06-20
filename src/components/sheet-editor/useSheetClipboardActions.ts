import { useCallback, useEffect, useRef } from 'react'
import type { ClipboardEvent as ReactClipboardEvent, Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  buildTolariaSheetClipboardPayload,
  parseTolariaSheetClipboardPayload,
  rangesIntersect,
  shiftedClipboardCellInput,
  TOLARIA_SHEET_CLIPBOARD_MIME,
  writeTolariaSheetClipboard,
  type TolariaSheetClipboardPayload,
} from '../../utils/sheetClipboard'
import { dirtyRowsForArea, dirtyRowsForSelectedRange, selectedRangeArea } from '../../utils/sheetSelection'
import { cancelIdle, scheduleIdle, type IdleHandle } from '../../utils/sheetBrowserScheduling'
import { SHEET_INDEX } from '../../utils/sheetWorkbook'
import {
  isEditableTarget,
  isSheetCommandTarget,
  type FormulaAutocompleteState,
  type SheetWikilinkAutocompleteState,
} from './sheetEditorHelpers'
import type { ScheduleSheetSerializeOptions, SheetWorkbookState } from './sheetEditorTypes'
import type { SheetContextMenuState } from '../../utils/sheetContextMenuState'

const SHEET_PASTE_CHUNK_SIZE = 100

interface PendingExternalFormulaCell {
  column: number
  input: string
  pendingLoads: Promise<unknown>[]
  row: number
}

interface SheetCellInputResult {
  applied: boolean
  pendingLoads: Promise<unknown>[]
}

interface UseSheetClipboardActionsOptions {
  refreshWorkbook: () => void
  scheduleSelectionChromePatch: () => void
  scheduleSerialize: (options?: ScheduleSheetSerializeOptions) => void
  setFormulaAutocomplete: Dispatch<SetStateAction<FormulaAutocompleteState | null>>
  setSheetContextMenu: Dispatch<SetStateAction<SheetContextMenuState | null>>
  setWikilinkAutocomplete: Dispatch<SetStateAction<SheetWikilinkAutocompleteState | null>>
  workbookRef: MutableRefObject<SheetWorkbookState | null>
  writeCellInputAt: (current: SheetWorkbookState, row: number, column: number, input: string) => SheetCellInputResult
}

function clipboardOperations(
  payload: TolariaSheetClipboardPayload,
  targetArea: ReturnType<typeof selectedRangeArea>,
) {
  return payload.cells.flatMap((row, rowOffset) => row.map((input, columnOffset) => ({
    column: targetArea.column + columnOffset,
    input: shiftedClipboardCellInput(input, {
      columnOffset,
      destinationColumn: targetArea.column + columnOffset,
      destinationRow: targetArea.row + rowOffset,
      payload,
      rowOffset,
    }),
    row: targetArea.row + rowOffset,
  })))
}

function sourceArea(payload: TolariaSheetClipboardPayload) {
  return {
    sheet: SHEET_INDEX,
    row: payload.source.row,
    column: payload.source.column,
    width: payload.source.width,
    height: payload.source.height,
  }
}

function destinationArea(payload: TolariaSheetClipboardPayload, targetArea: ReturnType<typeof selectedRangeArea>) {
  return {
    sheet: SHEET_INDEX,
    row: targetArea.row,
    column: targetArea.column,
    width: payload.source.width,
    height: payload.source.height,
  }
}

function clearCutSourceIfNeeded(
  current: SheetWorkbookState,
  payload: TolariaSheetClipboardPayload,
  targetArea: ReturnType<typeof selectedRangeArea>,
  dirtyRows: Set<number>,
) {
  if (payload.action !== 'cut' || payload.source.path !== current.path) return
  const cutSourceArea = sourceArea(payload)
  if (rangesIntersect(cutSourceArea, destinationArea(payload, targetArea))) return

  current.model.rangeClearContents(
    SHEET_INDEX,
    cutSourceArea.row,
    cutSourceArea.column,
    cutSourceArea.row + cutSourceArea.height - 1,
    cutSourceArea.column + cutSourceArea.width - 1,
  )
  for (const row of dirtyRowsForArea(cutSourceArea)) dirtyRows.add(row)
}

function usePendingExternalFormulaRetry({
  refreshWorkbook,
  scheduleSelectionChromePatch,
  scheduleSerialize,
  workbookRef,
  writeCellInputAt,
}: UseSheetClipboardActionsOptions) {
  return useCallback((pendingCells: PendingExternalFormulaCell[], jobId: number, currentJobId: () => number) => {
    if (pendingCells.length === 0) return

    void Promise.allSettled(pendingCells.flatMap((cell) => cell.pendingLoads)).then(() => {
      if (currentJobId() !== jobId) return
      const current = workbookRef.current
      if (!current) return

      current.model.pauseEvaluation()
      try {
        for (const cell of pendingCells) {
          if (current.model.getCellContent(SHEET_INDEX, cell.row, cell.column) !== cell.input) continue
          writeCellInputAt(current, cell.row, cell.column, cell.input)
        }
      } finally {
        current.model.resumeEvaluation()
      }

      current.model.evaluate()
      refreshWorkbook()
      scheduleSelectionChromePatch()
      scheduleSerialize({ bodyRows: pendingCells.map((cell) => cell.row) })
    })
  }, [refreshWorkbook, scheduleSelectionChromePatch, scheduleSerialize, workbookRef, writeCellInputAt])
}

function useTolariaClipboardPaste({
  cancelPendingPaste,
  pasteIdleRef,
  pasteJobRef,
  refreshWorkbook,
  retryPendingExternalFormulaCells,
  scheduleSelectionChromePatch,
  scheduleSerialize,
  workbookRef,
  writeCellInputAt,
}: UseSheetClipboardActionsOptions & {
  cancelPendingPaste: () => void
  pasteIdleRef: MutableRefObject<IdleHandle | null>
  pasteJobRef: MutableRefObject<number>
  retryPendingExternalFormulaCells: (
    pendingCells: PendingExternalFormulaCell[],
    jobId: number,
    currentJobId: () => number,
  ) => void
}) {
  return useCallback((payload: TolariaSheetClipboardPayload) => {
    const current = workbookRef.current
    if (!current) return false

    const targetArea = selectedRangeArea(current.model)
    if (targetArea.sheet !== SHEET_INDEX) return false

    const operations = clipboardOperations(payload, targetArea)
    if (operations.length === 0) return false

    cancelPendingPaste()
    const jobId = pasteJobRef.current
    const pendingCells: PendingExternalFormulaCell[] = []
    const dirtyRows = dirtyRowsForArea(targetArea)
    let operationIndex = 0

    const finishPaste = () => {
      const latest = workbookRef.current
      if (!latest || pasteJobRef.current !== jobId) return

      clearCutSourceIfNeeded(latest, payload, targetArea, dirtyRows)
      latest.model.evaluate()
      refreshWorkbook()
      scheduleSelectionChromePatch()
      scheduleSerialize({ bodyRows: dirtyRows })
      retryPendingExternalFormulaCells(pendingCells, jobId, () => pasteJobRef.current)
    }

    const runChunk = () => {
      pasteIdleRef.current = null
      if (pasteJobRef.current !== jobId) return

      const latest = workbookRef.current
      if (!latest) return
      const endIndex = Math.min(operationIndex + SHEET_PASTE_CHUNK_SIZE, operations.length)

      latest.model.pauseEvaluation()
      try {
        for (; operationIndex < endIndex; operationIndex += 1) {
          const operation = operations[operationIndex]
          if (!operation) continue
          const result = writeCellInputAt(latest, operation.row, operation.column, operation.input)
          if (result.pendingLoads.length > 0) pendingCells.push({ ...operation, pendingLoads: result.pendingLoads })
        }
      } finally {
        latest.model.resumeEvaluation()
      }

      refreshWorkbook()
      scheduleSelectionChromePatch()
      if (operationIndex < operations.length) {
        pasteIdleRef.current = scheduleIdle(runChunk)
        return
      }
      finishPaste()
    }

    pasteIdleRef.current = scheduleIdle(runChunk)
    return true
  }, [
    cancelPendingPaste,
    pasteIdleRef,
    pasteJobRef,
    refreshWorkbook,
    retryPendingExternalFormulaCells,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    workbookRef,
    writeCellInputAt,
  ])
}

function scheduleSelectedRowsSerialization(
  workbookRef: MutableRefObject<SheetWorkbookState | null>,
  scheduleSerialize: (options?: ScheduleSheetSerializeOptions) => void,
) {
  const current = workbookRef.current
  scheduleSerialize({ bodyRows: current ? dirtyRowsForSelectedRange(current.model) : 'all' })
}

function useTolariaCopyCaptureHandler(workbookRef: MutableRefObject<SheetWorkbookState | null>) {
  return useCallback((event: ReactClipboardEvent<HTMLDivElement>, action: TolariaSheetClipboardPayload['action']) => {
    if (isEditableTarget(event.target) || isSheetCommandTarget(event.target)) return false
    const current = workbookRef.current
    if (!current) return false

    const payload = buildTolariaSheetClipboardPayload(current.model, current.path, action, current.externalFormulaInputs)
    if (!payload) return false

    writeTolariaSheetClipboard(event.clipboardData, payload)
    event.preventDefault()
    event.stopPropagation()
    return true
  }, [workbookRef])
}

function useSheetCopyCutCaptureHandlers({
  scheduleSerialize,
  workbookRef,
}: Pick<UseSheetClipboardActionsOptions,
  | 'scheduleSerialize'
  | 'workbookRef'
>) {
  const handleTolariaSheetCopyCapture = useTolariaCopyCaptureHandler(workbookRef)

  const handleCopyCapture = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    handleTolariaSheetCopyCapture(event, 'copy')
  }, [handleTolariaSheetCopyCapture])

  const handleCutCapture = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    if (!handleTolariaSheetCopyCapture(event, 'cut')) scheduleSerialize()
  }, [handleTolariaSheetCopyCapture, scheduleSerialize])

  return { handleCopyCapture, handleCutCapture }
}

function useSheetPasteCaptureHandler({
  applyTolariaClipboardPaste,
  scheduleSerialize,
  setFormulaAutocomplete,
  setSheetContextMenu,
  setWikilinkAutocomplete,
  workbookRef,
}: Pick<UseSheetClipboardActionsOptions,
  | 'scheduleSerialize'
  | 'setFormulaAutocomplete'
  | 'setSheetContextMenu'
  | 'setWikilinkAutocomplete'
  | 'workbookRef'
> & {
  applyTolariaClipboardPaste: (payload: TolariaSheetClipboardPayload) => boolean
}) {
  return useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target) || isSheetCommandTarget(event.target)) {
      scheduleSelectedRowsSerialization(workbookRef, scheduleSerialize)
      return
    }

    const payload = parseTolariaSheetClipboardPayload(event.clipboardData.getData(TOLARIA_SHEET_CLIPBOARD_MIME))
    if (!payload || !applyTolariaClipboardPaste(payload)) {
      scheduleSelectedRowsSerialization(workbookRef, scheduleSerialize)
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setFormulaAutocomplete(null)
    setWikilinkAutocomplete(null)
    setSheetContextMenu(null)
  }, [
    applyTolariaClipboardPaste,
    scheduleSerialize,
    setFormulaAutocomplete,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    workbookRef,
  ])
}

function useClipboardEventHandlers(options: Pick<UseSheetClipboardActionsOptions,
  | 'scheduleSerialize'
  | 'setFormulaAutocomplete'
  | 'setSheetContextMenu'
  | 'setWikilinkAutocomplete'
  | 'workbookRef'
> & {
  applyTolariaClipboardPaste: (payload: TolariaSheetClipboardPayload) => boolean
}) {
  const { handleCopyCapture, handleCutCapture } = useSheetCopyCutCaptureHandlers(options)
  const handlePasteCapture = useSheetPasteCaptureHandler(options)

  return { handleCopyCapture, handleCutCapture, handlePasteCapture }
}

export function useSheetClipboardActions({
  refreshWorkbook,
  scheduleSelectionChromePatch,
  scheduleSerialize,
  setFormulaAutocomplete,
  setSheetContextMenu,
  setWikilinkAutocomplete,
  workbookRef,
  writeCellInputAt,
}: UseSheetClipboardActionsOptions) {
  const pasteJobRef = useRef(0)
  const pasteIdleRef = useRef<IdleHandle | null>(null)

  const cancelPendingPaste = useCallback(() => {
    pasteJobRef.current += 1
    if (pasteIdleRef.current !== null) {
      cancelIdle(pasteIdleRef.current)
      pasteIdleRef.current = null
    }
  }, [])

  useEffect(() => cancelPendingPaste, [cancelPendingPaste])

  const retryPendingExternalFormulaCells = usePendingExternalFormulaRetry({
    refreshWorkbook,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    setFormulaAutocomplete,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    workbookRef,
    writeCellInputAt,
  })

  const applyTolariaClipboardPaste = useTolariaClipboardPaste({
    cancelPendingPaste,
    pasteIdleRef,
    pasteJobRef,
    refreshWorkbook,
    retryPendingExternalFormulaCells,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    setFormulaAutocomplete,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    workbookRef,
    writeCellInputAt,
  })

  const {
    handleCopyCapture,
    handleCutCapture,
    handlePasteCapture,
  } = useClipboardEventHandlers({
    applyTolariaClipboardPaste,
    scheduleSerialize,
    setFormulaAutocomplete,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    workbookRef,
  })

  return {
    cancelPendingPaste,
    handleCopyCapture,
    handleCutCapture,
    handlePasteCapture,
  }
}
