import { useState, useCallback, useEffect, useRef } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import type { VaultEntry } from '../types'
import { logKeyboardNavigationTrace } from '../utils/noteOpenPerformance'

interface NoteListKeyboardOptions {
  items: VaultEntry[]
  selectedNotePath: string | null
  onOpen: (entry: VaultEntry) => void
  onEnterNeighborhood?: (entry: VaultEntry) => void | Promise<void>
  onPrefetch?: (entry: VaultEntry) => void
  searchVisible?: boolean
  toggleSearch?: () => void
  enabled: boolean
}

interface ItemIndex {
  entryByPath: Map<string, VaultEntry>
  indexByPath: Map<string, number>
}

const itemIndexCache = new WeakMap<VaultEntry[], ItemIndex>()

function buildItemIndex(items: VaultEntry[]): ItemIndex {
  const entryByPath = new Map<string, VaultEntry>()
  const indexByPath = new Map<string, number>()

  for (const [index, entry] of items.entries()) {
    entryByPath.set(entry.path, entry)
    indexByPath.set(entry.path, index)
  }

  return { entryByPath, indexByPath }
}

function getItemIndex(items: VaultEntry[]): ItemIndex {
  const cached = itemIndexCache.get(items)
  if (cached) return cached

  const nextIndex = buildItemIndex(items)
  itemIndexCache.set(items, nextIndex)
  return nextIndex
}

function resolveHighlightedPath(items: VaultEntry[], selectedNotePath: string | null): string | null {
  if (items.length === 0) return null
  if (!selectedNotePath) return items[0].path

  return getItemIndex(items).entryByPath.has(selectedNotePath)
    ? selectedNotePath
    : items[0].path
}

function isListActive(container: HTMLDivElement | null): boolean {
  if (!container) return false
  const activeElement = document.activeElement
  return activeElement instanceof Node && container.contains(activeElement)
}

function isPanelActive(panel: HTMLDivElement | null): boolean {
  if (!panel) return false
  const activeElement = document.activeElement
  return activeElement instanceof Node && panel.contains(activeElement)
}

function isEditableElement(element: Element | null): boolean {
  if (!element) return false
  if (
    element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
  ) return true
  if (!(element instanceof HTMLElement)) return false
  return element.isContentEditable || !!element.closest('[contenteditable="true"]')
}

function isInteractiveElement(element: Element | null): boolean {
  if (!element) return false
  if (isEditableElement(element)) return true
  return element.tagName === 'BUTTON'
    || element.tagName === 'A'
    || element.getAttribute('role') === 'button'
}

function isNestedInteractiveTarget(
  target: EventTarget | null,
  currentTarget: EventTarget | null,
): boolean {
  return target instanceof Element
    && currentTarget instanceof Element
    && target !== currentTarget
    && currentTarget.contains(target)
    && isInteractiveElement(target)
}

function resolveCurrentIndex(
  items: VaultEntry[],
  highlightedPath: string | null,
  selectedNotePath: string | null,
): number {
  const activePath = highlightedPath ?? selectedNotePath
  if (!activePath) return -1
  return getItemIndex(items).indexByPath.get(activePath) ?? -1
}

function moveHighlightIndex(
  previousIndex: number,
  direction: 1 | -1,
  itemCount: number,
): number {
  if (itemCount === 0) return -1
  if (previousIndex < 0) return direction === 1 ? 0 : itemCount - 1

  const currentIndex = Math.min(previousIndex, itemCount - 1)
  const nextIndex = currentIndex + direction
  if (nextIndex < 0 || nextIndex >= itemCount) return previousIndex
  return nextIndex
}

function resolveHighlightedEntry(items: VaultEntry[], highlightedPath: string | null): VaultEntry | undefined {
  if (!highlightedPath) return undefined
  return getItemIndex(items).entryByPath.get(highlightedPath)
}

function usesCommandModifier(event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>): boolean {
  return event.metaKey || event.ctrlKey
}

