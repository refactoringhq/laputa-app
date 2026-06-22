const IRONCALC_SELECTION_ORANGE = 'rgb(242, 153, 74)'
const IRONCALC_SELECTION_ORANGE_LIGHT = 'rgba(242, 153, 74, 0.1)'
const IRONCALC_SELECTION_ORANGE_HEX = '#f2994a'
const IRONCALC_HEADER_CELL_FILL_COLORS = new Set(['#fff', '#ffffff', '#eeeeee', 'rgb(255,255,255)', 'rgb(238,238,238)'])
const IRONCALC_ROW_HEADER_WIDTH_PX = 30
const IRONCALC_COLUMN_HEADER_HEIGHT_PX = 28
const IRONCALC_ROW_HEADER_RIGHT_BORDER_X_PX = IRONCALC_ROW_HEADER_WIDTH_PX - 1
const SHEET_CANVAS_COLOR_EPSILON = 0.01
const SHEET_SELECTION_ACCENT = 'var(--accent-blue)'
const SHEET_SELECTION_ACCENT_FALLBACK = '#155DFF'
const SHEET_SELECTION_ACCENT_LIGHT = 'var(--accent-blue-light)'
const SHEET_ROW_HEADER_BORDER_FALLBACK = '#E0E0E0'
const ACTIVE_SELECTION_BORDER_WIDTH_PX = 2
const RANGE_SELECTION_BORDER_WIDTH_PX = 1
const ACTIVE_EDITOR_BORDER_OFFSET_PX = -1

type StyleColorProperty =
  | 'backgroundColor'
  | 'borderBottomColor'
  | 'borderLeftColor'
  | 'borderRightColor'
  | 'borderTopColor'
  | 'caretColor'
  | 'outlineColor'

interface SheetCanvasHeaderPaintTheme {
  activeBorderColor: string
  gutterBorderColor: string
}

interface SelectionPatchSnapshot {
  height: number
  left: number | null
  top: number | null
  width: number
}

interface CanvasRect {
  height: number
  width: number
  x: number
  y: number
}

interface DatasetPixelLookup {
  element: HTMLElement
  key: keyof DOMStringMap
  offset: number
}

interface OutlinePatchOptions {
  expansion: number
  offset: number
}

interface PixelComparison {
  current: number
  expected: number | null
}

interface OptionalPixelComparison {
  current: number | null
  expected: number | null
}

interface PixelPair {
  left: number
  right: number
}

let sheetCanvasHeaderPaintPatchInstalled = false
let originalSheetCanvasFillRect: CanvasRenderingContext2D['fillRect'] | null = null

const sheetCanvasesWithHeaderPaint = new WeakMap<HTMLCanvasElement, SheetCanvasHeaderPaintTheme>()

const SELECTION_COLOR_REPLACEMENTS: Array<{
  property: StyleColorProperty
  source: string
  target: string
}> = [
  { property: 'borderTopColor', source: IRONCALC_SELECTION_ORANGE, target: SHEET_SELECTION_ACCENT },
  { property: 'borderRightColor', source: IRONCALC_SELECTION_ORANGE, target: SHEET_SELECTION_ACCENT },
  { property: 'borderBottomColor', source: IRONCALC_SELECTION_ORANGE, target: SHEET_SELECTION_ACCENT },
  { property: 'borderLeftColor', source: IRONCALC_SELECTION_ORANGE, target: SHEET_SELECTION_ACCENT },
  { property: 'backgroundColor', source: IRONCALC_SELECTION_ORANGE, target: SHEET_SELECTION_ACCENT },
  { property: 'backgroundColor', source: IRONCALC_SELECTION_ORANGE_LIGHT, target: SHEET_SELECTION_ACCENT_LIGHT },
  { property: 'caretColor', source: IRONCALC_SELECTION_ORANGE, target: SHEET_SELECTION_ACCENT },
  { property: 'outlineColor', source: IRONCALC_SELECTION_ORANGE, target: SHEET_SELECTION_ACCENT },
]

function parsePixelValue(value: unknown): number | null {
  if (typeof value !== 'string' || !value.endsWith('px')) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeCanvasColor(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/\s+/g, '') : ''
}

function nearlyEqual(pair: PixelPair): boolean {
  return Math.abs(pair.left - pair.right) < SHEET_CANVAS_COLOR_EPSILON
}

function resolveCanvasThemeColor(container: HTMLElement, variableName: string, fallback: string): string {
  const color = window.getComputedStyle(container).getPropertyValue(variableName).trim()
  return color === '' ? fallback : color
}

