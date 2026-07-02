import type { Area as IronCalcArea, BorderType, CellStyle } from '@ironcalc/wasm'
import { Model } from '@ironcalc/workbook'
import type { VaultEntry } from '../types'
import {
  mergeSheetDocument,
  parseCsvRows,
  parseCsvRowsWithSource,
  serializeCsvRowsPreservingParsedSourceRows,
  serializeCsvRowsReplacingParsedSourceRows,
  splitSheetDocument,
  type ParsedCsvRows,
} from './sheetCsv'
import {
  cellAddressToIndexes,
  columnIndexFromName,
  columnNameFromOneBasedIndex,
  emptySheetMetadata,
  isSheetMetadataEmpty,
  mergeSheetMetadata,
  metadataCellAddress,
  parseSheetMetadata,
  type SheetBorderMetadata,
  type SheetCellMetadata,
  type SheetMetadata,
} from './sheetMetadata'
import { parseSheetMarkdownCell } from './sheetMarkdownCell'
import {
  extractSheetExternalReferenceTargets,
  hasSheetExternalFrontmatterReferences as bodyHasExternalFrontmatterReferences,
  isExternalFormulaInput,
  SHEET_EXTERNAL_CELL_REFERENCE_PATTERN,
  SHEET_EXTERNAL_FRONTMATTER_REFERENCE_PATTERN,
  parseSheetExternalFrontmatterReference,
  type SheetExternalCellReference,
  type SheetExternalFrontmatterReference,
} from './sheetExternalReferences'
import { resolveSheetFrontmatterProperty } from './sheetFrontmatterProperties'
import type { SheetExternalFormulaInput, SheetExternalFormulaWorkerDependency } from './sheetExternalFormulaWorker'
import {
  applySheetWikilinkStyle,
  bridgeSheetWikilinkFormattedValues,
  sheetWikilinkCanvasColor,
  sheetWikilinkFormattedValueKey,
  SHEET_WIKILINK_FONT_COLOR,
} from './sheetWikilinkModelBridge'
import {
  sheetCellContainsPlainWikilink,
  sheetWikilinkDisplayValue,
} from './sheetWikilinks'
import { normalizeSheetColorForIronCalc } from './sheetIronCalcColor'
import { notePathsMatch } from './notePathIdentity'
import { resolveEntry, wikilinkTarget } from './wikilink'

export const SHEET_INDEX = 0
export const DEFAULT_SERIALIZATION_SCAN_ROWS = 1000
export const DEFAULT_SERIALIZATION_SCAN_COLUMNS = 200
export const MAX_SHEET_ROWS = 1048576
export const MAX_SHEET_COLUMNS = 16384
export const DEFAULT_COLUMN_WIDTH = 125
export const DEFAULT_ROW_HEIGHT = 28
export const DEFAULT_FONT_SIZE = 13
export const DEFAULT_FONT_COLOR = '#000000'
export const DEFAULT_VERTICAL_ALIGN = 'bottom'
export const DEFAULT_SHOW_GRID_LINES = true
export const DEFAULT_FROZEN_ROWS = 0
export const DEFAULT_FROZEN_COLUMNS = 0
export const SELECTED_METADATA_CELL_LIMIT = 5000
export const MAX_EXTERNAL_FORMULA_DEPTH = 4

const SHEET_EXTERNAL_FORMULA_CONTENT_BRIDGE = Symbol('sheetExternalFormulaContentBridge')
const EMPTY_VAULT_ENTRIES: VaultEntry[] = []
const SHEET_BORDER_TYPES = {
  bottom: 'Bottom' as BorderType,
  left: 'Left' as BorderType,
  right: 'Right' as BorderType,
  top: 'Top' as BorderType,
}

export interface UsedBounds {
  rowCount: number
  columnCount: number
}

interface UsedCell {
  row: number
  column: number
}

interface UsedArea extends UsedBounds {
  cells: UsedCell[]
}

export type SheetBodyDirtyRows = Set<number> | 'all' | null

export interface SheetContentBuildOptions {
  bodyRows?: SheetBodyDirtyRows
}

export interface SheetContentSummary {
  columnCount: number
  hasMetadata: boolean
  rowCount: number
}

interface SheetExternalWorkbookCache {
  buildsByPath: Map<string, SheetWorkbookBuild>
  ownedModels: Set<Model>
}

export interface SheetExternalFormulaContext {
  contentsByPath: Map<string, string>
  currentPath: string
  depth: number
  entries: VaultEntry[]
  entryResolutionCache: Map<string, VaultEntry | null>
  resolvingPaths: Set<string>
  sourceEntry?: VaultEntry | null
  workbookCache?: SheetExternalWorkbookCache
}

export interface SheetWorkbookBuild {
  externalFormulaInputs: Map<string, SheetExternalFormulaInput>
  model: Model
}

interface ExternalDependencyQueueItem {
  body: string
  depth: number
  sourceEntry: VaultEntry | null
}

type SheetExternalFormulaContentBridgeState = {
  [SHEET_EXTERNAL_FORMULA_CONTENT_BRIDGE]?: Model['getCellContent']
}

interface WorkbookCellBuildInput {
  address: string
  column: number
  row: number
  value: string
}

interface WorkbookCellBuildState {
  entries: VaultEntry[]
  externalFormulaCacheRun: { context: SheetExternalFormulaContext; dispose: () => void } | null
  externalFormulaInputs: Map<string, SheetExternalFormulaInput>
  markdownMetadata: SheetMetadata
  model: Model
  nativeExternalFormulaInputs?: Map<string, SheetExternalFormulaInput> | null
  sourceEntry?: VaultEntry | null
  wikilinkFormattedValues: Map<string, string>
}

function parseSheetRows({ content }: { content: string }): string[][] {
  return parseCsvRows(splitSheetDocument(content).body.trimEnd())
}

export function sheetHasExternalFormulaReferences(content: string): boolean {
  return extractSheetExternalReferenceTargets(splitSheetDocument(content).body).length > 0
}

export function sheetHasExternalFrontmatterReferences(content: string): boolean {
  return bodyHasExternalFrontmatterReferences({ value: splitSheetDocument(content).body })
}

