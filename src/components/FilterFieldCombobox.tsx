import { CaretUpDown } from '@phosphor-icons/react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type RefObject } from 'react'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { FilterFieldOptionsList } from './filter-builder/FilterFieldOptionsList'

const CONTENT_FIELDS = new Set(['body'])

type FilterFieldName = string
type FilterFieldQuery = string
type ListboxId = string

interface FilterFieldComboboxProps {
  value: FilterFieldName
  fields: FilterFieldName[]
  onChange: (value: FilterFieldName) => void
}

interface FieldGroup {
  key: 'property' | 'content'
  label: 'Properties' | 'Content'
  options: FilterFieldName[]
}

interface BuildFieldGroupsInput {
  currentValue: FilterFieldName
  fields: FilterFieldName[]
  query: FilterFieldQuery
}

interface HighlightIndexInput {
  currentValue: FilterFieldName
  options: FilterFieldName[]
}

function normalizeFieldQuery(query: FilterFieldQuery): FilterFieldQuery {
  return query.trim().toLowerCase()
}

function buildFieldGroups({ fields, currentValue, query }: BuildFieldGroupsInput): FieldGroup[] {
  const allFields = currentValue !== '' && !fields.includes(currentValue)
    ? [currentValue, ...fields]
    : fields
  const normalized = normalizeFieldQuery(query)
  const matches = (field: FilterFieldName) => normalized === '' || field.toLowerCase().includes(normalized)
  const propertyOptions = allFields.filter((field) => !CONTENT_FIELDS.has(field) && matches(field))
  const contentOptions = allFields.filter((field) => CONTENT_FIELDS.has(field) && matches(field))
  const groups: FieldGroup[] = []

  if (propertyOptions.length > 0) groups.push({ key: 'property', label: 'Properties', options: propertyOptions })
  if (contentOptions.length > 0) groups.push({ key: 'content', label: 'Content', options: contentOptions })

  return groups
}

function flattenGroups(groups: FieldGroup[]): FilterFieldName[] {
  return groups.flatMap((group) => group.options)
}

function initialHighlightIndex({ options, currentValue }: HighlightIndexInput): number {
  if (options.length === 0) return -1
  const currentIndex = options.indexOf(currentValue)
  return currentIndex >= 0 ? currentIndex : 0
}

function stepHighlightedIndex(current: number, optionCount: number, direction: 'next' | 'previous'): number {
  if (current < 0) return direction === 'next' ? 0 : optionCount - 1
  if (direction === 'next') return (current + 1) % optionCount
  return (current - 1 + optionCount) % optionCount
}

function moveHighlightedOption({
  event,
  open,
  options,
  direction,
  openCombobox,
  setHighlightedIndex,
}: {
  event: KeyboardEvent<HTMLInputElement>
  open: boolean
  options: FilterFieldName[]
  direction: 'next' | 'previous'
  openCombobox: () => void
  setHighlightedIndex: (updater: number | ((current: number) => number)) => void
}) {
  event.preventDefault()
  if (!open) {
    openCombobox()
    return
  }
  if (options.length === 0) return
  setHighlightedIndex((current) => stepHighlightedIndex(current, options.length, direction))
}

function selectHighlightedOption({
  event,
  open,
  options,
  highlightedIndex,
  selectOption,
}: {
  event: KeyboardEvent<HTMLInputElement>
  open: boolean
  options: FilterFieldName[]
  highlightedIndex: number
  selectOption: (value: FilterFieldName) => void
}) {
  const highlightedOption = options.at(highlightedIndex)
  if (!open || highlightedIndex < 0 || highlightedOption === undefined) return
  event.preventDefault()
  selectOption(highlightedOption)
}

function closeOpenCombobox({
  event,
  open,
  closeCombobox,
}: {
  event: KeyboardEvent<HTMLInputElement>
  open: boolean
  closeCombobox: () => void
}) {
  if (!open) return
  event.preventDefault()
  closeCombobox()
}

function handleFilterFieldKeyDown({
  event,
  open,
  options,
  highlightedIndex,
  openCombobox,
  setHighlightedIndex,
  selectOption,
  closeCombobox,
}: {
  event: KeyboardEvent<HTMLInputElement>
  open: boolean
  options: FilterFieldName[]
  highlightedIndex: number
  openCombobox: () => void
  setHighlightedIndex: (updater: number | ((current: number) => number)) => void
  selectOption: (value: FilterFieldName) => void
  closeCombobox: () => void
}) {
  switch (event.key) {
    case 'ArrowDown':
      moveHighlightedOption({ event, open, options, direction: 'next', openCombobox, setHighlightedIndex })
      return
    case 'ArrowUp':
      moveHighlightedOption({ event, open, options, direction: 'previous', openCombobox, setHighlightedIndex })
      return
    case 'Enter':
      selectHighlightedOption({ event, open, options, highlightedIndex, selectOption })
      return
    case 'Escape':
      closeOpenCombobox({ event, open, closeCombobox })
      return
    default:
      return
  }
}

