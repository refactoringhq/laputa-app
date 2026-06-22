import { canEditorClaimFocus } from '../../hooks/editorFocusOwnership'

export function hasFocusOutsideSheet(container: HTMLDivElement | null): boolean {
  const activeElement = document.activeElement
  return activeElement instanceof HTMLElement
    && container?.contains(activeElement) !== true
    && activeElement !== document.body
}

export function canSheetClaimFocus(container: HTMLDivElement | null): container is HTMLDivElement {
  return canEditorClaimFocus() && container !== null && !hasFocusOutsideSheet(container)
}
