import type { VaultEntry, ViewDefinition, FilterGroup, FilterNode, FilterCondition } from '../types'
import { toDateFilterTimestamp } from './filterDates'
import { compileSafeUserRegex } from './safeRegex'

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

function resolveField(entry: VaultEntry, field: string): { scalar?: string | number | boolean | null; array?: string[] } {
  const lower = field.toLowerCase()
  if (lower === 'type' || lower === 'isa') return { scalar: entry.isA }
  if (lower === 'status') return { scalar: entry.status }
  if (lower === 'title') return { scalar: entry.title }
  if (lower === 'filename') return { scalar: entry.filename }
  if (lower === 'archived') return { scalar: entry.archived }
  if (lower === 'favorite') return { scalar: entry.favorite }
  if (lower === 'body') return { scalar: entry.snippet }

  // Check relationships first (returns string[])
  const relKey = Object.keys(entry.relationships).find((k) => k.toLowerCase() === lower)
  if (relKey) return { array: entry.relationships[relKey] }

  // Then properties (returns scalar)
  const propKey = Object.keys(entry.properties).find((k) => k.toLowerCase() === lower)
  if (propKey) return { scalar: entry.properties[propKey] }

  return { scalar: null }
}

function wikilinkStem(raw: string): string {
  let s = raw.trim()
  if (s.startsWith('[[')) s = s.slice(2)
  if (s.endsWith(']]')) s = s.slice(0, -2)
  const pipe = s.indexOf('|')
  if (pipe >= 0) s = s.substring(0, pipe)
  return s.toLowerCase()
}

function relationshipCandidates(raw: string): string[] {
  const trimmed = raw.trim()
  let inner = trimmed
  if (inner.startsWith('[[')) inner = inner.slice(2)
  if (inner.endsWith(']]')) inner = inner.slice(0, -2)
  const pipe = inner.indexOf('|')
  if (pipe >= 0) {
    return [trimmed, inner.slice(0, pipe), inner.slice(pipe + 1)]
  }
  return [trimmed, inner]
}

/** Extract all comparable parts (path and alias) from a wikilink string. */
function wikilinkParts(raw: string): string[] {
  let s = raw.trim()
  if (s.startsWith('[[')) s = s.slice(2)
  if (s.endsWith(']]')) s = s.slice(0, -2)
  const pipe = s.indexOf('|')
  if (pipe >= 0) return [s.substring(0, pipe).toLowerCase(), s.substring(pipe + 1).toLowerCase()]
  return [s.toLowerCase()]
}

/** Check if two wikilink values match by comparing all path/alias combinations. */
function wikilinkEquals(a: string, b: string): boolean {
  const partsA = wikilinkParts(a)
  const partsB = wikilinkParts(b)
  return partsA.some(pa => partsB.some(pb => pa === pb))
}

function toString(v: unknown): string {
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
    if (resolved.array) return resolved.array.length === 0
    const s = resolved.scalar
    return s == null || s === '' || s === false
  }
  if (op === 'is_not_empty') {
    if (resolved.array) return resolved.array.length > 0
    const s = resolved.scalar
    return s != null && s !== '' && s !== false
  }
  return null
}

function evaluateRegexArrayCondition(op: FilterCondition['op'], values: string[], regex: RegExp): boolean {
  const matched = values.some((item) => relationshipCandidates(item).some((candidate) => regex.test(candidate)))
  if (op === 'contains' || op === 'equals') return matched
  if (op === 'not_contains' || op === 'not_equals') return !matched
  return false
}

function hasArrayMatch(values: string[], condVal: string): boolean {
  const stem = wikilinkStem(condVal)
  const isWikilink = condVal.trim().startsWith('[[')
  return values.some((item) => (
    isWikilink ? wikilinkEquals(item, condVal) : wikilinkStem(item).includes(stem)
  ))
}

function evaluateArrayCondition(cond: FilterCondition, values: string[], condVal: string, regex: RegExp | null): boolean {
  const { op, value } = cond
  if (regex) return evaluateRegexArrayCondition(op, values, regex)

  if (op === 'contains') return hasArrayMatch(values, condVal)
  if (op === 'not_contains') return !hasArrayMatch(values, condVal)
  if (op === 'any_of' && Array.isArray(value)) {
    return values.some((item) => (value as string[]).some((v) => wikilinkEquals(item, v)))
  }
  if (op === 'none_of' && Array.isArray(value)) {
    return !values.some((item) => (value as string[]).some((v) => wikilinkEquals(item, v)))
  }
  return false
}

function evaluateRegexScalarCondition(op: FilterCondition['op'], fieldRaw: string, regex: RegExp): boolean {
  const matched = regex.test(fieldRaw)
  if (op === 'equals' || op === 'contains') return matched
  if (op === 'not_equals' || op === 'not_contains') return !matched
  return false
}

function evaluateTextCondition(cond: FilterCondition, fieldRaw: string, condVal: string, regex: RegExp | null): boolean {
  const { op, value } = cond
  if (regex) return evaluateRegexScalarCondition(op, fieldRaw, regex)

  const fieldStr = fieldRaw.toLowerCase()
  const condStr = condVal.toLowerCase()
  if (op === 'equals') return fieldStr === condStr
  if (op === 'not_equals') return fieldStr !== condStr
  if (op === 'contains') return fieldStr.includes(condStr)
  if (op === 'not_contains') return !fieldStr.includes(condStr)
  if (op === 'any_of' && Array.isArray(value)) return (value as string[]).some((v) => toString(v).toLowerCase() === fieldStr)
  if (op === 'none_of' && Array.isArray(value)) return !(value as string[]).some((v) => toString(v).toLowerCase() === fieldStr)
  return false
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

function evaluateCondition(cond: FilterCondition, entry: VaultEntry): boolean {
  const resolved = resolveField(entry, cond.field)
  const emptyResult = evaluateEmptyCondition(cond.op, resolved)
  if (emptyResult !== null) return emptyResult

  const condVal = toString(cond.value)
  const regex = usesRegex(cond) ? compileRegex(cond, condVal) : null
  if (usesRegex(cond) && !regex) return false

  if (resolved.array) {
    return evaluateArrayCondition(cond, resolved.array, condVal, regex)
  }

  if (cond.op === 'before' || cond.op === 'after') {
    return evaluateDateCondition(cond, resolved.scalar, condVal)
  }

  return evaluateTextCondition(cond, toString(resolved.scalar), condVal, regex)
}
