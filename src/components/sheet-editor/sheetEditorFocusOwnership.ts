import { canEditorClaimFocus } from '../../hooks/editorFocusOwnership'

const EXTERNAL_FOCUS_SURFACE_SELECTOR = [
  '[data-slot="dialog-content"]:not([data-state="closed"])',
  '[role="dialog"]:not([data-state="closed"])',
].join(',')

export function hasFocusOutsideSheet(container: HTMLDivElement | null): boolean {
  const activeElement = document.activeElement
  return activeElement instanceof HTMLElement
    && container?.contains(activeElement) !== true
    && activeElement !== document.body
}

export function hasExternalFocusSurface(container: HTMLDivElement | null): boolean {
  if (typeof document === 'undefined') return false
  const surfaces = document.querySelectorAll(EXTERNAL_FOCUS_SURFACE_SELECTOR)
  return Array.from(surfaces).some((surface) => (
    surface instanceof HTMLElement
    && surface.isConnected
    && container?.contains(surface) !== true
  ))
}

export function canSheetClaimFocus(container: HTMLDivElement | null): container is HTMLDivElement {
  return canEditorClaimFocus()
    && container !== null
    && !hasFocusOutsideSheet(container)
    && !hasExternalFocusSurface(container)
}

export function canSheetClaimCapturedFocus(container: HTMLDivElement | null): container is HTMLDivElement {
  return canEditorClaimFocus()
    && container !== null
    && !hasExternalFocusSurface(container)
}
