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

export function blockSelectionAfterArrow(
  selectedBlockIds: readonly string[],
  allBlockIds: readonly string[],
  direction: BlockSelectionDirection,
  extend: boolean,
): string[] {
  const selected = uniqueBlockIds(selectedBlockIds).filter((id) => allBlockIds.includes(id))
  if (selected.length === 0) return allBlockIds[0] ? [allBlockIds[0]] : []

  const firstIndex = allBlockIds.indexOf(selected[0])
  const lastIndex = allBlockIds.indexOf(selected[selected.length - 1])
  if (firstIndex < 0 || lastIndex < 0) return allBlockIds[0] ? [allBlockIds[0]] : []

  if (extend) {
    const nextFirstIndex = direction === 'up' ? Math.max(0, firstIndex - 1) : firstIndex
    const nextLastIndex = direction === 'down' ? Math.min(allBlockIds.length - 1, lastIndex + 1) : lastIndex
    return allBlockIds.slice(nextFirstIndex, nextLastIndex + 1)
  }

  const targetIndex = direction === 'up'
    ? Math.max(0, firstIndex - 1)
    : Math.min(allBlockIds.length - 1, lastIndex + 1)
  return allBlockIds[targetIndex] ? [allBlockIds[targetIndex]] : selected
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
  return [remaining[nextIndex]]
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
    while (cursor < entries.length && hiddenBlockIds.has(entries[cursor].id)) {
      operationBlockIds.push(entries[cursor].id)
      cursor += 1
    }
  })

  return pruneNestedOperationBlockIds(operationBlockIds, entries)
}

function hasSameBlockIds(leftBlockIds: readonly string[], rightBlockIds: readonly string[]): boolean {
  const left = uniqueBlockIds(leftBlockIds)
  const right = uniqueBlockIds(rightBlockIds)

  return left.length === right.length && left.every((blockId, index) => right[index] === blockId)
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

export function moveSelectedDocumentBlocks(
  editor: RichEditorBlockSelectionEditor,
  selectedBlockIds: readonly string[],
  direction: BlockSelectionDirection,
): boolean {
  if (!editor.insertBlocks || !editor.removeBlocks || !editor.transact) return false

  const operationBlockIds = collapsedContentOperationBlockIds(editor, selectedBlockIds)
  const blocks = selectedDocumentBlocks(editor.document, operationBlockIds)
  if (operationBlockIds.length === 0 || blocks.length === 0) return false

  const placement = movePlacementForSelection(editor, operationBlockIds, direction)
  if (!placement) return true
  if (
    hasSameBlockIds(operationBlockIds, selectedBlockIds)
    && hasSameBlockIds(placement.targetOperationBlockIds, [placement.targetBlockId])
  ) {
    return false
  }

  editor.transact(() => {
    editor.removeBlocks?.(operationBlockIds)
    editor.insertBlocks?.(blocks, placement.referenceBlockId, placement.placement)
  })
  editor.focus?.()
  return true
}
