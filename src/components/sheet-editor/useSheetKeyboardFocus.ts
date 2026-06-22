import { useCallback, useRef } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type {
  FormulaAutocompleteState,
  SheetWikilinkAutocompleteState,
} from './sheetEditorHelpers'
import { focusWorkbookRoot } from './sheetEditorHelpers'
import type { SheetContextMenuState } from '../../utils/sheetContextMenuState'
import { canSheetClaimFocus } from './sheetEditorFocusOwnership'

interface UseSheetKeyboardFocusOptions {
  scheduleSelectionChromePatch: () => void
  setFormulaAutocomplete: Dispatch<SetStateAction<FormulaAutocompleteState | null>>
  setSheetContextMenu: Dispatch<SetStateAction<SheetContextMenuState | null>>
  setWikilinkAutocomplete: Dispatch<SetStateAction<SheetWikilinkAutocompleteState | null>>
  sheetElementRef: MutableRefObject<HTMLDivElement | null>
}

export function useSheetKeyboardFocus({
  scheduleSelectionChromePatch,
  setFormulaAutocomplete,
  setSheetContextMenu,
  setWikilinkAutocomplete,
  sheetElementRef,
}: UseSheetKeyboardFocusOptions) {
  const sheetKeyboardCapturedRef = useRef(false)
  const sheetFocusRequestRef = useRef(0)
  const sheetFocusSuppressedRef = useRef(false)

  const captureSheetKeyboard = useCallback(() => {
    sheetFocusSuppressedRef.current = false
    sheetKeyboardCapturedRef.current = true
  }, [])

  const releaseSheetKeyboard = useCallback(() => {
    sheetFocusRequestRef.current += 1
    sheetFocusSuppressedRef.current = true
    sheetKeyboardCapturedRef.current = false
    setFormulaAutocomplete(null)
    setWikilinkAutocomplete(null)
    setSheetContextMenu(null)
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && sheetElementRef.current?.contains(activeElement)) {
      activeElement.blur()
    }
  }, [setFormulaAutocomplete, setSheetContextMenu, setWikilinkAutocomplete, sheetElementRef])

  const restoreSheetKeyboardFocus = useCallback(() => {
    sheetFocusSuppressedRef.current = false
    sheetKeyboardCapturedRef.current = true
    const focusRequestId = sheetFocusRequestRef.current + 1
    sheetFocusRequestRef.current = focusRequestId

    window.setTimeout(() => {
      const container = sheetElementRef.current
      if (!container || sheetFocusRequestRef.current !== focusRequestId) return
      if (!canSheetClaimFocus(container)) {
        sheetKeyboardCapturedRef.current = false
        return
      }
      focusWorkbookRoot(container)
      scheduleSelectionChromePatch()
    }, 0)
  }, [scheduleSelectionChromePatch, sheetElementRef])

  return {
    captureSheetKeyboard,
    releaseSheetKeyboard,
    restoreSheetKeyboardFocus,
    sheetFocusRequestRef,
    sheetFocusSuppressedRef,
    sheetKeyboardCapturedRef,
  }
}
