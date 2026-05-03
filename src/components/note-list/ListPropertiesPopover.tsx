import { useState, useMemo, useCallback, useEffect, useId, useRef, type KeyboardEvent, type RefObject } from 'react'
import { SlidersHorizontal, DotsSixVertical } from '@phosphor-icons/react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { translate, type AppLocale } from '../../lib/i18n'
import {
  OPEN_NOTE_LIST_PROPERTIES_EVENT,
  type NoteListPropertiesScope,
  type OpenListPropertiesEventDetail,
} from './noteListPropertiesEvents'
import {
  DndContext, closestCenter, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type NoteListPropertyKey = string

export interface ListPropertiesPopoverProps {
  scope: NoteListPropertiesScope
  availableProperties: NoteListPropertyKey[]
  currentDisplay: NoteListPropertyKey[]
  onSave: (value: NoteListPropertyKey[] | null) => void
  triggerTitle: string
  triggerClassName?: string
  locale?: AppLocale
}

function propertyInputId(id: NoteListPropertyKey): string {
  return `list-prop-${id.replace(/[^a-z0-9_-]+/gi, '-')}`
}

function getSelectedProperties(currentDisplay: NoteListPropertyKey[], availableProperties: NoteListPropertyKey[]) {
  return currentDisplay.filter((property) => availableProperties.includes(property))
}

function getOrderedItems(currentDisplay: NoteListPropertyKey[], availableProperties: NoteListPropertyKey[]) {
  const selected = getSelectedProperties(currentDisplay, availableProperties)
  const unselected = availableProperties.filter((property) => !selected.includes(property))
  return [...selected, ...unselected]
}

function normalizePropertyQuery(query: string) {
  return query.trim().toLowerCase()
}

function filterOrderedItems(orderedItems: NoteListPropertyKey[], query: string) {
  const normalized = normalizePropertyQuery(query)
  if (normalized === '') return orderedItems
  return orderedItems.filter((property) => property.toLowerCase().includes(normalized))
}

function toggleDisplayProperty(currentDisplay: NoteListPropertyKey[], selectedSet: Set<NoteListPropertyKey>, key: NoteListPropertyKey) {
  if (selectedSet.has(key)) {
    const filtered = currentDisplay.filter((property) => property !== key)
    return filtered.length > 0 ? filtered : null
  }

  return [...currentDisplay, key]
}

function reorderDisplayProperties(event: DragEndEvent, currentDisplay: NoteListPropertyKey[], availableProperties: NoteListPropertyKey[]) {
  const { active, over } = event
  if (!over || active.id === over.id) return undefined

  const selected = getSelectedProperties(currentDisplay, availableProperties)
  const oldIndex = selected.indexOf(String(active.id) as NoteListPropertyKey)
  const newIndex = selected.indexOf(String(over.id) as NoteListPropertyKey)
  if (oldIndex === -1 || newIndex === -1) return undefined

  return arrayMove(selected, oldIndex, newIndex)
}

function SortablePropertyItem({ id, checked, locale = 'en', onToggle }: { id: NoteListPropertyKey; checked: boolean; locale?: AppLocale; onToggle: (key: NoteListPropertyKey) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const inputId = propertyInputId(id)
  const dragAttributes = { ...attributes, tabIndex: -1 }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted"
      data-testid={`list-prop-item-${id}`}
    >
      <Checkbox
        id={inputId}
        checked={checked}
        onCheckedChange={() => onToggle(id)}
        aria-label={id}
      />
      <label
        htmlFor={inputId}
        className="flex flex-1 cursor-pointer items-center gap-2 text-[13px]"
        onClick={(event) => {
          event.preventDefault()
          onToggle(id)
        }}
      >
        <span className="truncate">{id}</span>
      </label>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing"
        aria-label={translate(locale, 'noteList.properties.reorder', { name: id })}
        {...dragAttributes}
        {...listeners}
      >
        <DotsSixVertical size={14} />
      </Button>
    </div>
  )
}

function ListPropertiesSearchInput({
  inputRef,
  query,
  open,
  listboxId,
  locale = 'en',
  onQueryChange,
  onKeyDown,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  open: boolean
  listboxId: string
  locale?: AppLocale
  onQueryChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="mb-2">
      <Input
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={translate(locale, 'noteList.properties.searchPlaceholder')}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-label={translate(locale, 'noteList.properties.searchLabel')}
        className="h-8 text-[13px]"
        data-testid="list-properties-combobox-input"
      />
    </div>
  )
}

function ListPropertiesOptionsList({
  listboxId,
  filteredItems,
  selectedSet,
  sensors,
  locale = 'en',
  onDragEnd,
  onToggle,
}: {
  listboxId: string
  filteredItems: NoteListPropertyKey[]
  selectedSet: Set<NoteListPropertyKey>
  sensors: ReturnType<typeof useSensors>
  locale?: AppLocale
  onDragEnd: (event: DragEndEvent) => void
  onToggle: (key: string) => void
}) {
  return (
    <div className="max-h-60 overflow-y-auto" data-testid="list-properties-scroll-area">
      {filteredItems.length === 0 ? (
        <div className="px-1 py-2 text-[12px] text-muted-foreground">
          {translate(locale, 'noteList.properties.noMatches')}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <div id={listboxId} role="listbox" aria-multiselectable="true" className="pr-3">
            <SortableContext items={filteredItems} strategy={verticalListSortingStrategy}>
              {filteredItems.map((key) => (
                <SortablePropertyItem
                  key={key}
                  id={key}
                  checked={selectedSet.has(key)}
                  locale={locale}
                  onToggle={onToggle}
                />
              ))}
            </SortableContext>
          </div>
        </DndContext>
      )}
    </div>
  )
}

function ListPropertiesPopoverPanel({
  inputRef,
  query,
  open,
  listboxId,
  filteredItems,
  selectedSet,
  sensors,
  locale = 'en',
  onQueryChange,
  onSearchKeyDown,
  onPanelKeyDown,
  onDragEnd,
  onToggle,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  open: boolean
  listboxId: string
  filteredItems: NoteListPropertyKey[]
  selectedSet: Set<NoteListPropertyKey>
  sensors: ReturnType<typeof useSensors>
  locale?: AppLocale
  onQueryChange: (value: string) => void
  onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onPanelKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onDragEnd: (event: DragEndEvent) => void
  onToggle: (key: string) => void
}) {
  return (
    <PopoverContent
      align="end"
      className="w-64 overflow-hidden p-2"
      onOpenAutoFocus={(event) => event.preventDefault()}
      data-testid="list-properties-popover"
    >
      <div onKeyDownCapture={onPanelKeyDown}>
        <div className="mb-2 px-1 text-[11px] font-medium text-muted-foreground">
          {translate(locale, 'noteList.properties.showInNoteList')}
        </div>
        <ListPropertiesSearchInput
          inputRef={inputRef}
          query={query}
          open={open}
          listboxId={listboxId}
          locale={locale}
          onQueryChange={onQueryChange}
          onKeyDown={onSearchKeyDown}
        />
        <ListPropertiesOptionsList
          listboxId={listboxId}
          filteredItems={filteredItems}
          selectedSet={selectedSet}
          sensors={sensors}
          locale={locale}
          onDragEnd={onDragEnd}
          onToggle={onToggle}
        />
      </div>
    </PopoverContent>
  )
}

function handleEscapeKey(event: KeyboardEvent<HTMLInputElement | HTMLDivElement>, closePopover: () => void) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  closePopover()
}