function hashSheetWorkerString({ seed, value }: { seed: number; value: string }): number {
  let hash = seed
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  }
  return hash >>> 0
}

export function sheetExternalFormulaWorkerSignature({
  content,
  dependencies,
  path,
}: {
  content: string
  dependencies: SheetExternalFormulaWorkerDependency[]
  path: string
}): string {
  let hash = hashSheetWorkerString({ seed: 2166136261, value: path })
  hash = hashSheetWorkerString({ seed: hash, value: content })
  for (const dependency of [...dependencies].sort((left, right) => left.entry.path.localeCompare(right.entry.path))) {
    hash = hashSheetWorkerString({ seed: hash, value: dependency.entry.path })
    hash = hashSheetWorkerString({ seed: hash, value: dependency.content })
  }
  return `${path}:${hash.toString(16)}`
}

function sheetCellContainsWikilink({ value }: { value: string }): boolean {
  return sheetCellContainsPlainWikilink(value)
}

function sheetEntryResolutionCacheKey({
  sourceEntry,
  target,
}: {
  sourceEntry?: VaultEntry | null
  target: string
}): string {
  return `${sourceEntry?.path ?? ''}\n${target}`
}

function resolveSheetEntry(
  entries: VaultEntry[],
  target: string,
  sourceEntry?: VaultEntry | null,
  cache?: Map<string, VaultEntry | null>,
): VaultEntry | undefined {
  const cacheKey = sheetEntryResolutionCacheKey({ sourceEntry, target })
  if (cache?.has(cacheKey)) return cache.get(cacheKey) ?? undefined

  const entry = resolveEntry(entries, target, sourceEntry ?? undefined)
    ?? (sourceEntry ? resolveEntry([sourceEntry], target, sourceEntry) : undefined)
  cache?.set(cacheKey, entry ?? null)
  return entry
}

function sheetReferenceTargets({ body }: { body: string }): Set<string> {
  return new Set(extractSheetExternalReferenceTargets(body))
}

function enqueueNestedDependency({
  contentsByPath,
  entry,
  item,
  queue,
  visitedBodies,
}: {
  contentsByPath: Map<string, string>
  entry: VaultEntry
  item: ExternalDependencyQueueItem
  queue: ExternalDependencyQueueItem[]
  visitedBodies: Set<string>
}): void {
  if (visitedBodies.has(entry.path) || item.depth >= MAX_EXTERNAL_FORMULA_DEPTH) return

  const nestedContent = contentsByPath.get(entry.path)
  if (nestedContent === undefined) return

  visitedBodies.add(entry.path)
  queue.push({
    body: splitSheetDocument(nestedContent).body,
    depth: item.depth + 1,
    sourceEntry: entry,
  })
}

export function resolveExternalSheetDependencyEntries({
  content,
  contentsByPath,
  currentPath,
  entries,
  sourceEntry,
}: {
  content: string
  contentsByPath: Map<string, string>
  currentPath: string
  entries: VaultEntry[]
  sourceEntry: VaultEntry | null
}): VaultEntry[] {
  const resolved = new Map<string, VaultEntry>()
  const resolutionCache = new Map<string, VaultEntry | null>()
  const visitedBodies = new Set<string>([currentPath])
  const queue: ExternalDependencyQueueItem[] = [{
    body: splitSheetDocument(content).body,
    depth: 0,
    sourceEntry,
  }]

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index]
    if (!item || item.depth > MAX_EXTERNAL_FORMULA_DEPTH) continue

    for (const target of sheetReferenceTargets({ body: item.body })) {
      const entry = resolveSheetEntry(entries, target, item.sourceEntry, resolutionCache)
      if (!entry || notePathsMatch(entry.path, currentPath)) continue

      resolved.set(entry.path, entry)
      enqueueNestedDependency({ contentsByPath, entry, item, queue, visitedBodies })
    }
  }

  return Array.from(resolved.values())
}

export function resolveExternalSheetEntriesForFormula(
  formula: string,
  entries: VaultEntry[],
  sourceEntry: VaultEntry | null,
  currentPath: string,
): VaultEntry[] {
  const resolved = new Map<string, VaultEntry>()
  const resolutionCache = new Map<string, VaultEntry | null>()
  for (const target of extractSheetExternalReferenceTargets(formula)) {
    const entry = resolveSheetEntry(entries, target, sourceEntry, resolutionCache)
    if (!entry) continue
    if (notePathsMatch(entry.path, currentPath)) continue
    resolved.set(entry.path, entry)
  }
  return Array.from(resolved.values())
}

export function sheetExternalFormulaContext(options: {
  contentsByPath: Map<string, string>
  currentPath: string
  entries: VaultEntry[]
  sourceEntry?: VaultEntry | null
}): SheetExternalFormulaContext {
  return {
    contentsByPath: options.contentsByPath,
    currentPath: options.currentPath,
    depth: 0,
    entries: options.entries,
    entryResolutionCache: new Map(),
    resolvingPaths: new Set([options.currentPath]),
    sourceEntry: options.sourceEntry,
  }
}

function sheetExternalFormulaNestedContext(
  context: SheetExternalFormulaContext,
  entry: VaultEntry,
): SheetExternalFormulaContext {
  return {
    ...context,
    currentPath: entry.path,
    depth: context.depth + 1,
    resolvingPaths: new Set([...context.resolvingPaths, entry.path]),
    sourceEntry: entry,
  }
}

function withExternalWorkbookCache(context: SheetExternalFormulaContext): {
  context: SheetExternalFormulaContext
  dispose: () => void
} {
  if (context.workbookCache) return { context, dispose: () => undefined }

  const workbookCache: SheetExternalWorkbookCache = {
    buildsByPath: new Map(),
    ownedModels: new Set(),
  }

  return {
    context: { ...context, workbookCache },
    dispose: () => {
      for (const model of workbookCache.ownedModels) model.free()
      workbookCache.ownedModels.clear()
      workbookCache.buildsByPath.clear()
    },
  }
}

function isProbablyNumericFormulaLiteral({ value }: { value: string }): boolean {
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
}

