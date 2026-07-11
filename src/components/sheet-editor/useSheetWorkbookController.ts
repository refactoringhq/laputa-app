import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import ironCalcWasmUrl from '@ironcalc/wasm/wasm_bg.wasm?url'
import { init as initIronCalc, type Model } from '@ironcalc/workbook'
import { trackSheetEditorOpened } from '../../lib/productAnalytics'
import { notePathsMatch } from '../../utils/notePathIdentity'
import { cancelIdle, scheduleIdle, type IdleHandle } from '../../utils/sheetBrowserScheduling'
import {
  canSerializeSheetWorkbook,
  clearSheetWorkbookDirty,
  markSheetWorkbookDirty,
} from '../../utils/sheetDirtyState'
import { mergeDirtyBodyRows } from '../../utils/sheetSelection'
import {
  buildSheetContent,
  buildWorkbook,
  summarizeSheetContent,
  type SheetBodyDirtyRows,
  type SheetExternalFormulaContext,
} from '../../utils/sheetWorkbook'
import type { SheetExternalFormulaInput } from '../../utils/sheetExternalFormulaWorker'
import type { ScheduleSheetSerializeOptions, SheetWorkbookState } from './sheetEditorTypes'

const SERIALIZE_DEBOUNCE_MS = 450
const RELEASED_WORKBOOK_MODEL_ERROR = 'null pointer passed to rust'

let ironCalcInitPromise: Promise<void> | null = null

interface UseSheetWorkbookControllerOptions {
  content: string
  externalFormulaContextForBuild?: SheetExternalFormulaContext
  nativeExternalFormulaInputsForBuild?: Map<string, SheetExternalFormulaInput> | null
  onContentChange: (path: string, content: string) => void
  path: string
  pendingExternalFormulaCommitRef: MutableRefObject<number>
  shouldWaitForInitialExternalFormulaResolution?: (workbookAlreadyBuilt: boolean) => boolean
}

function ensureIronCalcReady(): Promise<void> {
  if (!ironCalcInitPromise) {
    ironCalcInitPromise = initIronCalc(ironCalcWasmUrl).then(() => undefined)
  }
  return ironCalcInitPromise
}

function resetDirtyTracking(
  dirtyWorkbookGenerationRef: MutableRefObject<number | null>,
  dirtyBodyRowsRef: MutableRefObject<SheetBodyDirtyRows>,
) {
  clearSheetWorkbookDirty(dirtyWorkbookGenerationRef)
  dirtyBodyRowsRef.current = null
}

function cancelPendingSerialize(
  idleSerializeRef: MutableRefObject<IdleHandle | null>,
  serializeTimerRef: MutableRefObject<number | null>,
) {
  if (serializeTimerRef.current !== null) {
    window.clearTimeout(serializeTimerRef.current)
    serializeTimerRef.current = null
  }
  if (idleSerializeRef.current !== null) {
    cancelIdle(idleSerializeRef.current)
    idleSerializeRef.current = null
  }
}

function isReleasedWorkbookModelError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(RELEASED_WORKBOOK_MODEL_ERROR)
}

function releaseWorkbookModelNow(model: Model | null | undefined): void {
  if (!model) return
  try {
    model.free()
  } catch (error) {
    console.warn('[sheet-editor] Failed to release workbook model:', error)
  }
}

function releaseWorkbookModel(model: Model | null | undefined): void {
  if (!model) return
  window.setTimeout(() => {
    releaseWorkbookModelNow(model)
  }, 0)
}

function buildCurrentSheetContent({
  current,
  dirtyBodyRowsRef,
  sourceContent,
}: {
  current: SheetWorkbookState
  dirtyBodyRowsRef: MutableRefObject<SheetBodyDirtyRows>
  sourceContent: string
}): string | null {
  try {
    return buildSheetContent(sourceContent, current.model, current.externalFormulaInputs, {
      bodyRows: dirtyBodyRowsRef.current,
    })
  } catch (error) {
    if (!isReleasedWorkbookModelError(error)) throw error
    console.warn('[sheet-editor] Skipped stale workbook serialization:', error)
    return null
  }
}

