export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return true
  return target.closest('input, textarea, [contenteditable="true"]') !== null
}

export function sheetHasEditableFocus(container: HTMLDivElement | null): boolean {
  const activeElement = document.activeElement
  return activeElement instanceof HTMLElement
    && container?.contains(activeElement) === true
    && isEditableTarget(activeElement)
}

export function isSheetCommandTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.closest('button, a[href], [role="button"], [role="menuitem"], [role="option"], [data-radix-collection-item]') !== null
}
