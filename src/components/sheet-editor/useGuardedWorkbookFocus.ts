import { useLayoutEffect } from 'react'
import type { MutableRefObject } from 'react'
import { registerFocusOwnershipScope } from '../../hooks/focusOwnershipGuard'
import { canSheetClaimCapturedFocus } from './sheetEditorFocusOwnership'

interface UseGuardedWorkbookFocusOptions {
  onWorkbookFocusBlocked?: () => void
  sheetFocusSuppressedRef: MutableRefObject<boolean>
  sheetElementRef: MutableRefObject<HTMLDivElement | null>
  sheetKeyboardCapturedRef: MutableRefObject<boolean>
}

type FocusGuardOptions = UseGuardedWorkbookFocusOptions

function canFocusWorkbook({
  sheetFocusSuppressedRef,
  sheetElementRef,
  sheetKeyboardCapturedRef,
}: UseGuardedWorkbookFocusOptions): boolean {
  return canSheetClaimCapturedFocus(sheetElementRef.current)
    && sheetKeyboardCapturedRef.current
    && !sheetFocusSuppressedRef.current
}

function releaseFocusOwnership(options: FocusGuardOptions): void {
  options.sheetFocusSuppressedRef.current = true
  options.sheetKeyboardCapturedRef.current = false
  options.onWorkbookFocusBlocked?.()
}

function allowSheetFocus(options: FocusGuardOptions): void {
  options.sheetFocusSuppressedRef.current = false
}

function installFocusOwnershipGuard(container: HTMLDivElement, guardOptions: FocusGuardOptions) {
  const guard = registerFocusOwnershipScope(container, {
    canClaimFocus: () => canFocusWorkbook(guardOptions),
    onAllowedFocusInside: () => allowSheetFocus(guardOptions),
    onBlockedFocus: () => releaseFocusOwnership(guardOptions),
    onInsidePointerDown: () => allowSheetFocus(guardOptions),
    onOutsideInteraction: () => releaseFocusOwnership(guardOptions),
  })
  guard.reconcileBlockedFocus()
  const reconcileTimer = window.setTimeout(guard.reconcileBlockedFocus, 0)
  return () => {
    window.clearTimeout(reconcileTimer)
    guard.unregister()
  }
}

export function useGuardedWorkbookFocus(options: UseGuardedWorkbookFocusOptions) {
  const {
    onWorkbookFocusBlocked,
    sheetElementRef,
    sheetFocusSuppressedRef,
    sheetKeyboardCapturedRef,
  } = options

  useLayoutEffect(() => {
    const container = sheetElementRef.current
    if (!container) return

    return installFocusOwnershipGuard(container, {
      onWorkbookFocusBlocked,
      sheetElementRef,
      sheetFocusSuppressedRef,
      sheetKeyboardCapturedRef,
    })
  })
}
