import type { InlineSelectionRange } from './inlineWikilinkDom'
import { findInlineChipDeletionRange, type InlineWikilinkSegment } from './inlineWikilinkText'

function normalizeSelectionRange(
  selection: InlineSelectionRange,
  valueLength: number,
): InlineSelectionRange {
  const start = Math.max(0, Math.min(selection.start, selection.end, valueLength))
  const end = Math.max(start, Math.min(Math.max(selection.start, selection.end), valueLength))
  return { start, end }
}

function collapseSelection(index: number): InlineSelectionRange {
  return { start: index, end: index }
}

export function selectedInlineText(
  value: string,
  selection: InlineSelectionRange,
): string {
  const normalizedSelection = normalizeSelectionRange(selection, value.length)
  return value.slice(normalizedSelection.start, normalizedSelection.end)
}

export function replaceInlineSelection(
  value: string,
  selection: InlineSelectionRange,
  text: string,
): { value: string; selection: InlineSelectionRange } {
  const normalizedSelection = normalizeSelectionRange(selection, value.length)
  const nextValue = (
    value.slice(0, normalizedSelection.start) +
    text +
    value.slice(normalizedSelection.end)
  )
  const nextIndex = normalizedSelection.start + text.length
  return {
    value: nextValue,
    selection: collapseSelection(nextIndex),
  }
}

export function deleteInlineSelection(
  value: string,
  selection: InlineSelectionRange,
  segments: InlineWikilinkSegment[],
  direction: 'backward' | 'forward',
): { value: string; selection: InlineSelectionRange } | null {
  const normalizedSelection = normalizeSelectionRange(selection, value.length)

  if (normalizedSelection.start !== normalizedSelection.end) {
    return {
      value: value.slice(0, normalizedSelection.start) + value.slice(normalizedSelection.end),
      selection: collapseSelection(normalizedSelection.start),
    }
  }

  const deletionRange = findInlineChipDeletionRange(
    segments,
    normalizedSelection.start,
    direction,
  )
  if (deletionRange) {
    return {
      value: value.slice(0, deletionRange.start) + value.slice(deletionRange.end),
      selection: collapseSelection(deletionRange.start),
    }
  }

  if (direction === 'backward') {
    if (normalizedSelection.start === 0) return null
    const nextIndex = normalizedSelection.start - 1
    return {
      value: value.slice(0, nextIndex) + value.slice(normalizedSelection.start),
      selection: collapseSelection(nextIndex),
    }
  }

  if (normalizedSelection.start >= value.length) return null
  return {
    value: value.slice(0, normalizedSelection.start) + value.slice(normalizedSelection.start + 1),
    selection: collapseSelection(normalizedSelection.start),
  }
}
