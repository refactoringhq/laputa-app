import {
  CaretDown,
  CaretRight,
  DotsSixVertical as GripVertical,
  Plus,
} from '@phosphor-icons/react'
import { SideMenuExtension, SuggestionMenu } from '@blocknote/core/extensions'
import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core'
import {
  DragHandleMenu,
  SideMenu,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useExtension,
  useExtensionState,
  type SideMenuProps,
} from '@blocknote/react'
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { isStaleBlockReferenceError } from './richEditorTransformErrorRecoveryExtension'

type TolariaBlockNoteEditor = BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>
type TolariaBlock = NonNullable<ReturnType<TolariaBlockNoteEditor['getBlock']>>
type SideMenuBlock = {
  children?: CollapsibleBlock[]
  content?: unknown
  id: string
  props?: Record<string, unknown>
  type: string
}
type CollapsibleBlock = {
  children?: CollapsibleBlock[]
  id?: unknown
  props?: Record<string, unknown>
  type?: unknown
}
type TableHeaderContent = Record<string, unknown> & {
  headerCols?: unknown
  headerRows?: unknown
}
type DropPlacement = 'before' | 'after'
type PointerReorderState = {
  affordances?: ReorderAffordances
  clearListeners: () => void
  draggedBlockId: string
  editorElement: HTMLElement
  hasMoved: boolean
  lastDropTarget?: DropTarget | null
  ownerDocument: Document
  pointerId: number
  startX: number
  startY: number
}
type ReorderAffordances = {
  draggedElement: HTMLElement
  dropIndicator: HTMLElement
  pointerOffsetX: number
  pointerOffsetY: number
  preview: HTMLElement
  previousDraggedOpacity: string
}
type DropTarget = {
  blockId: string
  element: HTMLElement
  placement: DropPlacement
}
type SideMenuAlignmentState = {
  attemptsRemaining: number
  frame: number | null
  hasObservedTargets: boolean
}
type SideMenuAlignmentContext = {
  blockId: string
  editorElement: HTMLElement
  observeTargets: () => void
  ownerWindow: Window
  retry: () => void
  state: SideMenuAlignmentState
}
type CollapsedHeadingStore = {
  collapsedHeadingIds: Set<string>
  emit: () => void
  getSnapshot: () => number
  listeners: Set<() => void>
  subscribe: (listener: () => void) => () => void
  version: number
}
type CollapsedSectionRenderState = {
  collapsedHeadingIds: Set<string>
  hiddenBlockIds: Set<string>
}
type CollapsedHeadingDotsHit = {
  blockId: string
  inlineContent: HTMLElement
}

const BLOCK_CONTAINER_SELECTOR = '[data-node-type="blockContainer"][data-id]'
const BLOCK_OUTER_SELECTOR = '[data-node-type="blockOuter"][data-id], .bn-block-outer[data-id]'
const COLLAPSIBLE_LIST_ITEM_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem'])
const POINTER_REORDER_THRESHOLD_PX = 4
const SIDE_MENU_ALIGNMENT_ATTEMPTS = 8
const headingCollapseStores = new WeakMap<TolariaBlockNoteEditor, CollapsedHeadingStore>()
const headingCollapseRenderers = new WeakMap<HTMLElement, () => void>()
const collapsedSectionStyleElements = new WeakMap<HTMLElement, HTMLStyleElement>()
let collapsedSectionScopeSequence = 0

function createCollapsedHeadingStore(): CollapsedHeadingStore {
  const store: CollapsedHeadingStore = {
    collapsedHeadingIds: new Set(),
    emit: () => {
      store.version += 1
      store.listeners.forEach((listener) => listener())
    },
    getSnapshot: () => store.version,
    listeners: new Set(),
    subscribe: (listener) => {
      store.listeners.add(listener)
      return () => store.listeners.delete(listener)
    },
    version: 0,
  }

  return store
}

function collapsedHeadingStore(editor: TolariaBlockNoteEditor) {
  let store = headingCollapseStores.get(editor)
  if (!store) {
    store = createCollapsedHeadingStore()
    headingCollapseStores.set(editor, store)
  }

  return store
}

function useCollapsedHeadingIds(editor: TolariaBlockNoteEditor) {
  const store = collapsedHeadingStore(editor)
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return store.collapsedHeadingIds
}

function blockHeadingLevel(block: CollapsibleBlock | undefined): number | null {
  if (block?.type !== 'heading') return null

  const rawLevel = block.props?.level
  const level = typeof rawLevel === 'number'
    ? rawLevel
    : typeof rawLevel === 'string'
      ? Number.parseInt(rawLevel, 10)
      : 1

  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : null
}

function isSectionBoundaryBlock(block: CollapsibleBlock) {
  return block.type === 'divider' || block.type === 'horizontalRule'
}

function isCollapsibleListItemBlock(block: CollapsibleBlock | undefined) {
  return typeof block?.type === 'string'
    && COLLAPSIBLE_LIST_ITEM_TYPES.has(block.type)
    && Array.isArray(block.children)
    && block.children.length > 0
}

function isListItemBlockType(type: unknown) {
  return typeof type === 'string' && COLLAPSIBLE_LIST_ITEM_TYPES.has(type)
}

function isCollapsibleSectionBlock(block: CollapsibleBlock | undefined) {
  return blockHeadingLevel(block) !== null || isCollapsibleListItemBlock(block)
}

function addDescendantBlockIds(block: CollapsibleBlock, hiddenBlockIds: Set<string>) {
  if (!Array.isArray(block.children)) return

  for (const child of block.children) {
    if (typeof child.id === 'string') hiddenBlockIds.add(child.id)
    addDescendantBlockIds(child, hiddenBlockIds)
  }
}

function flattenBlocks(blocks: readonly CollapsibleBlock[], result: CollapsibleBlock[] = []) {
  for (const block of blocks) {
    result.push(block)
    if (Array.isArray(block.children)) flattenBlocks(block.children, result)
  }

  return result
}

function collapsedSectionRenderState(
  blocks: readonly CollapsibleBlock[],
  collapsedHeadingIds: ReadonlySet<string>,
): CollapsedSectionRenderState {
  const state: CollapsedSectionRenderState = {
    collapsedHeadingIds: new Set(),
    hiddenBlockIds: new Set(),
  }
  let activeCollapsedLevel: number | null = null

  for (const block of flattenBlocks(blocks)) {
    const blockId = typeof block.id === 'string' ? block.id : undefined
    const headingLevel = blockHeadingLevel(block)
    const closesActiveSection = activeCollapsedLevel !== null
      && (isSectionBoundaryBlock(block) || (headingLevel !== null && headingLevel <= activeCollapsedLevel))

    if (closesActiveSection) activeCollapsedLevel = null

    if (activeCollapsedLevel !== null) {
      if (blockId) state.hiddenBlockIds.add(blockId)
      continue
    }

    if (blockId && headingLevel !== null && collapsedHeadingIds.has(blockId)) {
      state.collapsedHeadingIds.add(blockId)
      activeCollapsedLevel = headingLevel
      continue
    }

    if (blockId && isCollapsibleListItemBlock(block) && collapsedHeadingIds.has(blockId)) {
      state.collapsedHeadingIds.add(blockId)
      addDescendantBlockIds(block, state.hiddenBlockIds)
    }
  }

  return state
}