function sheetCanvasHeaderPaintTheme(container: HTMLElement): SheetCanvasHeaderPaintTheme {
  return {
    activeBorderColor: resolveCanvasThemeColor(container, '--accent-blue', SHEET_SELECTION_ACCENT_FALLBACK),
    gutterBorderColor: resolveCanvasThemeColor(container, '--border-default', SHEET_ROW_HEADER_BORDER_FALLBACK),
  }
}

function sheetCanvasHeaderPaintThemeForCanvas(canvas: HTMLCanvasElement): SheetCanvasHeaderPaintTheme | undefined {
  const cachedTheme = sheetCanvasesWithHeaderPaint.get(canvas)
  if (cachedTheme) return cachedTheme

  const container = canvas.closest<HTMLElement>('.sheet-editor--single-sheet')
  if (!container) return undefined

  const theme = sheetCanvasHeaderPaintTheme(container)
  sheetCanvasesWithHeaderPaint.set(canvas, theme)
  return theme
}

function isIronCalcHeaderCellFill(color: unknown): boolean {
  return IRONCALC_HEADER_CELL_FILL_COLORS.has(normalizeCanvasColor(color))
}

function isIronCalcSelectionOrange(color: unknown): boolean {
  const normalized = normalizeCanvasColor(color)
  return normalized === IRONCALC_SELECTION_ORANGE_HEX
    || normalized === normalizeCanvasColor(IRONCALC_SELECTION_ORANGE)
}

function isIronCalcRowHeaderInteriorRect(rect: CanvasRect): boolean {
  return nearlyEqual({ left: rect.x, right: 0.5 })
    && nearlyEqual({ left: rect.width, right: IRONCALC_ROW_HEADER_WIDTH_PX })
    && rect.y > IRONCALC_COLUMN_HEADER_HEIGHT_PX
    && rect.height > 0
}

function isIronCalcActiveRowHeaderBorderRect(rect: CanvasRect): boolean {
  return nearlyEqual({ left: rect.x, right: IRONCALC_ROW_HEADER_RIGHT_BORDER_X_PX })
    && nearlyEqual({ left: rect.width, right: 1 })
    && rect.y >= IRONCALC_COLUMN_HEADER_HEIGHT_PX
    && rect.height > 0
}

function paintRowHeaderGutterBorder(
  context: CanvasRenderingContext2D,
  theme: SheetCanvasHeaderPaintTheme,
  rect: CanvasRect,
): void {
  const originalFillRect = originalSheetCanvasFillRect
  if (!originalFillRect) return

  const previousFillStyle = context.fillStyle
  context.fillStyle = theme.gutterBorderColor
  originalFillRect.call(context, IRONCALC_ROW_HEADER_RIGHT_BORDER_X_PX, rect.y - 0.5, 1, rect.height + 1)
  context.fillStyle = previousFillStyle
}

function paintActiveRowHeaderBorder(
  context: CanvasRenderingContext2D,
  theme: SheetCanvasHeaderPaintTheme,
  rect: CanvasRect,
): void {
  const originalFillRect = originalSheetCanvasFillRect
  if (!originalFillRect) return

  const previousFillStyle = context.fillStyle
  context.fillStyle = theme.activeBorderColor
  originalFillRect.call(context, rect.x, rect.y, rect.width, rect.height)
  context.fillStyle = previousFillStyle
}

function patchedSheetCanvasFillRect(
  this: CanvasRenderingContext2D,
  ...rectValues: [number, number, number, number]
): void {
  const originalFillRect = originalSheetCanvasFillRect
  if (!originalFillRect) return
  const rect: CanvasRect = {
    height: rectValues[3],
    width: rectValues[2],
    x: rectValues[0],
    y: rectValues[1],
  }

  const theme = this.canvas instanceof HTMLCanvasElement
    ? sheetCanvasHeaderPaintThemeForCanvas(this.canvas)
    : undefined
  if (!theme) {
    originalFillRect.call(this, rect.x, rect.y, rect.width, rect.height)
    return
  }

  if (isIronCalcRowHeaderInteriorRect(rect) && isIronCalcHeaderCellFill(this.fillStyle)) {
    originalFillRect.call(this, rect.x, rect.y, rect.width, rect.height)
    paintRowHeaderGutterBorder(this, theme, rect)
    return
  }

  if (isIronCalcActiveRowHeaderBorderRect(rect) && isIronCalcSelectionOrange(this.fillStyle)) {
    paintActiveRowHeaderBorder(this, theme, rect)
    return
  }

  originalFillRect.call(this, rect.x, rect.y, rect.width, rect.height)
}

function ensureSheetCanvasHeaderPaintPatchInstalled(): void {
  if (sheetCanvasHeaderPaintPatchInstalled) return
  if (typeof CanvasRenderingContext2D === 'undefined') return

  originalSheetCanvasFillRect = CanvasRenderingContext2D.prototype.fillRect
  CanvasRenderingContext2D.prototype.fillRect = patchedSheetCanvasFillRect
  sheetCanvasHeaderPaintPatchInstalled = true
}

