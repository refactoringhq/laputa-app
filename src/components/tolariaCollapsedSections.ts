import {
  useLayoutEffect,
  useSyncExternalStore,
} from 'react'
import {
  BLOCK_OUTER_SELECTOR,
  editorBlockElement,
  renderedSectionBlockElements,
  type TolariaBlockNoteEditor,
} from './tolariaBlockNoteDom'

export type CollapsibleBlock = {
  children?: CollapsibleBlock[]
  id?: unknown
  props?: Record<string, unknown>
  type?: unknown
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
type CollapsedHeadingRenderingController = {
  attachedEditorElement: HTMLElement | null
  frame: number | null
  ownerWindow: Window | undefined
}

const COLLAPSIBLE_LIST_ITEM_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem'])
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

export function useCollapsedHeadingIds(editor: TolariaBlockNoteEditor) {
  const store = collapsedHeadingStore(editor)
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return store.collapsedHeadingIds
}

export function blockHeadingLevel(block: CollapsibleBlock | undefined): number | null {
  if (block?.type !== 'heading') return null

  return normalizedHeadingLevel(block.props?.level)
}

function normalizedHeadingLevel(rawLevel: unknown): number | null {
  const level = headingLevelValue(rawLevel)
  return isValidHeadingLevel(level) ? level : null
}

function headingLevelValue(rawLevel: unknown) {
  if (typeof rawLevel === 'number') return rawLevel
  if (typeof rawLevel === 'string') return Number.parseInt(rawLevel, 10)
  return 1
}

function isSectionBoundaryBlock(block: CollapsibleBlock) {
  return block.type === 'divider' || block.type === 'horizontalRule'
}

function isListItemBlockType(type: unknown) {
  return typeof type === 'string' && COLLAPSIBLE_LIST_ITEM_TYPES.has(type)
}

function isCollapsibleListItemBlock(block: CollapsibleBlock | undefined) {
  return isListItemBlockType(block?.type)
    && Array.isArray(block?.children)
    && block.children.length > 0
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
  const state = emptyCollapsedSectionRenderState()
  let activeCollapsedLevel: number | null = null

  for (const block of flattenBlocks(blocks)) {
    const blockId = typeof block.id === 'string' ? block.id : undefined
    const headingLevel = blockHeadingLevel(block)
    const closesActiveSection = activeCollapsedLevel !== null
      && (isSectionBoundaryBlock(block) || isClosingHeading(headingLevel, activeCollapsedLevel))

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
  const collapsedHeadingHoverSelectors = collapsedHeadingHoverRuleSelectors(editorElement, renderState)

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

function collapsedHeadingHoverRuleSelectors(
  editorElement: HTMLElement,
  renderState: CollapsedSectionRenderState,
) {
  const scope = collapsedSectionStyleScope(editorElement)
  if (!scope) return []

  return Array.from(renderState.collapsedHeadingIds)
    .flatMap((blockId) => headingDotsSelectorsForStyle(
      editorElement,
      blockId,
      `${scope}[data-tolaria-collapse-hover-id=${cssString(blockId)}]`,
    ))
}

function syncCollapsedSectionStyle(
  editorElement: HTMLElement,
  renderState: CollapsedSectionRenderState,
) {
  collapsedSectionStyleElement(editorElement).textContent = collapsedSectionStyleText(editorElement, renderState)
}

function renderedBlockElementById(editorElement: HTMLElement, blockId: string): HTMLElement | undefined {
  return renderedSectionBlockElements(editorElement)
    .find((element) => element.dataset.id === blockId)
}

function headingLevelFromRenderedBlock(element: HTMLElement): number | null {
  const headingContent = renderedHeadingContent(element)
  if (!headingContent) return null

  return headingDataLevel(headingContent) ?? headingTagLevel(headingContent) ?? 1
}

function renderedHeadingContent(element: HTMLElement) {
  const headingContent = element.querySelector('[data-content-type="heading"]')
  return headingContent instanceof HTMLElement ? headingContent : undefined
}

function headingDataLevel(headingContent: HTMLElement): number | undefined {
  const dataLevel = headingContent.dataset.level
  const parsedDataLevel = dataLevel ? Number.parseInt(dataLevel, 10) : Number.NaN
  return isValidHeadingLevel(parsedDataLevel) ? parsedDataLevel : undefined
}

function headingTagLevel(headingContent: HTMLElement): number | undefined {
  const headingElement = headingContent.querySelector('h1, h2, h3, h4, h5, h6')
  const tagName = headingElement?.tagName.toLowerCase()
  const tagLevel = tagName?.match(/^h([1-6])$/)?.[1]
  return tagLevel ? Number.parseInt(tagLevel, 10) : undefined
}

function isValidHeadingLevel(level: number) {
  return Number.isInteger(level) && level >= 1 && level <= 6
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

function emptyCollapsedSectionRenderState(): CollapsedSectionRenderState {
  return {
    collapsedHeadingIds: new Set(),
    hiddenBlockIds: new Set(),
  }
}

function isClosingHeading(headingLevel: number | null, activeCollapsedLevel: number) {
  return headingLevel !== null && headingLevel <= activeCollapsedLevel
}

function collapsedSectionRenderStateFromElements(
  elements: readonly HTMLElement[],
  collapsedHeadingIds: ReadonlySet<string>,
): CollapsedSectionRenderState {
  const state = emptyCollapsedSectionRenderState()
  let activeCollapsedLevel: number | null = null

  for (const element of elements) {
    const blockId = element.dataset.id
    const headingLevel = headingLevelFromRenderedBlock(element)
    const closesActiveSection = activeCollapsedLevel !== null
      && (isRenderedDividerBlock(element) || isClosingHeading(headingLevel, activeCollapsedLevel))

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
  const merged = emptyCollapsedSectionRenderState()

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
      : emptyCollapsedSectionRenderState(),
    blockElements.length > 0
      ? collapsedSectionRenderStateFromElements(blockElements, collapsedHeadingIds)
      : emptyCollapsedSectionRenderState(),
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

export function collapsedSectionHiddenBlockIds(editor: TolariaBlockNoteEditor): ReadonlySet<string> {
  const store = collapsedHeadingStore(editor)
  if (store.collapsedHeadingIds.size === 0) return new Set()

  const fallbackBlocks = editor.document as readonly CollapsibleBlock[]
  const editorElement = editorBlockElement(editor)
  if (!editorElement) {
    return collapsedSectionRenderState(fallbackBlocks, store.collapsedHeadingIds).hiddenBlockIds
  }

  const blockElements = renderedSectionBlockElements(editorElement)
  return mergeCollapsedSectionRenderStates(
    fallbackBlocks.length > 0
      ? collapsedSectionRenderState(fallbackBlocks, store.collapsedHeadingIds)
      : emptyCollapsedSectionRenderState(),
    blockElements.length > 0
      ? collapsedSectionRenderStateFromElements(blockElements, store.collapsedHeadingIds)
      : emptyCollapsedSectionRenderState(),
  ).hiddenBlockIds
}

export function isCollapsibleSectionBlockForEditor(
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
  return collapsedHeadingDotsHitAtPoint(editorElement, store, event.clientX, event.clientY)
    ?? collapsedHeadingDotsHitFromTarget(editorElement, store, event)
}

function collapsedHeadingDotsHitFromTarget(
  editorElement: HTMLElement,
  store: CollapsedHeadingStore,
  event: MouseEvent,
) {
  const inlineContent = inlineContentFromEventTarget(editorElement, event.target)
  if (!inlineContent) return undefined

  const blockElement = collapsedBlockElementForInlineContent(editorElement, inlineContent)
  if (!blockElement) return undefined

  const blockId = blockElement.dataset.id
  if (!blockId || !store.collapsedHeadingIds.has(blockId)) return undefined
  if (!isCollapsedHeadingDotsHit(inlineContent, event.clientX, event.clientY)) return undefined

  return { blockId, inlineContent }
}

function inlineContentFromEventTarget(editorElement: HTMLElement, target: EventTarget | null) {
  if (!(target instanceof Element)) return undefined

  const inlineContent = target.closest('.bn-inline-content')
  return inlineContent instanceof HTMLElement && editorElement.contains(inlineContent)
    ? inlineContent
    : undefined
}

function collapsedBlockElementForInlineContent(
  editorElement: HTMLElement,
  inlineContent: HTMLElement,
) {
  const blockElement = inlineContent.closest(BLOCK_OUTER_SELECTOR)
  return blockElement instanceof HTMLElement && editorElement.contains(blockElement)
    ? blockElement
    : undefined
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

function toggledCollapsedHeadingIds(collapsedHeadingIds: ReadonlySet<string>, headingId: string) {
  const nextCollapsedHeadingIds = new Set(collapsedHeadingIds)
  if (nextCollapsedHeadingIds.has(headingId)) nextCollapsedHeadingIds.delete(headingId)
  else nextCollapsedHeadingIds.add(headingId)
  return nextCollapsedHeadingIds
}

function releaseCurrentCollapsedHeadingRenderer(editor: TolariaBlockNoteEditor) {
  const currentEditorElement = editorBlockElement(editor)
  if (currentEditorElement) releaseCollapsedHeadingRenderer(currentEditorElement)
}

function releaseCollapsedHeadingRendererForToggle(
  editor: TolariaBlockNoteEditor,
  editorElement: HTMLElement | undefined,
) {
  if (editorElement) releaseCollapsedHeadingRenderer(editorElement)
  else releaseCurrentCollapsedHeadingRenderer(editor)
}

function applyCollapsedHeadingToggleRendering(options: {
  editor: TolariaBlockNoteEditor
  editorElement?: HTMLElement
  store: CollapsedHeadingStore
}) {
  const { editor, editorElement, store } = options

  if (store.collapsedHeadingIds.size === 0) {
    releaseCollapsedHeadingRendererForToggle(editor, editorElement)
    return
  }

  if (!editorElement) {
    applyCollapsedSectionRendering(editor, store.collapsedHeadingIds)
    return
  }

  ensureCollapsedHeadingRenderer(editor, editorElement, store)
  applyCollapsedSectionRenderingFromHeadingIds(
    editorElement,
    store.collapsedHeadingIds,
    editor.document as readonly CollapsibleBlock[],
  )
}

function releaseAttachedCollapsedHeadingRenderer(controller: CollapsedHeadingRenderingController) {
  if (controller.attachedEditorElement) releaseCollapsedHeadingRenderer(controller.attachedEditorElement)
  controller.attachedEditorElement = null
}

function scheduleCollapsedHeadingController(
  controller: CollapsedHeadingRenderingController,
  attachController: () => void,
) {
  if (controller.frame !== null || !controller.ownerWindow) return
  controller.frame = controller.ownerWindow.requestAnimationFrame(attachController)
}

function cleanupCollapsedHeadingController(
  controller: CollapsedHeadingRenderingController,
  unsubscribeStore: () => void,
) {
  unsubscribeStore()
  if (controller.frame !== null && controller.ownerWindow) {
    controller.ownerWindow.cancelAnimationFrame(controller.frame)
  }
  releaseAttachedCollapsedHeadingRenderer(controller)
}

function attachCollapsedHeadingController(options: {
  attachController: () => void
  controller: CollapsedHeadingRenderingController
  editor: TolariaBlockNoteEditor
  store: CollapsedHeadingStore
}) {
  const { attachController, controller, editor, store } = options
  controller.frame = null

  if (store.collapsedHeadingIds.size === 0) {
    releaseAttachedCollapsedHeadingRenderer(controller)
    return
  }

  const editorElement = editorBlockElement(editor)
  if (!editorElement) {
    scheduleCollapsedHeadingController(controller, attachController)
    return
  }

  controller.attachedEditorElement = editorElement
  ensureCollapsedHeadingRenderer(editor, editorElement)
}

export function toggleCollapsedHeading(
  editor: TolariaBlockNoteEditor,
  headingId: string,
  editorElement?: HTMLElement,
) {
  const store = collapsedHeadingStore(editor)
  store.collapsedHeadingIds = toggledCollapsedHeadingIds(store.collapsedHeadingIds, headingId)
  applyCollapsedHeadingToggleRendering({ editor, editorElement, store })
  store.emit()
}

export function useCollapsedHeadingRendering(editor: TolariaBlockNoteEditor) {
  useLayoutEffect(() => {
    const store = collapsedHeadingStore(editor)
    const controller: CollapsedHeadingRenderingController = {
      attachedEditorElement: null,
      frame: null,
      ownerWindow: typeof window === 'undefined' ? undefined : window,
    }
    const attachController = () => {
      attachCollapsedHeadingController({ attachController, controller, editor, store })
    }
    const scheduleAttachController = () => {
      scheduleCollapsedHeadingController(controller, attachController)
    }
    const unsubscribeStore = store.subscribe(scheduleAttachController)

    attachController()

    return () => {
      cleanupCollapsedHeadingController(controller, unsubscribeStore)
    }
  }, [editor])
}