function isToggleSearchShortcut(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
): boolean {
  if (!usesCommandModifier(event) || event.altKey || event.shiftKey) return false
  return event.code === 'KeyF' || event.key.toLowerCase() === 'f'
}

function isNeighborhoodKey(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>): boolean {
  return event.key === 'Enter' && usesCommandModifier(event) && !event.altKey
}

function useKeyboardItemRefs(items: VaultEntry[], selectedNotePath: string | null) {
  const itemsRef = useRef(items)
  const selectedNotePathRef = useRef(selectedNotePath)

  useEffect(() => {
    itemsRef.current = items
    selectedNotePathRef.current = selectedNotePath
  }, [items, selectedNotePath])

  return { itemsRef, selectedNotePathRef }
}

function useHighlightedPath() {
  const [highlightedPathState, setHighlightedPath] = useState<string | null>(null)
  const highlightedPathRef = useRef<string | null>(null)

  const syncHighlightedPath = useCallback((nextPath: string | null) => {
    highlightedPathRef.current = nextPath
    setHighlightedPath(nextPath)
  }, [])

  return { highlightedPathRef, highlightedPathState, syncHighlightedPath }
}

function useSelectionSync(
  itemsRef: React.RefObject<VaultEntry[]>,
  selectedNotePathRef: React.RefObject<string | null>,
  syncHighlightedPath: (nextPath: string | null) => void,
) {
  return useCallback(() => {
    syncHighlightedPath(resolveHighlightedPath(itemsRef.current, selectedNotePathRef.current))
  }, [itemsRef, selectedNotePathRef, syncHighlightedPath])
}

interface ScheduledOpenState {
  entry: VaultEntry | null
  frameId: number | null
}

function cancelScheduledOpen(stateRef: React.RefObject<ScheduledOpenState>): void {
  const frameId = stateRef.current.frameId
  if (frameId !== null) cancelAnimationFrame(frameId)
  stateRef.current.entry = null
  stateRef.current.frameId = null
}

function flushScheduledOpen(
  stateRef: React.RefObject<ScheduledOpenState>,
  onOpen: (entry: VaultEntry) => void,
  entry?: VaultEntry,
): void {
  if (entry) stateRef.current.entry = entry
  const nextEntry = stateRef.current.entry
  if (!nextEntry) return

  if (stateRef.current.frameId !== null) cancelAnimationFrame(stateRef.current.frameId)
  stateRef.current.entry = null
  stateRef.current.frameId = null
  onOpen(nextEntry)
}

function scheduleOpenForNextFrame(
  stateRef: React.RefObject<ScheduledOpenState>,
  onOpen: (entry: VaultEntry) => void,
  entry: VaultEntry,
): void {
  stateRef.current.entry = entry
  if (stateRef.current.frameId !== null) return

  stateRef.current.frameId = requestAnimationFrame(() => {
    flushScheduledOpen(stateRef, onOpen)
  })
}

function useScheduledOpen(onOpen: (entry: VaultEntry) => void, enabled: boolean) {
  const stateRef = useRef<ScheduledOpenState>({ entry: null, frameId: null })

  const scheduleOpen = useCallback((entry: VaultEntry) => {
    scheduleOpenForNextFrame(stateRef, onOpen, entry)
  }, [onOpen])

  const flushOpen = useCallback((entry?: VaultEntry) => {
    flushScheduledOpen(stateRef, onOpen, entry)
  }, [onOpen])

  const cancelOpen = useCallback(() => {
    cancelScheduledOpen(stateRef)
  }, [])

  useEffect(() => {
    if (enabled) return
    cancelOpen()
  }, [cancelOpen, enabled])

  useEffect(() => cancelOpen, [cancelOpen])

  return { cancelOpen, flushOpen, scheduleOpen }
}

