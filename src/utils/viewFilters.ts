import type { VaultEntry, ViewDefinition, FilterGroup, FilterNode, FilterCondition, VaultPropertyValue } from '../types'
import { toDateFilterTimestamp } from './filterDates'
import { compileSafeUserRegex } from './safeRegex'
import { evaluateArrayFieldCondition, type ViewFilterArrayKind } from './viewFilterArrayFields'

type FieldScalar = string | number | boolean | null
type ResolvedField =
  | { kind: 'scalar'; value: FieldScalar }
  | { kind: 'array'; values: string[]; arrayKind: ViewFilterArrayKind }
type BuiltInFieldReader = (entry: VaultEntry) => ResolvedField
type TextOp = FilterCondition['op']

const BUILT_IN_FIELD_READERS = new Map<string, BuiltInFieldReader>([
  ['type', (entry) => scalarField(entry.isA)],
  ['isa', (entry) => scalarField(entry.isA)],
  ['status', (entry) => scalarField(entry.status)],
  ['title', (entry) => scalarField(entry.title)],
  ['filename', (entry) => scalarField(entry.filename)],
  ['archived', (entry) => scalarField(entry.archived)],
  ['favorite', (entry) => scalarField(entry.favorite)],
  ['body', (entry) => scalarField(entry.snippet)],
])

/** Evaluate a view's filters against a list of entries, returning only matches. */
export function evaluateView(definition: ViewDefinition, entries: VaultEntry[]): VaultEntry[] {
  return entries.filter((e) => !e.archived && evaluateGroup(definition.filters, e))
}

function evaluateGroup(group: FilterGroup, entry: VaultEntry): boolean {
  if ('all' in group) return group.all.every((node) => evaluateNode(node, entry))
  if ('any' in group) return group.any.some((node) => evaluateNode(node, entry))
  return true
}

function isFilterGroup(node: FilterNode): node is FilterGroup {
  return 'all' in node || 'any' in node
}

function evaluateNode(node: FilterNode, entry: VaultEntry): boolean {
  if (isFilterGroup(node)) return evaluateGroup(node, entry)
  return evaluateCondition(node as FilterCondition, entry)
}

function findCaseInsensitiveKey(record: Record<string, unknown>, lower: string): string | undefined {
  return Object.keys(record).find((k) => k.toLowerCase() === lower)
}

function scalarField(value: FieldScalar): ResolvedField {
  return { kind: 'scalar', value }
}

function arrayField(values: string[], arrayKind: ViewFilterArrayKind): ResolvedField {
  return { kind: 'array', values, arrayKind }
}

function propertyField(value: VaultPropertyValue): ResolvedField {
  if (Array.isArray(value)) return arrayField(value.map(toFilterString), 'property')
  return scalarField(value)
}

function resolveRelationshipField(entry: VaultEntry, lower: string): ResolvedField | null {
  const relKey = findCaseInsensitiveKey(entry.relationships, lower)
  return relKey ? arrayField(Reflect.get(entry.relationships, relKey) as string[], 'relationship') : null
}

function resolvePropertyField(entry: VaultEntry, lower: string): ResolvedField | null {
  const propKey = findCaseInsensitiveKey(entry.properties, lower)
  return propKey ? propertyField(Reflect.get(entry.properties, propKey) as VaultPropertyValue) : null
}

function resolveField(entry: VaultEntry, field: string): ResolvedField {
  const lower = field.toLowerCase()
  return BUILT_IN_FIELD_READERS.get(lower)?.(entry)
    ?? resolveRelationshipField(entry, lower)
    ?? resolvePropertyField(entry, lower)
    ?? scalarField(null)
}

function toFilterString(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  return String(v)
}

function compileRegex(cond: FilterCondition, value: string): RegExp | null {
  if (cond.regex !== true) return null
  const compiled = compileSafeUserRegex(value, 'i')
  return compiled.ok ? compiled.pattern : null
}

function usesRegex(cond: FilterCondition): boolean {
  return cond.regex === true
    && (cond.op === 'contains' || cond.op === 'not_contains' || cond.op === 'equals' || cond.op === 'not_equals')
}

function evaluateEmptyCondition(op: FilterCondition['op'], resolved: ReturnType<typeof resolveField>): boolean | null {
  if (op === 'is_empty') {
    if (resolved.kind === 'array') return resolved.values.length === 0
    const s = resolved.value
    return s == null || s === '' || s === false
  }
  if (op === 'is_not_empty') {
    if (resolved.kind === 'array') return resolved.values.length > 0
    const s = resolved.value
    return s != null && s !== '' && s !== false
  }
  return null
}

function textMatchResult(op: FilterCondition['op'], matched: boolean): boolean {
  if (op === 'contains' || op === 'equals') return matched
  if (op === 'not_contains' || op === 'not_equals') return !matched
  return false
}