function cssString(value: string) {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\A ')
    .replace(/\r/g, '\\D ')}"`
}

function collapsedSectionContainer(editorElement: HTMLElement) {
  const container = editorElement.closest('.editor__blocknote-container')
  return container instanceof HTMLElement ? container : undefined
}

function collapsedSectionStyleScope(editorElement: HTMLElement) {
  const container = collapsedSectionContainer(editorElement)
  if (!container) return ''

  container.dataset.tolariaCollapseScope ??= String(++collapsedSectionScopeSequence)
  return `[data-tolaria-collapse-scope=${cssString(container.dataset.tolariaCollapseScope)}]`
}

function collapsedSectionStyleElement(editorElement: HTMLElement) {
  const existingStyle = collapsedSectionStyleElements.get(editorElement)
  if (existingStyle) return existingStyle

  const styleElement = editorElement.ownerDocument.createElement('style')
  styleElement.setAttribute('data-tolaria-collapsed-sections', 'true')
  editorElement.ownerDocument.head.appendChild(styleElement)
  collapsedSectionStyleElements.set(editorElement, styleElement)
  return styleElement
}

function blockOuterSelectorsForStyle(
  editorElement: HTMLElement,
  blockId: string,
  scope = collapsedSectionStyleScope(editorElement),
) {
  const prefix = scope ? `${scope} ` : ''
  const id = cssString(blockId)
  return [
    `${prefix}.bn-block-outer[data-id=${id}]`,
    `${prefix}[data-node-type="blockOuter"][data-id=${id}]`,
  ]
}

function headingDotsSelectorsForStyle(
  editorElement: HTMLElement,
  blockId: string,
  scope = collapsedSectionStyleScope(editorElement),
) {
  return blockOuterSelectorsForStyle(editorElement, blockId, scope)
    .map((selector) => (
      `${selector} .bn-block-content .bn-inline-content::after`
    ))
}

function headingDotsCssDeclarations() {
  return [
    'content: "...";',
    'display: inline-flex;',
    'align-items: center;',
    'justify-content: center;',
    'min-width: 34px;',
    'height: 24px;',
    'margin-inline-start: 10px;',
    'padding: 0 8px;',
    'border-radius: 8px;',
    'background: var(--bg-secondary, rgba(0, 0, 0, 0.08));',
    'color: var(--colors-muted, rgba(0, 0, 0, 0.46));',
    'transition: background-color 120ms ease, color 120ms ease;',
    'font-size: 0.5em;',
    'font-weight: 700;',
    'line-height: 1;',
    'vertical-align: middle;',
    'cursor: pointer;',
    'pointer-events: auto;',
  ].join('\n')
}

function headingDotsHoverCssDeclarations() {
  return [
    'background: var(--bg-tertiary, rgba(0, 0, 0, 0.13));',
    'color: var(--text-secondary, rgba(0, 0, 0, 0.62));',
  ].join('\n')
}

function collapsedSectionStyleText(
  editorElement: HTMLElement,
  renderState: CollapsedSectionRenderState,
) {
  const hiddenSelectors = Array.from(renderState.hiddenBlockIds)
    .flatMap((blockId) => blockOuterSelectorsForStyle(editorElement, blockId))
  const collapsedHeadingSelectors = Array.from(renderState.collapsedHeadingIds)
    .flatMap((blockId) => headingDotsSelectorsForStyle(editorElement, blockId))
  const scope = collapsedSectionStyleScope(editorElement)
  const collapsedHeadingHoverSelectors = scope
    ? Array.from(renderState.collapsedHeadingIds)
      .flatMap((blockId) => headingDotsSelectorsForStyle(
        editorElement,
        blockId,
        `${scope}[data-tolaria-collapse-hover-id=${cssString(blockId)}]`,
      ))
    : []

  const rules: string[] = []
  if (hiddenSelectors.length > 0) {
    rules.push(`${hiddenSelectors.join(',\n')} {\ndisplay: none !important;\n}`)
  }
  if (collapsedHeadingSelectors.length > 0) {
    rules.push(`${collapsedHeadingSelectors.join(',\n')} {\n${headingDotsCssDeclarations()}\n}`)
  }
  if (collapsedHeadingHoverSelectors.length > 0) {
    rules.push(`${collapsedHeadingHoverSelectors.join(',\n')} {\n${headingDotsHoverCssDeclarations()}\n}`)
  }

  return rules.join('\n\n')
}

function syncCollapsedSectionStyle(
  editorElement: HTMLElement,
  renderState: CollapsedSectionRenderState,
) {
  collapsedSectionStyleElement(editorElement).textContent = collapsedSectionStyleText(editorElement, renderState)
}

function liveSideMenuBlock(editor: TolariaBlockNoteEditor, block: SideMenuBlock | undefined) {
  if (!block) return undefined
  try {
    return editor.getBlock(block.id)
  } catch (error) {
    if (isStaleBlockReferenceError(error)) {
      console.warn('[editor] Ignored stale block side-menu lookup:', error)
      return undefined
    }
    throw error
  }
}

function runSideMenuAction(action: () => void) {
  try {
    action()
  } catch (error) {
    if (isStaleBlockReferenceError(error)) {
      console.warn('[editor] Ignored stale block side-menu action:', error)
      return
    }
    throw error
  }
}