function shouldSkipWorkbookRebuild({
  content,
  lastEmittedContentRef,
  lastEmittedPathRef,
  path,
}: Pick<UseSheetWorkbookControllerOptions, 'content' | 'path'> & {
  lastEmittedContentRef: MutableRefObject<string | null>
  lastEmittedPathRef: MutableRefObject<string | null>
}) {
  return content === lastEmittedContentRef.current && path === lastEmittedPathRef.current
}

function nextWorkbookState({
  build,
  generation,
  path,
}: {
  build: ReturnType<typeof buildWorkbook>
  generation: number
  path: string
}): SheetWorkbookState {
  return {
    externalFormulaInputs: build.externalFormulaInputs,
    generation,
    model: build.model,
    path,
    refreshId: Date.now(),
  }
}

interface WorkbookSerializationOptions {
  dirtyBodyRowsRef: MutableRefObject<SheetBodyDirtyRows>
  dirtyWorkbookGenerationRef: MutableRefObject<number | null>
  idleSerializeRef: MutableRefObject<IdleHandle | null>
  lastEmittedContentRef: MutableRefObject<string | null>
  lastEmittedPathRef: MutableRefObject<string | null>
  latestContentPathRef: MutableRefObject<string>
  latestContentRef: MutableRefObject<string>
  onContentChangeRef: MutableRefObject<(path: string, content: string) => void>
  serializeTimerRef: MutableRefObject<number | null>
  workbookPathRef: MutableRefObject<string>
  workbookRef: MutableRefObject<SheetWorkbookState | null>
}

function useCancelScheduledSerialize({
  idleSerializeRef,
  serializeTimerRef,
}: Pick<WorkbookSerializationOptions, 'idleSerializeRef' | 'serializeTimerRef'>) {
  return useCallback(() => {
    cancelPendingSerialize(idleSerializeRef, serializeTimerRef)
  }, [idleSerializeRef, serializeTimerRef])
}

function useSerializeCurrentWorkbook({
  dirtyBodyRowsRef,
  dirtyWorkbookGenerationRef,
  lastEmittedContentRef,
  lastEmittedPathRef,
  latestContentPathRef,
  latestContentRef,
  onContentChangeRef,
  workbookPathRef,
  workbookRef,
}: Omit<WorkbookSerializationOptions, 'idleSerializeRef' | 'serializeTimerRef'>) {
  return useCallback((expectedGeneration?: number) => {
    const current = workbookRef.current
    if (!current || !canSerializeSheetWorkbook({
      current,
      dirtyGeneration: dirtyWorkbookGenerationRef.current,
      expectedGeneration,
      latestContentPath: latestContentPathRef.current,
      pathsMatch: notePathsMatch,
      workbookPath: workbookPathRef.current,
    })) return false

    const sourceContent = latestContentRef.current
    const sourcePath = current.path
    const nextContent = buildCurrentSheetContent({ current, dirtyBodyRowsRef, sourceContent })
    if (nextContent === null) {
      resetDirtyTracking(dirtyWorkbookGenerationRef, dirtyBodyRowsRef)
      return false
    }
    if (nextContent === sourceContent) {
      resetDirtyTracking(dirtyWorkbookGenerationRef, dirtyBodyRowsRef)
      return false
    }
    if (nextContent === lastEmittedContentRef.current && sourcePath === lastEmittedPathRef.current) {
      resetDirtyTracking(dirtyWorkbookGenerationRef, dirtyBodyRowsRef)
      return false
    }

    lastEmittedPathRef.current = sourcePath
    lastEmittedContentRef.current = nextContent
    latestContentRef.current = nextContent
    latestContentPathRef.current = sourcePath
    resetDirtyTracking(dirtyWorkbookGenerationRef, dirtyBodyRowsRef)
    onContentChangeRef.current(sourcePath, nextContent)
    return true
  }, [
    dirtyBodyRowsRef,
    dirtyWorkbookGenerationRef,
    lastEmittedContentRef,
    lastEmittedPathRef,
    latestContentPathRef,
    latestContentRef,
    onContentChangeRef,
    workbookPathRef,
    workbookRef,
  ])
}