function evaluateArrayCondition(cond: FilterCondition, resolved: Extract<ResolvedField, { kind: 'array' }>, condVal: string, regex: RegExp | null): boolean {
  return evaluateArrayFieldCondition({
    cond,
    values: resolved.values,
    arrayKind: resolved.arrayKind,
    condVal,
    regex,
  })
}

function evaluateRegexScalarCondition(op: FilterCondition['op'], fieldRaw: string, regex: RegExp): boolean {
  return textMatchResult(op, regex.test(fieldRaw))
}

function conditionList(value: unknown): string[] | null {
  return Array.isArray(value) ? value.map(toFilterString) : null
}

function evaluateTextComparison(op: TextOp, fieldStr: string, condStr: string): boolean | null {
  if (op === 'equals') return fieldStr === condStr
  if (op === 'not_equals') return fieldStr !== condStr
  if (op === 'contains') return fieldStr.includes(condStr)
  if (op === 'not_contains') return !fieldStr.includes(condStr)
  return null
}

function evaluateTextSetCondition(op: TextOp, fieldStr: string, values: string[] | null): boolean | null {
  if (!values) return null
  const matched = values.some((v) => v.toLowerCase() === fieldStr)
  if (op === 'any_of') return matched
  if (op === 'none_of') return !matched
  return null
}

function evaluateTextCondition(cond: FilterCondition, fieldRaw: string, condVal: string, regex: RegExp | null): boolean {
  const { op } = cond
  if (regex) return evaluateRegexScalarCondition(op, fieldRaw, regex)

  const fieldStr = fieldRaw.toLowerCase()
  const condStr = condVal.toLowerCase()
  return evaluateTextComparison(op, fieldStr, condStr)
    ?? evaluateTextSetCondition(op, fieldStr, conditionList(cond.value))
    ?? false
}

function fieldTimestamp(value: string | number | boolean | null | undefined): number | null {
  if (typeof value === 'number') return value * 1000 // Unix timestamp (seconds) -> milliseconds
  if (typeof value === 'string') return toDateFilterTimestamp(value)
  return null
}

function evaluateDateCondition(cond: FilterCondition, scalar: string | number | boolean | null | undefined, condVal: string): boolean {
  if (cond.op !== 'before' && cond.op !== 'after') return false

  const tsMs = fieldTimestamp(scalar)
  if (tsMs == null) return false
  const target = toDateFilterTimestamp(condVal)
  if (target == null) return false
  return cond.op === 'before' ? tsMs < target : tsMs > target
}

type DateTimestamps = {
  left: number
  right: number
}

function isSameLocalDay(timestamps: DateTimestamps): boolean {
  const leftTimestamp = timestamps.left
  const rightTimestamp = timestamps.right
  const leftDate = new Date(leftTimestamp)
  const rightDate = new Date(rightTimestamp)
  return leftDate.getFullYear() === rightDate.getFullYear()
    && leftDate.getMonth() === rightDate.getMonth()
    && leftDate.getDate() === rightDate.getDate()
}

type DateEqualityCondition = {
  op: FilterCondition['op']
  scalar: FieldScalar
  condVal: string
}

function evaluateDateEqualityCondition(condition: DateEqualityCondition): boolean | null {
  const { op, scalar, condVal } = condition
  if (op !== 'equals' && op !== 'not_equals') return null

  const tsMs = fieldTimestamp(scalar)
  const target = toDateFilterTimestamp(condVal)
  if (tsMs == null || target == null) return null

  const matched = isSameLocalDay({ left: tsMs, right: target })
  return op === 'equals' ? matched : !matched
}

type ScalarDateCondition = {
  cond: FilterCondition
  scalar: FieldScalar
  condVal: string
}

function evaluateScalarDateCondition(condition: ScalarDateCondition): boolean | null {
  const { cond, scalar, condVal } = condition
  if (cond.op === 'before' || cond.op === 'after') {
    return evaluateDateCondition(cond, scalar, condVal)
  }

  return evaluateDateEqualityCondition({ op: cond.op, scalar, condVal })
}

type ScalarCondition = ScalarDateCondition & {
  regex: RegExp | null
}

function evaluateScalarCondition(condition: ScalarCondition): boolean {
  const dateResult = evaluateScalarDateCondition(condition)
  if (dateResult !== null) return dateResult

  const { cond, scalar, condVal, regex } = condition
  return evaluateTextCondition(cond, toFilterString(scalar), condVal, regex)
}

function evaluateCondition(cond: FilterCondition, entry: VaultEntry): boolean {
  const resolved = resolveField(entry, cond.field)
  const emptyResult = evaluateEmptyCondition(cond.op, resolved)
  if (emptyResult !== null) return emptyResult

  const condVal = toFilterString(cond.value)
  const regex = usesRegex(cond) ? compileRegex(cond, condVal) : null
  if (usesRegex(cond) && !regex) return false

  if (resolved.kind === 'array') {
    return evaluateArrayCondition(cond, resolved, condVal, regex)
  }

  return evaluateScalarCondition({ cond, scalar: resolved.value, condVal, regex })
}
