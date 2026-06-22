import { useCallback, useEffect, useRef, useState } from 'react'
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

interface SheetKeyboardCaptureOptions {
  deferActiveState?: boolean
}

function useSheetKeyboardActiveState(
  sheetKeyboardCapturedRef: MutableRefObject<boolean>,
) {
  const pendingActiveStateTimerRef = useRef<number | null>(null)
  const [sheetKeyboardActive, setSheetKeyboardActive] = useState(false)

  const cancelPendingActiveState = useCallback(() => {
    if (pendingActiveStateTimerRef.current === null) return
    window.clearTimeout(pendingActiveStateTimerRef.current)
    pendingActiveStateTimerRef.current = null
  }, [])

  useEffect(() => cancelPendingActiveState, [cancelPendingActiveState])

  const setSheetKeyboardCaptured = useCallback((captured: boolean, options: SheetKeyboardCaptureOptions = {}) => {
    cancelPendingActiveState()
    sheetKeyboardCapturedRef.current = captured
    if (!captured || !options.deferActiveState) {
      setSheetKeyboardActive(captured)
      return
    }
    pendingActiveStateTimerRef.current = window.setTimeout(() => {
      pendingActiveStateTimerRef.current = null
      if (sheetKeyboardCapturedRef.current) setSheetKeyboardActive(true)
    }, 0)
  }, [cancelPendingActiveState, sheetKeyboardCapturedRef])

  return { setSheetKeyboardCaptured, sheetKeyboardActive }
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
  const sheetFocusSuppressedRef = useRef(true)
  const { setSheetKeyboardCaptured, sheetKeyboardActive } = useSheetKeyboardActiveState(sheetKeyboardCapturedRef)

  const captureSheetKeyboard = useCallback((options: SheetKeyboardCaptureOptions = {}) => {
    sheetFocusSuppressedRef.current = false
    setSheetKeyboardCaptured(true, options)
  }, [setSheetKeyboardCaptured])

  const releaseSheetKeyboard = useCallback(() => {
    sheetFocusRequestRef.current += 1
    sheetFocusSuppressedRef.current = true
    setSheetKeyboardCaptured(false)
    setFormulaAutocomplete(null)
    setWikilinkAutocomplete(null)
    setSheetContextMenu(null)
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && sheetElementRef.current?.contains(activeElement)) {
      activeElement.blur()
    }
  }, [setFormulaAutocomplete, setSheetContextMenu, setSheetKeyboardCaptured, setWikilinkAutocomplete, sheetElementRef])

  const restoreSheetKeyboardFocus = useCallback(() => {
    sheetFocusSuppressedRef.current = false
    setSheetKeyboardCaptured(true)
    const focusRequestId = sheetFocusRequestRef.current + 1
    sheetFocusRequestRef.current = focusRequestId

    window.setTimeout(() => {
      const container = sheetElementRef.current
      if (!container || sheetFocusRequestRef.current !== focusRequestId) return
      if (!canSheetClaimFocus(container)) {
        sheetFocusSuppressedRef.current = true
        setSheetKeyboardCaptured(false)
        return
      }
      focusWorkbookRoot(container)
      scheduleSelectionChromePatch()
    }, 0)
  }, [scheduleSelectionChromePatch, setSheetKeyboardCaptured, sheetElementRef])

  return {
    captureSheetKeyboard,
    releaseSheetKeyboard,
    restoreSheetKeyboardFocus,
    sheetKeyboardActive,
    sheetFocusRequestRef,
    sheetFocusSuppressedRef,
    sheetKeyboardCapturedRef,
  }
}