function FilterFieldInput({
  inputRef,
  open,
  query,
  value,
  listboxId,
  highlightedIndex,
  onFocus,
  onChange,
  onKeyDown,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  open: boolean
  query: FilterFieldQuery
  value: FilterFieldName
  listboxId: ListboxId
  highlightedIndex: number
  onFocus: () => void
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <>
      <Input
        ref={inputRef}
        value={open ? query : value}
        onFocus={onFocus}
        onChange={onChange}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-activedescendant={highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined}
        className="h-8 pr-7 text-sm"
        data-testid="filter-field-combobox-input"
      />
      <CaretUpDown
        size={14}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </>
  )
}

function FilterFieldPopoverPanel({
  open,
  contentWidth,
  listboxId,
  fieldGroups,
  options,
  highlightedIndex,
  onHighlight,
  onSelect,
}: {
  open: boolean
  contentWidth: number
  listboxId: ListboxId
  fieldGroups: FieldGroup[]
  options: FilterFieldName[]
  highlightedIndex: number
  onHighlight: (index: number) => void
  onSelect: (value: FilterFieldName) => void
}) {
  if (!open) return null

  return (
    <PopoverContent
      align="start"
      sideOffset={4}
      className="overflow-hidden p-1"
      style={{ width: contentWidth }}
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => event.preventDefault()}
      data-testid="filter-field-combobox-popover"
    >
      <div
        className="max-h-60 overflow-y-auto overscroll-contain"
        data-testid="filter-field-combobox-scroll-area"
        onWheelCapture={(event) => event.stopPropagation()}
      >
        <div id={listboxId} role="listbox" data-testid="filter-field-combobox-options">
          <FilterFieldOptionsList
            listboxId={listboxId}
            fieldGroups={fieldGroups}
            options={options}
            highlightedIndex={highlightedIndex}
            onHighlight={onHighlight}
            onSelect={onSelect}
          />
        </div>
      </div>
    </PopoverContent>
  )
}

export function FilterFieldCombobox({ value, fields, onChange }: FilterFieldComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const [hasTyped, setHasTyped] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [contentWidth, setContentWidth] = useState<number>(220)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const effectiveQuery = hasTyped ? query : ''
  const fieldGroups = useMemo(
    () => buildFieldGroups({ fields, currentValue: value, query: effectiveQuery }),
    [fields, value, effectiveQuery],
  )
  const options = useMemo(() => flattenGroups(fieldGroups), [fieldGroups])

  const resetToCurrentValue = useCallback(() => {
    setQuery(value)
    setHasTyped(false)
    setHighlightedIndex(initialHighlightIndex({
      options: flattenGroups(buildFieldGroups({ fields, currentValue: value, query: '' })),
      currentValue: value,
    }))
  }, [fields, value])

  const openCombobox = useCallback(() => {
    resetToCurrentValue()
    setOpen(true)
    requestAnimationFrame(() => inputRef.current?.select())
  }, [resetToCurrentValue])

  const closeCombobox = useCallback(() => {
    setOpen(false)
    resetToCurrentValue()
  }, [resetToCurrentValue])

  const selectOption = useCallback((nextValue: FilterFieldName) => {
    onChange(nextValue)
    setQuery(nextValue)
    setHasTyped(false)
    setHighlightedIndex(-1)
    setOpen(false)
  }, [onChange])

  useEffect(() => {
    if (!open) return

    const updateWidth = () => {
      const nextWidth = rootRef.current?.getBoundingClientRect().width ?? 220
      setContentWidth(Math.max(nextWidth, 220))
    }

    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [open])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const handleBlur = (event: globalThis.FocusEvent) => {
      if (root.contains(event.relatedTarget as Node | null)) return
      closeCombobox()
    }

    root.addEventListener('focusout', handleBlur)
    return () => root.removeEventListener('focusout', handleBlur)
  }, [closeCombobox])

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextQuery = event.target.value
    const nextGroups = buildFieldGroups({ fields, currentValue: value, query: nextQuery })
    const nextOptions = flattenGroups(nextGroups)
    setOpen(true)
    setQuery(nextQuery)
    setHasTyped(true)
    setHighlightedIndex(nextOptions.length > 0 ? 0 : -1)
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    handleFilterFieldKeyDown({
      event,
      open,
      options,
      highlightedIndex,
      openCombobox,
      setHighlightedIndex,
      selectOption,
      closeCombobox,
    })
  }

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <div
          ref={rootRef}
          className="relative flex-1 min-w-[160px]"
          data-testid="filter-field-combobox"
        >
          <FilterFieldInput
            inputRef={inputRef}
            open={open}
            query={query}
            value={value}
            listboxId={listboxId}
            highlightedIndex={highlightedIndex}
            onFocus={openCombobox}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
          />
        </div>
      </PopoverAnchor>
      <FilterFieldPopoverPanel
        open={open}
        contentWidth={contentWidth}
        listboxId={listboxId}
        fieldGroups={fieldGroups}
        options={options}
        highlightedIndex={highlightedIndex}
        onHighlight={setHighlightedIndex}
        onSelect={selectOption}
      />
    </Popover>
  )
}
