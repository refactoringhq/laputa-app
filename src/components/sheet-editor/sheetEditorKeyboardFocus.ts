import {
  isEditableTarget,
  isSheetCommandTarget,
} from './sheetEditorTargetGuards'

export function workbookKeyboardRoot(container: HTMLDivElement | null): HTMLElement | null {
  if (!container) return null
  const sheetSurface = container.querySelector<HTMLElement>('.sheet-container')
  const root = sheetSurface?.closest<HTMLElement>('[tabindex="0"]') ?? null
  if (root && container.contains(root)) return root
  return container.querySelector<HTMLElement>('[tabindex="0"]')
}

function isWorkbookKeyboardTarget(container: HTMLDivElement | null, target: EventTarget | null): boolean {
  const root = workbookKeyboardRoot(container)
  return !!root && target instanceof Node && (target === root || root.contains(target))
}

export function isEditableWorkbookKeyboardTarget(container: HTMLDivElement | null, target: EventTarget | null): boolean {
  return isEditableTarget(target) && isWorkbookKeyboardTarget(container, target)
}

export function isSheetCellKeyboardTarget(container: HTMLDivElement | null, target: EventTarget | null): boolean {
  return isWorkbookKeyboardTarget(container, target)
    && !isEditableTarget(target)
    && !isSheetCommandTarget(target)
}

export function focusWorkbookRoot(container: HTMLDivElement | null): HTMLElement | null {
  const workbookRoot = workbookKeyboardRoot(container)
  workbookRoot?.focus()
  return workbookRoot
}

export function startCellEdit(container: HTMLDivElement | null): void {
  const workbookRoot = focusWorkbookRoot(container)
  workbookRoot?.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code: 'F2',
    key: 'F2',
  }))
}
