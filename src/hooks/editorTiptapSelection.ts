type TiptapEditorBridge = {
  state?: {
    doc?: { content?: { size?: unknown } }
  }
  commands?: {
    setTextSelection?: (position: number) => unknown
  }
}

function getTiptapEditorBridge(editor: unknown): TiptapEditorBridge | null {
  const editorWithBridge = editor as { _tiptapEditor?: TiptapEditorBridge }
  return editorWithBridge._tiptapEditor ?? null
}

function getSafeTextSelectionPosition(tiptapEditor: TiptapEditorBridge): number {
  const size = tiptapEditor.state?.doc?.content?.size
  if (typeof size !== 'number' || !Number.isFinite(size)) return 0
  return size > 0 ? Math.min(1, size) : 0
}

export function resetTextSelectionBeforeContentSwap(editor: unknown): void {
  const tiptapEditor = getTiptapEditorBridge(editor)
  const setTextSelection = tiptapEditor?.commands?.setTextSelection
  if (!tiptapEditor || typeof setTextSelection !== 'function') return

  try {
    setTextSelection(getSafeTextSelectionPosition(tiptapEditor))
  } catch (err) {
    console.warn('Failed to reset editor selection before content swap:', err)
  }
}
