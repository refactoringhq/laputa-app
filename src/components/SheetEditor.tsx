import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  ClipboardEvent as ReactClipboardEvent,
  FocusEvent as ReactFocusEvent,
  FormEvent as ReactFormEvent,
  MutableRefObject,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import ironCalcWasmUrl from '@ironcalc/wasm/wasm_bg.wasm?url'
import { init as initIronCalc, IronCalc, type Model } from '@ironcalc/workbook'
import { type Area as IronCalcArea, type CellStyle } from '@ironcalc/wasm'
import { getDocumentZoom } from '../extensions/zoomCursorFix'
import {
  getCachedNoteContentEntry,
  hasResolvedCachedContent,
  prefetchNoteContent,
  subscribeNoteContentResolved,
} from '../hooks/noteContentCache'
import { useSheetWikilinkNavigation } from '../hooks/useSheetWikilinkNavigation'
import { trackEvent } from '../lib/telemetry'
import { translate, type AppLocale } from '../lib/i18n'
import {
  trackSheetEditorOpened,
  trackSheetFormulaAutocompleteUsed,
} from '../lib/productAnalytics'
import { buildTypeEntryMap } from '../utils/typeColors'
import {
  attachClickHandlers,
  enrichSuggestionItems,
  hasMultipleSuggestionWorkspaces,
} from '../utils/suggestionEnrichment'
import {
  buildRawEditorBaseItems,
  extractWikilinkQuery,
  replaceActiveWikilinkQuery,
} from '../utils/rawEditorUtils'
import {
  serializeCsvRows,
} from '../utils/sheetCsv'
import {
  metadataCellAddress,
} from '../utils/sheetMetadata'
import {
  applyFormulaSuggestion,
  matchFormulaAutocomplete,
  type SheetFormulaSuggestion,
} from '../utils/sheetFormulaAutocomplete'
import { parseSheetMarkdownCell } from '../utils/sheetMarkdownCell'
import {
  isExternalFormulaInput,
  shiftExternalFormulaReferences,
} from '../utils/sheetExternalReferences'
import {
  canUseNativeSheetFormulaWorker,
  resolveExternalFormulaInputsWithNativeWorker,
  type SheetExternalFormulaInput,
  type SheetExternalFormulaWorkerDependency,
} from '../utils/sheetExternalFormulaWorker'
import {
  canSerializeSheetWorkbook,
  clearSheetWorkbookDirty,
  markSheetWorkbookDirty,
} from '../utils/sheetDirtyState'
import {
  applySheetWikilinkStyle,
  sheetWikilinkCanvasColor,
} from '../utils/sheetWikilinkModelBridge'
import {
  boundedSheetIndex,
  buildSheetContent,
  buildWorkbook,
  MAX_EXTERNAL_FORMULA_DEPTH,
  MAX_SHEET_COLUMNS,
  MAX_SHEET_ROWS,
  resolveExternalFormulaInput,
  resolveExternalSheetDependencyEntries,
  resolveExternalSheetEntriesForFormula,
  sheetExternalFormulaContext,
  sheetExternalFormulaWorkerSignature,
  sheetHasExternalFormulaReferences,
  SHEET_INDEX,
  summarizeSheetContent,
  type SheetBodyDirtyRows,
} from '../utils/sheetWorkbook'
import {
  elementCoordinateScale,
  localElementCoordinate,
  patchReactSheetPointerEvent,
  patchSheetPointerEventCoordinates,
  sheetCoordinateOrigin,
} from '../utils/sheetPointerCoordinates'
import { cancelFrame, cancelIdle, type IdleHandle, requestFrame, scheduleIdle } from '../utils/sheetBrowserScheduling'
import {
  applySheetStructureAction,
  sheetContextMenuSelectionState,
  type SheetContextMenuState,
  type SheetStructureAction,
} from '../utils/sheetContextMenuState'
import { sheetCellFromCanvasPoint } from '../utils/sheetPointerHitTest'
import { MIN_QUERY_LENGTH, preFilterWikilinks } from '../utils/wikilinkSuggestions'
import { notePathsMatch } from '../utils/notePathIdentity'
import { isSecondaryPointerButton } from '../utils/pointerButtons'
import { SheetContextMenu } from './SheetContextMenu'
import { WikilinkSuggestionMenu, type WikilinkSuggestionItem } from './WikilinkSuggestionMenu'
import type { VaultEntry } from '../types'
import './SheetEditor.css'

const SERIALIZE_DEBOUNCE_MS = 450
const SHEET_PASTE_CHUNK_SIZE = 100
const TOLARIA_SHEET_CLIPBOARD_MIME = 'application/x-tolaria-sheet-clipboard'
const TOLARIA_SHEET_CLIPBOARD_VERSION = 1
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
const EMPTY_VAULT_ENTRIES: VaultEntry[] = []

interface SheetEditorProps {
  content: string
  entries?: VaultEntry[]
  locale?: AppLocale
  path: string
  onContentChange: (path: string, content: string) => void
  onNavigateWikilink?: (target: string) => void
  flushContentRef?: MutableRefObject<((path: string) => void) | null>
  sourceEntry?: VaultEntry | null
  vaultPath?: string
}

interface WorkbookState {
  externalFormulaInputs: Map<string, SheetExternalFormulaInput>
  generation: number
  model: Model
  path: string
  refreshId: number
}

interface ScheduleSheetSerializeOptions {
  bodyRows?: Iterable<number> | 'all' | 'none'
  dirty?: boolean
}

interface FormulaAutocompleteState {
  suggestions: SheetFormulaSuggestion[]
  selectedIndex: number
  tokenStart: number
  tokenEnd: number
  left: number
  top: number
  width: number
}

interface SheetWikilinkAutocompleteState {
  items: WikilinkSuggestionItem[]
  selectedIndex: number
  left: number
  top: number
  width: number
}

interface NativeExternalFormulaResolutionState {
  inputs: Map<string, SheetExternalFormulaInput>
  signature: string
  status: 'pending' | 'resolved' | 'unavailable'
}

interface TolariaSheetClipboardPayload {
  action: 'copy' | 'cut'
  cells: string[][]
  source: {
    column: number
    height: number
    path: string
    row: number
    width: number
  }
  type: 'tolaria-sheet-clipboard'
  version: number
}

interface SheetCanvasHeaderPaintTheme {
  activeBorderColor: string
  gutterBorderColor: string
}

let ironCalcInitPromise: Promise<void> | null = null
let sheetCanvasHeaderPaintPatchInstalled = false
let originalSheetCanvasFillRect: CanvasRenderingContext2D['fillRect'] | null = null

const sheetCanvasesWithHeaderPaint = new WeakMap<HTMLCanvasElement, SheetCanvasHeaderPaintTheme>()

const MemoizedIronCalc = memo(IronCalc)

