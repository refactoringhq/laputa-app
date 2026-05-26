import { EditorView, ViewPlugin } from '@codemirror/view'

function parseZoomValue(source: string | undefined): number | null {
  const value = source?.trim() ?? ''
  if (!value || value === 'normal') return null

  let parsed = parseFloat(value)
  if (value.endsWith('%')) parsed /= 100
  return parsed > 0 && Number.isFinite(parsed) ? parsed : null
}

/**
 * Read the current CSS zoom factor from document.documentElement.
 * Returns 1 when no zoom is applied or the value is unparseable.
 */
export function getDocumentZoom(): number {
  const computedZoom = parseZoomValue(getComputedStyle(document.documentElement).zoom)
  if (computedZoom !== null) return computedZoom

  const inline = document.documentElement.style.getPropertyValue('zoom')
  const inlineZoom = parseZoomValue(inline)
  if (inlineZoom !== null) return inlineZoom

  return 1
}

/**
 * Convert viewport-space coordinates to CSS-space coordinates by
 * dividing by the zoom factor. When CSS zoom is applied to the root
 * element, mouse event clientX/clientY are in viewport space, but
 * Range.getClientRects() (used by CodeMirror's posAtCoords) may return
 * values in CSS space. Dividing by zoom aligns them.
 */
export function adjustCoordsForZoom(
  coords: { x: number; y: number },
  zoom: number,
): { x: number; y: number } {
  if (zoom === 1) return coords
  return { x: coords.x / zoom, y: coords.y / zoom }
}

/**
 * Use the browser's native caretRangeFromPoint API to find the document
 * position at viewport coordinates. This API correctly handles CSS zoom
 * because it operates in the browser's own coordinate system.
 *
 * Returns null if the API is unavailable or the position is outside the
 * editor's content area.
 */
function caretPosFromPoint(
  view: EditorView,
  x: number,
  y: number,
): number | null {
  if (typeof document.caretRangeFromPoint !== 'function') return null

  const range = document.caretRangeFromPoint(x, y)
  if (!range) return null

  if (!view.contentDOM.contains(range.startContainer)) return null

  try {
    return view.posAtDOM(range.startContainer, range.startOffset)
  } catch {
    return null
  }
}

type Coords = { x: number; y: number }
type PosAndSide = { pos: number; assoc: -1 | 1 }
type CoordsMethod<Result> = (
  this: EditorView,
  coords: Coords,
  precise?: boolean,
) => Result

type EditorViewCoordsOverrides = {
  posAtCoords?: CoordsMethod<number | null>
  posAndSideAtCoords?: CoordsMethod<PosAndSide | null>
}

interface ZoomAwareCoordsCall<Result> {
  self: EditorView
  coords: Coords
  precise: boolean | undefined
  originalMethod: CoordsMethod<Result>
  resultFromCaret: (pos: number) => Result
}

function callZoomAwareCoords<Result>(call: ZoomAwareCoordsCall<Result>): Result {
  const { self, coords, precise, originalMethod, resultFromCaret } = call
  const zoom = getDocumentZoom()
  if (zoom === 1) return originalMethod.call(self, coords, precise)

  const pos = caretPosFromPoint(self, coords.x, coords.y)
  if (pos !== null) return resultFromCaret(pos)

  return originalMethod.call(self, adjustCoordsForZoom(coords, zoom), precise)
}

function makeZoomCoordsOverride<Result>(
  originalMethod: CoordsMethod<Result>,
  resultFromCaret: (pos: number) => Result,
): CoordsMethod<Result> {
  return function zoomAwareCoordsOverride(
    this: EditorView,
    coords: Coords,
    precise?: boolean,
  ): Result {
    return callZoomAwareCoords({
      self: this,
      coords,
      precise,
      originalMethod,
      resultFromCaret,
    })
  }
}

/**
 * CodeMirror extension that fixes cursor positioning at non-100% CSS zoom.
 *
 * When CSS `zoom` is applied to document.documentElement, CodeMirror's
 * posAtCoords breaks because it compares mouse event coordinates (viewport
 * space) against Range.getClientRects() values (which may be in CSS space
 * under zoom). This extension overrides posAtCoords and posAndSideAtCoords
 * on the EditorView instance with zoom-aware versions that:
 *
 * 1. Use document.caretRangeFromPoint() — the browser's native, zoom-aware
 *    coordinate-to-text API — to find the correct position.
 * 2. Fall back to the original method with coordinates divided by the zoom
 *    factor if caretRangeFromPoint is unavailable or returns no result.
 */
export function zoomCursorFix() {
  return ViewPlugin.define((view) => {
    const prototype = Object.getPrototypeOf(view) as Required<EditorViewCoordsOverrides>
    const origPosAtCoords = prototype.posAtCoords
    const origPosAndSideAtCoords = prototype.posAndSideAtCoords
    const overrides = view as EditorViewCoordsOverrides

    // Override on the instance (shadows prototype methods)
    overrides.posAtCoords = makeZoomCoordsOverride(origPosAtCoords, (pos) => pos)
    overrides.posAndSideAtCoords = makeZoomCoordsOverride(
      origPosAndSideAtCoords,
      (pos) => ({ pos, assoc: 1 }),
    )

    return {
      destroy() {
        // Remove instance overrides, restoring prototype methods
        delete overrides.posAtCoords
        delete overrides.posAndSideAtCoords
      },
    }
  })
}