function useScheduleWorkbookSerialize({
  cancelScheduledSerialize,
  dirtyBodyRowsRef,
  dirtyWorkbookGenerationRef,
  idleSerializeRef,
  serializeCurrentWorkbook,
  serializeTimerRef,
  workbookRef,
}: Pick<WorkbookSerializationOptions,
  | 'dirtyBodyRowsRef'
  | 'dirtyWorkbookGenerationRef'
  | 'idleSerializeRef'
  | 'serializeTimerRef'
  | 'workbookRef'
> & {
  cancelScheduledSerialize: () => void
  serializeCurrentWorkbook: (expectedGeneration?: number) => boolean
}) {
  return useCallback((options: ScheduleSheetSerializeOptions = {}) => {
    const shouldMarkDirty = options.dirty !== false
    markSheetWorkbookDirty(dirtyWorkbookGenerationRef, workbookRef.current, shouldMarkDirty)
    if (shouldMarkDirty) dirtyBodyRowsRef.current = mergeDirtyBodyRows(dirtyBodyRowsRef.current, options.bodyRows)
    cancelScheduledSerialize()
    const generation = workbookRef.current?.generation
    serializeTimerRef.current = window.setTimeout(() => {
      serializeTimerRef.current = null
      idleSerializeRef.current = scheduleIdle(() => {
        idleSerializeRef.current = null
        serializeCurrentWorkbook(generation)
      })
    }, SERIALIZE_DEBOUNCE_MS)
  }, [
    cancelScheduledSerialize,
    dirtyBodyRowsRef,
    dirtyWorkbookGenerationRef,
    idleSerializeRef,
    serializeCurrentWorkbook,
    serializeTimerRef,
    workbookRef,
  ])
}

function useWorkbookSerialization(options: WorkbookSerializationOptions) {
  const cancelScheduledSerialize = useCancelScheduledSerialize(options)
  const serializeCurrentWorkbook = useSerializeCurrentWorkbook(options)
  const scheduleSerialize = useScheduleWorkbookSerialize({
    ...options,
    cancelScheduledSerialize,
    serializeCurrentWorkbook,
  })

  return { cancelScheduledSerialize, scheduleSerialize, serializeCurrentWorkbook }
}

function publishWorkbook({
  build,
  dirtyBodyRowsRef,
  dirtyWorkbookGenerationRef,
  generation,
  path,
  setWorkbook,
  workbookRef,
}: {
  build: ReturnType<typeof buildWorkbook>
  dirtyBodyRowsRef: MutableRefObject<SheetBodyDirtyRows>
  dirtyWorkbookGenerationRef: MutableRefObject<number | null>
  generation: number
  path: string
  setWorkbook: (workbook: SheetWorkbookState | null) => void
  workbookRef: MutableRefObject<SheetWorkbookState | null>
}) {
  const nextWorkbook = nextWorkbookState({ build, generation, path })
  releaseWorkbookModel(workbookRef.current?.model)
  workbookRef.current = nextWorkbook
  resetDirtyTracking(dirtyWorkbookGenerationRef, dirtyBodyRowsRef)
  setWorkbook(nextWorkbook)
}

function trackSheetOpenIfNeeded(
  content: string,
  path: string,
  trackedOpenPathRef: MutableRefObject<string | null>,
) {
  if (trackedOpenPathRef.current === path) return
  trackSheetEditorOpened(summarizeSheetContent(content))
  trackedOpenPathRef.current = path
}

function syncIncomingWorkbookContent({
  content,
  dirtyBodyRowsRef,
  dirtyWorkbookGenerationRef,
  latestContentPathRef,
  latestContentRef,
  path,
  workbookPathRef,
}: Pick<UseSheetWorkbookControllerOptions, 'content' | 'path'> & {
  dirtyBodyRowsRef: MutableRefObject<SheetBodyDirtyRows>
  dirtyWorkbookGenerationRef: MutableRefObject<number | null>
  latestContentPathRef: MutableRefObject<string>
  latestContentRef: MutableRefObject<string>
  workbookPathRef: MutableRefObject<string>
}) {
  latestContentRef.current = content
  latestContentPathRef.current = path
  workbookPathRef.current = path
  resetDirtyTracking(dirtyWorkbookGenerationRef, dirtyBodyRowsRef)
}