function normalizedNumericFormulaLiteral({ value }: { value: string }): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return '0'
  if (isProbablyNumericFormulaLiteral({ value: trimmed })) return trimmed

  const percent = trimmed.match(/^-?[$€£]?\s*[\d,]+(?:\.\d+)?%$/)
  if (percent) {
    const parsed = Number.parseFloat(trimmed.replace(/[$€£,\s%]/g, ''))
    if (Number.isFinite(parsed)) return String(parsed / 100)
  }

  const normalized = trimmed.replace(/^[$€£]\s*/, '').replace(/,/g, '')
  if (isProbablyNumericFormulaLiteral({ value: normalized })) return normalized
  return null
}

function textFormulaLiteral({ value }: { value: string }): string {
  return JSON.stringify(value)
}

function frontmatterFormulaLiteral(value: boolean | number | string): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NA()'
  if (typeof value === 'boolean') return value ? 'TRUE()' : 'FALSE()'
  return textFormulaLiteral({ value })
}

function externalCellFormulaLiteral({
  column,
  model,
  row,
}: {
  column: number
  model: Model
  row: number
}): string {
  const rawContent = model.getCellContent(SHEET_INDEX, row, column)
  if (!rawContent.trimStart().startsWith('=')) {
    return normalizedNumericFormulaLiteral({ value: rawContent }) ?? textFormulaLiteral({ value: rawContent })
  }

  const formattedValue = model.getFormattedCellValue(SHEET_INDEX, row, column)
  return normalizedNumericFormulaLiteral({ value: formattedValue }) ?? textFormulaLiteral({ value: formattedValue })
}

function externalWorkbookBuild(
  entry: VaultEntry,
  content: string,
  context: SheetExternalFormulaContext,
): { build: SheetWorkbookBuild; cached: boolean } {
  const cached = context.workbookCache?.buildsByPath.get(entry.path)
  if (cached) return { build: cached, cached: true }

  const build = buildWorkbook(content, entry.path, sheetExternalFormulaNestedContext(context, entry))
  if (!context.workbookCache) return { build, cached: false }

  context.workbookCache.buildsByPath.set(entry.path, build)
  context.workbookCache.ownedModels.add(build.model)
  return { build, cached: true }
}

function resolveExternalCellReference(
  reference: SheetExternalCellReference,
  context: SheetExternalFormulaContext,
): string | null {
  const entry = resolveSheetEntry(
    context.entries,
    reference.target,
    context.sourceEntry,
    context.entryResolutionCache,
  )
  if (!entry) return null
  if (notePathsMatch(entry.path, context.currentPath)) return null
  if (context.resolvingPaths.has(entry.path) || context.depth > MAX_EXTERNAL_FORMULA_DEPTH) return null

  const content = context.contentsByPath.get(entry.path)
  if (content === undefined) return null

  const cell = cellAddressToIndexes(reference.address)
  if (!cell) return null

  const nested = externalWorkbookBuild(entry, content, context)
  try {
    return externalCellFormulaLiteral({ column: cell.column, model: nested.build.model, row: cell.row })
  } finally {
    if (!nested.cached) nested.build.model.free()
  }
}

function normalizedSheetTarget(target: string): string {
  return target.trim().replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
}

function withoutMarkdownExtension(value: string): string {
  return value.replace(/\.md$/i, '')
}

function normalizedEntryPath(entry: VaultEntry): string {
  return entry.path.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
}

function entryFilenameStem(entry: VaultEntry): string {
  return withoutMarkdownExtension(entry.filename).toLowerCase()
}

function uniqueEntryResolution(matches: VaultEntry[]): { ambiguous: boolean; entry?: VaultEntry } {
  const unique = new Map(matches.map((entry) => [entry.path, entry]))
  if (unique.size === 0) return { ambiguous: false }
  if (unique.size > 1) return { ambiguous: true }
  return { ambiguous: false, entry: Array.from(unique.values())[0] }
}

function frontmatterTargetPathMatches(entries: VaultEntry[], target: string): VaultEntry[] {
  if (!target.includes('/')) return []

  const targetSuffixes = target.endsWith('.md') ? [`/${target}`] : [`/${target}`, `/${target}.md`]
  return entries.filter((entry) => targetSuffixes.some((suffix) => normalizedEntryPath(entry).endsWith(suffix)))
}

function frontmatterTargetSimpleMatchGroups(entries: VaultEntry[], target: string): VaultEntry[][] {
  const targetStem = withoutMarkdownExtension(target)
  const humanizedTarget = targetStem.replace(/-/g, ' ')
  return [
    entries.filter((entry) => entryFilenameStem(entry) === targetStem),
    entries.filter((entry) => entry.aliases.some((alias) => normalizedSheetTarget(alias) === target)),
    entries.filter((entry) => normalizedSheetTarget(entry.title) === target || normalizedSheetTarget(entry.title) === targetStem),
    humanizedTarget === targetStem ? [] : entries.filter((entry) => normalizedSheetTarget(entry.title) === humanizedTarget),
  ]
}

function frontmatterReferenceEntryResolution(
  entries: VaultEntry[],
  target: string,
): { ambiguous: boolean; entry?: VaultEntry } {
  const normalizedTarget = normalizedSheetTarget(target)
  const pathResolution = uniqueEntryResolution(frontmatterTargetPathMatches(entries, normalizedTarget))
  if (pathResolution.ambiguous || pathResolution.entry) return pathResolution

  for (const matches of frontmatterTargetSimpleMatchGroups(entries, normalizedTarget)) {
    const resolution = uniqueEntryResolution(matches)
    if (resolution.ambiguous || resolution.entry) return resolution
  }
  return { ambiguous: false }
}

function resolveExternalFrontmatterEntry(
  reference: SheetExternalFrontmatterReference,
  context: SheetExternalFormulaContext,
): { ambiguous: boolean; entry?: VaultEntry } {
  const resolution = frontmatterReferenceEntryResolution(context.entries, reference.target)
  if (resolution.ambiguous || resolution.entry) return resolution

  const entry = resolveSheetEntry(
    context.entries,
    reference.target,
    context.sourceEntry,
    context.entryResolutionCache,
  )
  return { ambiguous: false, entry }
}