function useMoveHighlight({
  items,
  selectedNotePath,
  highlightedPathRef,
  syncHighlightedPath,
  virtuosoRef,
  onPrefetch,
  scheduleOpen,
}: {
  items: VaultEntry[]
  selectedNotePath: string | null
  highlightedPathRef: React.RefObject<string | null>
  syncHighlightedPath: (nextPath: string | null) => void
  virtuosoRef: React.RefObject<VirtuosoHandle | null>
  onPrefetch?: (entry: VaultEntry) => void
  scheduleOpen: (entry: VaultEntry) => void
}) {
  return useCallback((direction: 1 | -1) => {
    const startedAt = performance.now()
    const currentIndex = resolveCurrentIndex(items, highlightedPathRef.current, selectedNotePath)
    const nextIndex = moveHighlightIndex(currentIndex, direction, items.length)
    const currentPath = highlightedPathRef.current ?? selectedNotePath
    const nextItem = items.at(nextIndex)
    if (!nextItem || nextItem.path === currentPath) return

    syncHighlightedPath(nextItem.path)
    virtuosoRef.current?.scrollIntoView({ index: nextIndex, behavior: 'auto' })
    scheduleOpen(nextItem)
    onPrefetch?.(nextItem)
    logKeyboardNavigationTrace(direction === 1 ? 'down' : 'up', items.length, performance.now() - startedAt)
  }, [highlightedPathRef, items, onPrefetch, scheduleOpen, selectedNotePath, syncHighlightedPath, virtuosoRef])
}

function resolveEntryForActivation(
  items: VaultEntry[],
  highlightedPathRef: React.RefObject<string | null>,
): VaultEntry | undefined {
  return resolveHighlightedEntry(items, highlightedPathRef.current)
}

function handleNeighborhoodActivation(options: {
  event: Pick<KeyboardEvent, 'preventDefault'>
  items: VaultEntry[]
  highlightedPathRef: React.RefObject<string | null>
  cancelOpen: () => void
  onEnterNeighborhood?: (entry: VaultEntry) => void | Promise<void>
}): boolean {
  const {
    event,
    items,
    highlightedPathRef,
    cancelOpen,
    onEnterNeighborhood,
  } = options

  const highlightedItem = resolveEntryForActivation(items, highlightedPathRef)
  if (!highlightedItem) return false

  event.preventDefault()
  cancelOpen()
  void onEnterNeighborhood?.(highlightedItem)
  return true
}

function handleArrowNavigation(
  event: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
  moveHighlight: (direction: 1 | -1) => void,
): boolean {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveHighlight(1)
    return true
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveHighlight(-1)
    return true
  }

  return false
}

function handleHighlightedOpen(options: {
  event: Pick<KeyboardEvent, 'preventDefault'>
  items: VaultEntry[]
  highlightedPathRef: React.RefObject<string | null>
  flushOpen: (entry?: VaultEntry) => void
}): boolean {
  const {
    event,
    items,
    highlightedPathRef,
    flushOpen,
  } = options

  const highlightedItem = resolveEntryForActivation(items, highlightedPathRef)
  if (!highlightedItem) return false

  event.preventDefault()
  flushOpen(highlightedItem)
  return true
}

function useProcessKeyDown({
  enabled,
  items,
  highlightedPathRef,
  moveHighlight,
  flushOpen,
  cancelOpen,
  onEnterNeighborhood,
  onToggleSearchShortcut,
}: {
  enabled: boolean
  items: VaultEntry[]
  highlightedPathRef: React.RefObject<string | null>
  moveHighlight: (direction: 1 | -1) => void
  flushOpen: (entry?: VaultEntry) => void
  cancelOpen: () => void
  onEnterNeighborhood?: (entry: VaultEntry) => void | Promise<void>
  onToggleSearchShortcut?: () => void
}) {
  return useCallback((event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'preventDefault'>) => {
    if (!enabled) return

    if (handleSearchShortcutEvent(event, onToggleSearchShortcut)) return
    if (items.length === 0) return
    if (handleNeighborhoodShortcutEvent({
      event,
      items,
      highlightedPathRef,
      cancelOpen,
      onEnterNeighborhood,
    })) return
    if (shouldIgnoreListKeyboardEvent(event)) return
    if (handleArrowNavigation(event, moveHighlight)) return

    handleEnterShortcutEvent(event, items, highlightedPathRef, flushOpen)
  }, [cancelOpen, enabled, flushOpen, highlightedPathRef, items, moveHighlight, onEnterNeighborhood, onToggleSearchShortcut])
}

