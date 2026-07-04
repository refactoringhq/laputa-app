import type { VaultEntry } from '../types'
import { resolveSheetFrontmatterProperty } from './sheetFrontmatterProperties'
import { splitSheetDocument } from './sheetCsv'
import { cellAddressToIndexes } from './sheetMetadata'
import { buildWorkbook, sheetExternalFormulaContext, SHEET_INDEX } from './sheetWorkbook'
import { notePathsMatch } from './notePathIdentity'
import { resolveEntry, wikilinkTarget } from './wikilink'

type VaultExpressionValue = boolean | number | string | null
type VaultExpressionReferenceKind = 'cell' | 'line' | 'property'
type BodyLineNumber = number
type DateFormatName = string
type DisplayText = string
type ExpressionFunctionName = string
type ExpressionSource = string
type HtmlText = string
type LocaleTag = string
type PropertyKey = string
type PropertyPath = string[]
type SourceCharacter = string
type SourceOffset = number
type TemplateSource = string

interface LiteralExpression {
  type: 'literal'
  value: VaultExpressionValue
}

interface ReferenceExpression {
  type: 'reference'
  explicitCurrent: boolean
  kind: VaultExpressionReferenceKind
  path: PropertyPath
  raw: string
  target: string | null
}

interface CallExpression {
  args: VaultExpressionAst[]
  name: string
  type: 'call'
}

interface BinaryExpression {
  left: VaultExpressionAst
  operator: '+'
  right: VaultExpressionAst
  type: 'binary'
}

type VaultExpressionAst = BinaryExpression | CallExpression | LiteralExpression | ReferenceExpression

interface TemplateExpression {
  ast: VaultExpressionAst | null
  source: string
}

type TemplatePart = string | TemplateExpression

export interface CompiledVaultExpressionTemplate {
  parts: TemplatePart[]
}

export interface VaultExpressionContext {
  contentsByPath: Map<string, string>
  currentContent: string
  entries: VaultEntry[]
  locale?: string
  sourceEntry: VaultEntry | null
}

export interface RenderedVaultExpressionTemplate {
  html: string
  unresolved: string[]
}

interface Token {
  type: 'comma' | 'dot' | 'identifier' | 'lparen' | 'number' | 'plus' | 'rparen' | 'string' | 'wikilink'
  value: string
}

interface EvaluationResult {
  resolved: boolean
  value: VaultExpressionValue
}

interface ReferencedEntry {
  content: string
  entry: VaultEntry | null
}

type DateStylePreset = 'short' | 'medium' | 'long'

const TEMPLATE_EXPRESSION_PATTERN = /\{\{([\s\S]*?)\}\}/g
const CELL_ADDRESS_PATTERN = /^[A-Za-z]+[1-9]\d*$/
const DATE_STYLE_PRESETS = new Set<DateStylePreset>(['short', 'medium', 'long'])
const ENTRY_FALLBACK_FIELD_RESOLVERS: Record<string, (entry: VaultEntry) => VaultExpressionValue> = {
  filename: (entry) => entry.filename,
  path: (entry) => entry.path,
  status: (entry) => entry.status,
  title: (entry) => entry.title,
}
const IDENTIFIER_START_PATTERN = /[A-Za-z_]/
const IDENTIFIER_PART_PATTERN = /[A-Za-z0-9_-]/
const UNRESOLVED_RESULT: EvaluationResult = { resolved: false, value: null }

function isWhitespace(character: SourceCharacter): boolean {
  return /\s/.test(character)
}

function stringToken(source: ExpressionSource, start: SourceOffset): { next: SourceOffset; token: Token } | null {
  const quote = source[start]
  if (quote !== '"' && quote !== "'") return null

  let value = ''
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index] ?? ''
    if (character === '\\') {
      const escaped = source[index + 1]
      if (escaped === undefined) return null
      value += escaped
      index += 1
    } else if (character === quote) {
      return { next: index + 1, token: { type: 'string', value } }
    } else {
      value += character
    }
  }
  return null
}