function parsePixelValue(value: string): number | null {
  if (!value.endsWith('px')) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeCanvasColor(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/\s+/g, '') : ''
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < SHEET_CANVAS_COLOR_EPSILON
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

function isIronCalcRowHeaderInteriorRect(x: number, y: number, width: number, height: number): boolean {
  return nearlyEqual(x, 0.5)
    && nearlyEqual(width, IRONCALC_ROW_HEADER_WIDTH_PX)
    && y > IRONCALC_COLUMN_HEADER_HEIGHT_PX
    && height > 0
}

function isIronCalcActiveRowHeaderBorderRect(x: number, y: number, width: number, height: number): boolean {
  return nearlyEqual(x, IRONCALC_ROW_HEADER_RIGHT_BORDER_X_PX)
    && nearlyEqual(width, 1)
    && y >= IRONCALC_COLUMN_HEADER_HEIGHT_PX
    && height > 0
}

function ensureSheetCanvasHeaderPaintPatchInstalled(): void {
  if (sheetCanvasHeaderPaintPatchInstalled) return
  if (typeof CanvasRenderingContext2D === 'undefined') return

  originalSheetCanvasFillRect = CanvasRenderingContext2D.prototype.fillRect
  CanvasRenderingContext2D.prototype.fillRect = function patchedSheetCanvasFillRect(
    this: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const originalFillRect = originalSheetCanvasFillRect
    if (!originalFillRect) return

    const theme = this.canvas instanceof HTMLCanvasElement
      ? sheetCanvasHeaderPaintThemeForCanvas(this.canvas)
      : undefined
    if (!theme) {
      originalFillRect.call(this, x, y, width, height)
      return
    }

    if (isIronCalcRowHeaderInteriorRect(x, y, width, height) && isIronCalcHeaderCellFill(this.fillStyle)) {
      originalFillRect.call(this, x, y, width, height)
      const previousFillStyle = this.fillStyle
      this.fillStyle = theme.gutterBorderColor
      originalFillRect.call(
        this,
        IRONCALC_ROW_HEADER_RIGHT_BORDER_X_PX,
        y - 0.5,
        1,
        height + 1,
      )
      this.fillStyle = previousFillStyle
      return
    }

    if (isIronCalcActiveRowHeaderBorderRect(x, y, width, height) && isIronCalcSelectionOrange(this.fillStyle)) {
      const previousFillStyle = this.fillStyle
      this.fillStyle = theme.activeBorderColor
      originalFillRect.call(this, x, y, width, height)
      this.fillStyle = previousFillStyle
      return
    }

    originalFillRect.call(this, x, y, width, height)
  }
  sheetCanvasHeaderPaintPatchInstalled = true
}

function registerSheetCanvasHeaderPaint(container: HTMLDivElement): void {
  ensureSheetCanvasHeaderPaintPatchInstalled()
  const theme = sheetCanvasHeaderPaintTheme(container)
  for (const canvas of container.querySelectorAll<HTMLCanvasElement>('.sheet-container canvas')) {
    sheetCanvasesWithHeaderPaint.set(canvas, theme)
  }
}

if (typeof window !== 'undefined') ensureSheetCanvasHeaderPaintPatchInstalled()

function ensureIronCalcReady(): Promise<void> {
  if (!ironCalcInitPromise) {
    ironCalcInitPromise = initIronCalc(ironCalcWasmUrl).then(() => undefined)
  }
  return ironCalcInitPromise
}

function normalizeSelectionOutline(element: HTMLElement): void {
  if (element.style.borderRadius !== '0px') element.style.borderRadius = '0px'
  if (element.style.boxShadow !== '') element.style.boxShadow = ''
}

function patchCellOutlineGeometry(element: HTMLElement, expansion: number, offset = 0): void {
  const currentWidth = parsePixelValue(element.style.width)
  const currentHeight = parsePixelValue(element.style.height)
  if (currentWidth === null || currentHeight === null) return

  const currentLeft = parsePixelValue(element.style.left)
  const currentTop = parsePixelValue(element.style.top)
  const previousBaseWidth = parsePixelValue(element.dataset.tolariaSelectionBaseWidth ?? '')
  const previousBaseHeight = parsePixelValue(element.dataset.tolariaSelectionBaseHeight ?? '')
  const previousBaseLeft = parsePixelValue(element.dataset.tolariaSelectionBaseLeft ?? '')
  const previousBaseTop = parsePixelValue(element.dataset.tolariaSelectionBaseTop ?? '')
  const previousPatchedWidth = previousBaseWidth === null ? null : previousBaseWidth + expansion
  const previousPatchedHeight = previousBaseHeight === null ? null : previousBaseHeight + expansion
  const previousPatchedLeft = previousBaseLeft === null ? null : previousBaseLeft + offset
  const previousPatchedTop = previousBaseTop === null ? null : previousBaseTop + offset
  const alreadyPatchedPosition = (currentLeft === null || previousPatchedLeft === null || Math.abs(currentLeft - previousPatchedLeft) < 0.01)
    && (currentTop === null || previousPatchedTop === null || Math.abs(currentTop - previousPatchedTop) < 0.01)

  if (
    previousPatchedWidth !== null
    && previousPatchedHeight !== null
    && Math.abs(currentWidth - previousPatchedWidth) < 0.01
    && Math.abs(currentHeight - previousPatchedHeight) < 0.01
    && alreadyPatchedPosition
    && element.style.boxSizing === 'border-box'
  ) {
    return
  }

  element.dataset.tolariaSelectionBaseWidth = `${currentWidth}px`
  element.dataset.tolariaSelectionBaseHeight = `${currentHeight}px`
  element.style.boxSizing = 'border-box'
  element.style.width = `${currentWidth + expansion}px`
  element.style.height = `${currentHeight + expansion}px`

  if (currentLeft !== null) {
    element.dataset.tolariaSelectionBaseLeft = `${currentLeft}px`
    element.style.left = `${currentLeft + offset}px`
  }
  if (currentTop !== null) {
    element.dataset.tolariaSelectionBaseTop = `${currentTop}px`
    element.style.top = `${currentTop + offset}px`
  }
}

function patchSelectedCellOutlineGeometry(element: HTMLElement): void {
  patchCellOutlineGeometry(element, ACTIVE_SELECTION_BORDER_WIDTH_PX * 2)
}

function patchEditingCellOutlineGeometry(element: HTMLElement): void {
  patchCellOutlineGeometry(element, ACTIVE_SELECTION_BORDER_WIDTH_PX * 3, ACTIVE_EDITOR_BORDER_OFFSET_PX)
}

function patchRangeSelectionOutlineGeometry(element: HTMLElement): void {
  patchCellOutlineGeometry(element, RANGE_SELECTION_BORDER_WIDTH_PX * 2)
}

function isIronCalcEditingCellOutline(element: HTMLElement, style: CSSStyleDeclaration): boolean {
  return style.position === 'absolute'
    && style.visibility === 'visible'
    && hasSelectionTintBorder(element, style)
    && element.querySelector('textarea') !== null
}

function isSelectionTint(color: string): boolean {
  return color === IRONCALC_SELECTION_ORANGE || color === SHEET_SELECTION_ACCENT
}

function isSelectionFill(color: string): boolean {
  return color === IRONCALC_SELECTION_ORANGE_LIGHT || color === SHEET_SELECTION_ACCENT_LIGHT
}

function hasSelectionTintBorder(element: HTMLElement, style: CSSStyleDeclaration): boolean {
  return (isSelectionTint(style.borderTopColor) || element.style.borderTopColor === SHEET_SELECTION_ACCENT)
    && (isSelectionTint(style.borderRightColor) || element.style.borderRightColor === SHEET_SELECTION_ACCENT)
    && (isSelectionTint(style.borderBottomColor) || element.style.borderBottomColor === SHEET_SELECTION_ACCENT)
    && (isSelectionTint(style.borderLeftColor) || element.style.borderLeftColor === SHEET_SELECTION_ACCENT)
}

function hasSelectionFill(element: HTMLElement, style: CSSStyleDeclaration): boolean {
  return isSelectionFill(style.backgroundColor) || element.style.backgroundColor === SHEET_SELECTION_ACCENT_LIGHT
}

function isIronCalcRangeSelectionOutline(element: HTMLElement, style: CSSStyleDeclaration): boolean {
  return style.position === 'absolute'
    && style.visibility !== 'hidden'
    && hasSelectionTintBorder(element, style)
    && hasSelectionFill(element, style)
    && parsePixelValue(element.style.width) !== null
    && parsePixelValue(element.style.height) !== null
}

function isIronCalcFillHandle(style: CSSStyleDeclaration): boolean {
  const width = parsePixelValue(style.width)
  const height = parsePixelValue(style.height)
  return (
    style.position === 'absolute'
    && style.cursor === 'crosshair'
    && width !== null
    && height !== null
    && width <= 6
    && height <= 6
    && style.backgroundColor === IRONCALC_SELECTION_ORANGE
  )
}

function hideIronCalcFillHandle(element: HTMLElement): void {
  if (element.style.visibility !== 'hidden') element.style.visibility = 'hidden'
  if (element.style.pointerEvents !== 'none') element.style.pointerEvents = 'none'
}

function sheetCellFromPointer(
  event: ReactPointerEvent<HTMLDivElement>,
  container: HTMLDivElement,
  model: Model,
): { column: number; row: number } | null {
  const view = model.getSelectedView()
  if (view.sheet !== SHEET_INDEX) return null

  const originElement = sheetCoordinateOrigin(container)
  const originRect = originElement.getBoundingClientRect()
  const zoom = getDocumentZoom()
  const scale = elementCoordinateScale(originElement, originRect, zoom)
  const x = localElementCoordinate(event.clientX, originRect, scale.x, 'x')
  const y = localElementCoordinate(event.clientY, originRect, scale.y, 'y')
  return sheetCellFromCanvasPoint(model, view.sheet, x, y)
}

function patchIronCalcSelectionElement(element: HTMLElement): void {
  const style = window.getComputedStyle(element)
  if (isIronCalcFillHandle(style)) {
    hideIronCalcFillHandle(element)
    return
  }

  if (style.borderTopColor === IRONCALC_SELECTION_ORANGE && element.style.borderTopColor !== SHEET_SELECTION_ACCENT) {
    element.style.borderTopColor = SHEET_SELECTION_ACCENT
  }
  if (style.borderRightColor === IRONCALC_SELECTION_ORANGE && element.style.borderRightColor !== SHEET_SELECTION_ACCENT) {
    element.style.borderRightColor = SHEET_SELECTION_ACCENT
  }
  if (style.borderBottomColor === IRONCALC_SELECTION_ORANGE && element.style.borderBottomColor !== SHEET_SELECTION_ACCENT) {
    element.style.borderBottomColor = SHEET_SELECTION_ACCENT
  }
  if (style.borderLeftColor === IRONCALC_SELECTION_ORANGE && element.style.borderLeftColor !== SHEET_SELECTION_ACCENT) {
    element.style.borderLeftColor = SHEET_SELECTION_ACCENT
  }
  if (style.backgroundColor === IRONCALC_SELECTION_ORANGE && element.style.backgroundColor !== SHEET_SELECTION_ACCENT) {
    element.style.backgroundColor = SHEET_SELECTION_ACCENT
  }
  if (style.backgroundColor === IRONCALC_SELECTION_ORANGE_LIGHT && element.style.backgroundColor !== SHEET_SELECTION_ACCENT_LIGHT) {
    element.style.backgroundColor = SHEET_SELECTION_ACCENT_LIGHT
  }
  if (style.caretColor === IRONCALC_SELECTION_ORANGE && element.style.caretColor !== SHEET_SELECTION_ACCENT) {
    element.style.caretColor = SHEET_SELECTION_ACCENT
  }
  if (style.outlineColor === IRONCALC_SELECTION_ORANGE && element.style.outlineColor !== SHEET_SELECTION_ACCENT) {
    element.style.outlineColor = SHEET_SELECTION_ACCENT
  }

  if (
    element.style.background === 'none'
    && element.style.lineHeight !== ''
    && hasSelectionTintBorder(element, style)
  ) {
    normalizeSelectionOutline(element)
    patchSelectedCellOutlineGeometry(element)
  }
  if (isIronCalcRangeSelectionOutline(element, style)) {
    normalizeSelectionOutline(element)
    patchRangeSelectionOutlineGeometry(element)
  }
  if (isIronCalcEditingCellOutline(element, style)) {
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

function patchIronCalcSelectionChrome(container: HTMLDivElement | null): void {
  if (!container) return
  registerSheetCanvasHeaderPaint(container)
  patchIronCalcSelectionSubtree(container.querySelector<HTMLElement>('.sheet-container') ?? container)
}

function selectedRangeArea(model: Model): IronCalcArea {
  const {
    sheet,
    range: [startRow, startColumn, endRow, endColumn],
  } = model.getSelectedView()
  const row = Math.min(startRow, endRow)
  const column = Math.min(startColumn, endColumn)

  return {
    sheet,
    row,
    column,
    width: Math.abs(endColumn - startColumn) + 1,
    height: Math.abs(endRow - startRow) + 1,
  }
}

function dirtyRowsForArea(area: IronCalcArea): Set<number> {
  const rows = new Set<number>()
  if (area.sheet !== SHEET_INDEX) return rows
  for (let row = area.row; row < area.row + area.height; row += 1) {
    if (row >= 1 && row <= MAX_SHEET_ROWS) rows.add(row)
  }
  return rows
}

function dirtyRowsForSelectedRange(model: Model): Set<number> {
  return dirtyRowsForArea(selectedRangeArea(model))
}

function mergeDirtyBodyRows(current: SheetBodyDirtyRows, update: ScheduleSheetSerializeOptions['bodyRows']): SheetBodyDirtyRows {
  if (update === 'none') return current
  if (update === undefined || update === 'all' || current === 'all') return 'all'

  const next = current instanceof Set ? new Set(current) : new Set<number>()
  for (const row of update) {
    if (row >= 1 && row <= MAX_SHEET_ROWS) next.add(row)
  }
  return next.size === 0 ? current : next
}

function selectedRangeHasExternalFormulas(
  model: Model,
  area: IronCalcArea,
  externalFormulaInputs: Map<string, SheetExternalFormulaInput>,
): boolean {
  if (area.sheet !== SHEET_INDEX) return false

  for (let rowOffset = 0; rowOffset < area.height; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < area.width; columnOffset += 1) {
      const row = area.row + rowOffset
      const column = area.column + columnOffset
      const content = model.getCellContent(SHEET_INDEX, row, column)
      if (externalFormulaInputs.has(metadataCellAddress(row, column)) || isExternalFormulaInput(content)) return true
    }
  }

  return false
}

function buildTolariaSheetClipboardPayload(
  current: WorkbookState,
  path: string,
  action: TolariaSheetClipboardPayload['action'],
): TolariaSheetClipboardPayload | null {
  const area = selectedRangeArea(current.model)
  if (!selectedRangeHasExternalFormulas(current.model, area, current.externalFormulaInputs)) return null

  const cells: string[][] = []
  for (let rowOffset = 0; rowOffset < area.height; rowOffset += 1) {
    const row: string[] = []
    for (let columnOffset = 0; columnOffset < area.width; columnOffset += 1) {
      row.push(parseSheetMarkdownCell(current.model.getCellContent(
        SHEET_INDEX,
        area.row + rowOffset,
        area.column + columnOffset,
      )).value)
    }
    cells.push(row)
  }

  return {
    action,
    cells,
    source: {
      column: area.column,
      height: area.height,
      path,
      row: area.row,
      width: area.width,
    },
    type: 'tolaria-sheet-clipboard',
    version: TOLARIA_SHEET_CLIPBOARD_VERSION,
  }
}

function parseTolariaSheetClipboardPayload(value: string): TolariaSheetClipboardPayload | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(value) as Partial<TolariaSheetClipboardPayload>
    if (
      parsed.type !== 'tolaria-sheet-clipboard'
      || parsed.version !== TOLARIA_SHEET_CLIPBOARD_VERSION
      || (parsed.action !== 'copy' && parsed.action !== 'cut')
      || !Array.isArray(parsed.cells)
      || !parsed.source
      || typeof parsed.source.row !== 'number'
      || typeof parsed.source.column !== 'number'
      || typeof parsed.source.path !== 'string'
    ) {
      return null
    }
    return parsed as TolariaSheetClipboardPayload
  } catch {
    return null
  }
}

