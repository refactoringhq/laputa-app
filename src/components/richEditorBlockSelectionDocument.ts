import { collapsedSectionHiddenBlockIds } from './tolariaCollapsedSections'
import type { TolariaBlockNoteEditor } from './tolariaBlockNoteDom'
import {
  documentBlock,
  isBlockLike,
  uniqueBlockIds,
  type BlockLike,
  type BlockSelectionDirection,
  type DocumentBlockEntry,
  type RichEditorBlockSelectionEditor,
} from './richEditorBlockSelectionTypes'

function nestedBlockIds(block: BlockLike): string[] {
  const childBlocks = Array.isArray(block.children)
    ? block.children.filter(isBlockLike).flatMap(nestedBlockIds)
    : []

  return [block.id, ...childBlocks]
}

export function documentBlockIds(blocks: readonly unknown[] | undefined): string[] {
  if (!blocks) return []
  return uniqueBlockIds(blocks.filter(isBlockLike).flatMap(nestedBlockIds))
}

function documentBlockEntries(
  blocks: readonly unknown[] | undefined,
  parentId: string | null = null,
): DocumentBlockEntry[] {
  if (!blocks) return []

  return blocks.flatMap((value) => {
    const block = documentBlock(value)
    if (!block) return []

    return [
      { id: block.id, parentId },
      ...documentBlockEntries(block.children, block.id),
    ]
  })
}

export function navigableDocumentBlockIds(editor: RichEditorBlockSelectionEditor): string[] {
  const blockIds = documentBlockIds(editor.document)
  const hiddenBlockIds = collapsedSectionHiddenBlockIds(editor as unknown as TolariaBlockNoteEditor)
  return hiddenBlockIds.size === 0
    ? blockIds
    : blockIds.filter((id) => !hiddenBlockIds.has(id))
}

export function findDocumentBlock(
  blocks: readonly unknown[] | undefined,
  blockId: string,
): (BlockLike & Record<string, unknown>) | null {
  if (!blocks) return null

  for (const value of blocks) {
    const block = documentBlock(value)
    if (!block) continue
    if (block.id === blockId) return block

    const childMatch = findDocumentBlock(block.children, blockId)
    if (childMatch) return childMatch
  }

  return null
}

export function selectedDocumentBlocks(
  blocks: readonly unknown[] | undefined,
  blockIds: readonly string[],
): unknown[] {
  if (!blocks) return []

  const selected = new Set(blockIds)
  const result: unknown[] = []
  const visit = (value: unknown): void => {
    const block = documentBlock(value)
    if (!block) return

    if (selected.has(block.id)) {
      result.push(block)
      return
    }

    block.children?.forEach(visit)
  }

  blocks.forEach(visit)
  return result
}

export function insertedBlockIds(blocks: readonly unknown[]): string[] {
  return uniqueBlockIds(blocks.filter(isBlockLike).map((block) => block.id))
}

export function blockSelectionAfterDelete(
  selectedBlockIds: readonly string[],
  allBlockIds: readonly string[],
): string[] {
  const selected = new Set(selectedBlockIds)
  const firstSelectedIndex = allBlockIds.findIndex((id) => selected.has(id))
  const remaining = allBlockIds.filter((id) => !selected.has(id))
  if (remaining.length === 0) return []

  const nextIndex = Math.min(Math.max(firstSelectedIndex, 0), remaining.length - 1)
  const nextBlockId = remaining.at(nextIndex)
  return nextBlockId ? [nextBlockId] : []
}

function parentIdsByBlockId(entries: readonly DocumentBlockEntry[]): Map<string, string | null> {
  return new Map(entries.map((entry) => [entry.id, entry.parentId]))
}

function hasSelectedAncestor(
  blockId: string,
  selectedBlockIds: ReadonlySet<string>,
  parentIds: ReadonlyMap<string, string | null>,
): boolean {
  let parentId = parentIds.get(blockId) ?? null

  while (parentId !== null) {
    if (selectedBlockIds.has(parentId)) return true
    parentId = parentIds.get(parentId) ?? null
  }

  return false
}

function pruneNestedOperationBlockIds(
  blockIds: readonly string[],
  entries: readonly DocumentBlockEntry[],
): string[] {
  const uniqueIds = uniqueBlockIds(blockIds)
  const selectedBlockIds = new Set(uniqueIds)
  const parentIds = parentIdsByBlockId(entries)

  return uniqueIds.filter((blockId) => !hasSelectedAncestor(blockId, selectedBlockIds, parentIds))
}

function coveredOperationBlockIds(
  blockIds: readonly string[],
  entries: readonly DocumentBlockEntry[],
): ReadonlySet<string> {
  const operationBlockIds = new Set(blockIds)
  const parentIds = parentIdsByBlockId(entries)

  return new Set(
    entries
      .filter((entry) => (
        operationBlockIds.has(entry.id)
        || hasSelectedAncestor(entry.id, operationBlockIds, parentIds)
      ))
      .map((entry) => entry.id),
  )
}

export function collapsedContentOperationBlockIds(
  editor: RichEditorBlockSelectionEditor,
  selectedBlockIds: readonly string[],
): string[] {
  const selected = new Set(selectedBlockIds)
  const hiddenBlockIds = collapsedSectionHiddenBlockIds(editor as unknown as TolariaBlockNoteEditor)
  const entries = documentBlockEntries(editor.document)
  const operationBlockIds: string[] = []

  entries.forEach((entry, index) => {
    if (!selected.has(entry.id)) return

    operationBlockIds.push(entry.id)
    let cursor = index + 1
    let cursorEntry = entries.at(cursor)
    while (cursorEntry && hiddenBlockIds.has(cursorEntry.id)) {
      operationBlockIds.push(cursorEntry.id)
      cursor += 1
      cursorEntry = entries.at(cursor)
    }
  })

  return pruneNestedOperationBlockIds(operationBlockIds, entries)
}