function shouldIgnoreWorkbookBuild(
  cancelled: boolean,
  generation: number,
  workbookGenerationRef: MutableRefObject<number>,
) {
  return cancelled || workbookGenerationRef.current !== generation
}

function reportWorkbookBuildError({
  cancelled,
  caught,
  generation,
  setError,
  workbookGenerationRef,
}: {
  cancelled: boolean
  caught: unknown
  generation: number
  setError: (error: string | null) => void
  workbookGenerationRef: MutableRefObject<number>
}) {
  if (shouldIgnoreWorkbookBuild(cancelled, generation, workbookGenerationRef)) return
  const message = caught instanceof Error ? caught.message : String(caught)
  setError(message)
}

interface WorkbookBuildLifecycleOptions extends UseSheetWorkbookControllerOptions {
  cancelScheduledSerialize: () => void
  dirtyBodyRowsRef: MutableRefObject<SheetBodyDirtyRows>
  dirtyWorkbookGenerationRef: MutableRefObject<number | null>
  lastEmittedContentRef: MutableRefObject<string | null>
  lastEmittedPathRef: MutableRefObject<string | null>
  latestContentPathRef: MutableRefObject<string>
  latestContentRef: MutableRefObject<string>
  serializeCurrentWorkbook: (expectedGeneration?: number) => boolean
  setError: (error: string | null) => void
  setWorkbook: (workbook: SheetWorkbookState | null) => void
  trackedOpenPathRef: MutableRefObject<string | null>
  workbookGenerationRef: MutableRefObject<number>
  workbookPathRef: MutableRefObject<string>
  workbookRef: MutableRefObject<SheetWorkbookState | null>
}

function deferInitialWorkbookBuildIfNeeded({
  content,
  dirtyBodyRowsRef,
  dirtyWorkbookGenerationRef,
  latestContentPathRef,
  latestContentRef,
  path,
  setError,
  shouldWaitForInitialExternalFormulaResolution,
  workbookPathRef,
  workbookRef,
}: Pick<WorkbookBuildLifecycleOptions,
  | 'content'
  | 'dirtyBodyRowsRef'
  | 'dirtyWorkbookGenerationRef'
  | 'latestContentPathRef'
  | 'latestContentRef'
  | 'path'
  | 'setError'
  | 'shouldWaitForInitialExternalFormulaResolution'
  | 'workbookPathRef'
  | 'workbookRef'
>) {
  if (!shouldWaitForInitialExternalFormulaResolution?.(workbookRef.current !== null)) return false
  setError(null)
  syncIncomingWorkbookContent({
    content,
    dirtyBodyRowsRef,
    dirtyWorkbookGenerationRef,
    latestContentPathRef,
    latestContentRef,
    path,
    workbookPathRef,
  })
  return true
}

function runWorkbookBuildLifecycle({
  cancelScheduledSerialize,
  content,
  dirtyBodyRowsRef,
  dirtyWorkbookGenerationRef,
  externalFormulaContextForBuild,
  lastEmittedContentRef,
  lastEmittedPathRef,
  latestContentPathRef,
  latestContentRef,
  nativeExternalFormulaInputsForBuild,
  path,
  pendingExternalFormulaCommitRef,
  serializeCurrentWorkbook,
  setError,
  setWorkbook,
  shouldWaitForInitialExternalFormulaResolution,
  trackedOpenPathRef,
  workbookGenerationRef,
  workbookPathRef,
  workbookRef,
}: WorkbookBuildLifecycleOptions) {
  if (deferInitialWorkbookBuildIfNeeded({
    content, dirtyBodyRowsRef, dirtyWorkbookGenerationRef, latestContentPathRef, latestContentRef, path, setError,
    shouldWaitForInitialExternalFormulaResolution, workbookPathRef, workbookRef,
  })) return undefined

  cancelScheduledSerialize()
  serializeCurrentWorkbook()
  pendingExternalFormulaCommitRef.current += 1
  syncIncomingWorkbookContent({
    content,
    dirtyBodyRowsRef,
    dirtyWorkbookGenerationRef,
    latestContentPathRef,
    latestContentRef,
    path,
    workbookPathRef,
  })
  if (shouldSkipWorkbookRebuild({ content, lastEmittedContentRef, lastEmittedPathRef, path })) return undefined

  let cancelled = false
  let pendingModel: Model | null = null
  const generation = workbookGenerationRef.current + 1
  workbookGenerationRef.current = generation

    ensureIronCalcReady()
    .then(() => {
      if (shouldIgnoreWorkbookBuild(cancelled, generation, workbookGenerationRef)) return

      setError(null)
      const build = buildWorkbook(content, path, externalFormulaContextForBuild, nativeExternalFormulaInputsForBuild)
      pendingModel = build.model
      trackSheetOpenIfNeeded(content, path, trackedOpenPathRef)
      publishWorkbook({ build, dirtyBodyRowsRef, dirtyWorkbookGenerationRef, generation, path, setWorkbook, workbookRef })
      pendingModel = null
    })
    .catch((caught: unknown) => {
      reportWorkbookBuildError({ cancelled, caught, generation, setError, workbookGenerationRef })
    })

  return () => {
    cancelled = true
    releaseWorkbookModelNow(pendingModel)
  }
}