function numberToken(source: ExpressionSource, start: SourceOffset): { next: SourceOffset; token: Token } | null {
  const match = source.slice(start).match(/^-?(?:\d+(?:\.\d+)?|\.\d+)/)
  return match ? { next: start + match[0].length, token: { type: 'number', value: match[0] } } : null
}

function identifierToken(source: ExpressionSource, start: SourceOffset): { next: SourceOffset; token: Token } | null {
  const first = source[start] ?? ''
  if (!IDENTIFIER_START_PATTERN.test(first)) return null

  let end = start + 1
  while (end < source.length && IDENTIFIER_PART_PATTERN.test(source[end] ?? '')) end += 1
  return { next: end, token: { type: 'identifier', value: source.slice(start, end) } }
}

function wikilinkToken(source: ExpressionSource, start: SourceOffset): { next: SourceOffset; token: Token } | null {
  if (!source.startsWith('[[', start)) return null

  const end = source.indexOf(']]', start + 2)
  if (end === -1) return null
  return { next: end + 2, token: { type: 'wikilink', value: source.slice(start, end + 2) } }
}

function simpleToken(character: SourceCharacter): Token['type'] | null {
  if (character === '.') return 'dot'
  if (character === ',') return 'comma'
  if (character === '(') return 'lparen'
  if (character === ')') return 'rparen'
  if (character === '+') return 'plus'
  return null
}

function readToken(source: ExpressionSource, start: SourceOffset): { next: SourceOffset; token: Token } | null {
  const character = source[start] ?? ''
  const simple = simpleToken(character)
  if (simple) return { next: start + 1, token: { type: simple, value: character } }

  return stringToken(source, start)
    ?? wikilinkToken(source, start)
    ?? numberToken(source, start)
    ?? identifierToken(source, start)
}

function tokenizeExpression(source: ExpressionSource): Token[] | null {
  const tokens: Token[] = []
  let index = 0
  while (index < source.length) {
    if (isWhitespace(source[index] ?? '')) {
      index += 1
      continue
    }

    const read = readToken(source, index)
    if (!read) return null
    tokens.push(read.token)
    index = read.next
  }
  return tokens
}

class ExpressionParser {
  private index = 0
  private readonly tokens: Token[]

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  parse(): VaultExpressionAst | null {
    const expression = this.parseConcatenation()
    return expression && this.index === this.tokens.length ? expression : null
  }

  private current(): Token | undefined {
    return this.tokens[this.index]
  }

  private consume(type: Token['type']): Token | null {
    const token = this.current()
    if (token?.type !== type) return null
    this.index += 1
    return token
  }

  private parseConcatenation(): VaultExpressionAst | null {
    let expression = this.parsePrimary()
    if (!expression) return null

    while (this.consume('plus')) {
      const right = this.parsePrimary()
      if (!right) return null
      expression = { left: expression, operator: '+', right, type: 'binary' }
    }
    return expression
  }

  private parsePrimary(): VaultExpressionAst | null {
    const token = this.current()
    if (!token) return null
    if (token.type === 'string') return this.parseString()
    if (token.type === 'number') return this.parseNumber()
    if (token.type === 'lparen') return this.parseGrouped()
    if (token.type === 'wikilink') return this.parseLinkedReference(token)
    if (token.type === 'identifier') return this.parseIdentifierExpression(token)
    return null
  }

  private parseString(): LiteralExpression | null {
    const token = this.consume('string')
    return token ? { type: 'literal', value: token.value } : null
  }

  private parseNumber(): LiteralExpression | null {
    const token = this.consume('number')
    if (!token) return null
    const value = Number(token.value)
    return Number.isFinite(value) ? { type: 'literal', value } : null
  }

  private parseGrouped(): VaultExpressionAst | null {
    this.consume('lparen')
    const expression = this.parseConcatenation()
    if (!expression || !this.consume('rparen')) return null
    return expression
  }