function writeTolariaSheetClipboard(dataTransfer: DataTransfer, payload: TolariaSheetClipboardPayload): void {
  const text = serializeCsvRows(payload.cells)
  dataTransfer.setData(TOLARIA_SHEET_CLIPBOARD_MIME, JSON.stringify(payload))
  dataTransfer.setData('text/plain', text)
  dataTransfer.setData('text/csv', text)
}

function wikilinkSuggestionKey(item: WikilinkSuggestionItem): string {
  return item.path ?? `${item.title}\n${item.noteType ?? ''}`
}

function nextWikilinkAutocompleteState(
  previous: SheetWikilinkAutocompleteState | null,
  next: SheetWikilinkAutocompleteState,
): SheetWikilinkAutocompleteState {
  if (!previous) return next
  const previousSelected = previous.items[previous.selectedIndex]
  const previousSelectedKey = previousSelected ? wikilinkSuggestionKey(previousSelected) : null
  const matchingIndex = previousSelectedKey === null
    ? -1
    : next.items.findIndex((item) => wikilinkSuggestionKey(item) === previousSelectedKey)
  return {
    ...next,
    selectedIndex: matchingIndex >= 0
      ? matchingIndex
      : Math.min(previous.selectedIndex, Math.max(next.items.length - 1, 0)),
  }
}

function nextFormulaAutocompleteState(
  previous: FormulaAutocompleteState | null,
  next: FormulaAutocompleteState,
): FormulaAutocompleteState {
  if (!previous) return next
  const previousSelected = previous.suggestions[previous.selectedIndex]
  const matchingIndex = previousSelected
    ? next.suggestions.findIndex((suggestion) => suggestion.name === previousSelected.name)
    : -1
  return {
    ...next,
    selectedIndex: matchingIndex >= 0
      ? matchingIndex
      : Math.min(previous.selectedIndex, Math.max(next.suggestions.length - 1, 0)),
  }
}

function shiftedClipboardCellInput(
  input: string,
  payload: TolariaSheetClipboardPayload,
  rowOffset: number,
  columnOffset: number,
  destinationRow: number,
  destinationColumn: number,
): string {
  if (payload.action === 'cut') return input

  const sourceRow = payload.source.row + rowOffset
  const sourceColumn = payload.source.column + columnOffset
  return shiftExternalFormulaReferences(input, destinationRow - sourceRow, destinationColumn - sourceColumn)
}

function rangesIntersect(left: IronCalcArea, right: IronCalcArea): boolean {
  const leftEndRow = left.row + left.height - 1
  const leftEndColumn = left.column + left.width - 1
  const rightEndRow = right.row + right.height - 1
  const rightEndColumn = right.column + right.width - 1
  return left.sheet === right.sheet
    && left.row <= rightEndRow
    && leftEndRow >= right.row
    && left.column <= rightEndColumn
    && leftEndColumn >= right.column
}

function selectedCellIndexes(model: Model): { column: number; row: number; sheet: number } | null {
  const { column, row, sheet } = model.getSelectedView()
  const boundedRow = boundedSheetIndex(row, MAX_SHEET_ROWS)
  const boundedColumn = boundedSheetIndex(column, MAX_SHEET_COLUMNS)
  if (sheet !== SHEET_INDEX || boundedRow === 0 || boundedColumn === 0) return null
  return { column: boundedColumn, row: boundedRow, sheet }
}

function clearSelectedRangeContents(model: Model): void {
  const area = selectedRangeArea(model)
  model.rangeClearContents(
    area.sheet,
    area.row,
    area.column,
    area.row + area.height - 1,
    area.column + area.width - 1,
  )
}

function selectedCellStyle(model: Model): CellStyle {
  const { sheet, row, column } = model.getSelectedView()
  return model.getCellStyle(sheet, row, column)
}

function increaseDecimalPlaces(format: string): string {
  if (format === 'general') return '#,##0.000'
  const expanded = format.replace(/\.0/g, '.00')
  if (expanded.includes('.')) return expanded
  if (expanded.includes('0')) return expanded.replace(/0/g, '0.0')
  if (expanded.includes('#')) return expanded.replace(/#([^#,]|$)/g, '0.0$1')
  return expanded
}

function decreaseDecimalPlaces(format: string): string {
  if (format === 'general') return '#,##0.0'
  return format.replace(/\.0/g, '.').replace(/0\.([^0]|$)/, '0$1')
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return true
  return target.closest('input, textarea, [contenteditable="true"]') !== null
}

function sheetHasEditableFocus(container: HTMLDivElement | null): boolean {
  const activeElement = document.activeElement
  return activeElement instanceof HTMLElement
    && container?.contains(activeElement) === true
    && isEditableTarget(activeElement)
}

function isSheetCommandTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.closest('button, a[href], [role="button"], [role="menuitem"], [role="option"], [data-radix-collection-item]') !== null
}

function isPlainEnterKey(event: ReactKeyboardEvent<HTMLDivElement>): boolean {
  return (
    (event.key === 'Enter' || event.key === 'Return')
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey
    && !event.shiftKey
  )
}

function isPlainCellClearKey(event: ReactKeyboardEvent<HTMLDivElement>): boolean {
  return (
    (event.key === 'Backspace' || event.key === 'Delete')
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey
    && !event.shiftKey
  )
}

function isSpreadsheetKey(event: ReactKeyboardEvent<HTMLDivElement>): boolean {
  if ((event.metaKey || event.ctrlKey) && ['c', 'v', 'x', 'z', 'y', 'b', 'i', 'u'].includes(event.key.toLowerCase())) {
    return true
  }
  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) return true
  return [
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'Backspace',
    'Delete',
    'End',
    'Enter',
    'F2',
    'Home',
    'PageDown',
    'PageUp',
    'Return',
    'Tab',
  ].includes(event.key)
}

function workbookKeyboardRoot(container: HTMLDivElement | null): HTMLElement | null {
  const sheetSurface = container?.querySelector<HTMLElement>('.sheet-container') ?? null
  const root = sheetSurface?.closest<HTMLElement>('[tabindex="0"]') ?? null
  return root && container?.contains(root) ? root : (container?.querySelector<HTMLElement>('[tabindex="0"]') ?? null)
}

function isWorkbookKeyboardTarget(container: HTMLDivElement | null, target: EventTarget | null): boolean {
  const root = workbookKeyboardRoot(container)
  return !!root && target instanceof Node && (target === root || root.contains(target))
}

function focusWorkbookRoot(container: HTMLDivElement | null): HTMLElement | null {
  const workbookRoot = workbookKeyboardRoot(container)
  workbookRoot?.focus()
  return workbookRoot
}

function startCellEdit(container: HTMLDivElement | null): void {
  const workbookRoot = focusWorkbookRoot(container)
  workbookRoot?.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code: 'F2',
    key: 'F2',
  }))
}

function formulaInputFromTarget(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target
  return null
}

