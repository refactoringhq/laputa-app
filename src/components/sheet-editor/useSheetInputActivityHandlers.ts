import { useCallback } from 'react'
import type {
  Dispatch,
  FocusEvent as ReactFocusEvent,
  FormEvent as ReactFormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  SetStateAction,
} from 'react'
import { dirtyRowsForSelectedRange } from '../../utils/sheetSelection'
import type { ScheduleSheetSerializeOptions, SheetWorkbookState } from './sheetEditorTypes'
import {
  formulaInputFromTarget,
  isEditableTarget,
  shouldScheduleSerializeForKey,
  type FormulaAutocompleteState,
  type SheetWikilinkAutocompleteState,
  visibleSheetTextInput,
} from './sheetEditorHelpers'
import { isReleasedWorkbookModelError } from './sheetReleasedModel'

interface UseSheetInputActivityHandlersOptions {
  commitExternalFormulaEditorInput: (input: HTMLInputElement | HTMLTextAreaElement | null) => boolean
  commitSheetTextInput: (input: HTMLInputElement | HTMLTextAreaElement | null) => boolean
  releaseSheetTextInputTarget: (input: HTMLInputElement | HTMLTextAreaElement | null) => void
  scheduleSelectionChromePatch: () => void
  scheduleSerialize: (options?: ScheduleSheetSerializeOptions) => void
  setFormulaAutocomplete: Dispatch<SetStateAction<FormulaAutocompleteState | null>>
  setWikilinkAutocomplete: Dispatch<SetStateAction<SheetWikilinkAutocompleteState | null>>
  sheetElementRef: MutableRefObject<HTMLDivElement | null>
  trackSheetTextInputEdit: (input: HTMLInputElement | HTMLTextAreaElement | null) => void
  updateSheetInlineAutocompletes: (input: HTMLInputElement | HTMLTextAreaElement | null) => void
  workbookRef: MutableRefObject<SheetWorkbookState | null>
}

function selectedRowsOrAll(workbookRef: MutableRefObject<SheetWorkbookState | null>) {
  const current = workbookRef.current
  if (!current) return 'all'

  try {
    return dirtyRowsForSelectedRange(current.model)
  } catch (error) {
    if (!isReleasedWorkbookModelError(error)) throw error
    console.warn('[sheet-editor] Skipped stale workbook selection read:', error)
    return 'all'
  }
}

function visibleAutocompleteInput(eventTarget: EventTarget, sheetElementRef: MutableRefObject<HTMLDivElement | null>) {
  return formulaInputFromTarget(eventTarget) ?? visibleSheetTextInput(sheetElementRef.current)
}

export function useSheetInputActivityHandlers(options: UseSheetInputActivityHandlersOptions) {
  const {
    commitExternalFormulaEditorInput,
    commitSheetTextInput,
    releaseSheetTextInputTarget,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    setFormulaAutocomplete,
    setWikilinkAutocomplete,
    sheetElementRef,
    trackSheetTextInputEdit,
    updateSheetInlineAutocompletes,
    workbookRef,
  } = options
  const handleBlurCapture = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>) => {
    const input = formulaInputFromTarget(event.target)
    if (!commitSheetTextInput(input)) {
      commitExternalFormulaEditorInput(input)
    }
    releaseSheetTextInputTarget(input)
    scheduleSerialize({ dirty: false })
    window.setTimeout(() => {
      if (sheetElementRef.current?.contains(document.activeElement) !== true) {
        setFormulaAutocomplete(null)
        setWikilinkAutocomplete(null)
      }
    }, 0)
    },
    [
    commitExternalFormulaEditorInput,
    commitSheetTextInput,
    releaseSheetTextInputTarget,
    scheduleSerialize,
    setFormulaAutocomplete,
    setWikilinkAutocomplete,
    sheetElementRef,
    ],
  )

  const handleInputCapture = useCallback(
    (event: ReactFormEvent<HTMLDivElement>) => {
    trackSheetTextInputEdit(formulaInputFromTarget(event.target))
    scheduleSerialize({ bodyRows: selectedRowsOrAll(workbookRef) })
    updateSheetInlineAutocompletes(visibleAutocompleteInput(event.target, sheetElementRef))
    },
    [scheduleSerialize, sheetElementRef, trackSheetTextInputEdit, updateSheetInlineAutocompletes, workbookRef],
  )

  const handleKeyUpCapture = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target) && shouldScheduleSerializeForKey(event)) {
      scheduleSerialize({ bodyRows: selectedRowsOrAll(workbookRef) })
    }
    scheduleSelectionChromePatch()
    updateSheetInlineAutocompletes(visibleAutocompleteInput(event.target, sheetElementRef))
    },
    [scheduleSelectionChromePatch, scheduleSerialize, sheetElementRef, updateSheetInlineAutocompletes, workbookRef],
  )

  return { handleBlurCapture, handleInputCapture, handleKeyUpCapture }
}
