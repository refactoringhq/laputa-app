import {
  chipToken,
  normalizeInlineWikilinkValue,
} from './inlineWikilinkTokens'

export interface InlineSelectionRange {
  start: number
  end: number
}

interface SelectionBoundary {
  container: Node
  offset: number
}

export function serializeInlineNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeInlineWikilinkValue(node.textContent ?? '')
  }

  if (node instanceof HTMLElement) {
    if (node.dataset.chipTarget) {
      return chipToken(node.dataset.chipTarget)
    }

    if (node.tagName === 'BR') return ''
  }

  return Array.from(node.childNodes).map(serializeInlineNode).join('')
}

function selectionFallsOutsideEditor(
  selection: Selection | null,
  root: HTMLDivElement,
): boolean {
  if (!selection || selection.rangeCount === 0) return true
  const range = selection.getRangeAt(0)
  return !root.contains(range.startContainer) || !root.contains(range.endContainer)
}

function serializedSelectionBoundary(
  root: HTMLDivElement,
  container: Node,
  offset: number,
): number {
  const range = document.createRange()
  range.setStart(root, 0)
  range.setEnd(container, offset)
  return serializeInlineNode(range.cloneContents()).length
}

export function readSelectionRange(root: HTMLDivElement): InlineSelectionRange {
  const currentSelection = window.getSelection()
  if (!currentSelection || selectionFallsOutsideEditor(currentSelection, root)) {
    const index = serializeInlineNode(root).length
    return { start: index, end: index }
  }

  const range = currentSelection.getRangeAt(0)
  return {
    start: serializedSelectionBoundary(root, range.startContainer, range.startOffset),
    end: serializedSelectionBoundary(root, range.endContainer, range.endOffset),
  }
}

export function readSelectionIndex(root: HTMLDivElement): number {
  return readSelectionRange(root).end
}

function boundaryAtEditorEnd(root: HTMLDivElement): SelectionBoundary {
  const endBoundary = findTextBoundaryAtEdge(root, 'end')
  return endBoundary ?? { container: root, offset: root.childNodes.length }
}

function findTextBoundaryAtEdge(
  node: Node,
  edge: 'start' | 'end',
): SelectionBoundary | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return {
      container: node,
      offset: edge === 'start' ? 0 : node.textContent?.length ?? 0,
    }
  }

  const children = Array.from(node.childNodes)
  const orderedChildren = edge === 'start' ? children : [...children].reverse()

  for (const child of orderedChildren) {
    const boundary = findTextBoundaryAtEdge(child, edge)
    if (boundary) return boundary
  }

  return null
}

function boundaryForTextNode(
  child: Node,
  remaining: number,
): { boundary: SelectionBoundary | null; remaining: number } {
  const textLength = normalizeInlineWikilinkValue(child.textContent ?? '').length
  if (remaining <= textLength) {
    return {
      boundary: { container: child, offset: remaining },
      remaining: 0,
    }
  }

  return {
    boundary: null,
    remaining: remaining - textLength,
  }
}

function boundaryForChip(
  node: Node,
  child: HTMLElement,
  index: number,
  remaining: number,
): { boundary: SelectionBoundary | null; remaining: number } {
  const tokenLength = chipToken(child.dataset.chipTarget ?? '').length
  if (remaining <= 0) {
    return {
      boundary: siblingBoundary(node, index - 1, 'end', index),
      remaining: 0,
    }
  }

  if (remaining <= tokenLength) {
    return {
      boundary: siblingBoundary(node, index + 1, 'start', index + 1),
      remaining: 0,
    }
  }

  return {
    boundary: null,
    remaining: remaining - tokenLength,
  }
}

function siblingBoundary(
  node: Node,
  siblingIndex: number,
  edge: 'start' | 'end',
  fallbackOffset: number,
): SelectionBoundary {
  const sibling = node.childNodes.item(siblingIndex)
  if (!sibling) return { container: node, offset: fallbackOffset }
  return findTextBoundaryAtEdge(sibling, edge) ?? { container: node, offset: fallbackOffset }
}

function findSelectionBoundary(
  node: Node,
  selectionIndex: number,
): SelectionBoundary | null {
  let remaining = Math.max(0, selectionIndex)
  const children = Array.from(node.childNodes)

  for (const [index, child] of children.entries()) {
    if (child.nodeType === Node.TEXT_NODE) {
      const textBoundary = boundaryForTextNode(child, remaining)
      if (textBoundary.boundary) return textBoundary.boundary
      remaining = textBoundary.remaining
      continue
    }

    if (!(child instanceof HTMLElement)) continue

    if (child.dataset.chipTarget) {
      const chipBoundary = boundaryForChip(node, child, index, remaining)
      if (chipBoundary.boundary) return chipBoundary.boundary
      remaining = chipBoundary.remaining
      continue
    }

    const childLength = serializeInlineNode(child).length
    if (remaining <= childLength) {
      return findSelectionBoundary(child, remaining)
    }
    remaining -= childLength
  }

  return null
}

export function applySelectionRange(
  root: HTMLDivElement,
  selectionRange: InlineSelectionRange,
) {
  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  const serializedLength = serializeInlineNode(root).length
  const start = Math.max(0, Math.min(selectionRange.start, selectionRange.end, serializedLength))
  const end = Math.max(start, Math.min(Math.max(selectionRange.start, selectionRange.end), serializedLength))
  const startBoundary = findSelectionBoundary(root, start) ?? boundaryAtEditorEnd(root)
  const endBoundary = findSelectionBoundary(root, end) ?? boundaryAtEditorEnd(root)

  range.setStart(startBoundary.container, startBoundary.offset)
  range.setEnd(endBoundary.container, endBoundary.offset)

  selection.removeAllRanges()
  selection.addRange(range)
}

export function applySelectionIndex(
  root: HTMLDivElement,
  selectionIndex: number,
) {
  applySelectionRange(root, { start: selectionIndex, end: selectionIndex })
}