  private parseLinkedReference(token: Token): ReferenceExpression | null {
    this.index += 1
    if (!this.consume('dot')) return null

    const next = this.current()
    if (next?.type === 'number') {
      this.index += 1
      return {
        explicitCurrent: false,
        kind: 'line',
        path: [next.value],
        raw: `${token.value}.${next.value}`,
        target: wikilinkTarget(token.value),
        type: 'reference',
      }
    }
    if (next?.type !== 'identifier') return null

    const path = this.parsePathSegments()
    if (path.length === 0) return null
    return {
      explicitCurrent: false,
      kind: CELL_ADDRESS_PATTERN.test(path[0] ?? '') ? 'cell' : 'property',
      path,
      raw: `${token.value}.${path.join('.')}`,
      target: wikilinkTarget(token.value),
      type: 'reference',
    }
  }

  private parseIdentifierExpression(token: Token): VaultExpressionAst | null {
    if (this.tokens[this.index + 1]?.type === 'lparen') return this.parseCall(token.value)
    return this.parseCurrentReference()
  }

  private parseCall(name: string): CallExpression | null {
    this.index += 1
    this.consume('lparen')

    const args: VaultExpressionAst[] = []
    if (this.consume('rparen')) return { args, name, type: 'call' }
    while (this.current()) {
      const expression = this.parseConcatenation()
      if (!expression) return null
      args.push(expression)
      if (this.consume('rparen')) return { args, name, type: 'call' }
      if (!this.consume('comma')) return null
    }
    return null
  }

  private parseCurrentReference(): ReferenceExpression | null {
    const path = this.parsePathSegments()
    if (path.length === 0) return null

    const explicitCurrent = path[0] === 'this'
    const normalizedPath = explicitCurrent ? path.slice(1) : path
    if (normalizedPath.length === 0) return null
    return {
      explicitCurrent,
      kind: 'property',
      path: normalizedPath,
      raw: path.join('.'),
      target: null,
      type: 'reference',
    }
  }

  private parsePathSegments(): PropertyPath {
    const path: PropertyPath = []
    const first = this.consume('identifier')
    if (!first) return path
    path.push(first.value)

    while (this.consume('dot')) {
      const segment = this.consume('identifier')
      if (!segment) return []
      path.push(segment.value)
    }
    return path
  }
}

function parseExpression(source: ExpressionSource): VaultExpressionAst | null {
  const tokens = tokenizeExpression(source)
  return tokens ? new ExpressionParser(tokens).parse() : null
}

function expressionPart(source: TemplateSource): TemplateExpression {
  const trimmed = source.trim()
  return {
    ast: parseExpression(trimmed),
    source: trimmed,
  }
}

export function compileVaultExpressionTemplate(source: TemplateSource): CompiledVaultExpressionTemplate {
  const parts: TemplatePart[] = []
  let lastIndex = 0
  for (const match of source.matchAll(TEMPLATE_EXPRESSION_PATTERN)) {
    const index = match.index ?? 0
    if (index > lastIndex) parts.push(source.slice(lastIndex, index))
    parts.push(expressionPart(match[1] ?? ''))
    lastIndex = index + match[0].length
  }
  if (lastIndex < source.length) parts.push(source.slice(lastIndex))
  return { parts }
}