function resolveExternalFrontmatterReference(
  reference: SheetExternalFrontmatterReference,
  context: SheetExternalFormulaContext,
): string {
  const resolution = resolveExternalFrontmatterEntry(reference, context)
  if (resolution.ambiguous || !resolution.entry) return 'NA()'

  const content = context.contentsByPath.get(resolution.entry.path)
  if (content === undefined) return 'NA()'

  const value = resolveSheetFrontmatterProperty(content, reference.path)
  return value === null ? 'NA()' : frontmatterFormulaLiteral(value)
}

function localSheetCellReference(
  columnAbsolute: string,
  rawColumn: string,
  rowAbsolute: string,
  row: string,
): string {
  return `${columnAbsolute}${rawColumn.toUpperCase()}${rowAbsolute}${row}`
}

function replacementForExternalFormulaReference({
  cacheRun,
  columnAbsolute,
  match,
  rawColumn,
  rawRow,
  rawTarget,
  rowAbsolute,
}: {
  cacheRun: { context: SheetExternalFormulaContext; dispose: () => void }
  columnAbsolute: string
  match: string
  rawColumn: string
  rawRow: string
  rawTarget: string
  rowAbsolute: string
}): { replacement: string; resolved: boolean } {
  const address = cellAddressToIndexes(`${rawColumn}${rawRow}`)
  const target = wikilinkTarget(`[[${rawTarget}]]`)
  if (!address) return { replacement: match, resolved: false }

  const entry = resolveSheetEntry(
    cacheRun.context.entries,
    target,
    cacheRun.context.sourceEntry,
    cacheRun.context.entryResolutionCache,
  )
  if (entry && notePathsMatch(entry.path, cacheRun.context.currentPath)) {
    return {
      replacement: localSheetCellReference(columnAbsolute, rawColumn, rowAbsolute, rawRow),
      resolved: true,
    }
  }

  const literal = resolveExternalCellReference(
    { address: metadataCellAddress(address.row, address.column), target },
    cacheRun.context,
  )
  return literal === null
    ? { replacement: match, resolved: false }
    : { replacement: literal, resolved: true }
}

export function resolveExternalFormulaInput(
  value: string,
  context?: SheetExternalFormulaContext,
): SheetExternalFormulaInput | null {
  if (!context || !isExternalFormulaInput(value)) return null

  const cacheRun = withExternalWorkbookCache(context)
  let unresolved = false
  try {
    let evaluated = value.replace(SHEET_EXTERNAL_CELL_REFERENCE_PATTERN, (match, rawTarget, columnAbsolute, rawColumn, rowAbsolute, row) => {
      const { replacement, resolved } = replacementForExternalFormulaReference({
        cacheRun,
        columnAbsolute,
        match,
        rawColumn,
        rawRow: row,
        rawTarget,
        rowAbsolute,
      })
      unresolved = unresolved || !resolved
      return replacement
    })

    evaluated = evaluated.replace(SHEET_EXTERNAL_FRONTMATTER_REFERENCE_PATTERN, (match, rawTarget, propertyPath) => {
      const reference = parseSheetExternalFrontmatterReference({ propertyPath, rawTarget })
      if (!reference) return match
      return resolveExternalFrontmatterReference(reference, cacheRun.context)
    })

    if (unresolved || evaluated === value) return null
    return { evaluated, source: value }
  } finally {
    cacheRun.dispose()
  }
}

function userFacingExternalCellContent(
  rawContent: string,
  row: number,
  column: number,
  externalFormulaInputs: Map<string, SheetExternalFormulaInput>,
): string {
  const externalFormula = externalFormulaInputs.get(metadataCellAddress(row, column))
  return externalFormula && rawContent === externalFormula.evaluated
    ? externalFormula.source
    : rawContent
}

function bridgeExternalFormulaCellContent(
  model: Model,
  externalFormulaInputs: Map<string, SheetExternalFormulaInput>,
): void {
  const bridgedModel = model as Model & SheetExternalFormulaContentBridgeState
  if (bridgedModel[SHEET_EXTERNAL_FORMULA_CONTENT_BRIDGE]) return

  const rawGetCellContent = model.getCellContent.bind(model)
  const bridgedGetCellContent: Model['getCellContent'] = (sheet, row, column) => {
    const rawContent = rawGetCellContent(sheet, row, column)
    if (sheet !== SHEET_INDEX) return rawContent
    return userFacingExternalCellContent(rawContent, row, column, externalFormulaInputs)
  }

  bridgedModel[SHEET_EXTERNAL_FORMULA_CONTENT_BRIDGE] = rawGetCellContent
  try {
    Object.defineProperty(bridgedModel, 'getCellContent', {
      configurable: true,
      value: bridgedGetCellContent,
    })
  } catch {
    bridgedModel.getCellContent = bridgedGetCellContent
  }
}

function workbookNameFromPath({ path }: { path: string }): string {
  const filename = path.split(/[\\/]/).at(-1) ?? 'Tolaria Sheet'
  return filename.replace(/\.md$/i, '') || 'Tolaria Sheet'
}

export function summarizeSheetContent(content: string): SheetContentSummary {
  const parts = splitSheetDocument(content)
  const rows = parseCsvRows(parts.body.trimEnd())
  return {
    columnCount: rows.reduce((max, row) => Math.max(max, row.length), 0),
    hasMetadata: !isSheetMetadataEmpty(parseSheetMetadata(parts.frontmatter)),
    rowCount: rows.length,
  }
}

function sheetContentBoundsFromRows({ rows }: { rows: string[][] }): UsedBounds {
  return {
    columnCount: rows.reduce((max, row) => Math.max(max, row.length), 0),
    rowCount: rows.length,
  }
}

function workbookCellBuildInput({
  columnIndex,
  rowIndex,
  value,
}: {
  columnIndex: number
  rowIndex: number
  value: string
}): WorkbookCellBuildInput {
  return {
    address: metadataCellAddress(rowIndex + 1, columnIndex + 1),
    column: columnIndex + 1,
    row: rowIndex + 1,
    value,
  }
}

function workbookCellExternalFormula(
  markdownValue: string,
  address: string,
  state: WorkbookCellBuildState,
): SheetExternalFormulaInput | null {
  const nativeExternalFormula = state.nativeExternalFormulaInputs?.get(address)
  return nativeExternalFormula?.source === markdownValue
    ? nativeExternalFormula
    : resolveExternalFormulaInput(markdownValue, state.externalFormulaCacheRun?.context)
}