function isInlineBlockEmpty(block: { content?: unknown }) {
  return Array.isArray(block.content) && block.content.length === 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tableHeaderContent(block: unknown): TableHeaderContent | undefined {
  if (!isRecord(block) || block.type !== 'table' || !isRecord(block.content)) return undefined
  return block.content
}

function hasChildBlock(block: TolariaBlock, blockId: string): boolean {
  for (const child of block.children) {
    if (child.id === blockId || hasChildBlock(child, blockId)) return true
  }

  return false
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function editorBlockElement(editor: TolariaBlockNoteEditor): HTMLElement | null {
  const element = editor.domElement
  if (!(element instanceof HTMLElement)) return null
  return element.matches('.bn-editor')
    ? element
    : element.querySelector('.bn-editor')
}

function blockElementFromPoint({
  editorElement,
  ownerDocument,
  x,
  y,
}: {
  editorElement: HTMLElement
  ownerDocument: Document
  x: number
  y: number
}): HTMLElement | null {
  if (typeof ownerDocument.elementsFromPoint !== 'function') return null

  const editorRect = editorElement.getBoundingClientRect()
  if (editorRect.width <= 0 || editorRect.height <= 0) return null

  const hitX = clamp(x, editorRect.left + 10, editorRect.right - 10)
  const hitY = clamp(y, editorRect.top + 1, editorRect.bottom - 1)

  for (const element of ownerDocument.elementsFromPoint(hitX, hitY)) {
    if (!editorElement.contains(element)) continue

    const blockElement = element.closest(BLOCK_CONTAINER_SELECTOR)
    if (blockElement instanceof HTMLElement && editorElement.contains(blockElement)) {
      return blockElement
    }
  }

  return null
}

function dropPlacementForPoint(blockElement: HTMLElement, y: number): DropPlacement {
  const rect = blockElement.getBoundingClientRect()
  return y < rect.top + rect.height / 2 ? 'before' : 'after'
}

function blockIdFromElement(blockElement: HTMLElement): string | null {
  return blockElement.dataset.id ?? null
}

function blockElementById(editorElement: HTMLElement, blockId: string): HTMLElement | null {
  for (const element of editorElement.querySelectorAll(BLOCK_CONTAINER_SELECTOR)) {
    if (element instanceof HTMLElement && element.dataset.id === blockId) return element
  }

  return null
}

function renderedSectionBlockElements(editorElement: HTMLElement): HTMLElement[] {
  const outerBlocks = Array.from(editorElement.querySelectorAll(BLOCK_OUTER_SELECTOR))
    .filter((element): element is HTMLElement => element instanceof HTMLElement)
  if (outerBlocks.length > 0) return outerBlocks

  return Array.from(editorElement.querySelectorAll(BLOCK_CONTAINER_SELECTOR))
    .filter((element): element is HTMLElement => element instanceof HTMLElement)
}

function renderedBlockElementById(editorElement: HTMLElement, blockId: string): HTMLElement | undefined {
  return renderedSectionBlockElements(editorElement)
    .find((element) => element.dataset.id === blockId)
}

function headingLevelFromRenderedBlock(element: HTMLElement): number | null {
  const headingContent = element.querySelector('[data-content-type="heading"]')
  if (!(headingContent instanceof HTMLElement)) return null

  const dataLevel = headingContent.dataset.level
  const parsedDataLevel = dataLevel ? Number.parseInt(dataLevel, 10) : Number.NaN
  if (Number.isInteger(parsedDataLevel) && parsedDataLevel >= 1 && parsedDataLevel <= 6) {
    return parsedDataLevel
  }

  const headingElement = headingContent.querySelector('h1, h2, h3, h4, h5, h6')
  const tagName = headingElement?.tagName.toLowerCase()
  const tagLevel = tagName?.match(/^h([1-6])$/)?.[1]
  return tagLevel ? Number.parseInt(tagLevel, 10) : 1
}

function isRenderedDividerBlock(element: HTMLElement) {
  return Boolean(element.querySelector('hr, [data-content-type="divider"]'))
}

function isRenderedListItemBlock(element: HTMLElement) {
  const contentType = element.querySelector('.bn-block-content')?.getAttribute('data-content-type')
  return isListItemBlockType(contentType)
}

function renderedChildBlockElements(element: HTMLElement) {
  const blockId = element.dataset.id
  if (!blockId) return []

  return Array.from(element.querySelectorAll(BLOCK_OUTER_SELECTOR))
    .filter((child): child is HTMLElement => (
      child instanceof HTMLElement && child.dataset.id !== blockId
    ))
}

function renderedListItemHasChildren(element: HTMLElement) {
  return isRenderedListItemBlock(element) && renderedChildBlockElements(element).length > 0
}

function addRenderedDescendantBlockIds(element: HTMLElement, hiddenBlockIds: Set<string>) {
  for (const child of renderedChildBlockElements(element)) {
    if (child.dataset.id) hiddenBlockIds.add(child.dataset.id)
  }
}

function collapsedSectionRenderStateFromElements(
  elements: readonly HTMLElement[],
  collapsedHeadingIds: ReadonlySet<string>,
): CollapsedSectionRenderState {
  const state: CollapsedSectionRenderState = {
    collapsedHeadingIds: new Set(),
    hiddenBlockIds: new Set(),
  }
  let activeCollapsedLevel: number | null = null

  for (const element of elements) {
    const blockId = element.dataset.id
    const headingLevel = headingLevelFromRenderedBlock(element)
    const closesActiveSection = activeCollapsedLevel !== null
      && (isRenderedDividerBlock(element) || (headingLevel !== null && headingLevel <= activeCollapsedLevel))

    if (closesActiveSection) activeCollapsedLevel = null

    if (activeCollapsedLevel !== null) {
      if (blockId) state.hiddenBlockIds.add(blockId)
      continue
    }

    if (blockId && headingLevel !== null && collapsedHeadingIds.has(blockId)) {
      state.collapsedHeadingIds.add(blockId)
      activeCollapsedLevel = headingLevel
      continue
    }

    if (blockId && collapsedHeadingIds.has(blockId) && renderedListItemHasChildren(element)) {
      state.collapsedHeadingIds.add(blockId)
      addRenderedDescendantBlockIds(element, state.hiddenBlockIds)
    }
  }

  return state
}

function mergeCollapsedSectionRenderStates(...states: CollapsedSectionRenderState[]): CollapsedSectionRenderState {
  const merged: CollapsedSectionRenderState = {
    collapsedHeadingIds: new Set(),
    hiddenBlockIds: new Set(),
  }

  for (const state of states) {
    state.collapsedHeadingIds.forEach((blockId) => merged.collapsedHeadingIds.add(blockId))
    state.hiddenBlockIds.forEach((blockId) => merged.hiddenBlockIds.add(blockId))
  }

  return merged
}

function applyCollapsedSectionRenderingToElement(
  editorElement: HTMLElement,
  collapsedHeadingIds: ReadonlySet<string>,
  fallbackBlocks: readonly CollapsibleBlock[],
) {
  const blockElements = renderedSectionBlockElements(editorElement)
  const renderState = mergeCollapsedSectionRenderStates(
    fallbackBlocks.length > 0
      ? collapsedSectionRenderState(fallbackBlocks, collapsedHeadingIds)
      : { collapsedHeadingIds: new Set(), hiddenBlockIds: new Set() },
    blockElements.length > 0
      ? collapsedSectionRenderStateFromElements(blockElements, collapsedHeadingIds)
      : { collapsedHeadingIds: new Set(), hiddenBlockIds: new Set() },
  )

  syncCollapsedSectionStyle(editorElement, renderState)
}

function applyCollapsedSectionRenderingFromHeadingIds(
  editorElement: HTMLElement,
  collapsedHeadingIds: ReadonlySet<string>,
  fallbackBlocks: readonly CollapsibleBlock[] = [],
) {
  applyCollapsedSectionRenderingToElement(editorElement, collapsedHeadingIds, fallbackBlocks)
}

function applyCollapsedSectionRendering(
  editor: TolariaBlockNoteEditor,
  collapsedHeadingIds: ReadonlySet<string>,
) {
  const editorElement = editorBlockElement(editor)
  if (!editorElement) return

  applyCollapsedSectionRenderingToElement(
    editorElement,
    collapsedHeadingIds,
    editor.document as readonly CollapsibleBlock[],
  )
}

function isCollapsibleSectionBlockForEditor(
  editor: TolariaBlockNoteEditor,
  block: CollapsibleBlock | undefined,
) {
  if (isCollapsibleSectionBlock(block)) return true
  if (!block || !isListItemBlockType(block.type) || typeof block.id !== 'string') return false

  const editorElement = editorBlockElement(editor)
  const blockElement = editorElement ? renderedBlockElementById(editorElement, block.id) : undefined
  return Boolean(blockElement && renderedListItemHasChildren(blockElement))
}

function parseCssPixelLength(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function lastInlineContentRect(inlineContent: HTMLElement): DOMRect | undefined {
  const ownerDocument = inlineContent.ownerDocument
  const range = ownerDocument.createRange()
  range.selectNodeContents(inlineContent)
  const rect = Array.from(range.getClientRects())
    .filter((candidate) => candidate.width > 0 && candidate.height > 0)
    .at(-1)
  range.detach()

  return rect
}

function isCollapsedHeadingDotsHit(inlineContent: HTMLElement, clientX: number, clientY: number) {
  const ownerWindow = inlineContent.ownerDocument.defaultView
  if (!ownerWindow) return false

  const textRect = lastInlineContentRect(inlineContent)
  if (!textRect) return false

  const contentRect = inlineContent.getBoundingClientRect()
  const afterStyle = ownerWindow.getComputedStyle(inlineContent, '::after')
  const marginStart = parseCssPixelLength(afterStyle.getPropertyValue('margin-inline-start'))
  const dotsWidth = Math.max(
    parseCssPixelLength(afterStyle.width),
    parseCssPixelLength(afterStyle.minWidth),
  ) + parseCssPixelLength(afterStyle.paddingLeft) + parseCssPixelLength(afterStyle.paddingRight)
  const verticalSlop = 4
  const isRtl = ownerWindow.getComputedStyle(inlineContent).direction === 'rtl'
  const dotsStart = isRtl ? textRect.left - marginStart - dotsWidth : textRect.right + marginStart
  const dotsEnd = isRtl ? textRect.left - marginStart : dotsStart + dotsWidth

  return clientX >= dotsStart
    && clientX <= dotsEnd
    && clientY >= Math.min(textRect.top, contentRect.top) - verticalSlop
    && clientY <= Math.max(textRect.bottom, contentRect.bottom) + verticalSlop
}

function collapsedHeadingDotsHitAtPoint(
  editorElement: HTMLElement,
  store: CollapsedHeadingStore,
  clientX: number,
  clientY: number,
) {
  for (const blockElement of renderedSectionBlockElements(editorElement)) {
    const blockId = blockElement.dataset.id
    if (!blockId || !store.collapsedHeadingIds.has(blockId)) continue

    const inlineContent = blockElement.querySelector('.bn-block-content .bn-inline-content')
    if (!(inlineContent instanceof HTMLElement)) continue
    if (isCollapsedHeadingDotsHit(inlineContent, clientX, clientY)) return { blockId, inlineContent }
  }

  return undefined
}

function collapsedHeadingDotsHitFromEvent(
  editorElement: HTMLElement,
  store: CollapsedHeadingStore,
  event: MouseEvent,
) {
  const coordinateHit = collapsedHeadingDotsHitAtPoint(editorElement, store, event.clientX, event.clientY)
  if (coordinateHit) return coordinateHit
  if (!(event.target instanceof Element)) return undefined

  const inlineContent = event.target.closest('.bn-inline-content')
  if (!(inlineContent instanceof HTMLElement) || !editorElement.contains(inlineContent)) return undefined

  const blockElement = inlineContent.closest(BLOCK_OUTER_SELECTOR)
  if (!(blockElement instanceof HTMLElement) || !editorElement.contains(blockElement)) return undefined

  const blockId = blockElement.dataset.id
  if (!blockId || !store.collapsedHeadingIds.has(blockId)) return undefined
  if (!isCollapsedHeadingDotsHit(inlineContent, event.clientX, event.clientY)) return undefined

  return { blockId, inlineContent }
}

function collapsedHeadingIdFromDotsEvent(
  editorElement: HTMLElement,
  store: CollapsedHeadingStore,
  event: MouseEvent,
) {
  return collapsedHeadingDotsHitFromEvent(editorElement, store, event)?.blockId
}

function expandCollapsedHeading(
  editorElement: HTMLElement,
  store: CollapsedHeadingStore,
  headingId: string,
  fallbackBlocks: readonly CollapsibleBlock[] = [],
) {
  const collapsedHeadingIds = new Set(store.collapsedHeadingIds)
  if (!collapsedHeadingIds.delete(headingId)) return

  store.collapsedHeadingIds = collapsedHeadingIds
  applyCollapsedSectionRenderingFromHeadingIds(editorElement, store.collapsedHeadingIds, fallbackBlocks)
  store.emit()
}

function ensureCollapsedHeadingRenderer(
  editor: TolariaBlockNoteEditor,
  editorElement: HTMLElement,
  store = collapsedHeadingStore(editor),
) {
  if (headingCollapseRenderers.has(editorElement)) return

  const ownerWindow = editorElement.ownerDocument.defaultView
  if (!ownerWindow) return

  let frame: number | null = null
  const apply = () => applyCollapsedSectionRenderingFromHeadingIds(
    editorElement,
    store.collapsedHeadingIds,
    editor.document as readonly CollapsibleBlock[],
  )
  const scheduleApply = () => {
    if (frame !== null) return
    frame = ownerWindow.requestAnimationFrame(() => {
      frame = null
      apply()
    })
  }
  const mutationObserver = new ownerWindow.MutationObserver(scheduleApply)
  mutationObserver.observe(editorElement, {
    childList: true,
    subtree: true,
  })
  let hoveredDotsElement: HTMLElement | null = null
  const setHoveredDotsHit = (hit?: CollapsedHeadingDotsHit) => {
    if (hoveredDotsElement && hoveredDotsElement !== hit?.inlineContent) {
      hoveredDotsElement.style.removeProperty('cursor')
    }

    const container = collapsedSectionContainer(editorElement)
    if (container) {
      if (hit) container.dataset.tolariaCollapseHoverId = hit.blockId
      else delete container.dataset.tolariaCollapseHoverId
    }

    hoveredDotsElement = hit?.inlineContent ?? null
    if (hoveredDotsElement) {
      editorElement.style.setProperty('cursor', 'pointer')
      hoveredDotsElement.style.setProperty('cursor', 'pointer')
    } else {
      editorElement.style.removeProperty('cursor')
    }
  }
  const handleCollapsedHeadingMouseMove = (event: MouseEvent) => {
    setHoveredDotsHit(collapsedHeadingDotsHitFromEvent(editorElement, store, event))
  }
  const handleCollapsedHeadingMouseLeave = () => setHoveredDotsHit()
  const handleCollapsedHeadingMouseDown = (event: MouseEvent) => {
    if (!collapsedHeadingIdFromDotsEvent(editorElement, store, event)) return

    event.preventDefault()
    event.stopPropagation()
  }
  const handleCollapsedHeadingClick = (event: MouseEvent) => {
    const headingId = collapsedHeadingIdFromDotsEvent(editorElement, store, event)
    if (!headingId) return

    event.preventDefault()
    event.stopPropagation()
    setHoveredDotsHit()
    expandCollapsedHeading(
      editorElement,
      store,
      headingId,
      editor.document as readonly CollapsibleBlock[],
    )
  }
  editorElement.addEventListener('mousemove', handleCollapsedHeadingMouseMove, true)
  editorElement.addEventListener('mouseleave', handleCollapsedHeadingMouseLeave, true)
  editorElement.addEventListener('mousedown', handleCollapsedHeadingMouseDown, true)
  editorElement.addEventListener('click', handleCollapsedHeadingClick, true)
  const unsubscribeStore = store.subscribe(scheduleApply)
  const unsubscribeEditorChange = editor.onChange(scheduleApply)
  const cleanup = () => {
    if (frame !== null) ownerWindow.cancelAnimationFrame(frame)
    mutationObserver.disconnect()
    setHoveredDotsHit()
    editorElement.removeEventListener('mousemove', handleCollapsedHeadingMouseMove, true)
    editorElement.removeEventListener('mouseleave', handleCollapsedHeadingMouseLeave, true)
    editorElement.removeEventListener('mousedown', handleCollapsedHeadingMouseDown, true)
    editorElement.removeEventListener('click', handleCollapsedHeadingClick, true)
    collapsedSectionStyleElements.get(editorElement)?.remove()
    collapsedSectionStyleElements.delete(editorElement)
    unsubscribeEditorChange()
    unsubscribeStore()
  }

  headingCollapseRenderers.set(editorElement, cleanup)
  apply()
}

function releaseCollapsedHeadingRenderer(editorElement: HTMLElement) {
  const cleanup = headingCollapseRenderers.get(editorElement)
  if (!cleanup) return

  cleanup()
  headingCollapseRenderers.delete(editorElement)
}

function toggleCollapsedHeading(
  editor: TolariaBlockNoteEditor,
  headingId: string,
  editorElement?: HTMLElement,
) {
  const store = collapsedHeadingStore(editor)
  const collapsedHeadingIds = new Set(store.collapsedHeadingIds)
  if (collapsedHeadingIds.has(headingId)) collapsedHeadingIds.delete(headingId)
  else collapsedHeadingIds.add(headingId)
  store.collapsedHeadingIds = collapsedHeadingIds

  if (editorElement) {
    ensureCollapsedHeadingRenderer(editor, editorElement, store)
    applyCollapsedSectionRenderingFromHeadingIds(
      editorElement,
      store.collapsedHeadingIds,
      editor.document as readonly CollapsibleBlock[],
    )
  } else {
    applyCollapsedSectionRendering(editor, store.collapsedHeadingIds)
  }
  store.emit()
}

function useCollapsedHeadingRendering(editor: TolariaBlockNoteEditor) {
  useLayoutEffect(() => {
    let attachFrame: number | null = null
    let attachedEditorElement: HTMLElement | null = null
    const fallbackWindow = typeof window === 'undefined' ? undefined : window
    const attachController = () => {
      attachFrame = null
      const editorElement = editorBlockElement(editor)
      if (!editorElement) {
        if (fallbackWindow) attachFrame = fallbackWindow.requestAnimationFrame(attachController)
        return
      }

      attachedEditorElement = editorElement
      ensureCollapsedHeadingRenderer(editor, editorElement)
    }

    attachController()

    return () => {
      if (attachFrame !== null && fallbackWindow) fallbackWindow.cancelAnimationFrame(attachFrame)
      if (attachedEditorElement) releaseCollapsedHeadingRenderer(attachedEditorElement)
    }
  }, [editor])
}

function sideMenuElementForEditor(editorElement: HTMLElement): HTMLElement | null {
  const container = editorElement.closest('.editor__blocknote-container') ?? editorElement
  const sideMenu = container.querySelector('.bn-side-menu')
  return sideMenu instanceof HTMLElement ? sideMenu : null
}

function blockTextAnchorRect(blockElement: HTMLElement): DOMRect | null {
  const content = blockElement.querySelector('.bn-block-content')
  const inlineContent = content?.querySelector('.bn-inline-content') ?? content
  if (!(inlineContent instanceof HTMLElement)) return null

  const ownerDocument = inlineContent.ownerDocument
  const range = ownerDocument.createRange()
  range.selectNodeContents(inlineContent)
  const firstLineRect = Array.from(range.getClientRects())
    .find((rect) => rect.width > 0 && rect.height > 0)
  const textRect = firstLineRect ?? range.getBoundingClientRect()
  range.detach()

  if (textRect.height > 0) return textRect

  const fallbackRect = inlineContent.getBoundingClientRect()
  return fallbackRect.height > 0 ? fallbackRect : null
}

function alignSideMenuWithBlockText(editorElement: HTMLElement, blockId: string): boolean {
  const blockElement = blockElementById(editorElement, blockId)
  const sideMenu = sideMenuElementForEditor(editorElement)
  if (!blockElement || !sideMenu) return false

  const anchorRect = blockTextAnchorRect(blockElement)
  if (!anchorRect) return false

  sideMenu.style.removeProperty('translate')
  const sideMenuRect = sideMenu.getBoundingClientRect()
  if (sideMenuRect.height <= 0) return false

  const anchorCenter = anchorRect.top + anchorRect.height / 2
  const sideMenuCenter = sideMenuRect.top + sideMenuRect.height / 2
  sideMenu.style.setProperty('translate', `0 ${anchorCenter - sideMenuCenter}px`)
  return true
}

function createSideMenuAlignmentState(): SideMenuAlignmentState {
  return {
    attemptsRemaining: SIDE_MENU_ALIGNMENT_ATTEMPTS,
    frame: null,
    hasObservedTargets: false,
  }
}

function createSideMenuResizeObserver(onResize: () => void): ResizeObserver | null {
  return typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(onResize)
}

function observeSideMenuAlignmentTargets({
  blockId,
  editorElement,
  resizeObserver,
  state,
}: {
  blockId: string
  editorElement: HTMLElement
  resizeObserver: ResizeObserver | null
  state: SideMenuAlignmentState
}) {
  if (state.hasObservedTargets) return

  const blockElement = blockElementById(editorElement, blockId)
  const sideMenu = sideMenuElementForEditor(editorElement)
  if (!resizeObserver || !blockElement || !sideMenu) return

  resizeObserver.observe(blockElement)
  resizeObserver.observe(sideMenu)
  state.hasObservedTargets = true
}

function scheduleSideMenuTextAlignment(context: SideMenuAlignmentContext) {
  const { blockId, editorElement, observeTargets, ownerWindow, retry, state } = context
  if (state.frame !== null) return

  state.frame = ownerWindow.requestAnimationFrame(() => {
    state.frame = null
    const aligned = alignSideMenuWithBlockText(editorElement, blockId)
    observeTargets()
    if (!aligned && state.attemptsRemaining > 0) {
      state.attemptsRemaining -= 1
      retry()
    }
  })
}

function createSideMenuAlignmentCleanup({
  editorElement,
  ownerWindow,
  resizeObserver,
  scheduleAlignment,
  state,
}: {
  editorElement: HTMLElement
  ownerWindow: Window
  resizeObserver: ResizeObserver | null
  scheduleAlignment: () => void
  state: SideMenuAlignmentState
}) {
  return () => {
    if (state.frame !== null) ownerWindow.cancelAnimationFrame(state.frame)
    resizeObserver?.disconnect()
    ownerWindow.removeEventListener('resize', scheduleAlignment)
    sideMenuElementForEditor(editorElement)?.style.removeProperty('translate')
  }
}

function createSideMenuAlignmentController(editor: TolariaBlockNoteEditor, blockId: string) {
  const editorElement = editorBlockElement(editor)
  const ownerWindow = editorElement?.ownerDocument.defaultView
  if (!editorElement || !ownerWindow) return undefined

  const state = createSideMenuAlignmentState()
  let resizeObserver: ResizeObserver | null = null
  const observeTargets = () => observeSideMenuAlignmentTargets({
    blockId,
    editorElement,
    resizeObserver,
    state,
  })
  const scheduleAlignment = () => scheduleSideMenuTextAlignment({
    blockId,
    editorElement,
    observeTargets,
    ownerWindow,
    retry: scheduleAlignment,
    state,
  })

  resizeObserver = createSideMenuResizeObserver(scheduleAlignment)
  scheduleAlignment()
  observeTargets()
  ownerWindow.addEventListener('resize', scheduleAlignment)

  return createSideMenuAlignmentCleanup({
    editorElement,
    ownerWindow,
    resizeObserver,
    scheduleAlignment,
    state,
  })
}

function useSideMenuTextAlignment(editor: TolariaBlockNoteEditor, block: SideMenuBlock | undefined) {
  const blockId = block?.id

  useLayoutEffect(() => {
    if (!blockId) return

    return createSideMenuAlignmentController(editor, blockId)
  }, [blockId, editor])
}

function styleDragPreview(preview: HTMLElement, rect: DOMRect) {
  preview.setAttribute('data-testid', 'editor-block-drag-preview')
  preview.setAttribute('aria-hidden', 'true')
  preview.className = 'editor__blocknote-container'
  preview.style.position = 'fixed'
  preview.style.width = `${rect.width}px`
  preview.style.maxHeight = `${Math.max(rect.height, 1)}px`
  preview.style.overflow = 'hidden'
  preview.style.pointerEvents = 'none'
  preview.style.opacity = '0.72'
  preview.style.zIndex = '14000'
  preview.style.boxSizing = 'border-box'
  preview.style.borderRadius = '6px'
  preview.style.background = 'var(--bg-primary, white)'
  preview.style.boxShadow = '0 10px 26px rgba(15, 23, 42, 0.18)'
}

function createDragPreview(draggedElement: HTMLElement, ownerDocument: Document): HTMLElement {
  const preview = ownerDocument.createElement('div')
  const clone = draggedElement.cloneNode(true)
  const rect = draggedElement.getBoundingClientRect()

  if (clone instanceof HTMLElement) {
    clone.style.margin = '0'
    clone.style.width = '100%'
    clone.style.pointerEvents = 'none'
    preview.appendChild(clone)
  }
  styleDragPreview(preview, rect)
  ownerDocument.body.appendChild(preview)

  return preview
}

function createDropIndicator(ownerDocument: Document): HTMLElement {
  const indicator = ownerDocument.createElement('div')
  indicator.setAttribute('data-testid', 'editor-block-drop-indicator')
  indicator.style.position = 'fixed'
  indicator.style.height = '2px'
  indicator.style.pointerEvents = 'none'
  indicator.style.background = 'var(--border-focus, #155dff)'
  indicator.style.borderRadius = '999px'
  indicator.style.boxShadow = '0 0 0 1px rgba(21, 93, 255, 0.12), 0 0 10px rgba(21, 93, 255, 0.28)'
  indicator.style.zIndex = '14001'
  indicator.style.display = 'none'
  ownerDocument.body.appendChild(indicator)

  return indicator
}

function createReorderAffordances(state: PointerReorderState): ReorderAffordances | undefined {
  const draggedElement = blockElementById(state.editorElement, state.draggedBlockId)
  if (!draggedElement) return undefined

  const rect = draggedElement.getBoundingClientRect()
  const previousDraggedOpacity = draggedElement.style.opacity
  const preview = createDragPreview(draggedElement, state.ownerDocument)
  draggedElement.style.opacity = '0.35'

  return {
    draggedElement,
    dropIndicator: createDropIndicator(state.ownerDocument),
    pointerOffsetX: state.startX - rect.left,
    pointerOffsetY: state.startY - rect.top,
    preview,
    previousDraggedOpacity,
  }
}

function cleanupReorderAffordances(affordances: ReorderAffordances | undefined) {
  if (!affordances) return

  affordances.draggedElement.style.opacity = affordances.previousDraggedOpacity
  affordances.preview.remove()
  affordances.dropIndicator.remove()
}

function updateDragPreview(affordances: ReorderAffordances, x: number, y: number) {
  affordances.preview.style.left = `${x - affordances.pointerOffsetX}px`
  affordances.preview.style.top = `${y - affordances.pointerOffsetY}px`
}

function hideDropIndicator(affordances: ReorderAffordances | undefined) {
  if (affordances) affordances.dropIndicator.style.display = 'none'
}

function updateDropIndicator(affordances: ReorderAffordances | undefined, target: DropTarget | null) {
  if (!affordances || !target) {
    hideDropIndicator(affordances)
    return
  }

  const rect = target.element.getBoundingClientRect()
  affordances.dropIndicator.style.display = 'block'
  affordances.dropIndicator.style.left = `${rect.left}px`
  affordances.dropIndicator.style.top = `${target.placement === 'before' ? rect.top - 1 : rect.bottom - 1}px`
  affordances.dropIndicator.style.width = `${rect.width}px`
}

function validDropTarget({
  editor,
  state,
  x,
  y,
}: {
  editor: TolariaBlockNoteEditor
  state: PointerReorderState
  x: number
  y: number
}): DropTarget | null {
  const targetElement = blockElementFromPoint({
    editorElement: state.editorElement,
    ownerDocument: state.ownerDocument,
    x,
    y,
  })
  if (!targetElement) return null

  const blockId = blockIdFromElement(targetElement)
  if (!blockId || blockId === state.draggedBlockId) return null

  const draggedBlock = liveSideMenuBlock(editor, { id: state.draggedBlockId, type: '' })
  const targetBlock = liveSideMenuBlock(editor, { id: blockId, type: '' })
  if (!draggedBlock || !targetBlock || hasChildBlock(draggedBlock, blockId)) return null

  return {
    blockId,
    element: targetElement,
    placement: dropPlacementForPoint(targetElement, y),
  }
}

function moveBlockByPointerDrop({
  editor,
  draggedBlockId,
  targetBlockId,
  placement,
}: {
  editor: TolariaBlockNoteEditor
  draggedBlockId: string
  targetBlockId: string
  placement: DropPlacement
}): boolean {
  if (draggedBlockId === targetBlockId) return false

  const draggedBlock = liveSideMenuBlock(editor, { id: draggedBlockId, type: '' })
  const targetBlock = liveSideMenuBlock(editor, { id: targetBlockId, type: '' })
  if (!draggedBlock || !targetBlock || hasChildBlock(draggedBlock, targetBlockId)) return false

  let moved = false
  runSideMenuAction(() => {
    editor.focus()
    editor.transact(() => {
      const currentDraggedBlock = liveSideMenuBlock(editor, { id: draggedBlockId, type: '' })
      const currentTargetBlock = liveSideMenuBlock(editor, { id: targetBlockId, type: '' })
      if (!currentDraggedBlock || !currentTargetBlock) return
      if (hasChildBlock(currentDraggedBlock, targetBlockId)) return

      editor.removeBlocks([currentDraggedBlock.id])
      editor.insertBlocks([currentDraggedBlock], currentTargetBlock.id, placement)
      moved = true
    })
  })

  return moved
}

function useSideMenuBlock() {
  const editor = useBlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>()
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state): SideMenuBlock | undefined => state?.block
      ? {
          children: state.block.children as CollapsibleBlock[] | undefined,
          content: state.block.content,
          id: state.block.id,
          props: state.block.props as Record<string, unknown> | undefined,
          type: state.block.type,
        }
      : undefined,
  })

  return { block, editor }
}

