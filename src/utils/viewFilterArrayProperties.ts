import type { FilterCondition } from '../types'

type ConditionText = string
type PropertyValue = string

function toStringValue(value: unknown): ConditionText {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return String(value)
}

function conditionList(value: unknown): ConditionText[] | null {
  return Array.isArray(value) ? value.map(toStringValue) : null
}

function textMatchResult(op: FilterCondition['op'], matched: boolean): boolean {
  if (op === 'contains' || op === 'equals') return matched
  if (op === 'not_contains' || op === 'not_equals') return !matched
  return false
}

class PropertyArrayField {
  private readonly values: PropertyValue[]
  private readonly normalizedValues: Set<PropertyValue>

  constructor(values: PropertyValue[]) {
    this.values = values
    this.normalizedValues = new Set(values.map((value) => value.toLowerCase()))
  }

  contains(target: ConditionText): boolean {
    return this.normalizedValues.has(target.toLowerCase())
  }

  equals(target: ConditionText): boolean {
    return this.values.length === 1 && this.contains(target)
  }

  matchesAny(targets: ConditionText[] | null): boolean {
    return targets?.some((target) => this.contains(target)) ?? false
  }

  matchesRegex(regex: RegExp): boolean {
    return this.values.some((value) => regex.test(value))
  }

  isEmpty(): boolean {
    return this.values.length === 0
  }
}

export function evaluatePropertyArrayCondition(
  cond: FilterCondition,
  values: PropertyValue[],
  condVal: ConditionText,
  regex: RegExp | null,
): boolean {
  const field = new PropertyArrayField(values)
  if (regex) return textMatchResult(cond.op, field.matchesRegex(regex))
  const contains = field.contains(condVal)
  const equals = field.equals(condVal)
  const matchesAny = field.matchesAny(conditionList(cond.value))
  const isEmpty = field.isEmpty()
  return new Map<FilterCondition['op'], boolean>([
    ['contains', contains],
    ['not_contains', !contains],
    ['equals', equals],
    ['not_equals', !equals],
    ['any_of', matchesAny],
    ['none_of', !matchesAny],
    ['is_empty', isEmpty],
    ['is_not_empty', !isEmpty],
  ]).get(cond.op) ?? false
}
