import { useCallback } from 'react'
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, MutableRefObject, SetStateAction } from 'react'
import {
  clearSelectedRangeContents,
  dirtyRowsForSelectedRange,
} from '../../utils/sheetSelection'
import type { SheetContextMenuState } from '../../utils/sheetContextMenuState'
import type { ScheduleSheetSerializeOptions, SheetWorkbookState } from './sheetEditorTypes'
import {
  focusWorkbookRoot,
  formulaInputFromTarget,
  isEditableTarget,
  isEditableWorkbookKeyboardTarget,
  isPlainCellClearKey,
  isPlainEnterKey,
  isSheetCellKeyboardTarget,
  isSpreadsheetKey,
  startCellEdit,
  type FormulaAutocompleteState,
  type SheetWikilinkAutocompleteState,
} from './sheetEditorHelpers'
import { canSheetClaimFocus } from './sheetEditorFocusOwnership'

interface UseSheetKeyboardHandlersOptions {
  cancelScheduledSerialize: () => void
  captureSheetKeyboard: () => void
  commitExternalFormulaEditorInput: (input: HTMLInputElement | HTMLTextAreaElement | null) => boolean
  commitSheetTextInput: (input: HTMLInputElement | HTMLTextAreaElement | null) => boolean
  handleFormulaKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  handleWikilinkKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  refreshWorkbook: () => void
  releaseSheetKeyboard: () => void
  restoreSheetKeyboardFocus: () => void
  scheduleSelectionChromePatch: () => void
  scheduleSerialize: (options?: ScheduleSheetSerializeOptions) => void
  serializeCurrentWorkbook: (expectedGeneration?: number) => boolean
  setFormulaAutocomplete: Dispatch<SetStateAction<FormulaAutocompleteState | null>>
  setSheetContextMenu: Dispatch<SetStateAction<SheetContextMenuState | null>>
  setWikilinkAutocomplete: Dispatch<SetStateAction<SheetWikilinkAutocompleteState | null>>
  sheetElementRef: MutableRefObject<HTMLDivElement | null>
  sheetKeyboardCapturedRef: MutableRefObject<boolean>
  workbookRef: MutableRefObject<SheetWorkbookState | null>
}

function isSaveShortcut(event: ReactKeyboardEvent<HTMLDivElement>) {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's'
}

const PASSIVE_WORKBOOK_NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp'])

function saveWorkbookNow({
  cancelScheduledSerialize,
  serializeCurrentWorkbook,
}: Pick<UseSheetKeyboardHandlersOptions, 'cancelScheduledSerialize' | 'serializeCurrentWorkbook'>) {
  cancelScheduledSerialize()
  serializeCurrentWorkbook()
}

function shouldCommitEditableFormulaInput(
  event: ReactKeyboardEvent<HTMLDivElement>,
  editableInput: HTMLInputElement | HTMLTextAreaElement | null,
) {
  return Boolean(editableInput) && (isPlainEnterKey(event) || event.key === 'Tab')
}

function dismissFormulaAutocomplete({
  setFormulaAutocomplete,
  setWikilinkAutocomplete,
}: Pick<UseSheetKeyboardHandlersOptions, 'setFormulaAutocomplete' | 'setWikilinkAutocomplete'>) {
  setFormulaAutocomplete(null)
  setWikilinkAutocomplete(null)
}

function focusWorkbookRootWhenSheetStillOwnsFocus(sheetElement: HTMLDivElement | null) {
  if (canSheetClaimFocus(sheetElement)) focusWorkbookRoot(sheetElement)
}

function restoreCommittedCellFocus(
  sheetElement: HTMLDivElement | null,
  sheetKeyboardCapturedRef: MutableRefObject<boolean>,
) {
  if (sheetKeyboardCapturedRef.current) focusWorkbookRootWhenSheetStillOwnsFocus(sheetElement)
}

