import {
  useState, useMemo, useEffect, useCallback, useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'
import type { VaultEntry } from '../../types'
import { APP_STORAGE_KEYS, LEGACY_APP_STORAGE_KEYS, getAppStorageItem } from '../../constants/appStorage'
import { buildTypeEntryMap } from '../../utils/typeColors'
import { countAllNotesByFilter } from '../../utils/noteListHelpers'
import { buildDynamicSections, sortSections } from '../../utils/sidebarSections'
import type { AllNotesFileVisibility } from '../../utils/allNotesFileVisibility'

export type SidebarGroupKey = 'favorites' | 'views' | 'sections' | 'folders'

export interface SidebarMenuPosition {
  x: number
  y: number
}

export interface SidebarContextMenuState<T> {
  target: T
  pos: SidebarMenuPosition
}

interface PointerMenuEvent {
  clientX: number
  clientY: number
  preventDefault?: () => void
  stopPropagation?: () => void
}

interface SidebarInlineRenameInputOptions {
  initialValue: string
  onCancel: () => void
  onSubmit: (value: string) => Promise<boolean> | boolean | void
  selectTextOnFocus?: boolean
}

const KEYBOARD_MENU_FALLBACK: SidebarMenuPosition = { x: 20, y: 100 }

export function getPointerMenuPosition(event: PointerMenuEvent): SidebarMenuPosition {
  return { x: event.clientX, y: event.clientY }
}

export function getElementMenuPosition(
  element: HTMLElement | null,
  fallback: SidebarMenuPosition = KEYBOARD_MENU_FALLBACK,
): SidebarMenuPosition {
  const bounds = element?.getBoundingClientRect()
  if (!bounds) return fallback
  return { x: bounds.left + 16, y: bounds.top + bounds.height }
}

export function useOutsideClick<T extends HTMLElement>(
  ref: RefObject<T | null>,
  isOpen: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!isOpen) return
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, isOpen, onClose])
}

export function useDismissableSidebarLayer<T extends HTMLElement>(
  ref: RefObject<T | null>,
  isOpen: boolean,
  onClose: () => void,
) {
  useOutsideClick(ref, isOpen, onClose)

  useEffect(() => {
    if (!isOpen) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])
}

export function useSidebarContextMenu<T>() {
  const [contextMenu, setContextMenu] = useState<SidebarContextMenuState<T> | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const closeContextMenu = useCallback(() => setContextMenu(null), [])
  useDismissableSidebarLayer(contextMenuRef, !!contextMenu, closeContextMenu)

  const openContextMenuAt = useCallback((target: T, pos: SidebarMenuPosition) => {
    setContextMenu({ target, pos })
  }, [])

  const openContextMenuFromPointer = useCallback((target: T, event: PointerMenuEvent) => {
    event.preventDefault?.()
    event.stopPropagation?.()
    openContextMenuAt(target, getPointerMenuPosition(event))
  }, [openContextMenuAt])

  return {
    closeContextMenu,
    contextMenu,
    contextMenuRef,
    openContextMenuAt,
    openContextMenuFromPointer,
  }
}

export function useSidebarInlineRenameInput({
  initialValue,
  onCancel,
  onSubmit,
  selectTextOnFocus = true,
}: SidebarInlineRenameInputOptions) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    if (selectTextOnFocus) input.select()
  }, [selectTextOnFocus])

  const submitValue = useCallback(async () => {
    if (submittingRef.current) return false
    submittingRef.current = true
    try {
      return await onSubmit(value)
    } finally {
      submittingRef.current = false
    }
  }, [onSubmit, value])

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      void submitValue()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
  }, [onCancel, submitValue])

  return {
    handleKeyDown,
    inputRef,
    setValue,
    submitValue,
    value,
  }
}

export function useSidebarSections(entries: VaultEntry[]) {
  const typeEntryMap = useMemo(() => buildTypeEntryMap(entries), [entries])
  const allSectionGroups = useMemo(() => {
    const sections = buildDynamicSections(entries, typeEntryMap)
    return sortSections(sections, typeEntryMap)
  }, [entries, typeEntryMap])
  const visibleSections = useMemo(
    () => allSectionGroups.filter((group) => typeEntryMap[group.type]?.visible !== false),
    [allSectionGroups, typeEntryMap],
  )
  const sectionIds = useMemo(() => visibleSections.map((group) => group.type), [visibleSections])
  return { typeEntryMap, allSectionGroups, visibleSections, sectionIds }
}

function loadCollapsedState(): Record<SidebarGroupKey, boolean> {
  try {
    const raw = getAppStorageItem('sidebarCollapsed')
    if (raw) return JSON.parse(raw)
  } catch {
    // Ignore localStorage failures and fall back to defaults.
  }
  return { favorites: false, views: false, sections: false, folders: false }
}

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState<Record<SidebarGroupKey, boolean>>(loadCollapsedState)

  const toggle = useCallback((key: SidebarGroupKey) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(APP_STORAGE_KEYS.sidebarCollapsed, JSON.stringify(next))
      localStorage.removeItem(LEGACY_APP_STORAGE_KEYS.sidebarCollapsed)
      return next
    })
  }, [])

  return { collapsed, toggle }
}

export function useEntryCounts(
  entries: VaultEntry[],
  allNotesFileVisibility?: AllNotesFileVisibility,
) {
  return useMemo(() => {
    const counts = countAllNotesByFilter(entries, allNotesFileVisibility)
    return { activeCount: counts.open, archivedCount: counts.archived }
  }, [allNotesFileVisibility, entries])
}

export function computeReorder(sectionIds: string[], activeId: string, overId: string): string[] | null {
  const oldIndex = sectionIds.indexOf(activeId)
  const newIndex = sectionIds.indexOf(overId)
  if (oldIndex === -1 || newIndex === -1) return null
  const reordered = [...sectionIds]
  reordered.splice(oldIndex, 1)
  reordered.splice(newIndex, 0, activeId)
  return reordered
}

function buildCustomizeArgs(typeEntry: VaultEntry, prop: 'icon' | 'color', value: string): [string, string] {
  return [
    prop === 'icon' ? value : (typeEntry.icon ?? 'file-text'),
    prop === 'color' ? value : (typeEntry.color ?? 'blue'),
  ]
}

export function applyCustomization(
  target: string | null,
  typeEntryMap: Record<string, VaultEntry>,
  onCustomizeType: ((typeName: string, icon: string, color: string) => void) | undefined,
  prop: 'icon' | 'color',
  value: string,
): void {
  if (!target || !onCustomizeType) return
  const typeEntry = typeEntryMap[target]
  const [icon, color] = typeEntry
    ? buildCustomizeArgs(typeEntry, prop, value)
    : [prop === 'icon' ? value : 'file-text', prop === 'color' ? value : 'blue']
  onCustomizeType(target, icon, color)
}