function useWorkbookBuildLifecycle(options: WorkbookBuildLifecycleOptions) {
  const {
    cancelScheduledSerialize, content, dirtyBodyRowsRef, dirtyWorkbookGenerationRef, externalFormulaContextForBuild,
    lastEmittedContentRef, lastEmittedPathRef, latestContentPathRef, latestContentRef, nativeExternalFormulaInputsForBuild,
    onContentChange, path, pendingExternalFormulaCommitRef, serializeCurrentWorkbook, setError, setWorkbook,
    shouldWaitForInitialExternalFormulaResolution, trackedOpenPathRef, workbookGenerationRef, workbookPathRef, workbookRef,
  } = options

  useEffect(() => runWorkbookBuildLifecycle({
    cancelScheduledSerialize, content, dirtyBodyRowsRef, dirtyWorkbookGenerationRef, externalFormulaContextForBuild,
    lastEmittedContentRef, lastEmittedPathRef, latestContentPathRef, latestContentRef, nativeExternalFormulaInputsForBuild,
    onContentChange, path, pendingExternalFormulaCommitRef, serializeCurrentWorkbook, setError, setWorkbook,
    shouldWaitForInitialExternalFormulaResolution, trackedOpenPathRef, workbookGenerationRef, workbookPathRef, workbookRef,
  }), [
    cancelScheduledSerialize, content, dirtyBodyRowsRef, dirtyWorkbookGenerationRef, externalFormulaContextForBuild,
    lastEmittedContentRef, lastEmittedPathRef, latestContentPathRef, latestContentRef, nativeExternalFormulaInputsForBuild,
    onContentChange, path, pendingExternalFormulaCommitRef, serializeCurrentWorkbook, setError, setWorkbook,
    shouldWaitForInitialExternalFormulaResolution, trackedOpenPathRef, workbookGenerationRef, workbookPathRef, workbookRef,
  ])
}

function useWorkbookCleanup({
  cancelScheduledSerialize,
  dirtyBodyRowsRef,
  dirtyWorkbookGenerationRef,
  pendingExternalFormulaCommitRef,
  serializeCurrentWorkbook,
  workbookGenerationRef,
  workbookRef,
}: {
  cancelScheduledSerialize: () => void
  dirtyBodyRowsRef: MutableRefObject<SheetBodyDirtyRows>
  dirtyWorkbookGenerationRef: MutableRefObject<number | null>
  pendingExternalFormulaCommitRef: MutableRefObject<number>
  serializeCurrentWorkbook: (expectedGeneration?: number) => boolean
  workbookGenerationRef: MutableRefObject<number>
  workbookRef: MutableRefObject<SheetWorkbookState | null>
}) {
  useEffect(() => () => {
    pendingExternalFormulaCommitRef.current += 1
    serializeCurrentWorkbook(workbookRef.current?.generation)
    cancelScheduledSerialize()
    releaseWorkbookModel(workbookRef.current?.model)
    workbookRef.current = null
    resetDirtyTracking(dirtyWorkbookGenerationRef, dirtyBodyRowsRef)
    workbookGenerationRef.current += 1
  }, [
    cancelScheduledSerialize,
    dirtyBodyRowsRef,
    dirtyWorkbookGenerationRef,
    pendingExternalFormulaCommitRef,
    serializeCurrentWorkbook,
    workbookGenerationRef,
    workbookRef,
  ])
}

