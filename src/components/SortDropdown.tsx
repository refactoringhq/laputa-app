import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { ArrowUp, ArrowDown } from '@phosphor-icons/react'
import { translate, type AppLocale, type TranslationKey } from '../lib/i18n'
import { type SortOption, type SortDirection, getDefaultDirection, SORT_OPTIONS } from '../utils/noteListHelpers'

interface SortItem {
  value: SortOption
  label: string
}

const SORT_LABEL_KEYS = {
  modified: 'noteList.sort.modified',
  created: 'noteList.sort.created',
  title: 'noteList.sort.title',
  status: 'noteList.sort.status',
} satisfies Record<string, TranslationKey>

type SortMenuAction =
  | { type: 'close' }
  | { type: 'focus'; index: number }

function getLocalizedSortOptionLabel(option: SortOption, locale: AppLocale): string {
  if (option.startsWith('property:')) return option.slice('property:'.length)
  return translate(locale, SORT_LABEL_KEYS[option as keyof typeof SORT_LABEL_KEYS])
}

function buildSortItems(locale: AppLocale, customProperties?: string[]): SortItem[] {
  const builtInItems = SORT_OPTIONS.map(({ value }) => ({ value, label: getLocalizedSortOptionLabel(value, locale) }))
  const customItems = (customProperties ?? []).map((key) => ({
    value: `property:${key}` as SortOption,
    label: key,
  }))
  return [...builtInItems, ...customItems]
}

function resolveFocusedIndex(groupLabel: string, current: SortOption, sortItems: SortItem[]) {
  const activeElement = document.activeElement as HTMLElement | null
  const activeIndex = Number(activeElement?.dataset.sortItemIndex ?? -1)
  if (activeElement?.dataset.sortGroupLabel === groupLabel && activeIndex >= 0) return activeIndex

  const currentIndex = sortItems.findIndex((item) => item.value === current)
  return currentIndex >= 0 ? currentIndex : 0
}

function focusSortItem(sortButtonRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>, index: number) {
  sortButtonRefs.current[index]?.focus()
}

function resolveSortMenuAction(key: string, focusIndex: number, itemCount: number): SortMenuAction | null {
  const lastIndex = itemCount - 1

  switch (key) {
    case 'Escape':
      return { type: 'close' }
    case 'ArrowDown':
      return { type: 'focus', index: Math.min(lastIndex, focusIndex + 1) }
    case 'ArrowUp':
      return { type: 'focus', index: Math.max(0, focusIndex - 1) }
    case 'Home':
      return { type: 'focus', index: 0 }
    case 'End':
      return { type: 'focus', index: lastIndex }
    default:
      return null
  }
}

function selectOnKeyboard(
  event: React.KeyboardEvent<HTMLButtonElement>,
  value: SortOption,
  direction: SortDirection,
  onSelect: (opt: SortOption, dir: SortDirection) => void,
) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  onSelect(value, direction)
}

function getDirectionButtonClass(isActive: boolean, activeDirection: SortDirection, buttonDirection: SortDirection) {
  return cn(
    'flex items-center rounded p-0.5 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    isActive && activeDirection === buttonDirection ? 'text-foreground' : 'text-muted-foreground opacity-40',
  )
}

function useSortDropdownState({
  groupLabel,
  current,
  sortItems,
  onChange,
}: {
  groupLabel: string
  current: SortOption
  sortItems: SortItem[]
  onChange: (groupLabel: string, option: SortOption, direction: SortDirection) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const sortButtonRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    focusSortItem(sortButtonRefs, resolveFocusedIndex(groupLabel, current, sortItems))
  }, [current, groupLabel, open, sortItems])

  const closeMenu = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  const handleSelect = useCallback((option: SortOption, nextDirection: SortDirection) => {
    onChange(groupLabel, option, nextDirection)
    closeMenu()
  }, [closeMenu, groupLabel, onChange])

  const handleMenuKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const action = resolveSortMenuAction(
      event.key,
      resolveFocusedIndex(groupLabel, current, sortItems),
      sortItems.length,
    )
    if (!action) return

    event.preventDefault()
    if (action.type === 'close') {
      closeMenu()
      return
    }

    focusSortItem(sortButtonRefs, action.index)
  }, [closeMenu, current, groupLabel, sortItems])

  return {
    open,
    setOpen,
    containerRef,
    triggerRef,
    sortButtonRefs,
    handleSelect,
    handleMenuKeyDown,
  }
}

function SortDropdownTrigger({
  triggerRef,
  open,
  current,
  groupLabel,
  direction,
  locale,
  onToggle,
}: {
  triggerRef: React.RefObject<HTMLButtonElement | null>
  open: boolean
  current: SortOption
  groupLabel: string
  direction: SortDirection
  locale: AppLocale
  onToggle: () => void
}) {
  const DirectionIcon = direction === 'asc' ? ArrowUp : ArrowDown
  const currentLabel = getLocalizedSortOptionLabel(current, locale)

  return (
    <button
      ref={triggerRef}
      type="button"
      className={cn('flex items-center gap-0.5 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground', open && 'bg-accent text-foreground')}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      title={translate(locale, 'noteList.sort.by', { label: currentLabel })}
      aria-haspopup="menu"
      aria-expanded={open}
      data-testid={`sort-button-${groupLabel}`}
    >
      <DirectionIcon size={12} data-testid={`sort-direction-icon-${groupLabel}`} />
      <span className="text-[10px] font-medium">{currentLabel}</span>
    </button>
  )
}

