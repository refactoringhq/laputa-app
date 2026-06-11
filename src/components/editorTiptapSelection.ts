export type EditorClientPoint = Pick<MouseEvent, 'clientX' | 'clientY'>

type TiptapSelectionRange = { from: number; to: number }
type TiptapCoordinateResult = { pos?: unknown } | null
type TiptapEditorView = {
  dom?: Element
  isDestroyed?: boolean
  posAtCoords?: (coords: { left: number; top: number }) => TiptapCoordinateResult
}

type TiptapCoordinateView = TiptapEditorView & {
  dom: Element
  posAtCoords: (coords: { left: number; top: number }) => TiptapCoordinateResult
}

export type TiptapSelectionBridge = {
  commands?: {
    setTextSelection?: (selection: number | TiptapSelectionRange) => unknown
  }
  state?: {
    doc?: {
      content?: { size?: unknown }
    }
  }
  view?: TiptapEditorView
}

export type EditorWithTiptapSelection = {
  _tiptapEditor?: TiptapSelectionBridge
}

export type WhitespaceSelectionStart = {
  anchor: number
  tiptapEditor: TiptapSelectionBridge
}

const EDGE_SELECTION_INSET_PX = 1

export function getTiptapSelectionBridge(
  editor: EditorWithTiptapSelection,
): TiptapSelectionBridge | null {
  return editor._tiptapEditor ?? null
}

function isValidDocumentPosition(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function textSelectionDocumentBounds(
  tiptapEditor: TiptapSelectionBridge,
): { start: number; end: number } | null {
  const size = tiptapEditor.state?.doc?.content?.size
  if (!isValidDocumentPosition(size)) return null
  if (size <= 0) return { start: 0, end: 0 }

  const end = Math.max(1, Math.floor(size) - 1)
  return { start: Math.min(1, end), end }
}

function clampCoordinate(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (max <= min) return min
  return Math.min(max, Math.max(min, value))
}

function clampedEditorCoords(
  point: EditorClientPoint,
  editorRect: DOMRect,
): { left: number; top: number } {
  return {
    left: clampCoordinate(
      point.clientX,
      editorRect.left + EDGE_SELECTION_INSET_PX,
      editorRect.right - EDGE_SELECTION_INSET_PX,
    ),
    top: clampCoordinate(
      point.clientY,
      editorRect.top + EDGE_SELECTION_INSET_PX,
      editorRect.bottom - EDGE_SELECTION_INSET_PX,
    ),
  }
}

function fallbackTextPosition(
  tiptapEditor: TiptapSelectionBridge,
  point: EditorClientPoint,
  editorRect: DOMRect,
): number | null {
  const bounds = textSelectionDocumentBounds(tiptapEditor)
  if (!bounds) return null

  return point.clientY < editorRect.top ? bounds.start : bounds.end
}

function isCoordinateView(view: TiptapSelectionBridge['view']): view is TiptapCoordinateView {
  return Boolean(
    view?.dom
    && typeof view.posAtCoords === 'function'
    && view.isDestroyed !== true,
  )
}

export function textPositionAtEditorPoint(
  tiptapEditor: TiptapSelectionBridge,
  point: EditorClientPoint,
): number | null {
  const view = tiptapEditor.view
  if (!isCoordinateView(view)) return null

  const editorRect = view.dom.getBoundingClientRect()
  let position: unknown
  try {
    position = view.posAtCoords(clampedEditorCoords(point, editorRect))?.pos
  } catch {
    return null
  }
  if (isValidDocumentPosition(position)) return position

  return fallbackTextPosition(tiptapEditor, point, editorRect)
}

export function applyTiptapTextSelection(
  tiptapEditor: TiptapSelectionBridge,
  anchor: number,
  head: number,
): boolean {
  const setTextSelection = tiptapEditor.commands?.setTextSelection
  if (typeof setTextSelection !== 'function') return false

  const range = {
    from: Math.min(anchor, head),
    to: Math.max(anchor, head),
  }

  try {
    setTextSelection(range)
    return true
  } catch {
    return false
  }
}