function useFocusHandlers({
  containerRef,
  syncToCurrentSelection,
  syncHighlightedPath,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  syncToCurrentSelection: () => void
  syncHighlightedPath: (nextPath: string | null) => void
}) {
  const handleFocus = useCallback(() => {
    syncToCurrentSelection()
  }, [syncToCurrentSelection])

  const handleBlur = useCallback(() => {
    syncHighlightedPath(null)
  }, [syncHighlightedPath])

  const focusList = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    container.focus()
    requestAnimationFrame(() => {
      if (isListActive(containerRef.current)) syncToCurrentSelection()
    })
  }, [containerRef, syncToCurrentSelection])

  return { focusList, handleBlur, handleFocus }
}

function usePanelFocusState(panelRef: React.RefObject<HTMLDivElement | null>) {
  const [isPanelActiveState, setIsPanelActiveState] = useState(false)

  const syncPanelState = useCallback(() => {
    setIsPanelActiveState(isPanelActive(panelRef.current))
  }, [panelRef])

  const handlePanelFocusCapture = useCallback(() => {
    setIsPanelActiveState(true)
  }, [])

  const handlePanelBlurCapture = useCallback(() => {
    requestAnimationFrame(syncPanelState)
  }, [syncPanelState])

  return {
    handlePanelBlurCapture,
    handlePanelFocusCapture,
    isPanelActive: isPanelActiveState,
  }
}

function useGlobalKeyboardHandling({
  enabled,
  panelRef,
  containerRef,
  processKeyDown,
}: {
  enabled: boolean
  panelRef: React.RefObject<HTMLDivElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  processKeyDown: (event: KeyboardEvent) => void
}) {
  const shouldSkipGlobalKeyDown = useCallback((activeElement: Element | null) => {
    if (isEditableElement(activeElement)) return true
    return Boolean(
      activeElement !== containerRef.current
      && containerRef.current?.contains(activeElement)
      && isInteractiveElement(activeElement)
    )
  }, [containerRef])

  useEffect(() => {
    if (!enabled) return
    const handleWindowKeyDown = createGlobalKeyDownHandler(panelRef, shouldSkipGlobalKeyDown, processKeyDown)

    window.addEventListener('keydown', handleWindowKeyDown)
    return () => window.removeEventListener('keydown', handleWindowKeyDown)
  }, [enabled, panelRef, processKeyDown, shouldSkipGlobalKeyDown])
}

function useSearchToggleShortcut({
  toggleSearch,
  searchVisible,
  focusList,
}: {
  toggleSearch?: () => void
  searchVisible: boolean
  focusList: () => void
}) {
  return useCallback(() => {
    if (!toggleSearch) return

    toggleSearch()
    if (!searchVisible) return

    requestAnimationFrame(() => {
      focusList()
    })
  }, [focusList, searchVisible, toggleSearch])
}

function useDirectKeyDownHandler(
  processKeyDown: (event: React.KeyboardEvent) => void,
) {
  return useCallback((event: React.KeyboardEvent) => {
    if (isNestedInteractiveTarget(event.target, event.currentTarget)) return
    processKeyDown(event)
  }, [processKeyDown])
}

function resolveStableHighlightedPath(items: VaultEntry[], highlightedPathState: string | null): string | null {
  return getItemIndex(items).entryByPath.has(highlightedPathState ?? '')
    ? highlightedPathState
    : null
}

function handleSearchShortcutEvent(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'preventDefault'>,
  onToggleSearchShortcut?: () => void,
): boolean {
  if (!isToggleSearchShortcut(event) || !onToggleSearchShortcut) return false
  event.preventDefault()
  onToggleSearchShortcut()
  return true
}