function SortDropdownMenu({
  open,
  groupLabel,
  current,
  direction,
  sortItems,
  sortButtonRefs,
  locale,
  onKeyDown,
  onSelect,
}: {
  open: boolean
  groupLabel: string
  current: SortOption
  direction: SortDirection
  sortItems: SortItem[]
  sortButtonRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>
  locale: AppLocale
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  onSelect: (option: SortOption, nextDirection: SortDirection) => void
}) {
  if (!open) return null

  const hasCustom = sortItems.length > SORT_OPTIONS.length
  const builtInOptionCount = SORT_OPTIONS.length

  return (
    <div
      role="menu"
      aria-label={translate(locale, 'noteList.sort.menu', { label: groupLabel })}
      className="absolute right-0 top-full mt-1 rounded-md border border-border bg-popover p-1 shadow-md"
      style={{ width: 170, maxHeight: 280, overflowY: 'auto' }}
      onKeyDown={onKeyDown}
      data-testid={`sort-menu-${groupLabel}`}
    >
      {sortItems.map((item, index) => (
        <SortRow
          key={item.value}
          index={index}
          groupLabel={groupLabel}
          value={item.value}
          label={item.label}
          current={current}
          direction={direction}
          buttonRef={(node) => {
            sortButtonRefs.current[index] = node
          }}
          showSeparator={hasCustom && index === builtInOptionCount}
          locale={locale}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

export function SortDropdown({ groupLabel, current, direction, customProperties, locale = 'en', onChange }: {
  groupLabel: string
  current: SortOption
  direction: SortDirection
  customProperties?: string[]
  locale?: AppLocale
  onChange: (groupLabel: string, option: SortOption, direction: SortDirection) => void
}) {
  const sortItems = useMemo(() => buildSortItems(locale, customProperties), [customProperties, locale])
  const {
    open,
    setOpen,
    containerRef,
    triggerRef,
    sortButtonRefs,
    handleSelect,
    handleMenuKeyDown,
  } = useSortDropdownState({
    groupLabel,
    current,
    sortItems,
    onChange,
  })

  return (
    <div ref={containerRef} className="relative" style={{ zIndex: open ? 10 : 0 }}>
      <SortDropdownTrigger
        triggerRef={triggerRef}
        open={open}
        current={current}
        groupLabel={groupLabel}
        direction={direction}
        locale={locale}
        onToggle={() => setOpen((value) => !value)}
      />
      <SortDropdownMenu
        open={open}
        groupLabel={groupLabel}
        current={current}
        direction={direction}
        sortItems={sortItems}
        sortButtonRefs={sortButtonRefs}
        locale={locale}
        onKeyDown={handleMenuKeyDown}
        onSelect={handleSelect}
      />
    </div>
  )
}

function SortRow({ index, groupLabel, value, label, current, direction, buttonRef, showSeparator, locale, onSelect }: {
  index: number
  groupLabel: string
  value: SortOption
  label: string
  current: SortOption
  direction: SortDirection
  buttonRef: (node: HTMLButtonElement | null) => void
  showSeparator: boolean
  locale: AppLocale
  onSelect: (opt: SortOption, dir: SortDirection) => void
}) {
  const isActive = value === current
  const defaultDirection = isActive ? direction : getDefaultDirection(value)
  const itemData = {
    'data-sort-group-label': groupLabel,
    'data-sort-item-index': String(index),
  }

  return (
    <>
      {showSeparator && <div className="mx-2 my-1 border-t border-border" data-testid="sort-separator" />}
      <div
        className={cn('flex items-center justify-between gap-1 rounded px-1 text-[12px] text-popover-foreground hover:bg-accent', isActive && 'bg-accent font-medium')}
        style={{ minHeight: 28 }}
      >
        <button
          ref={buttonRef}
          type="button"
          role="menuitemradio"
          aria-checked={isActive}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left text-inherit hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => {
            event.stopPropagation()
            onSelect(value, defaultDirection)
          }}
          onKeyDown={(event) => selectOnKeyboard(event, value, defaultDirection, onSelect)}
          data-testid={`sort-option-${value}`}
          {...itemData}
        >
          <span className="truncate">{label}</span>
        </button>
        <span className="flex items-center gap-0.5">
          <SortDirectionButton
            value={value}
            direction="asc"
            activeDirection={direction}
            isActive={isActive}
            onSelect={onSelect}
            icon={<ArrowUp size={12} />}
            itemData={itemData}
            locale={locale}
          />
          <SortDirectionButton
            value={value}
            direction="desc"
            activeDirection={direction}
            isActive={isActive}
            onSelect={onSelect}
            icon={<ArrowDown size={12} />}
            itemData={itemData}
            locale={locale}
          />
        </span>
      </div>
    </>
  )
}

function SortDirectionButton({
  value,
  direction,
  activeDirection,
  isActive,
  onSelect,
  icon,
  itemData,
  locale,
}: {
  value: SortOption
  direction: SortDirection
  activeDirection: SortDirection
  isActive: boolean
  onSelect: (opt: SortOption, dir: SortDirection) => void
  icon: React.ReactNode
  itemData: Record<string, string>
  locale: AppLocale
}) {
  return (
    <button
      type="button"
      className={getDirectionButtonClass(isActive, activeDirection, direction)}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(value, direction)
      }}
      data-testid={`sort-dir-${direction}-${value}`}
      title={translate(locale, direction === 'asc' ? 'noteList.sort.ascending' : 'noteList.sort.descending')}
      {...itemData}
    >
      {icon}
    </button>
  )
}
