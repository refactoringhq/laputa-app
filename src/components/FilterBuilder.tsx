import { Plus, X, WarningCircle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { FilterCondition, FilterOp, FilterGroup, FilterNode } from '../types'
import { compileSafeUserRegex } from '../utils/safeRegex'
import { FilterFieldCombobox } from './FilterFieldCombobox'
import { DateValueInput } from './filter-builder/DateValueInput'

const OPERATORS: { value: FilterOp; label: string }[] = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
  { value: 'before', label: 'before' },
  { value: 'after', label: 'after' },
]

const NO_VALUE_OPS = new Set<FilterOp>(['is_empty', 'is_not_empty'])
const DATE_OPS = new Set<FilterOp>(['before', 'after'])
const REGEX_OPS = new Set<FilterOp>(['contains', 'not_contains', 'equals', 'not_equals'])

function supportsRegex(op: FilterOp): boolean {
  return REGEX_OPS.has(op)
}

function normalizeRegexFlag(op: FilterOp, enabled: boolean): boolean | undefined {
  return supportsRegex(op) && enabled ? true : undefined
}

function hasInvalidRegex(value: string, regexEnabled: boolean): boolean {
  if (!regexEnabled) return false
  return !compileSafeUserRegex(value, 'i').ok
}

function isFilterGroup(node: FilterNode): node is FilterGroup {
  return 'all' in node || 'any' in node
}

function getGroupChildren(group: FilterGroup): FilterNode[] {
  return 'all' in group ? group.all : group.any
}

function getGroupMode(group: FilterGroup): 'all' | 'any' {
  return 'all' in group ? 'all' : 'any'
}

function setGroupChildren(mode: 'all' | 'any', children: FilterNode[]): FilterGroup {
  return mode === 'all' ? { all: children } : { any: children }
}

