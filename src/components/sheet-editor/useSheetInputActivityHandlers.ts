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

interface UseSheetInputActivityHandlersOptions {
  commitExternalFormulaEditorInput: (input: HTMLInputElement | HTMLTextAreaElement | null) => boolean
  scheduleSelectionChromePatch: () => void
  scheduleSerialize: (options?: ScheduleSheetSerializeOptions) => void
  setFormulaAutocomplete: Dispatch<SetStateAction<FormulaAutocompleteState | null>>
  setWikilinkAutocomplete: Dispatch<SetStateAction<SheetWikilinkAutocompleteState | null>>
  sheetElementRef: MutableRefObject<HTMLDivElement | null>
  updateSheetInlineAutocompletes: (input: HTMLInputElement | HTMLTextAreaElement | null) => void
  workbookRef: MutableRefObject<SheetWorkbookState | null>
}

function selectedRowsOrAll(workbookRef: MutableRefObject<SheetWorkbookState | null>) {
  const current = workbookRef.current
  return current ? dirtyRowsForSelectedRange(current.model) : 'all'
}

function visibleAutocompleteInput(
  eventTarget: EventTarget,
  sheetElementRef: MutableRefObject<HTMLDivElement | null>,
) {
  return formulaInputFromTarget(eventTarget) ?? visibleSheetTextInput(sheetElementRef.current)
}

export function useSheetInputActivityHandlers({
  commitExternalFormulaEditorInput,
  scheduleSelectionChromePatch,
  scheduleSerialize,
  setFormulaAutocomplete,
  setWikilinkAutocomplete,
  sheetElementRef,
  updateSheetInlineAutocompletes,
  workbookRef,
}: UseSheetInputActivityHandlersOptions) {
  const handleBlurCapture = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    commitExternalFormulaEditorInput(formulaInputFromTarget(event.target))
    scheduleSerialize({ dirty: false })
    window.setTimeout(() => {
      if (sheetElementRef.current?.contains(document.activeElement) !== true) {
        setFormulaAutocomplete(null)
        setWikilinkAutocomplete(null)
      }
    }, 0)
  }, [
    commitExternalFormulaEditorInput,
    scheduleSerialize,
    setFormulaAutocomplete,
    setWikilinkAutocomplete,
    sheetElementRef,
  ])

  const handleInputCapture = useCallback((event: ReactFormEvent<HTMLDivElement>) => {
    scheduleSerialize({ bodyRows: selectedRowsOrAll(workbookRef) })
    updateSheetInlineAutocompletes(visibleAutocompleteInput(event.target, sheetElementRef))
  }, [scheduleSerialize, sheetElementRef, updateSheetInlineAutocompletes, workbookRef])

  const handleKeyUpCapture = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target) && shouldScheduleSerializeForKey(event)) {
      scheduleSerialize({ bodyRows: selectedRowsOrAll(workbookRef) })
    }
    scheduleSelectionChromePatch()
    updateSheetInlineAutocompletes(visibleAutocompleteInput(event.target, sheetElementRef))
  }, [
    scheduleSelectionChromePatch,
    scheduleSerialize,
    sheetElementRef,
    updateSheetInlineAutocompletes,
    workbookRef,
  ])

  return { handleBlurCapture, handleInputCapture, handleKeyUpCapture }
}