function applyWorkbookCellWikilink(
  markdownValue: string,
  cell: WorkbookCellBuildInput,
  state: WorkbookCellBuildState,
): void {
  if (!sheetCellContainsWikilink({ value: markdownValue })) return

  state.wikilinkFormattedValues.set(
    sheetWikilinkFormattedValueKey(SHEET_INDEX, cell.row, cell.column),
    sheetWikilinkDisplayValue(markdownValue, state.entries, state.sourceEntry),
  )
  applySheetWikilinkStyle(state.model, {
    sheet: SHEET_INDEX,
    row: cell.row,
    column: cell.column,
    width: 1,
    height: 1,
  }, sheetWikilinkCanvasColor(markdownValue, state.entries, state.sourceEntry))
}

function applyWorkbookCell(cell: WorkbookCellBuildInput, state: WorkbookCellBuildState): void {
  const markdownCell = parseSheetMarkdownCell(cell.value)
  const externalFormula = workbookCellExternalFormula(markdownCell.value, cell.address, state)
  const modelInput = externalFormula?.evaluated ?? markdownCell.value
  if (markdownCell.value !== '') {
    state.model.setUserInput(SHEET_INDEX, cell.row, cell.column, modelInput)
  }
  if (externalFormula) {
    state.externalFormulaInputs.set(cell.address, externalFormula)
  }
  applyWorkbookCellWikilink(markdownCell.value, cell, state)
  if (Object.keys(markdownCell.metadata).length > 0) {
    state.markdownMetadata.cells[cell.address] = markdownCell.metadata
  }
}

function applyWorkbookRows({ rows, state }: { rows: string[][]; state: WorkbookCellBuildState }): void {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? []
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      applyWorkbookCell(workbookCellBuildInput({
        columnIndex,
        rowIndex,
        value: row[columnIndex] ?? '',
      }), state)
    }
  }
}

export function buildWorkbook(
  content: string,
  path: string,
  externalFormulaContext?: SheetExternalFormulaContext,
  nativeExternalFormulaInputs?: Map<string, SheetExternalFormulaInput> | null,
): SheetWorkbookBuild {
  const rows = parseSheetRows({ content })
  const metadata = parseSheetMetadata(splitSheetDocument(content).frontmatter)
  const externalFormulaCacheRun = externalFormulaContext ? withExternalWorkbookCache(externalFormulaContext) : null
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const model = new Model(workbookNameFromPath({ path }), 'en', timezone)
  const state: WorkbookCellBuildState = {
    entries: externalFormulaContext?.entries ?? EMPTY_VAULT_ENTRIES,
    externalFormulaCacheRun,
    externalFormulaInputs: new Map(),
    markdownMetadata: emptySheetMetadata(),
    model,
    nativeExternalFormulaInputs,
    sourceEntry: externalFormulaContext?.sourceEntry,
    wikilinkFormattedValues: new Map(),
  }

  model.pauseEvaluation()
  try {
    applyWorkbookRows({ rows, state })
    applySheetMetadata(model, state.markdownMetadata)
    applySheetMetadata(model, metadata)
  } finally {
    model.resumeEvaluation()
    externalFormulaCacheRun?.dispose()
  }

  model.evaluate()
  model.setSelectedSheet(SHEET_INDEX)
  bridgeExternalFormulaCellContent(model, state.externalFormulaInputs)
  bridgeSheetWikilinkFormattedValues({
    entries: state.entries,
    formattedValues: state.wikilinkFormattedValues,
    model,
    sheetIndex: SHEET_INDEX,
    sourceEntry: state.sourceEntry,
  })
  return { externalFormulaInputs: state.externalFormulaInputs, model }
}

function applyCellStyleValue(
  model: Model,
  area: IronCalcArea,
  value: string | number | boolean | undefined,
  stylePath: string,
): void {
  if (value !== undefined) model.updateRangeStyle(area, stylePath, String(value))
}

function applyCellColorStyleValue(
  model: Model,
  area: IronCalcArea,
  value: string | undefined,
  stylePath: string,
): void {
  const color = normalizeSheetColorForIronCalc(value)
  if (color) model.updateRangeStyle(area, stylePath, color)
}

function applyCellFontSize(model: Model, area: IronCalcArea, metadata: SheetCellMetadata): void {
  if (metadata.fontSize === undefined) return
  const currentFontSize = model.getCellStyle(SHEET_INDEX, area.row, area.column).font.sz ?? DEFAULT_FONT_SIZE
  const delta = metadata.fontSize - currentFontSize
  if (delta !== 0) model.updateRangeStyle(area, 'font.size_delta', String(delta))
}

function applyCellBorderMetadata(
  model: Model,
  area: IronCalcArea,
  type: BorderType,
  metadata: SheetBorderMetadata | undefined,
): void {
  if (!metadata) return
  model.setAreaWithBorder(area, {
    type,
    item: {
      color: normalizeSheetColorForIronCalc(metadata.color) ?? DEFAULT_FONT_COLOR,
      style: metadata.style,
    },
  })
}

function applyCellBorders(model: Model, area: IronCalcArea, metadata: SheetCellMetadata): void {
  applyCellBorderMetadata(model, area, SHEET_BORDER_TYPES.top, metadata.borderTop)
  applyCellBorderMetadata(model, area, SHEET_BORDER_TYPES.right, metadata.borderRight)
  applyCellBorderMetadata(model, area, SHEET_BORDER_TYPES.bottom, metadata.borderBottom)
  applyCellBorderMetadata(model, area, SHEET_BORDER_TYPES.left, metadata.borderLeft)
}