function registerSheetCanvasHeaderPaint(container: HTMLDivElement): void {
  ensureSheetCanvasHeaderPaintPatchInstalled()
  const theme = sheetCanvasHeaderPaintTheme(container)
  for (const canvas of container.querySelectorAll<HTMLCanvasElement>('.sheet-container canvas')) {
    sheetCanvasesWithHeaderPaint.set(canvas, theme)
  }
}

function normalizeSelectionOutline(element: HTMLElement): void {
  if (element.style.borderRadius !== '0px') element.style.borderRadius = '0px'
  if (element.style.boxShadow !== '') element.style.boxShadow = ''
}

function selectionPatchSnapshot(element: HTMLElement): SelectionPatchSnapshot | null {
  const width = parsePixelValue(element.style.width)
  const height = parsePixelValue(element.style.height)
  if (width === null || height === null) return null

  return {
    height,
    left: parsePixelValue(element.style.left),
    top: parsePixelValue(element.style.top),
    width,
  }
}

function previousPatchedPixel({ element, key, offset }: DatasetPixelLookup): number | null {
  const previousBase = parsePixelValue(element.dataset[key] ?? '')
  return previousBase === null ? null : previousBase + offset
}

function pixelsMatch(pair: PixelPair): boolean {
  return Math.abs(pair.left - pair.right) < 0.01
}

function requiredPixelMatches({ current, expected }: PixelComparison): boolean {
  return expected !== null && pixelsMatch({ left: current, right: expected })
}

function optionalPixelMatches({ current, expected }: OptionalPixelComparison): boolean {
  return current === null || expected === null || pixelsMatch({ left: current, right: expected })
}

function isAlreadyPatched(element: HTMLElement, snapshot: SelectionPatchSnapshot, options: OutlinePatchOptions): boolean {
  const previousPatchedWidth = previousPatchedPixel({ element, key: 'tolariaSelectionBaseWidth', offset: options.expansion })
  const previousPatchedHeight = previousPatchedPixel({ element, key: 'tolariaSelectionBaseHeight', offset: options.expansion })
  const previousPatchedLeft = previousPatchedPixel({ element, key: 'tolariaSelectionBaseLeft', offset: options.offset })
  const previousPatchedTop = previousPatchedPixel({ element, key: 'tolariaSelectionBaseTop', offset: options.offset })
  const requiredMatches = [
    requiredPixelMatches({ current: snapshot.width, expected: previousPatchedWidth }),
    requiredPixelMatches({ current: snapshot.height, expected: previousPatchedHeight }),
  ]
  const optionalMatches = [
    optionalPixelMatches({ current: snapshot.left, expected: previousPatchedLeft }),
    optionalPixelMatches({ current: snapshot.top, expected: previousPatchedTop }),
  ]
  return element.style.boxSizing === 'border-box'
    && requiredMatches.every(Boolean)
    && optionalMatches.every(Boolean)
}

function patchCellOutlineGeometry(element: HTMLElement, options: OutlinePatchOptions): void {
  const snapshot = selectionPatchSnapshot(element)
  if (!snapshot || isAlreadyPatched(element, snapshot, options)) return

  element.dataset.tolariaSelectionBaseWidth = `${snapshot.width}px`
  element.dataset.tolariaSelectionBaseHeight = `${snapshot.height}px`
  element.style.boxSizing = 'border-box'
  element.style.width = `${snapshot.width + options.expansion}px`
  element.style.height = `${snapshot.height + options.expansion}px`

  if (snapshot.left !== null) {
    element.dataset.tolariaSelectionBaseLeft = `${snapshot.left}px`
    element.style.left = `${snapshot.left + options.offset}px`
  }
  if (snapshot.top !== null) {
    element.dataset.tolariaSelectionBaseTop = `${snapshot.top}px`
    element.style.top = `${snapshot.top + options.offset}px`
  }
}

function patchSelectedCellOutlineGeometry(element: HTMLElement): void {
  patchCellOutlineGeometry(element, { expansion: ACTIVE_SELECTION_BORDER_WIDTH_PX * 2, offset: 0 })
}

function patchEditingCellOutlineGeometry(element: HTMLElement): void {
  patchCellOutlineGeometry(element, {
    expansion: ACTIVE_SELECTION_BORDER_WIDTH_PX * 3,
    offset: ACTIVE_EDITOR_BORDER_OFFSET_PX,
  })
}

