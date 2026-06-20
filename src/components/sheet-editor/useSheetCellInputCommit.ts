import { useCallback, useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { notePathsMatch } from '../../utils/notePathIdentity'
import { isExternalFormulaInput } from '../../utils/sheetExternalReferences'
import { metadataCellAddress } from '../../utils/sheetMetadata'
import { selectedCellIndexes } from '../../utils/sheetSelection'
import {
  resolveExternalFormulaInput,
  SHEET_INDEX,
  type SheetExternalFormulaContext,
} from '../../utils/sheetWorkbook'
import { visibleSheetTextInput } from './sheetEditorHelpers'
import type { ScheduleSheetSerializeOptions, SheetWorkbookState } from './sheetEditorTypes'

interface SheetCellInputResult {
  applied: boolean
  pendingLoads: Promise<unknown>[]
}

interface UseSheetCellInputCommitOptions {
  buildLiveExternalFormulaContext: (input: string) => {
    context?: SheetExternalFormulaContext
    pendingLoads: Promise<unknown>[]
  }
  cancelScheduledSerialize: () => void
  flushContentRef?: MutableRefObject<((path: string) => void) | null>
  pendingExternalFormulaCommitRef: MutableRefObject<number>
  refreshWorkbook: () => void
  scheduleSelectionChromePatch: () => void
  scheduleSerialize: (options?: ScheduleSheetSerializeOptions) => void
  serializeCurrentWorkbook: (expectedGeneration?: number) => boolean
  sheetElementRef: MutableRefObject<HTMLDivElement | null>
  workbookRef: MutableRefObject<SheetWorkbookState | null>
}

function writeExternalFormulaInput(
  current: SheetWorkbookState,
  row: number,
  column: number,
  input: string,
  buildLiveExternalFormulaContext: UseSheetCellInputCommitOptions['buildLiveExternalFormulaContext'],
): SheetCellInputResult {
  const address = metadataCellAddress(row, column)
  const { context, pendingLoads } = buildLiveExternalFormulaContext(input)
  const externalFormula = resolveExternalFormulaInput(input, context)
  if (!externalFormula) {
    if (pendingLoads.length === 0) return { applied: false, pendingLoads }
    current.model.setUserInput(SHEET_INDEX, row, column, input)
    current.externalFormulaInputs.set(address, { evaluated: input, source: input })
    return { applied: true, pendingLoads }
  }

  current.model.setUserInput(SHEET_INDEX, row, column, externalFormula.evaluated)
  current.externalFormulaInputs.set(address, externalFormula)
  return { applied: true, pendingLoads: [] }
}

function writePlainCellInput(
  current: SheetWorkbookState,
  row: number,
  column: number,
  input: string,
): SheetCellInputResult {
  current.model.setUserInput(SHEET_INDEX, row, column, input)
  current.externalFormulaInputs.delete(metadataCellAddress(row, column))
  return { applied: true, pendingLoads: [] }
}

function nextPendingCommitId(pendingExternalFormulaCommitRef: MutableRefObject<number>) {
  const pendingCommitId = pendingExternalFormulaCommitRef.current + 1
  pendingExternalFormulaCommitRef.current = pendingCommitId
  return pendingCommitId
}

function retryCommitAfterLoads({
  commitCellInputAtRef,
  column,
  input,
  pendingCommitId,
  pendingExternalFormulaCommitRef,
  pendingLoads,
  row,
}: {
  column: number
  commitCellInputAtRef: MutableRefObject<(row: number, column: number, input: string) => boolean>
  input: string
  pendingCommitId: number
  pendingExternalFormulaCommitRef: MutableRefObject<number>
  pendingLoads: Promise<unknown>[]
  row: number
}) {
  void Promise.allSettled(pendingLoads).then(() => {
    if (pendingExternalFormulaCommitRef.current !== pendingCommitId) return
    commitCellInputAtRef.current(row, column, input)
  })
}

function useCellInputWriter(buildLiveExternalFormulaContext: UseSheetCellInputCommitOptions['buildLiveExternalFormulaContext']) {
  return useCallback((current: SheetWorkbookState, row: number, column: number, input: string) => (
    isExternalFormulaInput(input)
      ? writeExternalFormulaInput(current, row, column, input, buildLiveExternalFormulaContext)
      : writePlainCellInput(current, row, column, input)
  ), [buildLiveExternalFormulaContext])
}

function useCommitCellInputAt({
  pendingExternalFormulaCommitRef,
  refreshWorkbook,
  scheduleSelectionChromePatch,
  scheduleSerialize,
  workbookRef,
  writeCellInputAt,
}: Pick<UseSheetCellInputCommitOptions,
  | 'pendingExternalFormulaCommitRef'
  | 'refreshWorkbook'
  | 'scheduleSelectionChromePatch'
  | 'scheduleSerialize'
  | 'workbookRef'
> & {
  writeCellInputAt: (current: SheetWorkbookState, row: number, column: number, input: string) => SheetCellInputResult
}) {
  const commitCellInputAtRef = useRef<(row: number, column: number, input: string) => boolean>(() => false)

  const commitCellInputAt = useCallback((row: number, column: number, input: string) => {
    const current = workbookRef.current
    if (!current) return false

    const result = writeCellInputAt(current, row, column, input)
    if (!result.applied) return false

    refreshWorkbook()
    scheduleSelectionChromePatch()
    scheduleSerialize({ bodyRows: [row] })
    if (result.pendingLoads.length > 0) {
      retryCommitAfterLoads({
        column,
        commitCellInputAtRef,
        input,
        pendingCommitId: nextPendingCommitId(pendingExternalFormulaCommitRef),
        pendingExternalFormulaCommitRef,
        pendingLoads: result.pendingLoads,
        row,
      })
    }
    return true
  }, [
    pendingExternalFormulaCommitRef,
    refreshWorkbook,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    workbookRef,
    writeCellInputAt,
  ])

  useEffect(() => {
    commitCellInputAtRef.current = commitCellInputAt
  }, [commitCellInputAt])

  return { commitCellInputAt, commitCellInputAtRef }
}

function useCommitSelectedCellInput({
  buildLiveExternalFormulaContext,
  commitCellInputAt,
  commitCellInputAtRef,
  pendingExternalFormulaCommitRef,
  workbookRef,
}: Pick<UseSheetCellInputCommitOptions,
  | 'buildLiveExternalFormulaContext'
  | 'pendingExternalFormulaCommitRef'
  | 'workbookRef'
> & {
  commitCellInputAt: (row: number, column: number, input: string) => boolean
  commitCellInputAtRef: MutableRefObject<(row: number, column: number, input: string) => boolean>
}) {
  return useCallback((input: string, options: { allowPendingExternal?: boolean } = {}) => {
    const current = workbookRef.current
    if (!current) return false
    const cell = selectedCellIndexes(current.model)
    if (!cell) return false

    if (commitCellInputAt(cell.row, cell.column, input)) return true
    if (!options.allowPendingExternal || !isExternalFormulaInput(input)) return false

    const { pendingLoads } = buildLiveExternalFormulaContext(input)
    if (pendingLoads.length === 0) return false

    retryCommitAfterLoads({
      column: cell.column,
      commitCellInputAtRef,
      input,
      pendingCommitId: nextPendingCommitId(pendingExternalFormulaCommitRef),
      pendingExternalFormulaCommitRef,
      pendingLoads,
      row: cell.row,
    })
    return true
  }, [buildLiveExternalFormulaContext, commitCellInputAt, commitCellInputAtRef, pendingExternalFormulaCommitRef, workbookRef])
}

function useExternalFormulaEditorCommit(
  commitSelectedCellInput: (input: string, options?: { allowPendingExternal?: boolean }) => boolean,
) {
  return useCallback((input: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (!input || !isExternalFormulaInput(input.value)) return false
    return commitSelectedCellInput(input.value, { allowPendingExternal: true })
  }, [commitSelectedCellInput])
}

function useFlushCurrentSheetContent({
  cancelScheduledSerialize,
  commitExternalFormulaEditorInput,
  flushContentRef,
  serializeCurrentWorkbook,
  sheetElementRef,
  workbookRef,
}: Pick<UseSheetCellInputCommitOptions,
  | 'cancelScheduledSerialize'
  | 'flushContentRef'
  | 'serializeCurrentWorkbook'
  | 'sheetElementRef'
  | 'workbookRef'
> & {
  commitExternalFormulaEditorInput: (input: HTMLInputElement | HTMLTextAreaElement | null) => boolean
}) {
  const flushCurrentSheetContent = useCallback((targetPath?: string) => {
    const current = workbookRef.current
    if (!current) return false
    if (targetPath && !notePathsMatch(targetPath, current.path)) return false

    commitExternalFormulaEditorInput(visibleSheetTextInput(sheetElementRef.current))
    cancelScheduledSerialize()
    return serializeCurrentWorkbook(current.generation)
  }, [cancelScheduledSerialize, commitExternalFormulaEditorInput, serializeCurrentWorkbook, sheetElementRef, workbookRef])

  useEffect(() => {
    if (!flushContentRef) return

    flushContentRef.current = flushCurrentSheetContent
    return () => {
      if (flushContentRef.current === flushCurrentSheetContent) flushContentRef.current = null
    }
  }, [flushContentRef, flushCurrentSheetContent])

  return flushCurrentSheetContent
}

export function useSheetCellInputCommit({
  buildLiveExternalFormulaContext,
  cancelScheduledSerialize,
  flushContentRef,
  pendingExternalFormulaCommitRef,
  refreshWorkbook,
  scheduleSelectionChromePatch,
  scheduleSerialize,
  serializeCurrentWorkbook,
  sheetElementRef,
  workbookRef,
}: UseSheetCellInputCommitOptions) {
  const writeCellInputAt = useCellInputWriter(buildLiveExternalFormulaContext)
  const { commitCellInputAt, commitCellInputAtRef } = useCommitCellInputAt({
    pendingExternalFormulaCommitRef,
    refreshWorkbook,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    workbookRef,
    writeCellInputAt,
  })
  const commitSelectedCellInput = useCommitSelectedCellInput({
    buildLiveExternalFormulaContext,
    commitCellInputAt,
    commitCellInputAtRef,
    pendingExternalFormulaCommitRef,
    workbookRef,
  })
  const commitExternalFormulaEditorInput = useExternalFormulaEditorCommit(commitSelectedCellInput)
  const flushCurrentSheetContent = useFlushCurrentSheetContent({
    cancelScheduledSerialize,
    commitExternalFormulaEditorInput,
    flushContentRef,
    serializeCurrentWorkbook,
    sheetElementRef,
    workbookRef,
  })

  return {
    commitExternalFormulaEditorInput,
    commitSelectedCellInput,
    flushCurrentSheetContent,
    writeCellInputAt,
  }
}