function stopSideMenuClick(event: ReactMouseEvent<Element>) {
  event.preventDefault()
  event.stopPropagation()
}

function editorElementFromSideMenuControl(control: Element): HTMLElement | undefined {
  const container = control.closest('.editor__blocknote-container')
  const editorElement = container?.querySelector('.bn-editor')
  if (editorElement instanceof HTMLElement) return editorElement

  const documentEditors = Array.from(control.ownerDocument.querySelectorAll('.bn-editor'))
    .filter((element): element is HTMLElement => element instanceof HTMLElement)
  return documentEditors.find((element) => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }) ?? documentEditors.at(-1)
}

function TolariaAddBlockButton() {
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const suggestionMenu = useExtension(SuggestionMenu)
  const { block, editor } = useSideMenuBlock()

  const addBlock = useCallback(() => {
    runSideMenuAction(() => {
      const liveBlock = liveSideMenuBlock(editor, block)
      if (!liveBlock) return

      if (isInlineBlockEmpty(liveBlock)) {
        editor.setTextCursorPosition(liveBlock.id)
        suggestionMenu.openSuggestionMenu('/')
        return
      }

      const insertedBlock = editor.insertBlocks([{ type: 'paragraph' }], liveBlock.id, 'after')[0]
      if (!insertedBlock) return
      editor.setTextCursorPosition(insertedBlock.id)
      suggestionMenu.openSuggestionMenu('/')
    })
  }, [block, editor, suggestionMenu])
  const onButtonClick = useCallback((event: ReactMouseEvent<Element>) => {
    stopSideMenuClick(event)
    addBlock()
  }, [addBlock])

  if (!block) return null

  return (
    <Components.SideMenu.Button
      className="bn-button"
      label={dict.side_menu.add_block_label}
      onClick={onButtonClick}
      icon={<Plus size={20} onClick={onButtonClick} data-test="dragHandleAdd" />}
    />
  )
}

