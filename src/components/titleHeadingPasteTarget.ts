export interface TitleHeadingPasteEditor {
  document: Array<{ id?: unknown; type?: string }>
  focus: () => void
  setTextCursorPosition: (blockId: string, placement: 'end') => void
}

function isSelectionInsideTitle(titleHeading: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false
  const anchor = selection.anchorNode
  const focus = selection.focusNode

  return Boolean(anchor && focus && titleHeading.contains(anchor) && titleHeading.contains(focus))
}

export function prepareTitleHeadingPaste(
  titleHeading: HTMLElement,
  editor: TitleHeadingPasteEditor,
): void {
  if (isSelectionInsideTitle(titleHeading)) {
    editor.focus()
    return
  }

  const firstBlock = editor.document[0]
  if (firstBlock?.type !== 'heading' || typeof firstBlock.id !== 'string') return

  try {
    editor.setTextCursorPosition(firstBlock.id, 'end')
  } catch {
    return
  }
  editor.focus()
}
