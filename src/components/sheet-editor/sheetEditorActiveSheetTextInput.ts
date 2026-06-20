export function activeSheetTextInput(container: HTMLDivElement): HTMLInputElement | HTMLTextAreaElement | null {
  const activeElement = document.activeElement
  return (
    (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement)
    && container.contains(activeElement)
  )
    ? activeElement
    : null
}