function useListPropertiesPopoverState({
  scope,
  availableProperties,
  currentDisplay,
  onSave,
}: Pick<ListPropertiesPopoverProps, 'scope' | 'availableProperties' | 'currentDisplay' | 'onSave'>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const closePopover = useCallback(() => {
    setQuery('')
    setOpen(false)
  }, [])

  const orderedItems = useMemo(
    () => getOrderedItems(currentDisplay, availableProperties),
    [availableProperties, currentDisplay],
  )
  const filteredItems = useMemo(
    () => filterOrderedItems(orderedItems, query),
    [orderedItems, query],
  )
  const selectedSet = useMemo(
    () => new Set(getSelectedProperties(currentDisplay, availableProperties)),
    [availableProperties, currentDisplay],
  )
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<OpenListPropertiesEventDetail>).detail
      if (detail?.scope === scope) setOpen(true)
    }
    window.addEventListener(OPEN_NOTE_LIST_PROPERTIES_EVENT, handler)
    return () => window.removeEventListener(OPEN_NOTE_LIST_PROPERTIES_EVENT, handler)
  }, [scope])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const handleToggle = useCallback((key: string) => {
    const nextSelected = toggleDisplayProperty(currentDisplay, selectedSet, key)
    onSave(nextSelected)
  }, [currentDisplay, onSave, selectedSet])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const reordered = reorderDisplayProperties(event, currentDisplay, availableProperties)
    if (!reordered) return

    onSave(reordered)
  }, [availableProperties, currentDisplay, onSave])

  const handleSearchKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    handleEscapeKey(event, closePopover)
  }, [closePopover])

  const handlePanelKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    handleEscapeKey(event, closePopover)
  }, [closePopover])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) setQuery('')
  }, [])

  return {
    open,
    query,
    inputRef,
    listboxId,
    filteredItems,
    selectedSet,
    sensors,
    setQuery,
    handleSearchKeyDown,
    handlePanelKeyDown,
    handleDragEnd,
    handleOpenChange,
    handleToggle,
  }
}

export function ListPropertiesPopover({
  scope,
  availableProperties,
  currentDisplay,
  onSave,
  triggerTitle,
  triggerClassName,
  locale = 'en',
}: ListPropertiesPopoverProps) {
  const {
    open,
    query,
    inputRef,
    listboxId,
    filteredItems,
    selectedSet,
    sensors,
    setQuery,
    handleSearchKeyDown,
    handlePanelKeyDown,
    handleDragEnd,
    handleOpenChange,
    handleToggle,
  } = useListPropertiesPopoverState({ scope, availableProperties, currentDisplay, onSave })

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn('h-7 w-7 text-muted-foreground', triggerClassName)}
          title={triggerTitle}
          aria-label={triggerTitle}
          data-testid="list-properties-btn"
      >
        <SlidersHorizontal size={16} />
      </Button>
      </PopoverTrigger>
      <ListPropertiesPopoverPanel
        inputRef={inputRef}
        query={query}
        open={open}
        listboxId={listboxId}
        filteredItems={filteredItems}
        selectedSet={selectedSet}
        sensors={sensors}
        locale={locale}
        onQueryChange={setQuery}
        onSearchKeyDown={handleSearchKeyDown}
        onPanelKeyDown={handlePanelKeyDown}
        onDragEnd={handleDragEnd}
        onToggle={handleToggle}
      />
    </Popover>
  )
}
