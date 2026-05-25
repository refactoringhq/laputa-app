import { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
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
const SORT_LABEL_KEYS_BY_OPTION = new Map<string, TranslationKey>(Object.entries(SORT_LABEL_KEYS))
const SORT_MENU_WIDTH = 170
const SORT_MENU_MAX_HEIGHT = 280
const SORT_MENU_MIN_HEIGHT = 160
const SORT_MENU_OFFSET = 4
const SORT_MENU_VIEWPORT_PADDING = 8

type SortMenuAction =
  | { type: 'close' }
  | { type: 'focus'; index: number }

interface SortMenuPosition {
  left: number
  top: number
  maxHeight: number
}

function getLocalizedSortOptionLabel(option: SortOption, locale: AppLocale): string {
  if (option.startsWith('property:')) return option.slice('property:'.length)
  return translate(locale, SORT_LABEL_KEYS_BY_OPTION.get(option) ?? 'noteList.sort.modified')
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
  const activeHTMLElement = document.activeElement
  if (activeHTMLElement instanceof HTMLElement) {
    const activeIndexText = activeHTMLElement.dataset.sortItemIndex
    const activeIndex = activeIndexText === undefined ? -1 : Number(activeIndexText)
    if (activeHTMLElement.dataset.sortGroupLabel === groupLabel && activeIndex >= 0) return activeIndex
  }

  const currentIndex = sortItems.findIndex((item) => item.value === current)
  return currentIndex >= 0 ? currentIndex : 0
}

function focusSortItem(sortButtonRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>, index: number) {
  sortButtonRefs.current.at(index)?.focus()
}

function clampMenuPosition(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function resolveSortMenuPosition(trigger: HTMLElement): SortMenuPosition {
  const rect = trigger.getBoundingClientRect()
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight
  const maxLeft = Math.max(SORT_MENU_VIEWPORT_PADDING, viewportWidth - SORT_MENU_WIDTH - SORT_MENU_VIEWPORT_PADDING)
  const left = clampMenuPosition(rect.right - SORT_MENU_WIDTH, SORT_MENU_VIEWPORT_PADDING, maxLeft)
  const belowTop = rect.bottom + SORT_MENU_OFFSET
  const availableBelow = viewportHeight - belowTop - SORT_MENU_VIEWPORT_PADDING
  const availableAbove = rect.top - SORT_MENU_VIEWPORT_PADDING - SORT_MENU_OFFSET
  const openAbove = availableBelow < SORT_MENU_MIN_HEIGHT && availableAbove > availableBelow
  const availableHeight = openAbove ? availableAbove : availableBelow
  const viewportBoundedMinHeight = Math.min(SORT_MENU_MIN_HEIGHT, Math.max(0, viewportHeight - (SORT_MENU_VIEWPORT_PADDING * 2)))
  const maxHeight = Math.max(viewportBoundedMinHeight, Math.min(SORT_MENU_MAX_HEIGHT, availableHeight))
  const top = openAbove
    ? Math.max(SORT_MENU_VIEWPORT_PADDING, rect.top - SORT_MENU_OFFSET - maxHeight)
    : Math.min(belowTop, viewportHeight - SORT_MENU_VIEWPORT_PADDING - maxHeight)

  return { left, top, maxHeight }
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

function useSortMenuDismissal({
  open,
  containerRef,
  menuRef,
  onDismiss,
}: {
  open: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
  menuRef: React.RefObject<HTMLDivElement | null>
  onDismiss: () => void
}) {
  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current?.contains(event.target as Node)) return
      if (menuRef.current?.contains(event.target as Node)) return
      onDismiss()
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [containerRef, menuRef, onDismiss, open])
}

function useSortMenuPosition({
  open,
  triggerRef,
}: {
  open: boolean
  triggerRef: React.RefObject<HTMLButtonElement | null>
}) {
  const [menuPosition, setMenuPosition] = useState<SortMenuPosition | null>(null)
  const updateMenuPosition = useCallback(() => {
    if (!triggerRef.current) return
    setMenuPosition(resolveSortMenuPosition(triggerRef.current))
  }, [triggerRef])

  useLayoutEffect(() => {
    if (!open) return

    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [open, updateMenuPosition])

  return { menuPosition, updateMenuPosition }
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
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const sortButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const closeMenu = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])
  const dismissMenu = useCallback(() => setOpen(false), [])
  const { menuPosition, updateMenuPosition } = useSortMenuPosition({ open, triggerRef })

  useSortMenuDismissal({ open, containerRef, menuRef, onDismiss: dismissMenu })

  useEffect(() => {
    if (!open) return
    focusSortItem(sortButtonRefs, resolveFocusedIndex(groupLabel, current, sortItems))
  }, [current, groupLabel, open, sortItems])

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
  const toggleMenu = useCallback(() => {
    if (open) {
      setOpen(false)
      return
    }

    updateMenuPosition()
    setOpen(true)
  }, [open, updateMenuPosition])

  return {
    open,
    toggleMenu,
    containerRef,
    menuRef,
    triggerRef,
    sortButtonRefs,
    menuPosition,
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
  menuRef,
  menuPosition,
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
  menuRef: React.RefObject<HTMLDivElement | null>
  menuPosition: SortMenuPosition | null
  locale: AppLocale
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  onSelect: (option: SortOption, nextDirection: SortDirection) => void
}) {
  if (!open) return null

  const hasCustom = sortItems.length > SORT_OPTIONS.length
  const builtInOptionCount = SORT_OPTIONS.length

  return createPortal((
    <div
      ref={menuRef}
      role="menu"
      aria-label={translate(locale, 'noteList.sort.menu', { label: groupLabel })}
      className="fixed z-[12000] rounded-md border border-border bg-popover p-1 shadow-md"
      style={{
        left: menuPosition?.left ?? 0,
        top: menuPosition?.top ?? 0,
        width: SORT_MENU_WIDTH,
        maxHeight: menuPosition?.maxHeight ?? SORT_MENU_MAX_HEIGHT,
        overflowY: 'auto',
        visibility: menuPosition ? 'visible' : 'hidden',
      }}
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
            Reflect.set(sortButtonRefs.current, index, node)
          }}
          showSeparator={hasCustom && index === builtInOptionCount}
          locale={locale}
          onSelect={onSelect}
        />
      ))}
    </div>
  ), document.body)
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
    toggleMenu,
    containerRef,
    menuRef,
    triggerRef,
    sortButtonRefs,
    menuPosition,
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
        onToggle={toggleMenu}
      />
      <SortDropdownMenu
        open={open}
        groupLabel={groupLabel}
        current={current}
        direction={direction}
        sortItems={sortItems}
        sortButtonRefs={sortButtonRefs}
        menuRef={menuRef}
        menuPosition={menuPosition}
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