function OperatorSelect({ value, onChange }: {
  value: FilterOp
  onChange: (v: FilterOp) => void
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as FilterOp)}>
      <SelectTrigger
        size="sm"
        className="h-8 shrink-0 gap-1 border-input bg-background px-2 text-sm shadow-none"
        style={{ minWidth: 120 }}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {OPERATORS.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function TextValueInput({ value, onChange, regexEnabled, regexSupported, invalidRegex, onToggleRegex }: {
  value: string
  onChange: (v: string) => void
  regexEnabled: boolean
  regexSupported: boolean
  invalidRegex: boolean
  onToggleRegex: () => void
}) {
  return (
    <div className="flex flex-1 min-w-0 items-center gap-1">
      <div className="relative min-w-0 flex-1">
        <Input
          className={cn(
            'h-8 w-full min-w-0 text-sm',
            invalidRegex && 'border-destructive pr-7 focus-visible:ring-destructive/20',
          )}
          placeholder="value"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid="filter-value-input"
          aria-invalid={invalidRegex || undefined}
        />
        {invalidRegex && (
          <WarningCircle
            size={14}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-destructive"
            data-testid="filter-regex-invalid"
            aria-hidden="true"
          />
        )}
      </div>
      {regexSupported && (
        <Button
          type="button"
          variant={regexEnabled ? 'secondary' : 'outline'}
          size="sm"
          className={cn(
            'h-8 shrink-0 px-2 font-mono text-[11px]',
            !regexEnabled && 'text-muted-foreground',
          )}
          onClick={onToggleRegex}
          aria-pressed={regexEnabled}
          data-testid="filter-regex-toggle"
          title="Treat value as regex"
        >
          .*
        </Button>
      )}
    </div>
  )
}

function FilterRow({ condition, fields, onUpdate, onRemove }: {
  condition: FilterCondition
  fields: string[]
  onUpdate: (c: FilterCondition) => void
  onRemove: () => void
}) {
  const isDateOp = DATE_OPS.has(condition.op)
  const regexSupported = supportsRegex(condition.op)
  const regexEnabled = regexSupported && condition.regex === true
  const invalidRegex = regexSupported && hasInvalidRegex(String(condition.value ?? ''), regexEnabled)
  return (
    <div className="flex items-start gap-1.5" data-testid="filter-row">
      <FilterFieldCombobox
        value={condition.field}
        fields={fields}
        onChange={(v) => onUpdate({ ...condition, field: v })}
      />
      <OperatorSelect
        value={condition.op}
        onChange={(op) => onUpdate({ ...condition, op, regex: normalizeRegexFlag(op, regexEnabled) })}
      />
      {!NO_VALUE_OPS.has(condition.op) && (
        isDateOp
          ? <DateValueInput value={String(condition.value ?? '')} onChange={(v) => onUpdate({ ...condition, value: v })} />
          : (
            <TextValueInput
              value={String(condition.value ?? '')}
              onChange={(v) => onUpdate({ ...condition, value: v })}
              regexEnabled={regexEnabled}
              regexSupported={regexSupported}
              invalidRegex={invalidRegex}
              onToggleRegex={() => onUpdate({ ...condition, regex: regexEnabled ? undefined : true })}
            />
          )
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground"
        onClick={onRemove}
        title="Remove filter"
      >
        <X size={14} />
      </Button>
    </div>
  )
}

function FilterGroupView({ group, fields, depth, onChange, onRemove }: {
  group: FilterGroup
  fields: string[]
  depth: number
  onChange: (g: FilterGroup) => void
  onRemove?: () => void
}) {
  const mode = getGroupMode(group)
  const children = getGroupChildren(group)

  const toggleMode = () => {
    onChange(setGroupChildren(mode === 'all' ? 'any' : 'all', children))
  }

  const updateChild = (index: number, node: FilterNode) => {
    const next = [...children]
    next.splice(index, 1, node)
    onChange(setGroupChildren(mode, next))
  }

  const removeChild = (index: number) => {
    const next = children.filter((_, i) => i !== index)
    onChange(setGroupChildren(mode, next))
  }

  const addCondition = () => {
    onChange(setGroupChildren(mode, [...children, { field: fields[0] ?? 'type', op: 'equals' as FilterOp, value: '' }]))
  }

  const addGroup = () => {
    const nested: FilterGroup = { all: [{ field: fields[0] ?? 'type', op: 'equals' as FilterOp, value: '' }] }
    onChange(setGroupChildren(mode, [...children, nested]))
  }

  return (
    <div className={depth > 0 ? 'ml-3 border-l-2 border-border pl-3 py-1' : ''}>
      <div className="flex items-center gap-2 mb-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 rounded-full px-2.5 text-[11px] font-medium"
          onClick={toggleMode}
          title={`Switch to ${mode === 'all' ? 'OR' : 'AND'}`}
        >
          {mode === 'all' ? 'AND' : 'OR'}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {mode === 'all' ? 'Match all conditions' : 'Match any condition'}
        </span>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            onClick={onRemove}
            title="Remove group"
          >
            <X size={12} />
          </Button>
        )}
      </div>
      <div className="space-y-2">
        {children.map((child, i) =>
          isFilterGroup(child) ? (
            <FilterGroupView
              key={i}
              group={child}
              fields={fields}
              depth={depth + 1}
              onChange={(g) => updateChild(i, g)}
              onRemove={() => removeChild(i)}
            />
          ) : (
            <FilterRow
              key={i}
              condition={child}
              fields={fields}
              onUpdate={(c) => updateChild(i, c)}
              onRemove={() => removeChild(i)}
            />
          )
        )}
      </div>
      <div className="flex gap-2 mt-2">
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={addCondition}>
          <Plus size={12} className="mr-1" /> Add filter
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={addGroup}>
          <Plus size={12} className="mr-1" /> Add group
        </Button>
      </div>
    </div>
  )
}

export interface FilterBuilderProps {
  group: FilterGroup
  onChange: (group: FilterGroup) => void
  availableFields: string[]
}

export function FilterBuilder({ group, onChange, availableFields }: FilterBuilderProps) {
  const fields = availableFields.length > 0 ? availableFields : ['type']
  return (
    <FilterGroupView
      group={group}
      fields={fields}
      depth={0}
      onChange={onChange}
    />
  )
}
