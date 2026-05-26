import type { FilterCondition } from '../types'
import { evaluatePropertyArrayCondition } from './viewFilterArrayProperties'

export type ViewFilterArrayKind = 'property' | 'relationship'
type ConditionText = string
type RelationshipValue = string

interface ArrayFieldCondition {
  cond: FilterCondition
  values: RelationshipValue[]
  arrayKind: ViewFilterArrayKind
  condVal: ConditionText
  regex: RegExp | null
}

function toStringValue(value: unknown): ConditionText {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return String(value)
}

function conditionList(value: unknown): ConditionText[] | null {
  return Array.isArray(value) ? value.map(toStringValue) : null
}

class WikilinkValue {
  private readonly trimmed: RelationshipValue

  constructor(raw: RelationshipValue) {
    this.trimmed = raw.trim()
  }

  get isBracketed(): boolean {
    return this.trimmed.startsWith('[[')
  }

  get normalizedStem(): RelationshipValue {
    return this.stem.toLowerCase()
  }

  get candidates(): ConditionText[] {
    const pipe = this.inner.indexOf('|')
    if (pipe >= 0) return [this.trimmed, this.inner.slice(0, pipe), this.inner.slice(pipe + 1)]
    return [this.trimmed, this.inner]
  }

  includesStem(target: WikilinkValue): boolean {
    return this.normalizedStem.includes(target.normalizedStem)
  }

  equals(target: WikilinkValue): boolean {
    const targetParts = target.parts
    return this.parts.some((part) => targetParts.some((targetPart) => part === targetPart))
  }

  private get parts(): ConditionText[] {
    const pipe = this.inner.indexOf('|')
    if (pipe >= 0) return [this.inner.substring(0, pipe).toLowerCase(), this.inner.substring(pipe + 1).toLowerCase()]
    return [this.inner.toLowerCase()]
  }

  private get stem(): RelationshipValue {
    return this.inner.split('|')[0] ?? this.inner
  }

  private get inner(): RelationshipValue {
    return this.trimmed.replace(/^\[\[/, '').replace(/\]\]$/, '')
  }
}

class RelationshipArrayField {
  private readonly links: WikilinkValue[]

  constructor(values: RelationshipValue[]) {
    this.links = values.map((value) => new WikilinkValue(value))
  }

  contains(targetValue: ConditionText): boolean {
    const target = new WikilinkValue(targetValue)
    return this.links.some((link) => target.isBracketed ? link.equals(target) : link.includesStem(target))
  }

  equals(targetValue: ConditionText): boolean {
    return this.links.length === 1 && this.links[0]?.equals(new WikilinkValue(targetValue)) === true
  }

  matchesAny(targets: ConditionText[] | null): boolean {
    return targets?.some((target) => this.links.some((link) => link.equals(new WikilinkValue(target)))) ?? false
  }

  matchesRegex(regex: RegExp): boolean {
    return this.links.some((link) => link.candidates.some((candidate) => regex.test(candidate)))
  }

  isEmpty(): boolean {
    return this.links.length === 0
  }
}

function textMatchResult(op: FilterCondition['op'], matched: boolean): boolean {
  if (op === 'contains' || op === 'equals') return matched
  if (op === 'not_contains' || op === 'not_equals') return !matched
  return false
}

function relationshipArrayMatch(field: RelationshipArrayField, cond: FilterCondition, condVal: ConditionText): boolean {
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

function evaluateRelationshipArrayCondition(cond: FilterCondition, values: RelationshipValue[], condVal: ConditionText, regex: RegExp | null): boolean {
  const { op } = cond
  const field = new RelationshipArrayField(values)
  if (regex) return textMatchResult(op, field.matchesRegex(regex))
  return relationshipArrayMatch(field, cond, condVal)
}

export function evaluateArrayFieldCondition({ cond, values, arrayKind, condVal, regex }: ArrayFieldCondition): boolean {
  if (arrayKind === 'property') return evaluatePropertyArrayCondition(cond, values, condVal, regex)
  return evaluateRelationshipArrayCondition(cond, values, condVal, regex)
}
