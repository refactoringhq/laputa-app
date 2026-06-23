import type { InlineSelectionRange } from './inlineWikilinkDom'

const CARET_SCROLL_MARGIN_PX = 4

function selectedCaretRect(): DOMRect | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  const clientRects = typeof range.getClientRects === 'function'
    ? Array.from(range.getClientRects())
    : []
  const lastClientRect = clientRects[clientRects.length - 1]
  if (lastClientRect) return lastClientRect

  return typeof range.getBoundingClientRect === 'function'
    ? range.getBoundingClientRect()
    : null
}

function scrollCaretIntoView(editor: HTMLDivElement) {
  const editorRect = editor.getBoundingClientRect()
  if (editorRect.bottom <= editorRect.top) return

  const caretRect = selectedCaretRect()
  if (!caretRect) return

  if (caretRect.bottom > editorRect.bottom) {
    editor.scrollTop += caretRect.bottom - editorRect.bottom + CARET_SCROLL_MARGIN_PX
    return
  }

  if (caretRect.top < editorRect.top) {
    editor.scrollTop = Math.max(
      0,
      editor.scrollTop - (editorRect.top - caretRect.top + CARET_SCROLL_MARGIN_PX),
    )
  }
}

export function restorePendingRemountState(
  editor: HTMLDivElement | null,
  focusSelectionRange: (selectionRange: InlineSelectionRange) => void,
  pendingFocusRef: { current: InlineSelectionRange | null },
  pendingScrollTopRef: { current: number | null },
) {
  const target = pendingFocusRef.current
  const scrollTop = pendingScrollTopRef.current
  pendingFocusRef.current = null
  pendingScrollTopRef.current = null
  if (!target) return

  focusSelectionRange(target)
  if (!editor) return
  if (scrollTop !== null) editor.scrollTop = scrollTop
  scrollCaretIntoView(editor)
}