function visibleFormulaInput(container: HTMLDivElement | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (!container) return null

  const inputs = Array.from(container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
  return inputs.find((input): input is HTMLInputElement | HTMLTextAreaElement => {
    const rect = input.getBoundingClientRect()
    return rect.width > 0
      && rect.height > 0
      && input.value.trimStart().startsWith('=')
  }) ?? null
}

function visibleSheetTextInput(container: HTMLDivElement | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (!container) return null

  const activeElement = document.activeElement
  if (
    (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement)
    && container.contains(activeElement)
  ) {
    return activeElement
  }

  const inputs = Array.from(container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
  return inputs.find((input): input is HTMLInputElement | HTMLTextAreaElement => {
    const rect = input.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }) ?? null
}

function isInsideFormulaStringLiteral(value: string, cursor: number): boolean {
  if (!value.trimStart().startsWith('=')) return false

  let insideString = false
  for (let index = 0; index < cursor; index += 1) {
    if (value[index] !== '"') continue
    if (insideString && value[index + 1] === '"') {
      index += 1
      continue
    }
    insideString = !insideString
  }
  return insideString
}

function isActiveWikilinkQueryInsideFormulaString(value: string, cursor: number): boolean {
  if (!value.trimStart().startsWith('=')) return false
  const activeQueryStart = value.slice(0, cursor).lastIndexOf('[[')
  return activeQueryStart >= 0 && isInsideFormulaStringLiteral(value, activeQueryStart)
}

function formulaAutocompletePosition(
  input: HTMLInputElement | HTMLTextAreaElement,
  container: HTMLDivElement,
  cursor: number,
): Pick<FormulaAutocompleteState, 'left' | 'top' | 'width'> {
  const inputRect = input.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  const inputStyle = window.getComputedStyle(input)
  const paddingLeft = Number.parseFloat(inputStyle.paddingLeft) || 0
  const font = [
    inputStyle.fontStyle,
    inputStyle.fontVariant,
    inputStyle.fontWeight,
    inputStyle.fontSize,
    inputStyle.fontFamily,
  ].join(' ')
  const measuredCursorOffset = measureFormulaTextWidth(input.value.slice(0, cursor), font) - input.scrollLeft
  const clampedCursorOffset = Math.max(0, Math.min(measuredCursorOffset, inputRect.width - paddingLeft - 24))
  const width = Math.max(240, Math.min(inputRect.width, 360))
  const rawLeft = inputRect.left - containerRect.left + paddingLeft + clampedCursorOffset

  return {
    left: Math.max(8, Math.min(rawLeft, containerRect.width - width - 8)),
    top: Math.max(8, inputRect.bottom - containerRect.top + 4),
    width,
  }
}

function measureFormulaTextWidth(text: string, font: string): number {
  const measurer = document.createElement('span')
  measurer.textContent = text
  measurer.style.contain = 'layout style paint'
  measurer.style.font = font
  measurer.style.position = 'absolute'
  measurer.style.visibility = 'hidden'
  measurer.style.whiteSpace = 'pre'
  document.body.append(measurer)
  const width = measurer.getBoundingClientRect().width
  measurer.remove()
  return width
}

function dispatchSheetInput(input: HTMLInputElement | HTMLTextAreaElement, data: string): void {
  const event = typeof InputEvent === 'function'
    ? new InputEvent('input', {
      bubbles: true,
      data,
      inputType: 'insertReplacementText',
    })
    : new Event('input', { bubbles: true })

  input.dispatchEvent(event)
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function dispatchFormulaInput(input: HTMLInputElement | HTMLTextAreaElement, suggestion: SheetFormulaSuggestion): void {
  dispatchSheetInput(input, suggestion.name)
}

function setFormulaInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const valueDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
  if (valueDescriptor?.set) {
    valueDescriptor.set.call(input, value)
    return
  }
  input.value = value
}

function shouldScheduleSerializeForKey(event: ReactKeyboardEvent<HTMLDivElement>): boolean {
  if (event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter') return true
  if ((event.metaKey || event.ctrlKey) && ['b', 'i', 'u', 'v', 'x', 'y', 'z'].includes(event.key.toLowerCase())) {
    return true
  }
  return event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey
}

function sheetWikilinkCandidates(
  baseItems: ReturnType<typeof buildRawEditorBaseItems>,
  query: string,
) {
  return query.length >= MIN_QUERY_LENGTH ? preFilterWikilinks(baseItems, query) : baseItems
}

function sheetWikilinkAutocompleteItems({
  baseItems,
  insertWikilink,
  query,
  sourceEntry,
  typeEntryMap,
  vaultPath,
}: {
  baseItems: ReturnType<typeof buildRawEditorBaseItems>
  insertWikilink: (target: string) => void
  query: string
  sourceEntry?: VaultEntry
  typeEntryMap: Record<string, VaultEntry>
  vaultPath: string
}): WikilinkSuggestionItem[] {
  const candidates = sheetWikilinkCandidates(baseItems, query)
  const withHandlers = attachClickHandlers(candidates, insertWikilink, vaultPath, sourceEntry)
  return enrichSuggestionItems(withHandlers, query, typeEntryMap, {
    showWorkspace: hasMultipleSuggestionWorkspaces(baseItems),
  })
}

export function SheetEditor({
  content,
  entries = EMPTY_VAULT_ENTRIES,
  locale = 'en',
  path,
  onContentChange,
  onNavigateWikilink,
  flushContentRef,
  sourceEntry = null,
  vaultPath = '',
}: SheetEditorProps) {
  const [workbook, setWorkbook] = useState<WorkbookState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formulaAutocomplete, setFormulaAutocomplete] = useState<FormulaAutocompleteState | null>(null)
  const [wikilinkAutocomplete, setWikilinkAutocomplete] = useState<SheetWikilinkAutocompleteState | null>(null)
  const [sheetContextMenu, setSheetContextMenu] = useState<SheetContextMenuState | null>(null)
  const [nativeExternalFormulaResolution, setNativeExternalFormulaResolution] = useState<NativeExternalFormulaResolutionState | null>(null)
  const latestContentRef = useRef(content)
  const lastEmittedPathRef = useRef<string | null>(null)
  const lastEmittedContentRef = useRef<string | null>(null)
  const onContentChangeRef = useRef(onContentChange)
  const trackedOpenPathRef = useRef<string | null>(null)
  const workbookPathRef = useRef(path)
  const latestContentPathRef = useRef(path)
  const workbookGenerationRef = useRef(0)
  const workbookRef = useRef<WorkbookState | null>(null)
  const formulaInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const wikilinkInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const pendingExternalFormulaCommitRef = useRef(0)
  const pasteJobRef = useRef(0)
  const pasteIdleRef = useRef<IdleHandle | null>(null)
  const sheetPointerActiveRef = useRef(false)
  const sheetKeyboardCapturedRef = useRef(false)
  const sheetFocusRequestRef = useRef(0)
  const refreshSequenceRef = useRef(0)
  const sheetElementRef = useRef<HTMLDivElement | null>(null)
  const idleSerializeRef = useRef<IdleHandle | null>(null)
  const serializeTimerRef = useRef<number | null>(null)
  const dirtyWorkbookGenerationRef = useRef<number | null>(null)
  const dirtyBodyRowsRef = useRef<SheetBodyDirtyRows>(null)
  const selectionPatchFrameRef = useRef<number | null>(null)
  const zoomRefreshFrameRef = useRef<number | null>(null)
  const typeEntryMap = useMemo(() => buildTypeEntryMap(entries), [entries])
  const wikilinkBaseItems = useMemo(() => buildRawEditorBaseItems(entries), [entries])

  useEffect(() => {
    onContentChangeRef.current = onContentChange
  }, [onContentChange])

  const cancelScheduledSerialize = useCallback(() => {
    if (serializeTimerRef.current !== null) {
      window.clearTimeout(serializeTimerRef.current)
      serializeTimerRef.current = null
    }
    if (idleSerializeRef.current !== null) {
      cancelIdle(idleSerializeRef.current)
      idleSerializeRef.current = null
    }
  }, [])

  const serializeCurrentWorkbook = useCallback((expectedGeneration?: number) => {
    const current = workbookRef.current
    if (!current || !canSerializeSheetWorkbook({
      current,
      dirtyGeneration: dirtyWorkbookGenerationRef.current,
      expectedGeneration,
      latestContentPath: latestContentPathRef.current,
      pathsMatch: notePathsMatch,
      workbookPath: workbookPathRef.current,
    })) return false

    const sourceContent = latestContentRef.current
    const sourcePath = current.path
    const nextContent = buildSheetContent(sourceContent, current.model, current.externalFormulaInputs, {
      bodyRows: dirtyBodyRowsRef.current,
    })
    if (nextContent === sourceContent) {
      clearSheetWorkbookDirty(dirtyWorkbookGenerationRef)
      dirtyBodyRowsRef.current = null
      return false
    }
    if (nextContent === lastEmittedContentRef.current && sourcePath === lastEmittedPathRef.current) {
      clearSheetWorkbookDirty(dirtyWorkbookGenerationRef)
      dirtyBodyRowsRef.current = null
      return false
    }

    lastEmittedPathRef.current = sourcePath
    lastEmittedContentRef.current = nextContent
    latestContentRef.current = nextContent
    latestContentPathRef.current = sourcePath
    clearSheetWorkbookDirty(dirtyWorkbookGenerationRef)
    dirtyBodyRowsRef.current = null
    onContentChangeRef.current(sourcePath, nextContent)
    return true
  }, [])

  const [externalSheetContents, setExternalSheetContents] = useState<Record<string, string>>({})
  const externalSheetContentsMap = useMemo(
    () => new Map(Object.entries(externalSheetContents)),
    [externalSheetContents],
  )
  const externalSheetEntries = useMemo(
    () => resolveExternalSheetDependencyEntries({
      content,
      contentsByPath: externalSheetContentsMap,
      currentPath: path,
      entries,
      sourceEntry,
    }),
    [content, entries, externalSheetContentsMap, path, sourceEntry],
  )
  const externalSheetPaths = useMemo(
    () => externalSheetEntries.map((entry) => entry.path).sort(),
    [externalSheetEntries],
  )
  const externalSheetPathKey = externalSheetPaths.join('\n')
  const externalSheetDependencyContents = useMemo<SheetExternalFormulaWorkerDependency[]>(
    () => externalSheetEntries.flatMap((entry) => {
      const dependencyContent = externalSheetContentsMap.get(entry.path)
      return dependencyContent === undefined ? [] : [{ content: dependencyContent, entry }]
    }),
    [externalSheetContentsMap, externalSheetEntries],
  )
  const hasExternalFormulaReferences = useMemo(
    () => sheetHasExternalFormulaReferences(content),
    [content],
  )
  const nativeExternalFormulaSignature = useMemo(
    () => sheetExternalFormulaWorkerSignature({
      content,
      dependencies: externalSheetDependencyContents,
      path,
    }),
    [content, externalSheetDependencyContents, path],
  )

  useEffect(() => {
    const dependencyPaths = new Set(externalSheetPathKey === '' ? [] : externalSheetPathKey.split('\n'))
    const cachedContents: Record<string, string> = {}

    for (const entry of externalSheetEntries) {
      const cached = getCachedNoteContentEntry(entry.path)
      if (hasResolvedCachedContent(cached)) {
        cachedContents[entry.path] = cached.value
      } else {
        prefetchNoteContent(entry, { parsedBlockPreload: false })
      }
    }

    setExternalSheetContents((current) => {
      const next: Record<string, string> = {}
      for (const path of dependencyPaths) {
        if (cachedContents[path] !== undefined) {
          next[path] = cachedContents[path]
        } else if (current[path] !== undefined) {
          next[path] = current[path]
        }
      }
      if (Object.keys(next).length === Object.keys(current).length
        && Object.keys(next).every((path) => current[path] === next[path])) {
        return current
      }
      return next
    })

    return subscribeNoteContentResolved((event) => {
      if (!dependencyPaths.has(event.path)) return
      setExternalSheetContents((current) => (
        current[event.path] === event.content
          ? current
          : { ...current, [event.path]: event.content }
      ))
    })
  }, [externalSheetEntries, externalSheetPathKey])

  useEffect(() => {
    if (!hasExternalFormulaReferences || !canUseNativeSheetFormulaWorker()) {
      setNativeExternalFormulaResolution((current) => (
        current?.signature === nativeExternalFormulaSignature ? null : current
      ))
      return undefined
    }

    let cancelled = false
    const signature = nativeExternalFormulaSignature
    setNativeExternalFormulaResolution((current) => (
      current?.signature === signature && current.status === 'pending'
        ? current
        : { inputs: current?.signature === signature ? current.inputs : new Map(), signature, status: 'pending' }
    ))

    void resolveExternalFormulaInputsWithNativeWorker({
      content,
      currentPath: path,
      dependencies: externalSheetDependencyContents,
      entries,
      maxDepth: MAX_EXTERNAL_FORMULA_DEPTH,
      sourceEntry,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    }).then((inputs) => {
      if (cancelled) return
      setNativeExternalFormulaResolution({
        inputs: inputs ?? new Map(),
        signature,
        status: inputs ? 'resolved' : 'unavailable',
      })
    })

    return () => {
      cancelled = true
    }
  }, [
    content,
    entries,
    externalSheetDependencyContents,
    hasExternalFormulaReferences,
    nativeExternalFormulaSignature,
    path,
    sourceEntry,
  ])

  const externalFormulaContext = useMemo(() => sheetExternalFormulaContext({
    contentsByPath: externalSheetContentsMap,
    currentPath: path,
    entries,
    sourceEntry,
  }), [entries, externalSheetContentsMap, path, sourceEntry])
  const nativeExternalFormulaInputsForBuild = nativeExternalFormulaResolution?.signature === nativeExternalFormulaSignature
    && nativeExternalFormulaResolution.status === 'resolved'
    ? nativeExternalFormulaResolution.inputs
    : null
  const shouldUseJsExternalFormulaResolver = !hasExternalFormulaReferences
    || !canUseNativeSheetFormulaWorker()
    || (
      nativeExternalFormulaResolution?.signature === nativeExternalFormulaSignature
      && nativeExternalFormulaResolution.status === 'unavailable'
    )
  const externalFormulaContextForBuild = shouldUseJsExternalFormulaResolver ? externalFormulaContext : undefined

  const buildLiveExternalFormulaContext = useCallback((formula: string) => {
    const contentsByPath = new Map(externalSheetContentsMap)
    const pendingLoads: Promise<unknown>[] = []
    for (const entry of resolveExternalSheetEntriesForFormula(formula, entries, sourceEntry, path)) {
      const cached = getCachedNoteContentEntry(entry.path)
      if (hasResolvedCachedContent(cached)) {
        contentsByPath.set(entry.path, cached.value)
        continue
      }

      prefetchNoteContent(entry, { parsedBlockPreload: false })
      const pending = getCachedNoteContentEntry(entry.path)
      if (pending) pendingLoads.push(pending.promise.catch(() => undefined))
    }

    return {
      context: sheetExternalFormulaContext({
        contentsByPath,
        currentPath: path,
        entries,
        sourceEntry,
      }),
      pendingLoads,
    }
  }, [entries, externalSheetContentsMap, path, sourceEntry])

  useEffect(() => {
    cancelScheduledSerialize()
    serializeCurrentWorkbook()
    pendingExternalFormulaCommitRef.current += 1
    latestContentRef.current = content
    latestContentPathRef.current = path
    workbookPathRef.current = path
    clearSheetWorkbookDirty(dirtyWorkbookGenerationRef)
    dirtyBodyRowsRef.current = null
    if (content === lastEmittedContentRef.current && path === lastEmittedPathRef.current) return

    let cancelled = false
    let pendingModel: Model | null = null
    const generation = workbookGenerationRef.current + 1
    workbookGenerationRef.current = generation

    ensureIronCalcReady()
      .then(() => {
        if (cancelled || workbookGenerationRef.current !== generation) return

        setError(null)
        const build = buildWorkbook(
          content,
          path,
          externalFormulaContextForBuild,
          nativeExternalFormulaInputsForBuild,
        )
        pendingModel = build.model
        if (trackedOpenPathRef.current !== path) {
          trackSheetEditorOpened(summarizeSheetContent(content))
          trackedOpenPathRef.current = path
        }
        const nextWorkbook = {
          externalFormulaInputs: build.externalFormulaInputs,
          generation,
          model: pendingModel,
          path,
          refreshId: Date.now(),
        }
        pendingModel = null

        workbookRef.current?.model.free()
        workbookRef.current = nextWorkbook
        clearSheetWorkbookDirty(dirtyWorkbookGenerationRef)
        dirtyBodyRowsRef.current = null
        setWorkbook(nextWorkbook)
      })
      .catch((caught: unknown) => {
        if (!cancelled && workbookGenerationRef.current === generation) {
          const message = caught instanceof Error ? caught.message : String(caught)
          setError(message)
        }
      })

    return () => {
      cancelled = true
      pendingModel?.free()
    }
  }, [
    cancelScheduledSerialize,
    content,
    externalFormulaContextForBuild,
    nativeExternalFormulaInputsForBuild,
    path,
    serializeCurrentWorkbook,
  ])

  useEffect(() => () => {
    pasteJobRef.current += 1
    pendingExternalFormulaCommitRef.current += 1
    if (pasteIdleRef.current !== null) {
      cancelIdle(pasteIdleRef.current)
      pasteIdleRef.current = null
    }
    serializeCurrentWorkbook(workbookRef.current?.generation)
    cancelScheduledSerialize()
    if (selectionPatchFrameRef.current !== null) {
      cancelFrame(selectionPatchFrameRef.current)
      selectionPatchFrameRef.current = null
    }
    workbookRef.current?.model.free()
    workbookRef.current = null
    clearSheetWorkbookDirty(dirtyWorkbookGenerationRef)
    dirtyBodyRowsRef.current = null
    workbookGenerationRef.current += 1
  }, [cancelScheduledSerialize, serializeCurrentWorkbook])

  const scheduleSelectionChromePatch = useCallback(() => {
    if (selectionPatchFrameRef.current !== null) return
    selectionPatchFrameRef.current = requestFrame(() => {
      selectionPatchFrameRef.current = null
      patchIronCalcSelectionChrome(sheetElementRef.current)
    })
  }, [])

  useEffect(() => {
    if (workbook) scheduleSelectionChromePatch()
  }, [scheduleSelectionChromePatch, workbook])

  useEffect(() => {
    const container = sheetElementRef.current
    if (!container || !workbook) return undefined

    const observer = new MutationObserver((mutations) => {
      if (mutations.length > 0) scheduleSelectionChromePatch()
    })

    patchIronCalcSelectionChrome(container)
    observer.observe(container, {
      attributeFilter: ['class', 'style'],
      attributes: true,
      childList: true,
      subtree: true,
    })

    return () => observer.disconnect()
  }, [scheduleSelectionChromePatch, workbook])

  const scheduleSerialize = useCallback((options: ScheduleSheetSerializeOptions = {}) => {
    const shouldMarkDirty = options.dirty !== false
    markSheetWorkbookDirty(dirtyWorkbookGenerationRef, workbookRef.current, shouldMarkDirty)
    if (shouldMarkDirty) dirtyBodyRowsRef.current = mergeDirtyBodyRows(dirtyBodyRowsRef.current, options.bodyRows)
    cancelScheduledSerialize()
    const generation = workbookRef.current?.generation
    serializeTimerRef.current = window.setTimeout(() => {
      serializeTimerRef.current = null
      idleSerializeRef.current = scheduleIdle(() => {
        idleSerializeRef.current = null
        serializeCurrentWorkbook(generation)
      })
    }, SERIALIZE_DEBOUNCE_MS)
  }, [cancelScheduledSerialize, serializeCurrentWorkbook])

  const refreshWorkbook = useCallback(() => {
    const current = workbookRef.current
    if (!current) return
    refreshSequenceRef.current += 1
    const nextWorkbook = {
      externalFormulaInputs: current.externalFormulaInputs,
      generation: current.generation,
      model: current.model,
      path: current.path,
      refreshId: Date.now() + refreshSequenceRef.current,
    }
    workbookRef.current = nextWorkbook
    setWorkbook(nextWorkbook)
  }, [])

  const refreshForCurrentZoom = useCallback(() => {
    if (zoomRefreshFrameRef.current !== null) cancelFrame(zoomRefreshFrameRef.current)
    zoomRefreshFrameRef.current = requestFrame(() => {
      zoomRefreshFrameRef.current = null
      refreshWorkbook()
      scheduleSelectionChromePatch()
    })
  }, [refreshWorkbook, scheduleSelectionChromePatch])

  useEffect(() => {
    window.addEventListener('laputa-zoom-change', refreshForCurrentZoom)
    window.addEventListener('resize', refreshForCurrentZoom)

    return () => {
      window.removeEventListener('laputa-zoom-change', refreshForCurrentZoom)
      window.removeEventListener('resize', refreshForCurrentZoom)
      if (zoomRefreshFrameRef.current !== null) {
        cancelFrame(zoomRefreshFrameRef.current)
        zoomRefreshFrameRef.current = null
      }
    }
  }, [refreshForCurrentZoom])

  const captureSheetKeyboard = useCallback(() => {
    sheetKeyboardCapturedRef.current = true
  }, [])

  const releaseSheetKeyboard = useCallback(() => {
    sheetFocusRequestRef.current += 1
    sheetKeyboardCapturedRef.current = false
    setFormulaAutocomplete(null)
    setWikilinkAutocomplete(null)
    setSheetContextMenu(null)
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && sheetElementRef.current?.contains(activeElement)) {
      activeElement.blur()
    }
  }, [])

  const restoreSheetKeyboardFocus = useCallback(() => {
    sheetKeyboardCapturedRef.current = true
    const focusRequestId = sheetFocusRequestRef.current + 1
    sheetFocusRequestRef.current = focusRequestId

    window.setTimeout(() => {
      const container = sheetElementRef.current
      if (!container || sheetFocusRequestRef.current !== focusRequestId) return
      focusWorkbookRoot(container)
      scheduleSelectionChromePatch()
    }, 0)
  }, [scheduleSelectionChromePatch])

  const applySelectedStyle = useCallback((stylePath: string, value: string) => {
    const current = workbookRef.current
    if (!current) return
    current.model.updateRangeStyle(selectedRangeArea(current.model), stylePath, value)
    refreshWorkbook()
    scheduleSerialize({ bodyRows: 'none' })
    setSheetContextMenu(null)
  }, [refreshWorkbook, scheduleSerialize])

  const handleContextNumberFormat = useCallback((format: string) => {
    applySelectedStyle('num_fmt', format)
  }, [applySelectedStyle])

  const handleContextDecreaseDecimals = useCallback(() => {
    const current = workbookRef.current
    if (!current) return
    applySelectedStyle('num_fmt', decreaseDecimalPlaces(selectedCellStyle(current.model).num_fmt))
  }, [applySelectedStyle])

  const handleContextIncreaseDecimals = useCallback(() => {
    const current = workbookRef.current
    if (!current) return
    applySelectedStyle('num_fmt', increaseDecimalPlaces(selectedCellStyle(current.model).num_fmt))
  }, [applySelectedStyle])

  const handleContextBold = useCallback(() => {
    const current = workbookRef.current
    if (!current) return
    applySelectedStyle('font.b', String(!selectedCellStyle(current.model).font.b))
  }, [applySelectedStyle])

  const handleContextItalic = useCallback(() => {
    const current = workbookRef.current
    if (!current) return
    applySelectedStyle('font.i', String(!selectedCellStyle(current.model).font.i))
  }, [applySelectedStyle])

  const handleContextClearFormatting = useCallback(() => {
    const current = workbookRef.current
    if (!current) return
    const area = selectedRangeArea(current.model)
    current.model.rangeClearFormatting(
      area.sheet,
      area.row,
      area.column,
      area.row + area.height - 1,
      area.column + area.width - 1,
    )
    refreshWorkbook()
    scheduleSerialize({ bodyRows: 'none' })
    setSheetContextMenu(null)
  }, [refreshWorkbook, scheduleSerialize])

  const finishContextWorkbookMutation = useCallback((serializeOptions: ScheduleSheetSerializeOptions = {}) => {
    refreshWorkbook()
    scheduleSelectionChromePatch()
    scheduleSerialize(serializeOptions)
    setSheetContextMenu(null)
  }, [refreshWorkbook, scheduleSelectionChromePatch, scheduleSerialize])

  const handleContextStructureAction = useCallback((action: SheetStructureAction) => {
    const current = workbookRef.current
    if (!current) return

    applySheetStructureAction(current.model, action)
    finishContextWorkbookMutation()
  }, [finishContextWorkbookMutation])

  const handleContextFreezeRows = useCallback(() => {
    const current = workbookRef.current
    if (!current) return
    const { sheet, row } = current.model.getSelectedView()
    current.model.setFrozenRowsCount(sheet, row)
    finishContextWorkbookMutation({ bodyRows: 'none' })
  }, [finishContextWorkbookMutation])

  const handleContextFreezeColumns = useCallback(() => {
    const current = workbookRef.current
    if (!current) return
    const { sheet, column } = current.model.getSelectedView()
    current.model.setFrozenColumnsCount(sheet, column)
    finishContextWorkbookMutation({ bodyRows: 'none' })
  }, [finishContextWorkbookMutation])

  const handleContextUnfreezeRows = useCallback(() => {
    const current = workbookRef.current
    if (!current) return
    current.model.setFrozenRowsCount(SHEET_INDEX, 0)
    finishContextWorkbookMutation({ bodyRows: 'none' })
  }, [finishContextWorkbookMutation])

  const handleContextUnfreezeColumns = useCallback(() => {
    const current = workbookRef.current
    if (!current) return
    current.model.setFrozenColumnsCount(SHEET_INDEX, 0)
    finishContextWorkbookMutation({ bodyRows: 'none' })
  }, [finishContextWorkbookMutation])

  const handleContextToggleWrapText = useCallback(() => {
    const current = workbookRef.current
    if (!current) return
    const shouldWrap = selectedCellStyle(current.model).alignment?.wrap_text !== true
    current.model.updateRangeStyle(selectedRangeArea(current.model), 'alignment.wrap_text', String(shouldWrap))
    finishContextWorkbookMutation({ bodyRows: 'none' })
  }, [finishContextWorkbookMutation])

  const writeCellInputAt = useCallback((current: WorkbookState, row: number, column: number, input: string) => {
    const address = metadataCellAddress(row, column)
    if (isExternalFormulaInput(input)) {
      const { context, pendingLoads } = buildLiveExternalFormulaContext(input)
      const externalFormula = resolveExternalFormulaInput(input, context)
      if (!externalFormula) {
        if (pendingLoads.length === 0) return { applied: false, pendingLoads }
        current.model.setUserInput(SHEET_INDEX, row, column, input)
        current.externalFormulaInputs.set(address, { evaluated: input, source: input })
        return { applied: true, pendingLoads }
      }

      current.model.setUserInput(SHEET_INDEX, row, column, externalFormula.evaluated)
      current.externalFormulaInputs.set(address, externalFormula)
      return { applied: true, pendingLoads: [] }
    } else {
      current.model.setUserInput(SHEET_INDEX, row, column, input)
      current.externalFormulaInputs.delete(address)
      return { applied: true, pendingLoads: [] }
    }
  }, [buildLiveExternalFormulaContext])

  const commitCellInputAt = useCallback((row: number, column: number, input: string) => {
    const current = workbookRef.current
    if (!current) return false

    const result = writeCellInputAt(current, row, column, input)
    if (!result.applied) return false

    refreshWorkbook()
    scheduleSelectionChromePatch()
    scheduleSerialize({ bodyRows: [row] })
    if (result.pendingLoads.length > 0) {
      const pendingCommitId = pendingExternalFormulaCommitRef.current + 1
      pendingExternalFormulaCommitRef.current = pendingCommitId
      void Promise.allSettled(result.pendingLoads).then(() => {
        if (pendingExternalFormulaCommitRef.current !== pendingCommitId) return
        commitCellInputAt(row, column, input)
      })
    }
    return true
  }, [refreshWorkbook, scheduleSelectionChromePatch, scheduleSerialize, writeCellInputAt])

  const commitSelectedCellInput = useCallback((input: string, options: { allowPendingExternal?: boolean } = {}) => {
    const current = workbookRef.current
    if (!current) return false
    const cell = selectedCellIndexes(current.model)
    if (!cell) return false

    if (commitCellInputAt(cell.row, cell.column, input)) return true
    if (!options.allowPendingExternal || !isExternalFormulaInput(input)) return false

    const { pendingLoads } = buildLiveExternalFormulaContext(input)
    if (pendingLoads.length === 0) return false

    const pendingCommitId = pendingExternalFormulaCommitRef.current + 1
    pendingExternalFormulaCommitRef.current = pendingCommitId
    void Promise.allSettled(pendingLoads).then(() => {
      if (pendingExternalFormulaCommitRef.current !== pendingCommitId) return
      commitCellInputAt(cell.row, cell.column, input)
    })
    return true
  }, [buildLiveExternalFormulaContext, commitCellInputAt])

  const commitExternalFormulaEditorInput = useCallback((input: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (!input || !isExternalFormulaInput(input.value)) return false
    return commitSelectedCellInput(input.value, { allowPendingExternal: true })
  }, [commitSelectedCellInput])

  const flushCurrentSheetContent = useCallback((targetPath?: string) => {
    const current = workbookRef.current
    if (!current) return false
    if (targetPath && !notePathsMatch(targetPath, current.path)) return false

    commitExternalFormulaEditorInput(visibleSheetTextInput(sheetElementRef.current))
    cancelScheduledSerialize()
    return serializeCurrentWorkbook(current.generation)
  }, [cancelScheduledSerialize, commitExternalFormulaEditorInput, serializeCurrentWorkbook])

  useEffect(() => {
    if (!flushContentRef) return

    flushContentRef.current = flushCurrentSheetContent
    return () => {
      if (flushContentRef.current === flushCurrentSheetContent) flushContentRef.current = null
    }
  }, [flushContentRef, flushCurrentSheetContent])

  const retryPendingExternalFormulaCells = useCallback((pendingCells: Array<{ column: number; input: string; pendingLoads: Promise<unknown>[]; row: number }>, jobId: number) => {
    if (pendingCells.length === 0) return

    const pendingLoads = pendingCells.flatMap((cell) => cell.pendingLoads)
    void Promise.allSettled(pendingLoads).then(() => {
      if (pasteJobRef.current !== jobId) return
      const current = workbookRef.current
      if (!current) return

      current.model.pauseEvaluation()
      try {
        for (const cell of pendingCells) {
          if (current.model.getCellContent(SHEET_INDEX, cell.row, cell.column) !== cell.input) continue
          writeCellInputAt(current, cell.row, cell.column, cell.input)
        }
      } finally {
        current.model.resumeEvaluation()
      }

      current.model.evaluate()
      refreshWorkbook()
      scheduleSelectionChromePatch()
      scheduleSerialize({ bodyRows: pendingCells.map((cell) => cell.row) })
    })
  }, [refreshWorkbook, scheduleSelectionChromePatch, scheduleSerialize, writeCellInputAt])

  const applyTolariaClipboardPaste = useCallback((payload: TolariaSheetClipboardPayload) => {
    const current = workbookRef.current
    if (!current) return false

    const targetArea = selectedRangeArea(current.model)
    if (targetArea.sheet !== SHEET_INDEX) return false

    const operations = payload.cells.flatMap((row, rowOffset) => row.map((input, columnOffset) => ({
      column: targetArea.column + columnOffset,
      input: shiftedClipboardCellInput(
        input,
        payload,
        rowOffset,
        columnOffset,
        targetArea.row + rowOffset,
        targetArea.column + columnOffset,
      ),
      row: targetArea.row + rowOffset,
    })))
    if (operations.length === 0) return false

    pasteJobRef.current += 1
    const jobId = pasteJobRef.current
    if (pasteIdleRef.current !== null) {
      cancelIdle(pasteIdleRef.current)
      pasteIdleRef.current = null
    }

    const pendingCells: Array<{ column: number; input: string; pendingLoads: Promise<unknown>[]; row: number }> = []
    const dirtyRows = dirtyRowsForArea(targetArea)
    let operationIndex = 0

    const finishPaste = () => {
      const latest = workbookRef.current
      if (!latest || pasteJobRef.current !== jobId) return

      if (payload.action === 'cut' && payload.source.path === latest.path) {
        const sourceArea = {
          sheet: SHEET_INDEX,
          row: payload.source.row,
          column: payload.source.column,
          width: payload.source.width,
          height: payload.source.height,
        }
        const destinationArea = {
          sheet: SHEET_INDEX,
          row: targetArea.row,
          column: targetArea.column,
          width: payload.source.width,
          height: payload.source.height,
        }
        if (!rangesIntersect(sourceArea, destinationArea)) {
          latest.model.rangeClearContents(
            SHEET_INDEX,
            sourceArea.row,
            sourceArea.column,
            sourceArea.row + sourceArea.height - 1,
            sourceArea.column + sourceArea.width - 1,
          )
          for (const row of dirtyRowsForArea(sourceArea)) dirtyRows.add(row)
        }
      }

      latest.model.evaluate()
      refreshWorkbook()
      scheduleSelectionChromePatch()
      scheduleSerialize({ bodyRows: dirtyRows })
      retryPendingExternalFormulaCells(pendingCells, jobId)
    }

    const runChunk = () => {
      pasteIdleRef.current = null
      if (pasteJobRef.current !== jobId) return

      const latest = workbookRef.current
      if (!latest) return
      const endIndex = Math.min(operationIndex + SHEET_PASTE_CHUNK_SIZE, operations.length)

      latest.model.pauseEvaluation()
      try {
        for (; operationIndex < endIndex; operationIndex += 1) {
          const operation = operations[operationIndex]
          if (!operation) continue
          const result = writeCellInputAt(latest, operation.row, operation.column, operation.input)
          if (result.pendingLoads.length > 0) {
            pendingCells.push({ ...operation, pendingLoads: result.pendingLoads })
          }
        }
      } finally {
        latest.model.resumeEvaluation()
      }

      refreshWorkbook()
      scheduleSelectionChromePatch()

      if (operationIndex < operations.length) {
        pasteIdleRef.current = scheduleIdle(runChunk)
        return
      }

      finishPaste()
    }

    pasteIdleRef.current = scheduleIdle(runChunk)
    return true
  }, [
    refreshWorkbook,
    retryPendingExternalFormulaCells,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    writeCellInputAt,
  ])

  const handleTolariaSheetCopyCapture = useCallback((event: ReactClipboardEvent<HTMLDivElement>, action: TolariaSheetClipboardPayload['action']) => {
    if (isEditableTarget(event.target) || isSheetCommandTarget(event.target)) return false
    const current = workbookRef.current
    if (!current) return false

    const payload = buildTolariaSheetClipboardPayload(current, current.path, action)
    if (!payload) return false

    writeTolariaSheetClipboard(event.clipboardData, payload)
    event.preventDefault()
    event.stopPropagation()
    return true
  }, [])

  const handleCopyCapture = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    handleTolariaSheetCopyCapture(event, 'copy')
  }, [handleTolariaSheetCopyCapture])

  const handleCutCapture = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    if (!handleTolariaSheetCopyCapture(event, 'cut')) scheduleSerialize()
  }, [handleTolariaSheetCopyCapture, scheduleSerialize])

  const handlePasteCapture = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target) || isSheetCommandTarget(event.target)) {
      const current = workbookRef.current
      scheduleSerialize({ bodyRows: current ? dirtyRowsForSelectedRange(current.model) : 'all' })
      return
    }

    const payload = parseTolariaSheetClipboardPayload(event.clipboardData.getData(TOLARIA_SHEET_CLIPBOARD_MIME))
    if (!payload || !applyTolariaClipboardPaste(payload)) {
      const current = workbookRef.current
      scheduleSerialize({ bodyRows: current ? dirtyRowsForSelectedRange(current.model) : 'all' })
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setFormulaAutocomplete(null)
    setWikilinkAutocomplete(null)
    setSheetContextMenu(null)
  }, [applyTolariaClipboardPaste, scheduleSerialize])

  const applyWikilinkAutocompleteTarget = useCallback((target: string) => {
    const input = wikilinkInputRef.current
    if (!input) return

    const cursor = input.selectionStart ?? input.value.length
    const isFormulaInput = input.value.trimStart().startsWith('=')
    const replacement = replaceActiveWikilinkQuery(input.value, cursor, target)
    if (!replacement) return

    setFormulaInputValue(input, replacement.text)
    input.setSelectionRange(replacement.cursor, replacement.cursor)
    dispatchSheetInput(input, target)
    trackEvent('wikilink_inserted')
    input.focus()
    setWikilinkAutocomplete(null)
    setFormulaAutocomplete(null)

    const current = workbookRef.current
    if (current && !isFormulaInput) {
      commitSelectedCellInput(replacement.text)
      applySheetWikilinkStyle(
        current.model,
        selectedRangeArea(current.model),
        sheetWikilinkCanvasColor(replacement.text, entries, sourceEntry),
      )
      refreshWorkbook()
    } else if (current && isExternalFormulaInput(replacement.text)) {
      commitSelectedCellInput(replacement.text, { allowPendingExternal: true })
    }
    scheduleSerialize({ bodyRows: 'none' })
  }, [commitSelectedCellInput, entries, refreshWorkbook, scheduleSerialize, sourceEntry])

  const updateWikilinkAutocomplete = useCallback((input: HTMLInputElement | HTMLTextAreaElement | null) => {
    const container = sheetElementRef.current
    if (!input || !container) {
      wikilinkInputRef.current = null
      setWikilinkAutocomplete(null)
      return false
    }

    const cursor = input.selectionStart ?? input.value.length
    if (
      isInsideFormulaStringLiteral(input.value, cursor)
      || isActiveWikilinkQueryInsideFormulaString(input.value, cursor)
    ) {
      wikilinkInputRef.current = null
      setWikilinkAutocomplete(null)
      return false
    }

    const query = extractWikilinkQuery(input.value, cursor)
    if (query === null) {
      wikilinkInputRef.current = input
      setWikilinkAutocomplete(null)
      return false
    }

    wikilinkInputRef.current = input
    const items = sheetWikilinkAutocompleteItems({
      baseItems: wikilinkBaseItems,
      insertWikilink: applyWikilinkAutocompleteTarget,
      query,
      sourceEntry: sourceEntry ?? undefined,
      typeEntryMap,
      vaultPath,
    })
    setFormulaAutocomplete(null)
    setWikilinkAutocomplete((current) => nextWikilinkAutocompleteState(current, {
      items,
      selectedIndex: 0,
      ...formulaAutocompletePosition(input, container, cursor),
    }))
    return true
  }, [applyWikilinkAutocompleteTarget, sourceEntry, typeEntryMap, vaultPath, wikilinkBaseItems])

  const updateFormulaAutocomplete = useCallback((input: HTMLInputElement | HTMLTextAreaElement | null) => {
    const container = sheetElementRef.current
    if (!input || !container) {
      formulaInputRef.current = null
      setFormulaAutocomplete(null)
      return
    }

    const cursor = input.selectionStart ?? input.value.length
    const match = matchFormulaAutocomplete(input.value, cursor)
    if (!match) {
      formulaInputRef.current = input
      setFormulaAutocomplete(null)
      return
    }

    formulaInputRef.current = input
    setFormulaAutocomplete((current) => nextFormulaAutocompleteState(current, {
      suggestions: match.suggestions,
      selectedIndex: 0,
      tokenStart: match.tokenStart,
      tokenEnd: match.tokenEnd,
      ...formulaAutocompletePosition(input, container, cursor),
    }))
  }, [])

  const applyAutocompleteSuggestion = useCallback((suggestion: SheetFormulaSuggestion) => {
    const input = formulaInputRef.current
    if (!input || !formulaAutocomplete) return

    const applied = applyFormulaSuggestion(
      input.value,
      formulaAutocomplete.tokenStart,
      formulaAutocomplete.tokenEnd,
      suggestion,
    )

    setFormulaInputValue(input, applied.value)
    input.setSelectionRange(applied.cursor, applied.cursor)
    dispatchFormulaInput(input, suggestion)
    trackSheetFormulaAutocompleteUsed(suggestion.name)
    input.focus()
    setFormulaAutocomplete(null)
    const current = workbookRef.current
    scheduleSerialize({ bodyRows: current ? dirtyRowsForSelectedRange(current.model) : 'all' })
  }, [formulaAutocomplete, scheduleSerialize])

  const handleWikilinkKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!wikilinkAutocomplete) return

    const input = formulaInputFromTarget(event.target) ?? visibleSheetTextInput(sheetElementRef.current)
    if (!input || input !== wikilinkInputRef.current) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      setWikilinkAutocomplete((current) => {
        if (!current || current.items.length === 0) return current
        const step = event.key === 'ArrowDown' ? 1 : -1
        return {
          ...current,
          selectedIndex: (current.selectedIndex + step + current.items.length) % current.items.length,
        }
      })
      return
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      const item = wikilinkAutocomplete.items[wikilinkAutocomplete.selectedIndex]
      item?.onItemClick()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setWikilinkAutocomplete(null)
    }
  }, [wikilinkAutocomplete])

  const handleFormulaKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!formulaAutocomplete) return

    const input = formulaInputFromTarget(event.target) ?? visibleFormulaInput(sheetElementRef.current)
    if (!input || input !== formulaInputRef.current) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      setFormulaAutocomplete((current) => {
        if (!current) return null
        const step = event.key === 'ArrowDown' ? 1 : -1
        return {
          ...current,
          selectedIndex: (current.selectedIndex + step + current.suggestions.length) % current.suggestions.length,
        }
      })
      return
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      const suggestion = formulaAutocomplete.suggestions[formulaAutocomplete.selectedIndex]
      if (suggestion) applyAutocompleteSuggestion(suggestion)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setFormulaAutocomplete(null)
    }
  }, [applyAutocompleteSuggestion, formulaAutocomplete])

  const handleKeyDownCapture = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      cancelScheduledSerialize()
      serializeCurrentWorkbook()
    }

    const editableInput = formulaInputFromTarget(event.target)
    if (
      editableInput
      && (isPlainEnterKey(event) || event.key === 'Tab')
      && commitExternalFormulaEditorInput(editableInput)
    ) {
      event.preventDefault()
      event.stopPropagation()
      setFormulaAutocomplete(null)
      setWikilinkAutocomplete(null)
      window.setTimeout(() => focusWorkbookRoot(sheetElementRef.current), 0)
      return
    }

    handleWikilinkKeyDown(event)
    if (event.defaultPrevented) return

    handleFormulaKeyDown(event)
    if (event.defaultPrevented) return

    if (sheetKeyboardCapturedRef.current && event.key === 'Escape') {
      if (isEditableTarget(event.target) && isWorkbookKeyboardTarget(sheetElementRef.current, event.target)) {
        restoreSheetKeyboardFocus()
        return
      }
      window.setTimeout(releaseSheetKeyboard, 0)
      return
    }

    if (
      isPlainCellClearKey(event)
      && isWorkbookKeyboardTarget(sheetElementRef.current, event.target)
      && !isEditableTarget(event.target)
      && !isSheetCommandTarget(event.target)
    ) {
      const current = workbookRef.current
      if (!current) return
      captureSheetKeyboard()
      event.preventDefault()
      event.stopPropagation()
      const dirtyRows = dirtyRowsForSelectedRange(current.model)
      clearSelectedRangeContents(current.model)
      refreshWorkbook()
      scheduleSelectionChromePatch()
      scheduleSerialize({ bodyRows: dirtyRows })
      setFormulaAutocomplete(null)
      setSheetContextMenu(null)
      return
    }

    if (
      isPlainEnterKey(event)
      && isWorkbookKeyboardTarget(sheetElementRef.current, event.target)
      && !isEditableTarget(event.target)
      && !isSheetCommandTarget(event.target)
    ) {
      captureSheetKeyboard()
      event.preventDefault()
      event.stopPropagation()
      startCellEdit(sheetElementRef.current)
      scheduleSelectionChromePatch()
    }
  }, [
    cancelScheduledSerialize,
    captureSheetKeyboard,
    commitExternalFormulaEditorInput,
    handleFormulaKeyDown,
    handleWikilinkKeyDown,
    refreshWorkbook,
    releaseSheetKeyboard,
    restoreSheetKeyboardFocus,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    serializeCurrentWorkbook,
  ])

  const handleSheetKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!sheetKeyboardCapturedRef.current) return
    if (event.key === 'Escape') {
      event.stopPropagation()
      if (isEditableTarget(event.target)) {
        restoreSheetKeyboardFocus()
        return
      }
      releaseSheetKeyboard()
      return
    }
    if (isEditableTarget(event.target)) return
    if (isSpreadsheetKey(event)) event.stopPropagation()
  }, [releaseSheetKeyboard, restoreSheetKeyboardFocus])

  const updateSheetInlineAutocompletes = useCallback((input: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (updateWikilinkAutocomplete(input)) return
    updateFormulaAutocomplete(input?.value.trimStart().startsWith('=') ? input : visibleFormulaInput(sheetElementRef.current))
  }, [updateFormulaAutocomplete, updateWikilinkAutocomplete])

  const handleInputCapture = useCallback((event: ReactFormEvent<HTMLDivElement>) => {
    const current = workbookRef.current
    scheduleSerialize({ bodyRows: current ? dirtyRowsForSelectedRange(current.model) : 'all' })
    updateSheetInlineAutocompletes(formulaInputFromTarget(event.target) ?? visibleSheetTextInput(sheetElementRef.current))
  }, [scheduleSerialize, updateSheetInlineAutocompletes])

  const handleKeyUpCapture = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target) && shouldScheduleSerializeForKey(event)) {
      const current = workbookRef.current
      scheduleSerialize({ bodyRows: current ? dirtyRowsForSelectedRange(current.model) : 'all' })
    }
    scheduleSelectionChromePatch()
    updateSheetInlineAutocompletes(formulaInputFromTarget(event.target) ?? visibleSheetTextInput(sheetElementRef.current))
  }, [scheduleSelectionChromePatch, scheduleSerialize, updateSheetInlineAutocompletes])

  const handleContextMenuCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('.sheet-context-menu, .sheet-wikilink-autocomplete')) return
    const container = sheetElementRef.current
    if (!container) return

    event.preventDefault()
    event.stopPropagation()
    captureSheetKeyboard()

    const zoom = getDocumentZoom()
    const containerRect = container.getBoundingClientRect()
    const scale = elementCoordinateScale(container, containerRect, zoom)
    const localX = localElementCoordinate(event.clientX, containerRect, scale.x, 'x')
    const localY = localElementCoordinate(event.clientY, containerRect, scale.y, 'y')
    const containerWidth = container.clientWidth || containerRect.width * scale.x
    const containerHeight = container.clientHeight || containerRect.height * scale.y
    const menuWidth = 220
    const menuHeight = 360
    const current = workbookRef.current
    if (!current) return

    setSheetContextMenu(sheetContextMenuSelectionState(
      current.model,
      Math.max(8, Math.min(localX, containerWidth - menuWidth - 8)),
      Math.max(8, Math.min(localY, containerHeight - menuHeight - 8)),
    ))
  }, [captureSheetKeyboard])

  useEffect(() => {
    const patchPointerEvent = (event: PointerEvent) => {
      const container = sheetElementRef.current
      if (!container) return

      const targetIsInsideSheet = event.target instanceof Node && container.contains(event.target)
      if (!targetIsInsideSheet && !sheetPointerActiveRef.current) return
      patchSheetPointerEventCoordinates(event, container)
    }

    document.addEventListener('pointerdown', patchPointerEvent, true)
    document.addEventListener('pointermove', patchPointerEvent, true)
    document.addEventListener('pointerup', patchPointerEvent, true)
    return () => {
      document.removeEventListener('pointerdown', patchPointerEvent, true)
      document.removeEventListener('pointermove', patchPointerEvent, true)
      document.removeEventListener('pointerup', patchPointerEvent, true)
    }
  }, [])

  useEffect(() => {
    const scheduleAfterPointerInteraction = () => {
      if (!sheetPointerActiveRef.current) return
      sheetPointerActiveRef.current = false
    }

    document.addEventListener('pointerup', scheduleAfterPointerInteraction, true)
    return () => document.removeEventListener('pointerup', scheduleAfterPointerInteraction, true)
  }, [])

  useEffect(() => {
    const releaseWhenOutsideSheet = (event: PointerEvent | FocusEvent) => {
      const container = sheetElementRef.current
      if (!container) return
      if (event.target instanceof Node && container.contains(event.target)) return
      releaseSheetKeyboard()
    }

    document.addEventListener('focusin', releaseWhenOutsideSheet, true)
    document.addEventListener('pointerdown', releaseWhenOutsideSheet, true)
    return () => {
      document.removeEventListener('focusin', releaseWhenOutsideSheet, true)
      document.removeEventListener('pointerdown', releaseWhenOutsideSheet, true)
    }
  }, [releaseSheetKeyboard])

  const dismissSheetTransientUi = useCallback(() => {
    setFormulaAutocomplete(null)
    setWikilinkAutocomplete(null)
    setSheetContextMenu(null)
  }, [])

  const handleSheetWikilinkPointerDown = useSheetWikilinkNavigation({
    cellFromPointer: sheetCellFromPointer,
    containerRef: sheetElementRef,
    dismissTransientUi: dismissSheetTransientUi,
    onNavigateWikilink,
    onBeforeNavigate: flushCurrentSheetContent,
    sheetIndex: SHEET_INDEX,
    workbookRef,
  })

  const interactionHandlers = useMemo(() => ({
    onBlurCapture: (event: ReactFocusEvent<HTMLDivElement>) => {
      commitExternalFormulaEditorInput(formulaInputFromTarget(event.target))
      scheduleSerialize({ dirty: false })
      window.setTimeout(() => {
        if (sheetElementRef.current?.contains(document.activeElement) !== true) {
          setFormulaAutocomplete(null)
          setWikilinkAutocomplete(null)
        }
      }, 0)
    },
    onCopyCapture: handleCopyCapture,
    onCutCapture: handleCutCapture,
    onContextMenuCapture: handleContextMenuCapture,
    onInputCapture: handleInputCapture,
    onKeyDown: handleSheetKeyDown,
    onKeyDownCapture: handleKeyDownCapture,
    onKeyUpCapture: handleKeyUpCapture,
    onPasteCapture: handlePasteCapture,
    onPointerDownCapture: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.target instanceof Element && event.target.closest('.sheet-context-menu, .sheet-formula-autocomplete, .sheet-wikilink-autocomplete')) return
      if (handleSheetWikilinkPointerDown(event)) return
      if (isSecondaryPointerButton(event.button, event.buttons)) {
        event.stopPropagation()
        return
      }
      commitExternalFormulaEditorInput(visibleSheetTextInput(sheetElementRef.current))
      patchReactSheetPointerEvent(event, sheetElementRef.current)
      sheetPointerActiveRef.current = true
      captureSheetKeyboard()
      scheduleSelectionChromePatch()
      setSheetContextMenu(null)
      setWikilinkAutocomplete(null)
      if (!isEditableTarget(event.target) && !sheetHasEditableFocus(sheetElementRef.current)) {
        const focusRequestId = sheetFocusRequestRef.current + 1
        sheetFocusRequestRef.current = focusRequestId
        window.setTimeout(() => {
          const container = sheetElementRef.current
          if (!container || !sheetKeyboardCapturedRef.current || sheetFocusRequestRef.current !== focusRequestId) return
          const activeElement = document.activeElement
          if (activeElement instanceof HTMLElement && !container.contains(activeElement) && activeElement !== document.body) return
          focusWorkbookRoot(container)
        }, 0)
      }
    },
    onPointerMoveCapture: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (sheetPointerActiveRef.current) patchReactSheetPointerEvent(event, sheetElementRef.current)
    },
    onPointerUpCapture: (event: ReactPointerEvent<HTMLDivElement>) => {
      patchReactSheetPointerEvent(event, sheetElementRef.current)
      scheduleSelectionChromePatch()
    },
  }), [
    captureSheetKeyboard,
    commitExternalFormulaEditorInput,
    handleCopyCapture,
    handleContextMenuCapture,
    handleCutCapture,
    handleInputCapture,
    handleKeyDownCapture,
    handleKeyUpCapture,
    handlePasteCapture,
    handleSheetWikilinkPointerDown,
    handleSheetKeyDown,
    scheduleSelectionChromePatch,
    scheduleSerialize,
  ])

  if (error) {
    return (
      <div className="sheet-editor sheet-editor--status" data-testid="sheet-editor">
        {translate(locale, 'editor.sheet.unavailable', { error })}
      </div>
    )
  }

  if (!workbook) {
    return (
      <div className="sheet-editor sheet-editor--status" data-testid="sheet-editor">
        {translate(locale, 'editor.sheet.loading')}
      </div>
    )
  }

  return (
    <div
      ref={sheetElementRef}
      className="sheet-editor sheet-editor--workbook sheet-editor--single-sheet"
      data-testid="sheet-editor"
      {...interactionHandlers}
    >
      <MemoizedIronCalc model={workbook.model} refreshId={workbook.refreshId} />
      {formulaAutocomplete && (
        <div
          className="sheet-formula-autocomplete"
          role="listbox"
          style={{
            left: formulaAutocomplete.left,
            top: formulaAutocomplete.top,
            minWidth: formulaAutocomplete.width,
          }}
        >
          {formulaAutocomplete.suggestions.map((suggestion, index) => (
            <div
              aria-selected={index === formulaAutocomplete.selectedIndex}
              className="sheet-formula-autocomplete__item"
              key={suggestion.name}
              onMouseDown={(event) => {
                event.preventDefault()
                applyAutocompleteSuggestion(suggestion)
              }}
              onMouseEnter={() => {
                setFormulaAutocomplete((current) => {
                  if (!current) return null
                  return { ...current, selectedIndex: index }
                })
              }}
              role="option"
              tabIndex={-1}
            >
              <span className="sheet-formula-autocomplete__name">{suggestion.name}</span>
              <span className="sheet-formula-autocomplete__signature">{suggestion.signature}</span>
            </div>
          ))}
        </div>
      )}
      {wikilinkAutocomplete && (
        <div
          className="sheet-wikilink-autocomplete"
          data-testid="sheet-wikilink-autocomplete"
          style={{
            left: wikilinkAutocomplete.left,
            top: wikilinkAutocomplete.top,
            minWidth: wikilinkAutocomplete.width,
          }}
        >
          <WikilinkSuggestionMenu
            items={wikilinkAutocomplete.items}
            loadingState="loaded"
            selectedIndex={wikilinkAutocomplete.selectedIndex}
          />
        </div>
      )}
      {sheetContextMenu && (
        <SheetContextMenu
          locale={locale}
          onBold={handleContextBold}
          onClearFormatting={handleContextClearFormatting}
          onClose={() => setSheetContextMenu(null)}
          onDeleteColumn={() => handleContextStructureAction('deleteColumn')}
          onDeleteRow={() => handleContextStructureAction('deleteRow')}
          onDecreaseDecimals={handleContextDecreaseDecimals}
          onFreezeColumns={handleContextFreezeColumns}
          onFreezeRows={handleContextFreezeRows}
          onIncreaseDecimals={handleContextIncreaseDecimals}
          onInsertColumnLeft={() => handleContextStructureAction('insertColumnLeft')}
          onInsertColumnRight={() => handleContextStructureAction('insertColumnRight')}
          onInsertRowAbove={() => handleContextStructureAction('insertRowAbove')}
          onInsertRowBelow={() => handleContextStructureAction('insertRowBelow')}
          onItalic={handleContextItalic}
          onNumberFormat={handleContextNumberFormat}
          onToggleWrapText={handleContextToggleWrapText}
          onUnfreezeColumns={handleContextUnfreezeColumns}
          onUnfreezeRows={handleContextUnfreezeRows}
          state={sheetContextMenu}
        />
      )}
    </div>
  )
}