function patchRangeSelectionOutlineGeometry(element: HTMLElement): void {
  patchCellOutlineGeometry(element, { expansion: RANGE_SELECTION_BORDER_WIDTH_PX * 2, offset: 0 })
}

function isSelectionTint(color: string): boolean {
  return color === IRONCALC_SELECTION_ORANGE || color === SHEET_SELECTION_ACCENT
}

function isSelectionFill(color: string): boolean {
  return color === IRONCALC_SELECTION_ORANGE_LIGHT || color === SHEET_SELECTION_ACCENT_LIGHT
}

function hasSelectionTintBorder(element: HTMLElement, style: CSSStyleDeclaration): boolean {
  return ['Top', 'Right', 'Bottom', 'Left'].every((side) => {
    const property = `border${side}Color` as StyleColorProperty
    return isSelectionTint(style[property]) || element.style[property] === SHEET_SELECTION_ACCENT
  })
}

function hasSelectionFill(element: HTMLElement, style: CSSStyleDeclaration): boolean {
  return isSelectionFill(style.backgroundColor) || element.style.backgroundColor === SHEET_SELECTION_ACCENT_LIGHT
}

function smallStyleSize(style: CSSStyleDeclaration): boolean {
  const width = parsePixelValue(style.width)
  const height = parsePixelValue(style.height)
  return width !== null && height !== null && width <= 6 && height <= 6
}

function isIronCalcEditingCellOutline(element: HTMLElement, style: CSSStyleDeclaration): boolean {
  return style.position === 'absolute'
    && style.visibility === 'visible'
    && hasSelectionTintBorder(element, style)
    && element.querySelector('textarea') !== null
}

function isIronCalcRangeSelectionOutline(element: HTMLElement, style: CSSStyleDeclaration): boolean {
  return style.position === 'absolute'
    && style.visibility !== 'hidden'
    && hasSelectionTintBorder(element, style)
    && hasSelectionFill(element, style)
    && selectionPatchSnapshot(element) !== null
}

function isIronCalcFillHandle(style: CSSStyleDeclaration): boolean {
  return (
    style.position === 'absolute'
    && style.cursor === 'crosshair'
    && smallStyleSize(style)
    && style.backgroundColor === IRONCALC_SELECTION_ORANGE
  )
}

function hideIronCalcFillHandle(element: HTMLElement): void {
  if (element.style.visibility !== 'hidden') element.style.visibility = 'hidden'
  if (element.style.pointerEvents !== 'none') element.style.pointerEvents = 'none'
}

function markSelectionChrome(element: HTMLElement): void {
  if (element.dataset.tolariaSelectionChrome !== 'true') element.dataset.tolariaSelectionChrome = 'true'
}

function replaceSelectionColor(element: HTMLElement, style: CSSStyleDeclaration): void {
  for (const replacement of SELECTION_COLOR_REPLACEMENTS) {
    if (style[replacement.property] === replacement.source && element.style[replacement.property] !== replacement.target) {
      element.style[replacement.property] = replacement.target
    }
  }
}

function shouldPatchSelectedCellOutline(element: HTMLElement, style: CSSStyleDeclaration): boolean {
  return element.style.background === 'none'
    && element.style.lineHeight !== ''
    && hasSelectionTintBorder(element, style)
}

function patchIronCalcSelectionElement(element: HTMLElement): void {
  const style = window.getComputedStyle(element)
  if (isIronCalcFillHandle(style)) {
    markSelectionChrome(element)
    hideIronCalcFillHandle(element)
    return
  }

  replaceSelectionColor(element, style)

  if (shouldPatchSelectedCellOutline(element, style)) {
    markSelectionChrome(element)
    normalizeSelectionOutline(element)
    patchSelectedCellOutlineGeometry(element)
  }
  if (isIronCalcRangeSelectionOutline(element, style)) {
    markSelectionChrome(element)
    normalizeSelectionOutline(element)
    patchRangeSelectionOutlineGeometry(element)
  }
  if (isIronCalcEditingCellOutline(element, style)) {
    markSelectionChrome(element)
    normalizeSelectionOutline(element)
    patchEditingCellOutlineGeometry(element)
  }
}

function patchIronCalcSelectionSubtree(root: HTMLElement): void {
  patchIronCalcSelectionElement(root)
  for (const element of root.querySelectorAll<HTMLElement>('*')) {
    patchIronCalcSelectionElement(element)
  }
}

export function patchIronCalcSelectionChrome(container: HTMLDivElement | null): void {
  if (!container) return
  registerSheetCanvasHeaderPaint(container)
  patchIronCalcSelectionSubtree(container.querySelector<HTMLElement>('.sheet-container') ?? container)
}

if (typeof window !== 'undefined') ensureSheetCanvasHeaderPaintPatchInstalled()
