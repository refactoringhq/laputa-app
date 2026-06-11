import type { InlineSelectionRange } from './inlineWikilinkDom'

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
  if (scrollTop !== null && editor) editor.scrollTop = scrollTop
}