function TolariaHeadingCollapseButton() {
  const Components = useComponentsContext()!
  const { block, editor } = useSideMenuBlock()
  const collapsedHeadingIds = useCollapsedHeadingIds(editor)
  const isCollapsed = Boolean(block?.id && collapsedHeadingIds.has(block.id))
  const isHeading = blockHeadingLevel(block) !== null
  const isCollapsible = isCollapsibleSectionBlockForEditor(editor, block)
  const Icon = isCollapsed ? CaretRight : CaretDown
  const label = isHeading
    ? isCollapsed ? 'Expand section' : 'Collapse section'
    : isCollapsed ? 'Expand item' : 'Collapse item'

  const toggleHeading = useCallback((editorElement?: HTMLElement) => {
    runSideMenuAction(() => {
      const liveBlock = liveSideMenuBlock(editor, block)
      if (!liveBlock) return
      if (!isCollapsibleSectionBlockForEditor(editor, liveBlock as CollapsibleBlock | undefined)) return
      toggleCollapsedHeading(editor, liveBlock.id, editorElement)
    })
  }, [block, editor])
  const onButtonClick = useCallback((event: ReactMouseEvent<Element>) => {
    stopSideMenuClick(event)
    toggleHeading(editorElementFromSideMenuControl(event.currentTarget))
  }, [toggleHeading])

  if (!isCollapsible) return null

  return (
    <Components.SideMenu.Button
      className="bn-button"
      label={label}
      onClick={onButtonClick}
      icon={<Icon size={20} onClick={onButtonClick} data-test="headingCollapseToggle" />}
    />
  )
}

