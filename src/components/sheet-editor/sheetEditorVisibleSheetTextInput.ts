import { activeSheetTextInput } from './sheetEditorActiveSheetTextInput'

export function visibleSheetTextInput(container: HTMLDivElement | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (!container) return null
  return activeSheetTextInput(container)
}