function hasSameBlockIds(leftBlockIds: readonly string[], rightBlockIds: readonly string[]): boolean {
  const left = uniqueBlockIds(leftBlockIds)
  const right = uniqueBlockIds(rightBlockIds)

  return left.length === right.length && left.every((blockId, index) => right.at(index) === blockId)
}

function movePlacementForSelection(
  editor: RichEditorBlockSelectionEditor,
  operationBlockIds: readonly string[],
  direction: BlockSelectionDirection,
): {
  placement: 'after' | 'before'
  referenceBlockId: string
  targetBlockId: string
  targetOperationBlockIds: string[]
} | null {
  const entries = documentBlockEntries(editor.document)
  const coveredBlockIds = coveredOperationBlockIds(operationBlockIds, entries)
  const visibleBlockIds = navigableDocumentBlockIds(editor)
  const selectedIndexes = visibleBlockIds
    .map((blockId, index) => coveredBlockIds.has(blockId) ? index : -1)
    .filter((index) => index >= 0)
  if (selectedIndexes.length === 0) return null

  if (direction === 'up') {
    const targetBlockId = visibleBlockIds[Math.min(...selectedIndexes) - 1]
    if (!targetBlockId) return null

    return {
      placement: 'before',
      referenceBlockId: targetBlockId,
      targetBlockId,
      targetOperationBlockIds: collapsedContentOperationBlockIds(editor, [targetBlockId]),
    }
  }

  const targetBlockId = visibleBlockIds[Math.max(...selectedIndexes) + 1]
  if (!targetBlockId) return null

  const targetOperationBlockIds = collapsedContentOperationBlockIds(editor, [targetBlockId])
  return {
    placement: 'after',
    referenceBlockId: targetOperationBlockIds[targetOperationBlockIds.length - 1] ?? targetBlockId,
    targetBlockId,
    targetOperationBlockIds,
  }
}

function canMoveBlocks(editor: RichEditorBlockSelectionEditor): boolean {
  return Boolean(editor.insertBlocks && editor.removeBlocks && editor.transact)
}

function isNoOpMove(
  operationBlockIds: readonly string[],
  selectedBlockIds: readonly string[],
  placement: NonNullable<ReturnType<typeof movePlacementForSelection>>,
): boolean {
  return hasSameBlockIds(operationBlockIds, selectedBlockIds)
    && hasSameBlockIds(placement.targetOperationBlockIds, [placement.targetBlockId])
}

export function moveSelectedDocumentBlocks(
  editor: RichEditorBlockSelectionEditor,
  selectedBlockIds: readonly string[],
  direction: BlockSelectionDirection,
): boolean {
  if (!canMoveBlocks(editor)) return false

  const operationBlockIds = collapsedContentOperationBlockIds(editor, selectedBlockIds)
  const blocks = selectedDocumentBlocks(editor.document, operationBlockIds)
  if (operationBlockIds.length === 0 || blocks.length === 0) return false

  const placement = movePlacementForSelection(editor, operationBlockIds, direction)
  if (!placement) return true
  if (isNoOpMove(operationBlockIds, selectedBlockIds, placement)) return false

  editor.transact?.(() => {
    editor.removeBlocks?.(operationBlockIds)
    editor.insertBlocks?.(blocks, placement.referenceBlockId, placement.placement)
  })
  editor.focus?.()
  return true
}

interface SelectionBounds {
  firstIndex: number
  lastIndex: number
}

function selectionBounds(selected: readonly string[], allBlockIds: readonly string[]): SelectionBounds | null {
  const firstIndex = allBlockIds.indexOf(selected[0])
  const lastIndex = allBlockIds.indexOf(selected[selected.length - 1])
  return firstIndex < 0 || lastIndex < 0 ? null : { firstIndex, lastIndex }
}

function extendedBlockSelection(
  bounds: SelectionBounds,
  allBlockIds: readonly string[],
  direction: BlockSelectionDirection,
): string[] {
  const firstIndex = direction === 'up' ? Math.max(0, bounds.firstIndex - 1) : bounds.firstIndex
  const lastIndex = direction === 'down' ? Math.min(allBlockIds.length - 1, bounds.lastIndex + 1) : bounds.lastIndex
  return allBlockIds.slice(firstIndex, lastIndex + 1)
}

function movedBlockSelection(
  selected: readonly string[],
  bounds: SelectionBounds,
  allBlockIds: readonly string[],
  direction: BlockSelectionDirection,
): string[] {
  const targetIndex = direction === 'up'
    ? Math.max(0, bounds.firstIndex - 1)
    : Math.min(allBlockIds.length - 1, bounds.lastIndex + 1)
  const targetBlockId = allBlockIds.at(targetIndex)
  return targetBlockId ? [targetBlockId] : [...selected]
}

export function blockSelectionAfterArrow(
  selectedBlockIds: readonly string[],
  allBlockIds: readonly string[],
  direction: BlockSelectionDirection,
  extend: boolean,
): string[] {
  const selected = uniqueBlockIds(selectedBlockIds).filter((id) => allBlockIds.includes(id))
  if (selected.length === 0) return fallbackBlockSelection(allBlockIds)
  const bounds = selectionBounds(selected, allBlockIds)
  if (!bounds) return fallbackBlockSelection(allBlockIds)
  return extend
    ? extendedBlockSelection(bounds, allBlockIds, direction)
    : movedBlockSelection(selected, bounds, allBlockIds, direction)
}

function fallbackBlockSelection(allBlockIds: readonly string[]): string[] {
  return allBlockIds[0] ? [allBlockIds[0]] : []
}
