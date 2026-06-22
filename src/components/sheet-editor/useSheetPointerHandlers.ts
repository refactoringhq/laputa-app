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

interface UseSheetPointerHandlersOptions {
  captureSheetKeyboard: (options?: { deferActiveState?: boolean }) => void
  commitExternalFormulaEditorInput: (input: HTMLInputElement | HTMLTextAreaElement | null) => boolean
  handleSheetWikilinkPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => boolean
  scheduleSelectionChromePatch: () => void
  setSheetContextMenu: Dispatch<SetStateAction<SheetContextMenuState | null>>
  setWikilinkAutocomplete: Dispatch<SetStateAction<SheetWikilinkAutocompleteState | null>>
  sheetElementRef: MutableRefObject<HTMLDivElement | null>
  sheetFocusRequestRef: MutableRefObject<number>
  sheetKeyboardCapturedRef: MutableRefObject<boolean>
  sheetPointerActiveRef: MutableRefObject<boolean>
}

function isTransientUiPointerTarget(target: EventTarget) {
  return target instanceof Element
    && target.closest('.sheet-context-menu, .sheet-formula-autocomplete, .sheet-wikilink-autocomplete')
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
    handleSheetWikilinkPointerDown,
    scheduleSelectionChromePatch,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    sheetElementRef,
    sheetPointerActiveRef,
  } = options

  const handlePointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (isTransientUiPointerTarget(event.target)) return
    if (handleSheetWikilinkPointerDown(event)) return
    if (stopSecondaryPointer(event)) return

    commitExternalFormulaEditorInput(visibleSheetTextInput(sheetElementRef.current))
    patchReactSheetPointerEvent(event, sheetElementRef.current)
    sheetPointerActiveRef.current = true
    captureSheetKeyboard({ deferActiveState: true })
    scheduleSelectionChromePatch()
    setSheetContextMenu(null)
    setWikilinkAutocomplete(null)
    if (shouldRequestWorkbookFocus(event, sheetElementRef)) focusWorkbookForPointerDown(options)
  }, [
    captureSheetKeyboard,
    commitExternalFormulaEditorInput,
    handleSheetWikilinkPointerDown,
    options,
    scheduleSelectionChromePatch,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    sheetElementRef,
    sheetPointerActiveRef,
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