function applyCellMetadata({
  cell,
  metadata,
  model,
}: {
  cell: string
  metadata: SheetCellMetadata
  model: Model
}): void {
  const indexes = cellAddressToIndexes(cell)
  if (!indexes) return

  const area = {
    sheet: SHEET_INDEX,
    row: indexes.row,
    column: indexes.column,
    width: 1,
    height: 1,
  }

  applyCellStyleValue(model, area, metadata.numFmt, 'num_fmt')
  applyCellStyleValue(model, area, metadata.bold, 'font.b')
  applyCellStyleValue(model, area, metadata.italic, 'font.i')
  applyCellStyleValue(model, area, metadata.underline, 'font.u')
  applyCellStyleValue(model, area, metadata.strike, 'font.strike')
  applyCellFontSize(model, area, metadata)
  applyCellColorStyleValue(model, area, metadata.fontColor, 'font.color')
  applyCellColorStyleValue(model, area, metadata.fillColor, 'fill.fg_color')
  applyCellStyleValue(model, area, metadata.horizontalAlign, 'alignment.horizontal')
  applyCellStyleValue(model, area, metadata.verticalAlign, 'alignment.vertical')
  applyCellStyleValue(model, area, metadata.wrapText, 'alignment.wrap_text')
  applyCellBorders(model, area, metadata)
}

function applySheetSettings(model: Model, metadata: SheetMetadata): void {
  if (metadata.showGridLines !== undefined) model.setShowGridLines(SHEET_INDEX, metadata.showGridLines)
  if (metadata.frozenRows !== undefined) model.setFrozenRowsCount(SHEET_INDEX, metadata.frozenRows)
  if (metadata.frozenColumns !== undefined) model.setFrozenColumnsCount(SHEET_INDEX, metadata.frozenColumns)
}

function applySheetColumns(model: Model, metadata: SheetMetadata): void {
  for (const [columnName, column] of Object.entries(metadata.columns)) {
    if (column.width === undefined) continue
    const columnIndex = columnIndexFromName(columnName)
    if (columnIndex === null) continue
    model.setColumnsWidth(SHEET_INDEX, columnIndex, columnIndex, column.width)
  }
}

function applySheetRows(model: Model, metadata: SheetMetadata): void {
  for (const [rowName, row] of Object.entries(metadata.rows)) {
    if (row.height === undefined) continue
    const rowIndex = Number(rowName)
    if (!Number.isInteger(rowIndex) || rowIndex < 1) continue
    model.setRowsHeight(SHEET_INDEX, rowIndex, rowIndex, row.height)
  }
}

function applySheetMetadata(model: Model, metadata: SheetMetadata): void {
  applySheetSettings(model, metadata)
  applySheetColumns(model, metadata)
  applySheetRows(model, metadata)
  for (const [cell, cellMetadata] of Object.entries(metadata.cells)) {
    applyCellMetadata({ cell, metadata: cellMetadata, model })
  }
}

function workbookUsedArea(
  model: Model,
  scanBounds: UsedBounds = {
    rowCount: DEFAULT_SERIALIZATION_SCAN_ROWS,
    columnCount: DEFAULT_SERIALIZATION_SCAN_COLUMNS,
  },
): UsedArea {
  let rowCount = 0
  let columnCount = 0
  const cells = new Map<string, UsedCell>()
  const maxRows = Math.max(1, Math.min(scanBounds.rowCount, MAX_SHEET_ROWS))
  const maxColumns = Math.max(1, Math.min(scanBounds.columnCount, MAX_SHEET_COLUMNS))

  if (maxRows <= maxColumns) {
    for (let row = 1; row <= maxRows; row += 1) {
      let rowHasData = false
      for (const column of model.getColumnsWithData(SHEET_INDEX, row)) {
        if (column <= 0 || column > maxColumns) continue
        rowHasData = true
        columnCount = Math.max(columnCount, column)
        cells.set(metadataCellAddress(row, column), { row, column })
      }
      if (rowHasData) rowCount = row
    }

    return { cells: Array.from(cells.values()), rowCount, columnCount }
  }

  for (let column = 1; column <= maxColumns; column += 1) {
    let columnHasData = false
    for (const row of model.getRowsWithData(SHEET_INDEX, column)) {
      if (row <= 0 || row > maxRows) continue
      columnHasData = true
      rowCount = Math.max(rowCount, row)
      cells.set(metadataCellAddress(row, column), { row, column })
    }
    if (columnHasData) columnCount = column
  }

  return { cells: Array.from(cells.values()), rowCount, columnCount }
}

function workbookUsedAreaForRows(model: Model, dirtyRows: Set<number>): UsedArea {
  let rowCount = 0
  let columnCount = 0
  const cells = new Map<string, UsedCell>()

  for (const row of dirtyRows) {
    if (row < 1 || row > MAX_SHEET_ROWS) continue
    for (const column of model.getColumnsWithData(SHEET_INDEX, row)) {
      if (column <= 0 || column > MAX_SHEET_COLUMNS) continue
      rowCount = Math.max(rowCount, row)
      columnCount = Math.max(columnCount, column)
      cells.set(metadataCellAddress(row, column), { row, column })
    }
  }

  return { cells: Array.from(cells.values()), rowCount, columnCount }
}

function workbookUsedAreaForSheetSave(model: Model, sourceBounds: UsedBounds, dirtyRows: SheetBodyDirtyRows): UsedArea {
  if (dirtyRows === null) return { cells: [], rowCount: 0, columnCount: 0 }
  if (dirtyRows instanceof Set) return workbookUsedAreaForRows(model, dirtyRows)
  return workbookUsedArea(model, combinedBounds(
    sourceBounds,
    { rowCount: DEFAULT_SERIALIZATION_SCAN_ROWS, columnCount: DEFAULT_SERIALIZATION_SCAN_COLUMNS },
  ))
}

function workbookUsedBounds(model: Model): UsedBounds {
  return workbookUsedArea(model)
}

export function boundedSheetIndex(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 1) return 0
  return Math.min(Math.floor(value), max)
}

function combinedBounds(left: UsedBounds, right: UsedBounds): UsedBounds {
  return {
    rowCount: Math.max(left.rowCount, right.rowCount),
    columnCount: Math.max(left.columnCount, right.columnCount),
  }
}

function previousMetadataBounds(metadata: SheetMetadata): UsedBounds {
  const rowCount = Object.keys(metadata.rows)
    .reduce((max, row) => Math.max(max, boundedSheetIndex(Number(row), MAX_SHEET_ROWS)), 0)
  const columnCount = Object.keys(metadata.columns)
    .reduce((max, column) => Math.max(max, boundedSheetIndex(columnIndexFromName(column) ?? 0, MAX_SHEET_COLUMNS)), 0)

  return { rowCount, columnCount }
}