function handleNeighborhoodShortcutEvent(options: {
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'preventDefault'>
  items: VaultEntry[]
  highlightedPathRef: React.RefObject<string | null>
  cancelOpen: () => void
  onEnterNeighborhood?: (entry: VaultEntry) => void | Promise<void>
}): boolean {
  const {
    event,
    items,
    highlightedPathRef,
    cancelOpen,
    onEnterNeighborhood,
  } = options

  if (!isNeighborhoodKey(event)) return false
  handleNeighborhoodActivation({
    event,
    items,
    highlightedPathRef,
    cancelOpen,
    onEnterNeighborhood,
  })
  return true
}

function shouldIgnoreListKeyboardEvent(
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey'>,
): boolean {
  return usesCommandModifier(event) || event.altKey
}

function handleEnterShortcutEvent(
  event: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
  items: VaultEntry[],
  highlightedPathRef: React.RefObject<string | null>,
  flushOpen: (entry?: VaultEntry) => void,
) {
  if (event.key !== 'Enter') return
  handleHighlightedOpen({
    event,
    items,
    highlightedPathRef,
    flushOpen,
  })
}

function createGlobalKeyDownHandler(
  panelRef: React.RefObject<HTMLDivElement | null>,
  shouldSkipGlobalKeyDown: (activeElement: Element | null) => boolean,
  processKeyDown: (event: KeyboardEvent) => void,
) {
  return (event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    if (isToggleSearchShortcut(event) && isPanelActive(panelRef.current)) {
      processKeyDown(event)
      return
    }
    if (shouldSkipGlobalKeyDown(document.activeElement)) return
    processKeyDown(event)
  }
}

export function useNoteListKeyboard({
  items,
  selectedNotePath,
  onOpen,
  onEnterNeighborhood,
  onPrefetch,
  searchVisible = false,
  toggleSearch,
  enabled,
}: NoteListKeyboardOptions) {
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { itemsRef, selectedNotePathRef } = useKeyboardItemRefs(items, selectedNotePath)
  const { highlightedPathRef, highlightedPathState, syncHighlightedPath } = useHighlightedPath()
  const syncToCurrentSelection = useSelectionSync(itemsRef, selectedNotePathRef, syncHighlightedPath)
  const { cancelOpen, flushOpen, scheduleOpen } = useScheduledOpen(onOpen, enabled)
  const { focusList, handleBlur, handleFocus } = useFocusHandlers({
    containerRef,
    syncToCurrentSelection,
    syncHighlightedPath,
  })
  const { handlePanelBlurCapture, handlePanelFocusCapture, isPanelActive: isPanelActiveState } = usePanelFocusState(panelRef)
  const handleToggleSearchShortcut = useSearchToggleShortcut({
    focusList,
    searchVisible,
    toggleSearch,
  })
  const moveHighlight = useMoveHighlight({
    items,
    selectedNotePath,
    highlightedPathRef,
    syncHighlightedPath,
    virtuosoRef,
    onPrefetch,
    scheduleOpen,
  })
  const processKeyDown = useProcessKeyDown({
    enabled,
    items,
    highlightedPathRef,
    moveHighlight,
    flushOpen,
    cancelOpen,
    onEnterNeighborhood,
    onToggleSearchShortcut: handleToggleSearchShortcut,
  })
  const handleKeyDown = useDirectKeyDownHandler(processKeyDown)
  useGlobalKeyboardHandling({ enabled, panelRef, containerRef, processKeyDown })
  useEffect(() => {
    void selectedNotePath
    cancelOpen()
  }, [cancelOpen, selectedNotePath])

  const highlightedPath = resolveStableHighlightedPath(items, highlightedPathState)

  return {
    containerRef,
    focusList,
    handlePanelBlurCapture,
    handlePanelFocusCapture,
    highlightedPath,
    handleBlur,
    handleKeyDown,
    handleFocus,
    isPanelActive: isPanelActiveState,
    panelRef,
    toggleSearchShortcut: handleToggleSearchShortcut,
    virtuosoRef,
  }
}
