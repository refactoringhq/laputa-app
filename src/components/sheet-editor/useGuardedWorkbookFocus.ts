import { useLayoutEffect } from 'react'
import type { MutableRefObject } from 'react'
import { canSheetClaimCapturedFocus } from './sheetEditorFocusOwnership'

interface UseGuardedWorkbookFocusOptions {
  onWorkbookFocusBlocked?: () => void
  sheetFocusSuppressedRef: MutableRefObject<boolean>
  sheetElementRef: MutableRefObject<HTMLDivElement | null>
  sheetKeyboardCapturedRef: MutableRefObject<boolean>
}

type FocusMethod = HTMLElement['focus']
type FocusGuardOptions = UseGuardedWorkbookFocusOptions

const guardedWorkbookSheets = new Set<FocusGuardOptions>()
let focusPatchUsers = 0
let restoreNativeFocus: (() => void) | null = null

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

function findWorkbookFocusGuard(target: HTMLElement): FocusGuardOptions | null {
  for (const options of guardedWorkbookSheets) {
    const container = options.sheetElementRef.current
    if (container?.contains(target)) return options
  }
  return null
}

function installWorkbookFocusGuard() {
  focusPatchUsers += 1
  if (!restoreNativeFocus) {
    const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'focus')
    const originalFocus = HTMLElement.prototype.focus
    Object.defineProperty(HTMLElement.prototype, 'focus', {
      configurable: true,
      value(this: HTMLElement, focusOptions?: FocusOptions) {
        const options = findWorkbookFocusGuard(this)
        if (options && !canFocusWorkbook(options)) return
        originalFocus.call(this, focusOptions)
      },
    })
    restoreNativeFocus = () => {
      if (originalDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'focus', originalDescriptor)
        return
      }
      delete (HTMLElement.prototype as { focus?: FocusMethod }).focus
    }
  }

  return () => {
    focusPatchUsers = Math.max(0, focusPatchUsers - 1)
    if (focusPatchUsers > 0) return
    restoreNativeFocus?.()
    restoreNativeFocus = null
  }
}

function updateFocusOwnershipFromEvent(event: Event, options: FocusGuardOptions) {
  const container = options.sheetElementRef.current
  if (!container) return
  const targetIsInsideSheet = event.target instanceof Node && container.contains(event.target)
  options.sheetFocusSuppressedRef.current = !targetIsInsideSheet
  if (!targetIsInsideSheet) releaseFocusOwnership(options)
}

function restoreOutsideFocus(target: HTMLElement | null, container: HTMLDivElement): void {
  if (target?.isConnected && !container.contains(target)) {
    target.focus({ preventScroll: true })
    return
  }

  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement && container.contains(activeElement)) {
    activeElement.blur()
  }
}

function shouldRestoreBlockedWorkbookFocus(
  container: HTMLDivElement,
  guardOptions: FocusGuardOptions,
): boolean {
  const activeElement = document.activeElement
  return activeElement instanceof HTMLElement
    && container.contains(activeElement)
    && !canFocusWorkbook(guardOptions)
}

function addFocusOwnershipListeners(
  handleFocusIntoSheet: (event: FocusEvent) => void,
  handleOutsideInteraction: (event: Event) => void,
) {
  document.addEventListener('focus', handleFocusIntoSheet, true)
  document.addEventListener('focus', handleOutsideInteraction, true)
  document.addEventListener('focusin', handleFocusIntoSheet, true)
  document.addEventListener('focusin', handleOutsideInteraction, true)
  document.addEventListener('pointerdown', handleOutsideInteraction, true)
  return () => {
    document.removeEventListener('focus', handleOutsideInteraction, true)
    document.removeEventListener('focus', handleFocusIntoSheet, true)
    document.removeEventListener('focusin', handleOutsideInteraction, true)
    document.removeEventListener('focusin', handleFocusIntoSheet, true)
    document.removeEventListener('pointerdown', handleOutsideInteraction, true)
  }
}

function installFocusOwnershipGuard(container: HTMLDivElement, guardOptions: FocusGuardOptions) {
  const removeGlobalFocusGuard = installWorkbookFocusGuard()
  guardedWorkbookSheets.add(guardOptions)
  let lastOutsideFocusTarget: HTMLElement | null = null
  const restoreBlockedWorkbookFocus = () => {
    if (!shouldRestoreBlockedWorkbookFocus(container, guardOptions)) return
    releaseFocusOwnership(guardOptions)
    restoreOutsideFocus(lastOutsideFocusTarget, container)
  }

  const handleOutsideInteraction = (event: Event) => {
    updateFocusOwnershipFromEvent(event, guardOptions)
    const target = event.target
    if (target instanceof HTMLElement && !container.contains(target)) {
      lastOutsideFocusTarget = target
    }
  }
  const handleFocusIntoSheet = (event: FocusEvent) => {
    if (canFocusWorkbook(guardOptions)) return
    const target = event.target
    if (!(target instanceof Node) || !container.contains(target)) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    releaseFocusOwnership(guardOptions)
    restoreOutsideFocus(lastOutsideFocusTarget, container)
  }
  const removeFocusOwnershipListeners = addFocusOwnershipListeners(
    handleFocusIntoSheet,
    handleOutsideInteraction,
  )
  restoreBlockedWorkbookFocus()
  const reconcileTimer = window.setTimeout(restoreBlockedWorkbookFocus, 0)
  return () => {
    window.clearTimeout(reconcileTimer)
    removeFocusOwnershipListeners()
    guardedWorkbookSheets.delete(guardOptions)
    removeGlobalFocusGuard()
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