function useWorkbookRefresh({
  refreshSequenceRef,
  setWorkbook,
  workbookRef,
}: {
  refreshSequenceRef: MutableRefObject<number>
  setWorkbook: (workbook: SheetWorkbookState | null) => void
  workbookRef: MutableRefObject<SheetWorkbookState | null>
}) {
  return useCallback(() => {
    const current = workbookRef.current
    if (!current) return
    refreshSequenceRef.current += 1
    const nextWorkbook = {
      externalFormulaInputs: current.externalFormulaInputs,
      generation: current.generation,
      model: current.model,
      path: current.path,
      refreshId: Date.now() + refreshSequenceRef.current,
    }
    workbookRef.current = nextWorkbook
    setWorkbook(nextWorkbook)
  }, [refreshSequenceRef, setWorkbook, workbookRef])
}

export function useSheetWorkbookController({
  content,
  externalFormulaContextForBuild,
  nativeExternalFormulaInputsForBuild,
  onContentChange,
  path,
  pendingExternalFormulaCommitRef,
  shouldWaitForInitialExternalFormulaResolution,
}: UseSheetWorkbookControllerOptions) {
  const [workbook, setWorkbook] = useState<SheetWorkbookState | null>(null), [error, setError] = useState<string | null>(null)
  const dirtyBodyRowsRef = useRef<SheetBodyDirtyRows>(null), dirtyWorkbookGenerationRef = useRef<number | null>(null)
  const idleSerializeRef = useRef<IdleHandle | null>(null), serializeTimerRef = useRef<number | null>(null)
  const lastEmittedContentRef = useRef<string | null>(null), lastEmittedPathRef = useRef<string | null>(null)
  const latestContentPathRef = useRef(path), latestContentRef = useRef(content), onContentChangeRef = useRef(onContentChange)
  const refreshSequenceRef = useRef(0), trackedOpenPathRef = useRef<string | null>(null), workbookGenerationRef = useRef(0)
  const workbookPathRef = useRef(path), workbookRef = useRef<SheetWorkbookState | null>(null)

  useEffect(() => { onContentChangeRef.current = onContentChange }, [onContentChange, onContentChangeRef])

  const {
    cancelScheduledSerialize,
    scheduleSerialize,
    serializeCurrentWorkbook,
  } = useWorkbookSerialization({
    dirtyBodyRowsRef, dirtyWorkbookGenerationRef, idleSerializeRef, lastEmittedContentRef, lastEmittedPathRef,
    latestContentPathRef, latestContentRef, onContentChangeRef, serializeTimerRef, workbookPathRef, workbookRef,
  })

  useWorkbookBuildLifecycle({
    cancelScheduledSerialize, content, dirtyBodyRowsRef, dirtyWorkbookGenerationRef, externalFormulaContextForBuild,
    lastEmittedContentRef, lastEmittedPathRef, latestContentPathRef, latestContentRef, nativeExternalFormulaInputsForBuild,
    onContentChange, path, pendingExternalFormulaCommitRef, serializeCurrentWorkbook, setError, setWorkbook,
    shouldWaitForInitialExternalFormulaResolution, trackedOpenPathRef, workbookGenerationRef, workbookPathRef, workbookRef,
  })

  useWorkbookCleanup({
    cancelScheduledSerialize, dirtyBodyRowsRef, dirtyWorkbookGenerationRef, pendingExternalFormulaCommitRef,
    serializeCurrentWorkbook, workbookGenerationRef, workbookRef,
  })

  const refreshWorkbook = useWorkbookRefresh({ refreshSequenceRef, setWorkbook, workbookRef })

  return {
    cancelScheduledSerialize,
    error,
    refreshWorkbook,
    scheduleSerialize,
    serializeCurrentWorkbook,
    workbook,
    workbookRef,
  }
}
