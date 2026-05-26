import { useId, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { isEmoji } from '../utils/emoji'
import { ICON_OPTIONS } from '../utils/iconRegistry'

const MAX_ICON_RESULTS = 24

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeIconQuery(query: string): string {
  return query.trim().toLowerCase()
}

function matchesIconQuery(name: string, query: string): boolean {
  if (!query) return true

  const normalized = normalizeIconQuery(query)
  const spacedName = name.replace(/-/g, ' ')
  const dashedQuery = normalized.replace(/\s+/g, '-')

  return name.includes(dashedQuery) || spacedName.includes(normalized)
}

function filterIconOptions(query: string) {
  return ICON_OPTIONS
    .filter((option) => matchesIconQuery(option.name, query))
    .slice(0, MAX_ICON_RESULTS)
}

function shouldSelectIconSuggestion(value: string, suggestionCount: number): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (isEmoji(trimmed) || isHttpUrl(trimmed)) return false
  return suggestionCount > 0
}

interface IconEditableValueProps {
  value: string
  onSave: (newValue: string) => void
  onCancel: () => void
  isEditing: boolean
  onStartEdit: () => void
}

function IconEditableInput({
  value,
  onSave,
  onCancel,
}: Pick<IconEditableValueProps, 'value' | 'onSave' | 'onCancel'>) {
  const [editValue, setEditValue] = useState(value)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const listboxId = useId()
  const filteredIcons = useMemo(() => filterIconOptions(editValue), [editValue])

  const commitTypedValue = () => onSave(editValue)
  const selectIcon = (iconName: string) => {
    setEditValue(iconName)
    onSave(iconName)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (filteredIcons.length === 0) return
      setHighlightedIndex((current) => (current + 1) % filteredIcons.length)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (filteredIcons.length === 0) return
      setHighlightedIndex((current) => (current - 1 + filteredIcons.length) % filteredIcons.length)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      if (shouldSelectIconSuggestion(editValue, filteredIcons.length)) {
        selectIcon(filteredIcons.at(highlightedIndex)?.name ?? editValue)
        return
      }
      commitTypedValue()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  return (
    <div className="relative flex flex-col gap-2" data-testid="icon-editable-value">
      <Input
        type="text"
        value={editValue}
        onChange={(event) => {
          setEditValue(event.target.value)
          setHighlightedIndex(0)
        }}
        onKeyDown={handleKeyDown}
        onBlur={commitTypedValue}
        autoFocus
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded
        aria-activedescendant={filteredIcons.at(highlightedIndex) ? `${listboxId}-option-${highlightedIndex}` : undefined}
        placeholder="Emoji, icon name, or URL"
        className="h-8 text-[12px]"
        data-testid="icon-editable-input"
      />
      <div
        id={listboxId}
        role="listbox"
        className="max-h-44 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-sm"
        data-testid="icon-picker-results"
      >
        {filteredIcons.length === 0 ? (
          <div className="px-2 py-6 text-center text-[12px] text-muted-foreground" data-testid="icon-picker-empty">
            No icons found
          </div>
        ) : (
          filteredIcons.map(({ name, Icon }, index) => (
            <button
              key={name}
              id={`${listboxId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={index === highlightedIndex}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] transition-colors',
                index === highlightedIndex
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-accent hover:text-foreground',
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => selectIcon(name)}
              data-testid={`icon-picker-option-${name}`}
            >
              <Icon size={14} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

export function IconEditableValue({
  value,
  onSave,
  onCancel,
  isEditing,
  onStartEdit,
}: IconEditableValueProps) {
  if (isEditing) {
    return <IconEditableInput key={value} value={value} onSave={onSave} onCancel={onCancel} />
  }

  return (
    <button
      type="button"
      className="inline-flex h-6 min-w-0 max-w-full cursor-pointer items-center truncate rounded-md border-0 bg-transparent px-2 text-left text-[12px] text-secondary-foreground transition-colors hover:bg-muted"
      onClick={onStartEdit}
      title={value || 'Click to edit'}
      data-testid="icon-editable-display"
    >
      {value || '\u2014'}
    </button>
  )
}