function dispatchWindowNavigationKey(event: ReactKeyboardEvent<HTMLDivElement>) {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    altKey: event.altKey,
    bubbles: true,
    cancelable: true,
    code: event.code,
    ctrlKey: event.ctrlKey,
    key: event.key,
    location: event.location,
    metaKey: event.metaKey,
    repeat: event.repeat,
    shiftKey: event.shiftKey,
  }))
}

function redirectPassiveWorkbookNavigation(
  event: ReactKeyboardEvent<HTMLDivElement>,
  sheetElement: HTMLDivElement | null,
  options: Pick<UseSheetKeyboardHandlersOptions,
    | 'releaseSheetKeyboard'
    | 'sheetKeyboardCapturedRef'
  >,
) {
  if (options.sheetKeyboardCapturedRef.current) return false
  if (!PASSIVE_WORKBOOK_NAVIGATION_KEYS.has(event.key)) return false
  if (!isSheetCellKeyboardTarget(sheetElement, event.target)) return false

  event.preventDefault()
  event.stopPropagation()
  event.nativeEvent.stopImmediatePropagation()
  options.releaseSheetKeyboard()
  dispatchWindowNavigationKey(event)
  return true
}

function commitEditableFormulaInput(
  event: ReactKeyboardEvent<HTMLDivElement>,
  sheetElement: HTMLDivElement | null,
  options: Pick<UseSheetKeyboardHandlersOptions,
    | 'commitExternalFormulaEditorInput'
    | 'sheetKeyboardCapturedRef'
    | 'setFormulaAutocomplete'
    | 'setWikilinkAutocomplete'
  >,
) {
  const editableInput = formulaInputFromTarget(event.target)
  if (!shouldCommitEditableFormulaInput(event, editableInput)) return false
  if (!options.commitExternalFormulaEditorInput(editableInput)) return false

  event.preventDefault()
  event.stopPropagation()
  dismissFormulaAutocomplete(options)
  window.setTimeout(() => restoreCommittedCellFocus(sheetElement, options.sheetKeyboardCapturedRef), 0)
  return true
}

function shouldHandleCapturedEscape(
  event: ReactKeyboardEvent<HTMLDivElement>,
  sheetKeyboardCapturedRef: MutableRefObject<boolean>,
) {
  return sheetKeyboardCapturedRef.current && event.key === 'Escape'
}

function scheduleCapturedKeyboardRelease(
  options: Pick<UseSheetKeyboardHandlersOptions, 'releaseSheetKeyboard'>,
) {
  window.setTimeout(options.releaseSheetKeyboard, 0)
}

function handleCapturedEscape(
  event: ReactKeyboardEvent<HTMLDivElement>,
  sheetElement: HTMLDivElement | null,
  options: Pick<UseSheetKeyboardHandlersOptions,
    | 'commitSheetTextInput'
    | 'releaseSheetKeyboard'
    | 'restoreSheetKeyboardFocus'
    | 'sheetKeyboardCapturedRef'
  >,
) {
  if (!shouldHandleCapturedEscape(event, options.sheetKeyboardCapturedRef)) return false
  if (isEditableWorkbookKeyboardTarget(sheetElement, event.target)) {
    options.commitSheetTextInput(formulaInputFromTarget(event.target))
    event.preventDefault()
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation()
    options.restoreSheetKeyboardFocus()
    return true
  }
  scheduleCapturedKeyboardRelease(options)
  return true
}

function canClearSelectedCells(
  event: ReactKeyboardEvent<HTMLDivElement>,
  sheetElement: HTMLDivElement | null,
) {
  return isPlainCellClearKey(event) && isSheetCellKeyboardTarget(sheetElement, event.target)
}

function updateClearedSelection(
  current: SheetWorkbookState,
  options: Pick<UseSheetKeyboardHandlersOptions,
    | 'refreshWorkbook'
    | 'scheduleSelectionChromePatch'
    | 'scheduleSerialize'
  >,
) {
  const dirtyRows = dirtyRowsForSelectedRange(current.model)
  clearSelectedRangeContents(current.model)
  options.refreshWorkbook()
  options.scheduleSelectionChromePatch()
  options.scheduleSerialize({ bodyRows: dirtyRows })
}

