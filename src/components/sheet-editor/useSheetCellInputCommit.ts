import { useCallback, useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { notePathsMatch } from '../../utils/notePathIdentity'
import { isExternalFormulaInput } from '../../utils/sheetExternalReferences'
import { metadataCellAddress } from '../../utils/sheetMetadata'
import { selectedCellIndexes } from '../../utils/sheetSelection'
import { resolveExternalFormulaInput, SHEET_INDEX, type SheetExternalFormulaContext } from '../../utils/sheetWorkbook'
import { visibleSheetTextInput } from './sheetEditorHelpers'
import type { ScheduleSheetSerializeOptions, SheetWorkbookState } from './sheetEditorTypes'
import { isReleasedWorkbookModelError } from './sheetReleasedModel'

interface SheetCellInputResult {
  applied: boolean
  pendingLoads: Promise<unknown>[]
}

interface SheetCellInputTarget {
  column: number
  row: number
}

interface TrackedSheetTextInput extends SheetCellInputTarget {
  dirty: boolean
  input: HTMLInputElement | HTMLTextAreaElement
}

interface CommittedSheetTextInput extends SheetCellInputTarget {
  value: string
}

interface SheetTextInputTrackerRefs {
  committedTextInputRef: MutableRefObject<CommittedSheetTextInput | null>
  textInputTargetRef: MutableRefObject<TrackedSheetTextInput | null>
  workbookRef: MutableRefObject<SheetWorkbookState | null>
}

type CommitSheetCellInput = (
  input: string,
  options?: {
    allowPendingExternal?: boolean
    target?: SheetCellInputTarget | null
  },
) => boolean

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

function selectedCellInputTarget(current: SheetWorkbookState): SheetCellInputTarget | null {
  let cell: ReturnType<typeof selectedCellIndexes>
  try {
    cell = selectedCellIndexes(current.model)
  } catch (error) {
    if (!isReleasedWorkbookModelError(error)) throw error
    console.warn('[sheet-editor] Skipped stale workbook selection read:', error)
    return null
  }
  return cell ? { column: cell.column, row: cell.row } : null
}

function trackedInputForExistingEdit(
  input: HTMLInputElement | HTMLTextAreaElement,
  existing: TrackedSheetTextInput | null,
): TrackedSheetTextInput | null {
  return existing?.input === input && existing.dirty ? existing : null
}

function trackedInputForSelectedCell(
  input: HTMLInputElement | HTMLTextAreaElement,
  current: SheetWorkbookState,
  textInputTargetRef: MutableRefObject<TrackedSheetTextInput | null>,
): TrackedSheetTextInput | null {
  const target = selectedCellInputTarget(current)
  if (!target) return null

  const tracked = { ...target, dirty: true, input }
  textInputTargetRef.current = tracked
  return tracked
}

function trackSheetTextInputEditForRefs(
  input: HTMLInputElement | HTMLTextAreaElement | null,
  refs: SheetTextInputTrackerRefs,
): TrackedSheetTextInput | null {
  const current = refs.workbookRef.current
  if (!input || !current) return null
  refs.committedTextInputRef.current = null

  return (
    trackedInputForExistingEdit(input, refs.textInputTargetRef.current) ??
    trackedInputForSelectedCell(input, current, refs.textInputTargetRef)
  )
}

function committedInputTarget(
  input: HTMLInputElement | HTMLTextAreaElement,
  committed: CommittedSheetTextInput | null,
): TrackedSheetTextInput | null {
  return committed && input.value === committed.value ? { ...committed, dirty: false, input } : null
}

function sheetTextInputTargetForRefs(
  input: HTMLInputElement | HTMLTextAreaElement | null,
  refs: SheetTextInputTrackerRefs,
): TrackedSheetTextInput | null {
  if (!input) return null
  const existing = refs.textInputTargetRef.current
  if (existing && !existing.dirty) return existing

  return (
    committedInputTarget(input, refs.committedTextInputRef.current) ??
    (existing?.input === input ? existing : trackSheetTextInputEditForRefs(input, refs))
  )
}

function commitTrackedTextInput(
  input: HTMLInputElement | HTMLTextAreaElement | null,
  refs: Pick<SheetTextInputTrackerRefs, 'committedTextInputRef' | 'textInputTargetRef'>,
): void {
  const tracked = refs.textInputTargetRef.current
  if (!input || tracked?.input !== input) return

  refs.committedTextInputRef.current = {
    column: tracked.column,
    row: tracked.row,
    value: input.value,
  }
  refs.textInputTargetRef.current = { ...tracked, dirty: false }
}

function releaseTrackedTextInput(
  input: HTMLInputElement | HTMLTextAreaElement | null,
  textInputTargetRef: MutableRefObject<TrackedSheetTextInput | null>,
): void {
  if (!input || textInputTargetRef.current?.input === input) textInputTargetRef.current = null
}

function useSheetTextInputTargetTracker(workbookRef: MutableRefObject<SheetWorkbookState | null>) {
  const textInputTargetRef = useRef<TrackedSheetTextInput | null>(null)
  const committedTextInputRef = useRef<CommittedSheetTextInput | null>(null)

  const trackSheetTextInputEdit = useCallback(
    (input: HTMLInputElement | HTMLTextAreaElement | null) => {
      return trackSheetTextInputEditForRefs(input, {
        committedTextInputRef,
        textInputTargetRef,
        workbookRef,
      })
    },
    [workbookRef],
  )

  const sheetTextInputTarget = useCallback(
    (input: HTMLInputElement | HTMLTextAreaElement | null) => {
      return sheetTextInputTargetForRefs(input, {
        committedTextInputRef,
        textInputTargetRef,
        workbookRef,
      })
    },
    [workbookRef],
  )

  const markSheetTextInputCommitted = useCallback((input: HTMLInputElement | HTMLTextAreaElement | null) => {
    commitTrackedTextInput(input, {
      committedTextInputRef,
      textInputTargetRef,
    })
  }, [])

  const releaseSheetTextInputTarget = useCallback((input: HTMLInputElement | HTMLTextAreaElement | null) => {
    releaseTrackedTextInput(input, textInputTargetRef)
  }, [])

  return {
    markSheetTextInputCommitted,
    releaseSheetTextInputTarget,
    sheetTextInputTarget,
    trackSheetTextInputEdit,
  }
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
    current.externalFormulaInputs.set(address, {
      evaluated: input,
      source: input,
    })
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

function useCellInputWriter(
  buildLiveExternalFormulaContext: UseSheetCellInputCommitOptions['buildLiveExternalFormulaContext'],
) {
  return useCallback(
    (current: SheetWorkbookState, row: number, column: number, input: string) =>
    isExternalFormulaInput(input)
      ? writeExternalFormulaInput(current, row, column, input, buildLiveExternalFormulaContext)
        : writePlainCellInput(current, row, column, input),
    [buildLiveExternalFormulaContext],
  )
}

function useCommitCellInputAt({
  pendingExternalFormulaCommitRef,
  refreshWorkbook,
  scheduleSelectionChromePatch,
  scheduleSerialize,
  workbookRef,
  writeCellInputAt,
}: Pick<
  UseSheetCellInputCommitOptions,
  | 'pendingExternalFormulaCommitRef'
  | 'refreshWorkbook'
  | 'scheduleSelectionChromePatch'
  | 'scheduleSerialize'
  | 'workbookRef'
> & {
  writeCellInputAt: (current: SheetWorkbookState, row: number, column: number, input: string) => SheetCellInputResult
}) {
  const commitCellInputAtRef = useRef<(row: number, column: number, input: string) => boolean>(() => false)

  const commitCellInputAt = useCallback(
    (row: number, column: number, input: string) => {
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
    },
    [
    pendingExternalFormulaCommitRef,
    refreshWorkbook,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    workbookRef,
    writeCellInputAt,
    ],
  )

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
}: Pick<
  UseSheetCellInputCommitOptions,
  'buildLiveExternalFormulaContext' | 'pendingExternalFormulaCommitRef' | 'workbookRef'
> & {
  commitCellInputAt: (row: number, column: number, input: string) => boolean
  commitCellInputAtRef: MutableRefObject<(row: number, column: number, input: string) => boolean>
}) {
  return useCallback(
    (
      input: string,
      options: {
        allowPendingExternal?: boolean
        target?: SheetCellInputTarget | null
      } = {},
    ) => {
    const current = workbookRef.current
    if (!current) return false
    const cell = options.target ?? selectedCellInputTarget(current)
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
    },
    [
      buildLiveExternalFormulaContext,
      commitCellInputAt,
      commitCellInputAtRef,
      pendingExternalFormulaCommitRef,
      workbookRef,
    ],
  )
}

function useExternalFormulaEditorCommit(
  commitSelectedCellInput: CommitSheetCellInput,
  markSheetTextInputCommitted: (input: HTMLInputElement | HTMLTextAreaElement | null) => void,
  sheetTextInputTarget: (input: HTMLInputElement | HTMLTextAreaElement | null) => SheetCellInputTarget | null,
) {
  return useCallback(
    (input: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (!input || !isExternalFormulaInput(input.value)) return false
    const committed = commitSelectedCellInput(input.value, {
      allowPendingExternal: true,
      target: sheetTextInputTarget(input),
    })
    if (committed) markSheetTextInputCommitted(input)
    return committed
    },
    [commitSelectedCellInput, markSheetTextInputCommitted, sheetTextInputTarget],
  )
}

function selectedCellInputSource(current: SheetWorkbookState, target: SheetCellInputTarget): string {
  const address = metadataCellAddress(target.row, target.column)
  return (
    current.externalFormulaInputs.get(address)?.source ??
    current.model.getCellContent(SHEET_INDEX, target.row, target.column)
  )
}

function useSheetTextInputCommit({
  commitSelectedCellInput,
  markSheetTextInputCommitted,
  sheetTextInputTarget,
  workbookRef,
}: Pick<UseSheetCellInputCommitOptions, 'workbookRef'> & {
  commitSelectedCellInput: CommitSheetCellInput
  markSheetTextInputCommitted: (input: HTMLInputElement | HTMLTextAreaElement | null) => void
  sheetTextInputTarget: (input: HTMLInputElement | HTMLTextAreaElement | null) => SheetCellInputTarget | null
}) {
  return useCallback(
    (input: HTMLInputElement | HTMLTextAreaElement | null) => {
    const current = workbookRef.current
    if (!input || !current) return false
    const target = sheetTextInputTarget(input)
    if (!target) return false
    if (input.value === selectedCellInputSource(current, target)) {
      markSheetTextInputCommitted(input)
      return false
    }

    const committed = commitSelectedCellInput(input.value, {
      allowPendingExternal: true,
      target,
    })
    if (committed) markSheetTextInputCommitted(input)
    return committed
    },
    [commitSelectedCellInput, markSheetTextInputCommitted, sheetTextInputTarget, workbookRef],
  )
}

function useFlushCurrentSheetContent({
  cancelScheduledSerialize,
  commitExternalFormulaEditorInput,
  commitSheetTextInput,
  flushContentRef,
  serializeCurrentWorkbook,
  sheetElementRef,
  workbookRef,
}: Pick<
  UseSheetCellInputCommitOptions,
  'cancelScheduledSerialize' | 'flushContentRef' | 'serializeCurrentWorkbook' | 'sheetElementRef' | 'workbookRef'
> & {
  commitExternalFormulaEditorInput: (input: HTMLInputElement | HTMLTextAreaElement | null) => boolean
  commitSheetTextInput: (input: HTMLInputElement | HTMLTextAreaElement | null) => boolean
}) {
  const flushCurrentSheetContent = useCallback(
    (targetPath?: string) => {
    const current = workbookRef.current
    if (!current) return false
    if (targetPath && !notePathsMatch(targetPath, current.path)) return false

    const visibleInput = visibleSheetTextInput(sheetElementRef.current)
    if (!commitSheetTextInput(visibleInput)) {
      commitExternalFormulaEditorInput(visibleInput)
    }
    cancelScheduledSerialize()
    return serializeCurrentWorkbook(current.generation)
    },
    [
    cancelScheduledSerialize,
    commitExternalFormulaEditorInput,
    commitSheetTextInput,
    serializeCurrentWorkbook,
    sheetElementRef,
    workbookRef,
    ],
  )

  useEffect(() => {
    if (!flushContentRef) return

    flushContentRef.current = flushCurrentSheetContent
    return () => {
      if (flushContentRef.current === flushCurrentSheetContent) flushContentRef.current = null
    }
  }, [flushContentRef, flushCurrentSheetContent])

  return flushCurrentSheetContent
}

export function useSheetCellInputCommit(options: UseSheetCellInputCommitOptions) {
  const {
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
  } = options
  const writeCellInputAt = useCellInputWriter(buildLiveExternalFormulaContext)
  const { markSheetTextInputCommitted, releaseSheetTextInputTarget, sheetTextInputTarget, trackSheetTextInputEdit } =
    useSheetTextInputTargetTracker(workbookRef)
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
  const commitExternalFormulaEditorInput = useExternalFormulaEditorCommit(
    commitSelectedCellInput,
    markSheetTextInputCommitted,
    sheetTextInputTarget,
  )
  const commitSheetTextInput = useSheetTextInputCommit({
    commitSelectedCellInput,
    markSheetTextInputCommitted,
    sheetTextInputTarget,
    workbookRef,
  })
  const flushCurrentSheetContent = useFlushCurrentSheetContent({
    cancelScheduledSerialize,
    commitExternalFormulaEditorInput,
    commitSheetTextInput,
    flushContentRef,
    serializeCurrentWorkbook,
    sheetElementRef,
    workbookRef,
  })

  return {
    commitExternalFormulaEditorInput,
    commitSheetTextInput,
    commitSelectedCellInput,
    flushCurrentSheetContent,
    releaseSheetTextInputTarget,
    trackSheetTextInputEdit,
    writeCellInputAt,
  }
}
