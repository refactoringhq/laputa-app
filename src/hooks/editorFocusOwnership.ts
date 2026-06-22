import { useEffect } from 'react'
import type { RefObject } from 'react'

type FocusMethod = HTMLElement['focus']

const editorFocusScopes = new Set<HTMLElement>()
let editorFocusSuspended = false
let focusPatchUsers = 0
let lastSuspendedFocusTarget: HTMLElement | null = null
let restoreNativeFocus: (() => void) | null = null

function eventTargetElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target
  return target instanceof Node ? target.parentElement : null
}

function targetIsInsideEditorScope(target: EventTarget | null): boolean {
  const element = eventTargetElement(target)
  if (!element) return false

  for (const scope of editorFocusScopes) {
    if (scope.contains(element)) return true
  }

  return false
}

function rememberSuspendedFocusTarget(target: EventTarget | null): void {
  const element = eventTargetElement(target)
  if (element && !targetIsInsideEditorScope(element)) {
    lastSuspendedFocusTarget = element
  }
}

function restoreSuspendedFocus(blockedTarget: HTMLElement): void {
  const target = lastSuspendedFocusTarget
  if (target?.isConnected && !targetIsInsideEditorScope(target)) {
    target.focus({ preventScroll: true })
    return
  }

  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement && blockedTarget.contains(activeElement)) {
    activeElement.blur()
  }
}

function installEditorFocusGuard() {
  focusPatchUsers += 1
  if (!restoreNativeFocus) {
    const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'focus')
    const originalFocus = HTMLElement.prototype.focus
    Object.defineProperty(HTMLElement.prototype, 'focus', {
      configurable: true,
      value(this: HTMLElement, focusOptions?: FocusOptions) {
        if (editorFocusSuspended && targetIsInsideEditorScope(this)) return
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

function handleDocumentFocusIn(event: FocusEvent): void {
  if (!editorFocusSuspended || !targetIsInsideEditorScope(event.target)) return
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  restoreSuspendedFocus(event.target as HTMLElement)
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (targetIsInsideEditorScope(event.target)) {
    resumeEditorFocus()
  }
}

export function canEditorClaimFocus(): boolean {
  return !editorFocusSuspended
}

export function resumeEditorFocus(): void {
  editorFocusSuspended = false
  lastSuspendedFocusTarget = null
}

export function suspendEditorFocus(target?: EventTarget | null): void {
  editorFocusSuspended = true
  rememberSuspendedFocusTarget(target ?? null)
}

export function useEditorFocusScope(scopeRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const scope = scopeRef.current
    if (!scope) return

    const uninstallGuard = installEditorFocusGuard()
    editorFocusScopes.add(scope)
    document.addEventListener('focusin', handleDocumentFocusIn, true)
    document.addEventListener('pointerdown', handleDocumentPointerDown, true)
    return () => {
      document.removeEventListener('focusin', handleDocumentFocusIn, true)
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
      editorFocusScopes.delete(scope)
      uninstallGuard()
    }
  }, [scopeRef])
}

export function useInspectorFocusBoundary(boundaryRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const boundary = boundaryRef.current
    if (!boundary) return

    const suspendFromBoundary = (event: Event) => suspendEditorFocus(event.target)
    boundary.addEventListener('focusin', suspendFromBoundary, true)
    boundary.addEventListener('pointerdown', suspendFromBoundary, true)
    return () => {
      boundary.removeEventListener('focusin', suspendFromBoundary, true)
      boundary.removeEventListener('pointerdown', suspendFromBoundary, true)
    }
  }, [boundaryRef])
}
