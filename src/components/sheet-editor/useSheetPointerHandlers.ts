import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, PointerEvent as ReactPointerEvent, SetStateAction } from 'react'
import { isSecondaryPointerButton } from '../../utils/pointerButtons'
import { patchReactSheetPointerEvent } from '../../utils/sheetPointerCoordinates'
import type { SheetContextMenuState } from '../../utils/sheetContextMenuState'
import {
  focusWorkbookRoot,
  isEditableTarget,
  sheetHasEditableFocus,
  type SheetWikilinkAutocompleteState,
  visibleSheetTextInput,
} from './sheetEditorHelpers'
import type { SheetWorkbookState } from './sheetEditorTypes'

const SHEET_SCROLL_RESTORE_DELAYS_MS = [0, 32, 96, 192, 240, 384] as const

interface UseSheetPointerHandlersOptions {
  captureSheetKeyboard: (options?: { deferActiveState?: boolean }) => void
  commitExternalFormulaEditorInput: (input: HTMLInputElement | HTMLTextAreaElement | null) => boolean
  commitSheetTextInput: (input: HTMLInputElement | HTMLTextAreaElement | null) => boolean
  handleSheetWikilinkPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => boolean
  scheduleSelectionChromePatch: () => void
  setSheetContextMenu: Dispatch<SetStateAction<SheetContextMenuState | null>>
  setWikilinkAutocomplete: Dispatch<SetStateAction<SheetWikilinkAutocompleteState | null>>
  sheetElementRef: MutableRefObject<HTMLDivElement | null>
  sheetFocusRequestRef: MutableRefObject<number>
  sheetKeyboardCapturedRef: MutableRefObject<boolean>
  sheetPointerActiveRef: MutableRefObject<boolean>
  workbookRef: MutableRefObject<SheetWorkbookState | null>
}

interface SheetScrollSnapshot {
  element: HTMLElement
  leftColumn: number
  scrollLeft: number
  scrollTop: number
  topRow: number
}

function isTransientUiPointerTarget(target: EventTarget) {
  return target instanceof Element
    && target.closest('.sheet-context-menu, .sheet-formula-autocomplete, .sheet-wikilink-autocomplete')
}

function frozenSheetViewport(workbookRef: MutableRefObject<SheetWorkbookState | null>) {
  const current = workbookRef.current
  if (!current) return null
  const { model } = current
  const sheet = model.getSelectedSheet()
  const hasFrozenPane = model.getFrozenRowsCount(sheet) > 0 || model.getFrozenColumnsCount(sheet) > 0
  if (!hasFrozenPane) return null
  const view = model.getSelectedView()
  return {
    leftColumn: view.left_column,
    topRow: view.top_row,
  }
}

function sheetScrollSnapshot(
  container: HTMLDivElement | null,
  workbookRef: MutableRefObject<SheetWorkbookState | null>,
): SheetScrollSnapshot | null {
  const viewport = frozenSheetViewport(workbookRef)
  if (!viewport) return null
  const element = container?.querySelector<HTMLElement>('.scroll') ?? null
  if (!element) return null
  return {
    element,
    leftColumn: viewport.leftColumn,
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
    topRow: viewport.topRow,
  }
}

function isValidViewportIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 1
}

function restoreSheetScrollPosition(
  snapshot: SheetScrollSnapshot | null,
  workbookRef: MutableRefObject<SheetWorkbookState | null>,
) {
  if (!snapshot?.element.isConnected) return
  if (!isValidViewportIndex(snapshot.topRow) || !isValidViewportIndex(snapshot.leftColumn)) return
  workbookRef.current?.model.setTopLeftVisibleCell(snapshot.topRow, snapshot.leftColumn)
  snapshot.element.scrollLeft = snapshot.scrollLeft
  snapshot.element.scrollTop = snapshot.scrollTop
  snapshot.element.dispatchEvent(new Event('scroll', { bubbles: true }))
}