function escapeHtml(value: HtmlText): HtmlText {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function valueText(value: VaultExpressionValue): string {
  if (value === null) return ''
  return String(value)
}

function isEmptyValue(value: VaultExpressionValue): boolean {
  return value === null || value === ''
}

function numberValue(value: VaultExpressionValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null

  const parsed = Number(value.replace(/[$€£,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function integerArgument(value: VaultExpressionValue): number | null {
  const number = numberValue(value)
  return number === null ? null : Math.max(0, Math.trunc(number))
}

function stringArgument(value: VaultExpressionValue): string {
  return valueText(value)
}

function titleCase(value: DisplayText): DisplayText {
  return value.replace(/\b([A-Za-z])([A-Za-z]*)/g, (_match, first: string, rest: string) => (
    `${first.toUpperCase()}${rest.toLowerCase()}`
  ))
}

function truncateValue(value: DisplayText, length: VaultExpressionValue, suffix: VaultExpressionValue): DisplayText {
  const maxLength = integerArgument(length) ?? value.length
  const suffixText = suffix === null ? '...' : stringArgument(suffix)
  return value.length > maxLength ? `${value.slice(0, maxLength)}${suffixText}` : value
}

function formatNumber(value: VaultExpressionValue, digits: VaultExpressionValue, locale: LocaleTag): string | null {
  const number = numberValue(value)
  if (number === null) return null
  const fractionDigits = integerArgument(digits)
  return new Intl.NumberFormat(locale, fractionDigits === null ? {} : {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(number)
}

function formatPercent(value: VaultExpressionValue, digits: VaultExpressionValue, locale: LocaleTag): string | null {
  const number = numberValue(value)
  if (number === null) return null
  const fractionDigits = integerArgument(digits)
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: fractionDigits ?? 0,
    minimumFractionDigits: fractionDigits ?? 0,
    style: 'percent',
  }).format(number)
}

function formatCurrency(
  value: VaultExpressionValue,
  currency: VaultExpressionValue,
  digits: VaultExpressionValue,
  locale: LocaleTag,
): string | null {
  const number = numberValue(value)
  const currencyCode = stringArgument(currency).trim().toUpperCase()
  if (number === null || !/^[A-Z]{3}$/.test(currencyCode)) return null

  const fractionDigits = integerArgument(digits)
  return new Intl.NumberFormat(locale, {
    currency: currencyCode,
    maximumFractionDigits: fractionDigits ?? undefined,
    minimumFractionDigits: fractionDigits ?? undefined,
    style: 'currency',
  }).format(number)
}

function dateValue(value: VaultExpressionValue): Date | null {
  const date = new Date(valueText(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function isDateStylePreset(format: DateFormatName): format is DateStylePreset {
  return DATE_STYLE_PRESETS.has(format as DateStylePreset)
}

function formattedIsoDate(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function formattedDatePreset(date: Date, format: DateFormatName, locale: LocaleTag): string {
  if (isDateStylePreset(format)) {
    return new Intl.DateTimeFormat(locale, { dateStyle: format }).format(date)
  }
  if (format === 'YYYY-MM-DD') {
    return formattedIsoDate(date)
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}

function formatDate(value: VaultExpressionValue, format: VaultExpressionValue, locale: LocaleTag): string | null {
  const date = dateValue(value)
  return date ? formattedDatePreset(date, stringArgument(format || 'medium'), locale) : null
}

function evaluateTextFunction(name: ExpressionFunctionName, args: VaultExpressionValue[]): VaultExpressionValue {
  const value = stringArgument(args[0] ?? null)
  if (name === 'upper') return value.toUpperCase()
  if (name === 'lower') return value.toLowerCase()
  if (name === 'title') return titleCase(value)
  if (name === 'trim') return value.trim()
  if (name === 'truncate') return truncateValue(value, args[1] ?? null, args[2] ?? null)
  if (name === 'replace') return value.split(stringArgument(args[1] ?? null)).join(stringArgument(args[2] ?? null))
  return null
}

function evaluateNumberFunction(
  name: ExpressionFunctionName,
  args: VaultExpressionValue[],
  locale: LocaleTag,
): VaultExpressionValue {
  if (name === 'round') {
    const number = numberValue(args[0] ?? null)
    if (number === null) return null
    const digits = integerArgument(args[1] ?? 0) ?? 0
    const factor = 10 ** digits
    return Math.round(number * factor) / factor
  }
  if (name === 'formatNumber') return formatNumber(args[0] ?? null, args[1] ?? null, locale)
  if (name === 'formatPercent') return formatPercent(args[0] ?? null, args[1] ?? null, locale)
  if (name === 'formatCurrency') return formatCurrency(args[0] ?? null, args[1] ?? null, args[2] ?? null, locale)
  return null
}

function evaluateFunction(name: ExpressionFunctionName, args: VaultExpressionValue[], locale: LocaleTag): EvaluationResult {
  if (name === 'default') return { resolved: true, value: isEmptyValue(args[0] ?? null) ? (args[1] ?? null) : (args[0] ?? null) }
  if (name === 'isEmpty') return { resolved: true, value: isEmptyValue(args[0] ?? null) }
  if (name === 'formatDate') return { resolved: true, value: formatDate(args[0] ?? null, args[1] ?? 'medium', locale) }

  const text = evaluateTextFunction(name, args)
  if (text !== null) return { resolved: true, value: text }

  const number = evaluateNumberFunction(name, args, locale)
  return number === null ? UNRESOLVED_RESULT : { resolved: true, value: number }
}

function scalarEntryProperty(value: unknown): VaultExpressionValue {
  if (value === undefined || Array.isArray(value)) return null
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value
  return null
}

function singleEntryPropertyKey(entry: VaultEntry | null, path: PropertyPath): PropertyKey | null {
  const key = path[0]
  if (!entry || path.length !== 1 || !key) return null
  return key
}

function entryFallbackProperty(entry: VaultEntry | null, path: PropertyPath): VaultExpressionValue {
  const key = singleEntryPropertyKey(entry, path)
  if (!entry || key === null) return null

  const resolveFallbackField = ENTRY_FALLBACK_FIELD_RESOLVERS[key]
  return resolveFallbackField ? resolveFallbackField(entry) : scalarEntryProperty(entry.properties[key])
}

function referencedEntry(reference: ReferenceExpression, context: VaultExpressionContext): ReferencedEntry | null {
  if (reference.target === null) {
    return { content: context.currentContent, entry: context.sourceEntry }
  }

  const entry = resolveEntry(context.entries, reference.target, context.sourceEntry ?? undefined)
  if (!entry) return null
  if (context.sourceEntry && notePathsMatch(entry.path, context.sourceEntry.path)) {
    return { content: context.currentContent, entry }
  }

  const content = context.contentsByPath.get(entry.path)
  return content === undefined ? null : { content, entry }
}

function resolveProperty(reference: ReferenceExpression, context: VaultExpressionContext): EvaluationResult {
  const resolved = referencedEntry(reference, context)
  if (!resolved) return UNRESOLVED_RESULT

  const value = resolveSheetFrontmatterProperty(resolved.content, reference.path)
    ?? entryFallbackProperty(resolved.entry, reference.path)
  return value === null ? UNRESOLVED_RESULT : { resolved: true, value }
}

function bodyLine(content: TemplateSource, line: BodyLineNumber): string | null {
  return splitSheetDocument(content).body.split(/\r\n|\r|\n/)[line - 1] ?? null
}

function resolveLine(reference: ReferenceExpression, context: VaultExpressionContext): EvaluationResult {
  const resolved = referencedEntry(reference, context)
  if (!resolved) return UNRESOLVED_RESULT

  const line = bodyLine(resolved.content, Number(reference.path[0] ?? 0))
  return line === null ? UNRESOLVED_RESULT : { resolved: true, value: line }
}

function resolveCell(reference: ReferenceExpression, context: VaultExpressionContext): EvaluationResult {
  const resolved = referencedEntry(reference, context)
  const address = cellAddressToIndexes(reference.path[0] ?? '')
  if (!resolved || !address) return UNRESOLVED_RESULT

  const build = buildWorkbook(
    resolved.content,
    resolved.entry?.path ?? context.sourceEntry?.path ?? 'Tolaria',
    sheetExternalFormulaContext({
      contentsByPath: context.contentsByPath,
      currentPath: resolved.entry?.path ?? context.sourceEntry?.path ?? '',
      entries: context.entries,
      sourceEntry: resolved.entry,
    }),
  )
  try {
    const rawContent = build.model.getCellContent(SHEET_INDEX, address.row, address.column)
    const value = rawContent.trimStart().startsWith('=')
      ? build.model.getFormattedCellValue(SHEET_INDEX, address.row, address.column)
      : rawContent
    return { resolved: true, value }
  } finally {
    build.model.free()
  }
}

function evaluateReference(reference: ReferenceExpression, context: VaultExpressionContext): EvaluationResult {
  if (reference.kind === 'cell') return resolveCell(reference, context)
  if (reference.kind === 'line') return resolveLine(reference, context)
  return resolveProperty(reference, context)
}

function evaluateExpression(ast: VaultExpressionAst, context: VaultExpressionContext): EvaluationResult {
  if (ast.type === 'literal') return { resolved: true, value: ast.value }
  if (ast.type === 'reference') return evaluateReference(ast, context)
  if (ast.type === 'binary') {
    const left = evaluateExpression(ast.left, context)
    const right = evaluateExpression(ast.right, context)
    return left.resolved && right.resolved
      ? { resolved: true, value: `${valueText(left.value)}${valueText(right.value)}` }
      : UNRESOLVED_RESULT
  }

  const evaluatedArgs = ast.args.map((arg) => evaluateExpression(arg, context))
  if (ast.name !== 'default' && evaluatedArgs.some((arg) => !arg.resolved)) return UNRESOLVED_RESULT
  return evaluateFunction(ast.name, evaluatedArgs.map((arg) => arg.value), context.locale ?? 'en-US')
}

function unresolvedHtml(source: TemplateSource): HtmlText {
  return escapeHtml(`{{${source}}}`)
}

export function renderVaultExpressionTemplate({
  compiled,
  context,
}: {
  compiled: CompiledVaultExpressionTemplate
  context: VaultExpressionContext
}): RenderedVaultExpressionTemplate {
  const unresolved: string[] = []
  const html = compiled.parts.map((part) => {
    if (typeof part === 'string') return part
    if (!part.ast) {
      unresolved.push(part.source)
      return unresolvedHtml(part.source)
    }

    const result = evaluateExpression(part.ast, context)
    if (!result.resolved) {
      unresolved.push(part.source)
      return unresolvedHtml(part.source)
    }
    return escapeHtml(valueText(result.value))
  }).join('')
  return { html, unresolved }
}

function collectReferenceDependencies(ast: VaultExpressionAst, dependencies: ReferenceExpression[]): void {
  if (ast.type === 'reference') {
    if (ast.target !== null) dependencies.push(ast)
  } else if (ast.type === 'binary') {
    collectReferenceDependencies(ast.left, dependencies)
    collectReferenceDependencies(ast.right, dependencies)
  } else if (ast.type === 'call') {
    for (const arg of ast.args) collectReferenceDependencies(arg, dependencies)
  }
}

export function vaultExpressionReferences(compiled: CompiledVaultExpressionTemplate): ReferenceExpression[] {
  const dependencies: ReferenceExpression[] = []
  for (const part of compiled.parts) {
    if (typeof part !== 'string' && part.ast) collectReferenceDependencies(part.ast, dependencies)
  }
  return dependencies
}

function dependencyFormula(reference: ReferenceExpression): string | null {
  if (!reference.target) return null
  if (reference.kind === 'cell') return `=[[${reference.target}]].${reference.path[0] ?? ''}`
  if (reference.kind === 'line') return `=[[${reference.target}]].${reference.path[0] ?? ''}`
  return `=[[${reference.target}]].${reference.path.join('.')}`
}

export function vaultExpressionDependencySource(compiled: CompiledVaultExpressionTemplate): string {
  const lines = new Set<string>()
  for (const reference of vaultExpressionReferences(compiled)) {
    const formula = dependencyFormula(reference)
    if (formula) lines.add(formula)
  }
  return Array.from(lines).join('\n')
}