function serializeWorkbookCell(
  model: Model,
  row: number,
  column: number,
  externalFormulaInputs?: Map<string, SheetExternalFormulaInput>,
): string {
  const content = model.getCellContent(SHEET_INDEX, row, column)
  const externalFormula = externalFormulaInputs?.get(metadataCellAddress(row, column))
  if (externalFormula && content === externalFormula.evaluated) return externalFormula.source
  return parseSheetMarkdownCell(content).value
}

function serializeWorkbookRows(
  model: Model,
  bounds: UsedBounds = workbookUsedBounds(model),
  externalFormulaInputs?: Map<string, SheetExternalFormulaInput>,
): string[][] {
  const { rowCount, columnCount } = bounds
  const rows: string[][] = []

  for (let row = 1; row <= rowCount; row += 1) {
    const cells: string[] = []
    for (let column = 1; column <= columnCount; column += 1) {
      cells.push(serializeWorkbookCell(model, row, column, externalFormulaInputs))
    }
    rows.push(cells)
  }

  return rows
}

function serializeWorkbookRow(
  model: Model,
  row: number,
  columnCount: number,
  externalFormulaInputs?: Map<string, SheetExternalFormulaInput>,
): string[] {
  return Array.from({ length: columnCount }, (_, columnIndex) => (
    serializeWorkbookCell(model, row, columnIndex + 1, externalFormulaInputs)
  ))
}

function serializeWorkbookDirtyRows(
  model: Model,
  dirtyRows: Set<number>,
  columnCount: number,
  externalFormulaInputs?: Map<string, SheetExternalFormulaInput>,
): Map<number, string[]> {
  const rows = new Map<number, string[]>()
  for (const row of dirtyRows) {
    if (row < 1 || row > MAX_SHEET_ROWS) continue
    rows.set(row - 1, serializeWorkbookRow(model, row, columnCount, externalFormulaInputs))
  }
  return rows
}

function extractBorderMetadata(
  border: CellStyle['border'],
  side: 'bottom' | 'left' | 'right' | 'top',
): SheetBorderMetadata | undefined {
  const item = border[side] as { color?: string; style?: string } | undefined
  if (!item?.style) return undefined
  return item.color ? { color: item.color, style: item.style } : { style: item.style }
}

function extractFontMetadata(font: CellStyle['font']): SheetCellMetadata {
  const metadata: SheetCellMetadata = {}
  if (font.b) metadata.bold = true
  if (font.i) metadata.italic = true
  if (font.u) metadata.underline = true
  if (font.strike) metadata.strike = true
  if (font.sz && font.sz !== DEFAULT_FONT_SIZE) metadata.fontSize = font.sz
  if (font.color && font.color !== DEFAULT_FONT_COLOR) metadata.fontColor = font.color
  return metadata
}

function extractAlignmentMetadata(alignment: CellStyle['alignment']): SheetCellMetadata {
  const metadata: SheetCellMetadata = {}
  if (alignment?.horizontal && alignment.horizontal !== 'general') {
    metadata.horizontalAlign = alignment.horizontal
  }
  if (alignment?.vertical && alignment.vertical !== DEFAULT_VERTICAL_ALIGN) {
    metadata.verticalAlign = alignment.vertical
  }
  if (alignment?.wrap_text) metadata.wrapText = true
  return metadata
}

function extractCellMetadata(style: CellStyle): SheetCellMetadata {
  const metadata: SheetCellMetadata = {
    ...extractFontMetadata(style.font),
    ...extractAlignmentMetadata(style.alignment),
  }
  if (style.num_fmt && style.num_fmt !== 'general') metadata.numFmt = style.num_fmt
  if (style.fill.fg_color) metadata.fillColor = style.fill.fg_color
  const borderTop = extractBorderMetadata(style.border, 'top')
  const borderRight = extractBorderMetadata(style.border, 'right')
  const borderBottom = extractBorderMetadata(style.border, 'bottom')
  const borderLeft = extractBorderMetadata(style.border, 'left')
  if (borderTop !== undefined) metadata.borderTop = borderTop
  if (borderRight !== undefined) metadata.borderRight = borderRight
  if (borderBottom !== undefined) metadata.borderBottom = borderBottom
  if (borderLeft !== undefined) metadata.borderLeft = borderLeft
  return metadata
}

function hasCellMetadata(metadata: SheetCellMetadata): boolean {
  return Object.keys(metadata).length > 0
}

function mergeCellMetadata(left: SheetCellMetadata, right: SheetCellMetadata): SheetCellMetadata {
  return { ...left, ...right }
}

function removeDefaultWikilinkVisualMetadata(metadata: SheetCellMetadata): SheetCellMetadata {
  const cleaned = { ...metadata }
  if (cleaned.fontColor?.toLowerCase() === SHEET_WIKILINK_FONT_COLOR) Reflect.deleteProperty(cleaned, 'fontColor')
  if (cleaned.underline === true) Reflect.deleteProperty(cleaned, 'underline')
  return cleaned
}

function addCellCandidate({
  candidates,
  column,
  row,
}: {
  candidates: Map<string, UsedCell>
  column: number
  row: number
}): void {
  if (row < 1 || row > MAX_SHEET_ROWS || column < 1 || column > MAX_SHEET_COLUMNS) return
  candidates.set(metadataCellAddress(row, column), { row, column })
}

function selectedMetadataBounds(model: Model): { endColumn: number; endRow: number; startColumn: number; startRow: number } | null {
  const view = model.getSelectedView()
  if (view.sheet !== SHEET_INDEX) return null

  const startRow = boundedSheetIndex(Math.min(view.range[0], view.range[2]), MAX_SHEET_ROWS)
  const endRow = boundedSheetIndex(Math.max(view.range[0], view.range[2]), MAX_SHEET_ROWS)
  const startColumn = boundedSheetIndex(Math.min(view.range[1], view.range[3]), MAX_SHEET_COLUMNS)
  const endColumn = boundedSheetIndex(Math.max(view.range[1], view.range[3]), MAX_SHEET_COLUMNS)
  if (startRow === 0 || endRow === 0 || startColumn === 0 || endColumn === 0) return null
  const selectedCellCount = (endRow - startRow + 1) * (endColumn - startColumn + 1)
  if (selectedCellCount > SELECTED_METADATA_CELL_LIMIT) return null

  return { endColumn, endRow, startColumn, startRow }
}