function restoreSheetScrollAfterPointerDown(
  snapshot: SheetScrollSnapshot | null,
  workbookRef: MutableRefObject<SheetWorkbookState | null>,
) {
  if (!snapshot) return
  const targetWindow = snapshot.element.ownerDocument.defaultView
  if (!targetWindow) return

  SHEET_SCROLL_RESTORE_DELAYS_MS.forEach((delay) => {
    targetWindow.setTimeout(() => {
      restoreSheetScrollPosition(snapshot, workbookRef)
      if (!snapshot.element.isConnected) return
      targetWindow.requestAnimationFrame(() => restoreSheetScrollPosition(snapshot, workbookRef))
    }, delay)
  })
}

function stopSecondaryPointer(event: ReactPointerEvent<HTMLDivElement>) {
  if (!isSecondaryPointerButton(event.button, event.buttons)) return false
  event.stopPropagation()
  return true
}

function focusWorkbookForPointerDown({
  sheetElementRef,
  sheetFocusRequestRef,
  sheetKeyboardCapturedRef,
}: Pick<UseSheetPointerHandlersOptions,
  | 'sheetElementRef'
  | 'sheetFocusRequestRef'
  | 'sheetKeyboardCapturedRef'
>) {
  sheetFocusRequestRef.current += 1
  const container = sheetElementRef.current
  if (!container || !sheetKeyboardCapturedRef.current) return
  focusWorkbookRoot(container)
}

function shouldRequestWorkbookFocus(
  event: ReactPointerEvent<HTMLDivElement>,
  sheetElementRef: MutableRefObject<HTMLDivElement | null>,
) {
  return !isEditableTarget(event.target) && !sheetHasEditableFocus(sheetElementRef.current)
}

export function useSheetPointerHandlers(options: UseSheetPointerHandlersOptions) {
  const {
    captureSheetKeyboard,
    commitExternalFormulaEditorInput,
    commitSheetTextInput,
    handleSheetWikilinkPointerDown,
    scheduleSelectionChromePatch,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    sheetElementRef,
    sheetPointerActiveRef,
    workbookRef,
  } = options

  const handlePointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (isTransientUiPointerTarget(event.target)) return
    if (handleSheetWikilinkPointerDown(event)) return
    if (stopSecondaryPointer(event)) return

    const scrollSnapshot = sheetScrollSnapshot(sheetElementRef.current, workbookRef)
    const activeInput = visibleSheetTextInput(sheetElementRef.current)
    if (!commitSheetTextInput(activeInput)) {
      commitExternalFormulaEditorInput(activeInput)
    }
    patchReactSheetPointerEvent(event, sheetElementRef.current)
    sheetPointerActiveRef.current = true
    captureSheetKeyboard({ deferActiveState: true })
    scheduleSelectionChromePatch()
    setSheetContextMenu(null)
    setWikilinkAutocomplete(null)
    if (shouldRequestWorkbookFocus(event, sheetElementRef)) focusWorkbookForPointerDown(options)
    restoreSheetScrollAfterPointerDown(scrollSnapshot, workbookRef)
  }, [
    captureSheetKeyboard,
    commitExternalFormulaEditorInput,
    commitSheetTextInput,
    handleSheetWikilinkPointerDown,
    options,
    scheduleSelectionChromePatch,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    sheetElementRef,
    sheetPointerActiveRef,
    workbookRef,
  ])

  const handlePointerMoveCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (sheetPointerActiveRef.current) patchReactSheetPointerEvent(event, sheetElementRef.current)
  }, [sheetElementRef, sheetPointerActiveRef])

  const handlePointerUpCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    patchReactSheetPointerEvent(event, sheetElementRef.current)
    scheduleSelectionChromePatch()
  }, [scheduleSelectionChromePatch, sheetElementRef])

  return {
    handlePointerDownCapture,
    handlePointerMoveCapture,
    handlePointerUpCapture,
  }
}