function clearSelectedCells(
  event: ReactKeyboardEvent<HTMLDivElement>,
  sheetElement: HTMLDivElement | null,
  options: Pick<UseSheetKeyboardHandlersOptions,
    | 'captureSheetKeyboard'
    | 'refreshWorkbook'
    | 'scheduleSelectionChromePatch'
    | 'scheduleSerialize'
    | 'setFormulaAutocomplete'
    | 'setSheetContextMenu'
    | 'workbookRef'
  >,
) {
  if (!canClearSelectedCells(event, sheetElement)) return false
  const current = options.workbookRef.current
  if (!current) return true

  options.captureSheetKeyboard()
  event.preventDefault()
  event.stopPropagation()
  updateClearedSelection(current, options)
  options.setFormulaAutocomplete(null)
  options.setSheetContextMenu(null)
  return true
}

function canStartSelectedCellEdit(
  event: ReactKeyboardEvent<HTMLDivElement>,
  sheetElement: HTMLDivElement | null,
) {
  return isPlainEnterKey(event) && isSheetCellKeyboardTarget(sheetElement, event.target)
}

function startSelectedCellEdit(
  event: ReactKeyboardEvent<HTMLDivElement>,
  sheetElement: HTMLDivElement | null,
  options: Pick<UseSheetKeyboardHandlersOptions,
    | 'captureSheetKeyboard'
    | 'scheduleSelectionChromePatch'
  >,
) {
  if (!canStartSelectedCellEdit(event, sheetElement)) return false

  options.captureSheetKeyboard()
  event.preventDefault()
  event.stopPropagation()
  startCellEdit(sheetElement)
  options.scheduleSelectionChromePatch()
  return true
}

function stopEscapeKeyPropagation(
  event: ReactKeyboardEvent<HTMLDivElement>,
  options: Pick<UseSheetKeyboardHandlersOptions, 'releaseSheetKeyboard'>,
) {
  if (event.key !== 'Escape') return false
  event.stopPropagation()
  if (!isEditableTarget(event.target)) options.releaseSheetKeyboard()
  return true
}

function stopSpreadsheetKeyPropagation(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (isEditableTarget(event.target)) return
  if (isSpreadsheetKey(event)) event.stopPropagation()
}

function stopWorkbookKeyPropagation(
  event: ReactKeyboardEvent<HTMLDivElement>,
  options: Pick<UseSheetKeyboardHandlersOptions,
    | 'releaseSheetKeyboard'
    | 'restoreSheetKeyboardFocus'
  >,
) {
  if (stopEscapeKeyPropagation(event, options)) return
  stopSpreadsheetKeyPropagation(event)
}

function processKeyDownCapture(
  event: ReactKeyboardEvent<HTMLDivElement>,
  options: UseSheetKeyboardHandlersOptions,
) {
  const sheetElement = options.sheetElementRef.current

  if (isSaveShortcut(event)) saveWorkbookNow(options)
  if (redirectPassiveWorkbookNavigation(event, sheetElement, options)) return
  if (commitEditableFormulaInput(event, sheetElement, options)) return

  options.handleWikilinkKeyDown(event)
  if (event.defaultPrevented) return

  options.handleFormulaKeyDown(event)
  if (event.defaultPrevented) return

  if (handleCapturedEscape(event, sheetElement, options)) return
  if (clearSelectedCells(event, sheetElement, options)) return
  startSelectedCellEdit(event, sheetElement, options)
}

function processSheetKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  options: UseSheetKeyboardHandlersOptions,
) {
  if (!options.sheetKeyboardCapturedRef.current) return
  stopWorkbookKeyPropagation(event, options)
}

export function useSheetKeyboardHandlers(options: UseSheetKeyboardHandlersOptions) {
  const handleKeyDownCapture = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    processKeyDownCapture(event, options)
  }, [options])

  const handleSheetKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    processSheetKeyDown(event, options)
  }, [options])

  return { handleKeyDownCapture, handleSheetKeyDown }
}