function addSelectedCellCandidates(model: Model, candidates: Map<string, UsedCell>): void {
  const bounds = selectedMetadataBounds(model)
  if (!bounds) return

  for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
    for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
      addCellCandidate({ candidates, column, row })
    }
  }
}

function metadataCellCandidates(model: Model, previousMetadata: SheetMetadata, usedArea: UsedArea): UsedCell[] {
  const candidates = new Map<string, UsedCell>()

  for (const cell of usedArea.cells) addCellCandidate({ candidates, column: cell.column, row: cell.row })
  for (const cell of Object.keys(previousMetadata.cells)) {
    const indexes = cellAddressToIndexes(cell)
    if (indexes) addCellCandidate({ candidates, column: indexes.column, row: indexes.row })
  }
  addSelectedCellCandidates(model, candidates)

  return Array.from(candidates.values())
}

function extractSheetSettingsMetadata(model: Model, metadata: SheetMetadata): void {
  const showGridLines = model.getShowGridLines(SHEET_INDEX)
  const frozenRows = model.getFrozenRowsCount(SHEET_INDEX)
  const frozenColumns = model.getFrozenColumnsCount(SHEET_INDEX)

  if (showGridLines !== DEFAULT_SHOW_GRID_LINES) metadata.showGridLines = showGridLines
  if (frozenRows !== DEFAULT_FROZEN_ROWS) metadata.frozenRows = frozenRows
  if (frozenColumns !== DEFAULT_FROZEN_COLUMNS) metadata.frozenColumns = frozenColumns
}

function extractSheetColumnMetadata(model: Model, metadata: SheetMetadata, bounds: UsedBounds): void {
  for (let column = 1; column <= bounds.columnCount; column += 1) {
    const width = model.getColumnWidth(SHEET_INDEX, column)
    if (width !== DEFAULT_COLUMN_WIDTH) {
      metadata.columns[columnNameFromOneBasedIndex(column)] = { width }
    }
  }
}

function extractSheetRowMetadata(model: Model, metadata: SheetMetadata, bounds: UsedBounds): void {
  for (let row = 1; row <= bounds.rowCount; row += 1) {
    const height = model.getRowHeight(SHEET_INDEX, row)
    if (height !== DEFAULT_ROW_HEIGHT) {
      metadata.rows[String(row)] = { height }
    }
  }
}

function extractSheetCellMetadata(model: Model, metadata: SheetMetadata, previousMetadata: SheetMetadata, usedArea: UsedArea): void {
  for (const { row, column } of metadataCellCandidates(model, previousMetadata, usedArea)) {
    const markdownCell = parseSheetMarkdownCell(model.getCellContent(SHEET_INDEX, row, column))
    const extractedMetadata = mergeCellMetadata(
      extractCellMetadata(model.getCellStyle(SHEET_INDEX, row, column)),
      markdownCell.metadata,
    )
    const cellMetadata = sheetCellContainsWikilink({ value: markdownCell.value })
      ? removeDefaultWikilinkVisualMetadata(extractedMetadata)
      : extractedMetadata
    if (hasCellMetadata(cellMetadata)) {
      metadata.cells[metadataCellAddress(row, column)] = cellMetadata
    }
  }
}

function extractSheetMetadata(model: Model, previousMetadata: SheetMetadata, usedArea: UsedArea): SheetMetadata {
  const bounds = combinedBounds(usedArea, previousMetadataBounds(previousMetadata))
  const metadata = emptySheetMetadata()

  extractSheetSettingsMetadata(model, metadata)
  extractSheetColumnMetadata(model, metadata, bounds)
  extractSheetRowMetadata(model, metadata, bounds)
  extractSheetCellMetadata(model, metadata, previousMetadata, usedArea)
  return metadata
}

function serializeSourceRows(source: ParsedCsvRows): string {
  return source.rawRows.map((row, index) => `${row}${source.rowTerminators[index] ?? ''}`).join('')
}

function serializeSheetBody({
  bounds,
  dirtyRows,
  externalFormulaInputs,
  model,
  source,
}: {
  bounds: UsedBounds
  dirtyRows: SheetBodyDirtyRows
  externalFormulaInputs?: Map<string, SheetExternalFormulaInput>
  model: Model
  source: ParsedCsvRows
}): string {
  if (dirtyRows === null) return serializeSourceRows(source)
  if (dirtyRows instanceof Set) {
    return serializeCsvRowsReplacingParsedSourceRows(
      source,
      serializeWorkbookDirtyRows(model, dirtyRows, bounds.columnCount, externalFormulaInputs),
    )
  }

  return serializeCsvRowsPreservingParsedSourceRows(
    serializeWorkbookRows(model, bounds, externalFormulaInputs),
    source,
  )
}

export function buildSheetContent(
  content: string,
  model: Model,
  externalFormulaInputs?: Map<string, SheetExternalFormulaInput>,
  options: SheetContentBuildOptions = {},
): string {
  const { body, frontmatter } = splitSheetDocument(content)
  const sourceRows = parseCsvRowsWithSource(body)
  const previousMetadata = parseSheetMetadata(frontmatter)
  const sourceBounds = sheetContentBoundsFromRows({ rows: sourceRows.rows })
  const bodyRows = options.bodyRows === undefined ? 'all' : options.bodyRows
  const usedArea = workbookUsedAreaForSheetSave(model, sourceBounds, bodyRows)
  const serializedBounds = combinedBounds(sourceBounds, usedArea)
  const frontmatterWithMetadata = mergeSheetMetadata(
    frontmatter,
    extractSheetMetadata(model, previousMetadata, usedArea),
  )
  return mergeSheetDocument(
    frontmatterWithMetadata,
    serializeSheetBody({
      bounds: serializedBounds,
      dirtyRows: bodyRows,
      externalFormulaInputs,
      model,
      source: sourceRows,
    }),
  )
}