function TolariaSectionControlButton() {
  const { block, editor } = useSideMenuBlock()
  if (isCollapsibleSectionBlockForEditor(editor, block)) return <TolariaHeadingCollapseButton />

  return <TolariaAddBlockButton />
}

function TolariaDragHandleButton({
  children,
  dragHandleMenu,
}: SideMenuProps & { children?: ReactNode }) {
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const sideMenu = useExtension(SideMenuExtension)
  const { block, editor } = useSideMenuBlock()
  const MenuComponent: ComponentType<{ children?: ReactNode }> = dragHandleMenu ?? DragHandleMenu
  const reorderStateRef = useRef<PointerReorderState | null>(null)
  const suppressNextClickRef = useRef(false)

  const clearReorderState = useCallback(() => {
    const state = reorderStateRef.current
    if (state) {
      state.clearListeners()
      cleanupReorderAffordances(state.affordances)
    }
    reorderStateRef.current = null
  }, [])

  const finishPointerReorder = useCallback((event: PointerEvent) => {
    const state = reorderStateRef.current
    if (!state || event.pointerId !== state.pointerId) return

    clearReorderState()
    if (!state.hasMoved) return

    event.preventDefault()
    suppressNextClickRef.current = true
    const dropTarget = state.lastDropTarget ?? validDropTarget({
      editor,
      state,
      x: event.clientX,
      y: event.clientY,
    })
    if (!dropTarget) return

    const moved = moveBlockByPointerDrop({
      editor,
      draggedBlockId: state.draggedBlockId,
      targetBlockId: dropTarget.blockId,
      placement: dropTarget.placement,
    })

    if (!moved) suppressNextClickRef.current = false
  }, [clearReorderState, editor])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if ((typeof event.button === 'number' && event.button !== 0) || event.isPrimary === false) return

    runSideMenuAction(() => {
      const liveBlock = liveSideMenuBlock(editor, block)
      const editorElement = editorBlockElement(editor)
      if (!liveBlock || !editorElement) {
        event.preventDefault()
        return
      }

      clearReorderState()
      const ownerDocument = event.currentTarget.ownerDocument
      const pointerId = event.pointerId
      const handlePointerMove = (nativeEvent: PointerEvent) => {
        const state = reorderStateRef.current
        if (!state || nativeEvent.pointerId !== state.pointerId) return

        const distance = Math.hypot(
          nativeEvent.clientX - state.startX,
          nativeEvent.clientY - state.startY,
        )
        if (!state.hasMoved && distance < POINTER_REORDER_THRESHOLD_PX) return

        state.hasMoved = true
        suppressNextClickRef.current = true
        state.affordances ??= createReorderAffordances(state)
        if (!state.affordances) return

        updateDragPreview(state.affordances, nativeEvent.clientX, nativeEvent.clientY)
        state.lastDropTarget = validDropTarget({
          editor,
          state,
          x: nativeEvent.clientX,
          y: nativeEvent.clientY,
        })
        updateDropIndicator(state.affordances, state.lastDropTarget ?? null)
        nativeEvent.preventDefault()
      }
      const handlePointerUp = (nativeEvent: PointerEvent) => finishPointerReorder(nativeEvent)
      const handlePointerCancel = (nativeEvent: PointerEvent) => {
        if (nativeEvent.pointerId !== pointerId) return
        clearReorderState()
      }

      ownerDocument.addEventListener('pointermove', handlePointerMove, true)
      ownerDocument.addEventListener('pointerup', handlePointerUp, true)
      ownerDocument.addEventListener('pointercancel', handlePointerCancel, true)

      reorderStateRef.current = {
        clearListeners: () => {
          ownerDocument.removeEventListener('pointermove', handlePointerMove, true)
          ownerDocument.removeEventListener('pointerup', handlePointerUp, true)
          ownerDocument.removeEventListener('pointercancel', handlePointerCancel, true)
        },
        draggedBlockId: liveBlock.id,
        editorElement,
        hasMoved: false,
        ownerDocument,
        pointerId,
        startX: event.clientX,
        startY: event.clientY,
      }
      try {
        event.currentTarget.setPointerCapture?.(pointerId)
      } catch {
        // Document-level pointer listeners still complete the reorder gesture.
      }
    })
  }, [block, clearReorderState, editor, finishPointerReorder])

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressNextClickRef.current) return

    suppressNextClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }, [])

  if (!block) return null

  return (
    <Components.Generic.Menu.Root
      onOpenChange={(open: boolean) => {
        if (open) sideMenu.freezeMenu()
        else sideMenu.unfreezeMenu()
      }}
      position="left"
    >
      <Components.Generic.Menu.Trigger>
        <span
          className="tolaria-block-drag-handle"
          onPointerDown={onPointerDown}
          onClickCapture={onClickCapture}
        >
          <Components.SideMenu.Button
            label={dict.side_menu.drag_handle_label}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            onDragEnd={sideMenu.blockDragEnd}
            className="bn-button"
            icon={<GripVertical size={20} data-test="dragHandle" />}
          />
        </span>
      </Components.Generic.Menu.Trigger>
      <MenuComponent>{children}</MenuComponent>
    </Components.Generic.Menu.Root>
  )
}

