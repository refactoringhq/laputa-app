type FocusMethod = HTMLElement['focus']

interface FocusOwnershipScopeOptions {
  canClaimFocus: () => boolean
  onAllowedFocusInside?: () => void
  onBlockedFocus?: () => void
  onInsidePointerDown?: () => void
  onOutsideInteraction?: (event: Event) => void
}

export interface FocusOwnershipScopeHandle {
  reconcileBlockedFocus: () => void
  rememberOutsideTarget: (target: EventTarget | null) => void
  unregister: () => void
}

interface ActiveFocusOwnershipScope {
  lastOutsideFocusTarget: HTMLElement | null
  options: FocusOwnershipScopeOptions
  scope: HTMLElement
}

const focusOwnershipScopes = new Set<ActiveFocusOwnershipScope>()
let removeDocumentListeners: (() => void) | null = null
let restoreNativeFocus: (() => void) | null = null

function eventTargetElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target
  return target instanceof Node ? target.parentElement : null
}

function targetIsInsideScope(scope: HTMLElement, target: EventTarget | null): boolean {
  const element = eventTargetElement(target)
  return element !== null && scope.contains(element)
}

function rememberOutsideTarget(record: ActiveFocusOwnershipScope, target: EventTarget | null): void {
  if (target === null) {
    record.lastOutsideFocusTarget = null
    return
  }

  const element = eventTargetElement(target)
  if (element && !record.scope.contains(element)) {
    record.lastOutsideFocusTarget = element
  }
}

function blockedScopeForFocusTarget(target: HTMLElement): ActiveFocusOwnershipScope | null {
  return Array.from(focusOwnershipScopes)
    .find((record) => record.scope.contains(target) && !record.options.canClaimFocus()) ?? null
}

function stopBlockedFocusEvent(event: FocusEvent): void {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

function connectedOutsideTarget(record: ActiveFocusOwnershipScope): HTMLElement | null {
  const target = record.lastOutsideFocusTarget
  return target?.isConnected && !record.scope.contains(target) ? target : null
}

function blurActiveInside(blockedTarget: HTMLElement): void {
  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement && blockedTarget.contains(activeElement)) {
    activeElement.blur()
  }
}

function restoreOutsideFocus(record: ActiveFocusOwnershipScope, blockedTarget: HTMLElement): void {
  const target = connectedOutsideTarget(record)
  if (!target) {
    blurActiveInside(blockedTarget)
    return
  }
  target.focus({ preventScroll: true })
}

function handleOutsideInteraction(
  record: ActiveFocusOwnershipScope,
  event: Event,
  target: EventTarget | null,
): void {
  record.options.onOutsideInteraction?.(event)
  rememberOutsideTarget(record, target)
}

function handleAllowedFocusInside(record: ActiveFocusOwnershipScope): boolean {
  if (!record.options.canClaimFocus()) return false
  record.options.onAllowedFocusInside?.()
  return true
}

function blockFocusInside(
  record: ActiveFocusOwnershipScope,
  event: FocusEvent,
  target: EventTarget | null,
): boolean {
  stopBlockedFocusEvent(event)
  record.options.onBlockedFocus?.()
  if (target instanceof HTMLElement) restoreOutsideFocus(record, target)
  return true
}

function handleFocusForScope(
  record: ActiveFocusOwnershipScope,
  event: FocusEvent,
  target: EventTarget | null,
): boolean {
  if (!targetIsInsideScope(record.scope, target)) {
    handleOutsideInteraction(record, event, target)
    return false
  }
  return handleAllowedFocusInside(record) || blockFocusInside(record, event, target)
}

function handleDocumentFocus(event: FocusEvent): void {
  const target = event.target
  Array.from(focusOwnershipScopes).some((record) => handleFocusForScope(record, event, target))
}

function handlePointerForScope(
  record: ActiveFocusOwnershipScope,
  event: PointerEvent,
  target: EventTarget | null,
): void {
  if (targetIsInsideScope(record.scope, target)) {
    record.options.onInsidePointerDown?.()
    return
  }
  handleOutsideInteraction(record, event, target)
}

function handleDocumentPointerDown(event: PointerEvent): void {
  const target = event.target
  focusOwnershipScopes.forEach((record) => handlePointerForScope(record, event, target))
}

function installDocumentListeners(): void {
  if (removeDocumentListeners) return
  document.addEventListener('focus', handleDocumentFocus, true)
  document.addEventListener('focusin', handleDocumentFocus, true)
  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  removeDocumentListeners = () => {
    document.removeEventListener('focus', handleDocumentFocus, true)
    document.removeEventListener('focusin', handleDocumentFocus, true)
    document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
  }
}

function installFocusPatch(): void {
  if (restoreNativeFocus) return
  const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'focus')
  const originalFocus = HTMLElement.prototype.focus
  Object.defineProperty(HTMLElement.prototype, 'focus', {
    configurable: true,
    value(this: HTMLElement, focusOptions?: FocusOptions) {
      const blockedScope = blockedScopeForFocusTarget(this)
      if (blockedScope) {
        blockedScope.options.onBlockedFocus?.()
        return
      }
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

function uninstallGlobalGuardIfIdle(): void {
  if (focusOwnershipScopes.size > 0) return
  removeDocumentListeners?.()
  removeDocumentListeners = null
  restoreNativeFocus?.()
  restoreNativeFocus = null
}

export function registerFocusOwnershipScope(
  scope: HTMLElement,
  options: FocusOwnershipScopeOptions,
): FocusOwnershipScopeHandle {
  const record: ActiveFocusOwnershipScope = {
    lastOutsideFocusTarget: null,
    options,
    scope,
  }
  focusOwnershipScopes.add(record)
  installFocusPatch()
  installDocumentListeners()

  return {
    reconcileBlockedFocus: () => {
      const activeElement = document.activeElement
      if (!(activeElement instanceof HTMLElement) || !record.scope.contains(activeElement)) return
      if (record.options.canClaimFocus()) return
      record.options.onBlockedFocus?.()
      restoreOutsideFocus(record, activeElement)
    },
    rememberOutsideTarget: (target) => rememberOutsideTarget(record, target),
    unregister: () => {
      focusOwnershipScopes.delete(record)
      uninstallGlobalGuardIfIdle()
    },
  }
}