function TolariaRemoveBlockItem({ children }: { children: ReactNode }) {
  const Components = useComponentsContext()!
  const { block, editor } = useSideMenuBlock()

  if (!block) return null

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => {
        runSideMenuAction(() => {
          const liveBlock = liveSideMenuBlock(editor, block)
          if (!liveBlock) return
          editor.removeBlocks([liveBlock.id])
        })
      }}
    >
      {children}
    </Components.Generic.Menu.Item>
  )
}

function TolariaTableHeaderItem({
  children,
  header,
}: {
  children: ReactNode
  header: 'column' | 'row'
}) {
  const Components = useComponentsContext()!
  const { block, editor } = useSideMenuBlock()
  const liveBlock = liveSideMenuBlock(editor, block)
  const tableContent = tableHeaderContent(liveBlock)

  if (!tableContent || !editor.settings.tables.headers) return null

  const checked = header === 'row'
    ? Boolean(tableContent.headerRows)
    : Boolean(tableContent.headerCols)

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      checked={checked}
      onClick={() => {
        runSideMenuAction(() => {
          const currentBlock = liveSideMenuBlock(editor, block)
          const currentContent = tableHeaderContent(currentBlock)
          if (!currentBlock || !currentContent) return

          editor.updateBlock(currentBlock.id, {
            content: {
              ...currentContent,
              [header === 'row' ? 'headerRows' : 'headerCols']: checked ? undefined : 1,
            } as never,
          })
        })
      }}
    >
      {children}
    </Components.Generic.Menu.Item>
  )
}

function TolariaDragHandleMenu() {
  const dict = useDictionary()

  return (
    <DragHandleMenu>
      <TolariaRemoveBlockItem>{dict.drag_handle.delete_menuitem}</TolariaRemoveBlockItem>
      <TolariaTableHeaderItem header="row">{dict.drag_handle.header_row_menuitem}</TolariaTableHeaderItem>
      <TolariaTableHeaderItem header="column">{dict.drag_handle.header_column_menuitem}</TolariaTableHeaderItem>
    </DragHandleMenu>
  )
}

export function TolariaSideMenu(props: SideMenuProps) {
  const { block, editor } = useSideMenuBlock()
  useSideMenuTextAlignment(editor, block)

  return (
    <SideMenu {...props}>
      <TolariaDragHandleButton dragHandleMenu={TolariaDragHandleMenu} />
      <TolariaSectionControlButton />
    </SideMenu>
  )
}

export function TolariaCollapsedHeadingsController() {
  const editor = useBlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>()
  useCollapsedHeadingRendering(editor)

  return null
}
