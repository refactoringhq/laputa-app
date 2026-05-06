let fallbackBlockIdSequence = 0
const LIST_ITEM_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem'])

type RepairResult = {
  blocks: unknown[]
  changed: boolean
}

type ChildRepair = {
  children: unknown
  promoted: unknown[]
  changed: boolean
  writeChildren: boolean
}

function createEditorBlockId(): string {
  const randomUUID = globalThis.crypto?.randomUUID
  if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto)

  fallbackBlockIdSequence += 1
  return `tolaria-block-${fallbackBlockIdSequence}`
}

function isEditorBlockRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isListItemBlock(block: Record<string, unknown>): boolean {
  return typeof block.type === 'string' && LIST_ITEM_TYPES.has(block.type)
}

function hasUsableBlockId(block: Record<string, unknown>): boolean {
  return typeof block.id === 'string' && block.id.trim().length > 0
}

function fallbackParagraphBlock(): Record<string, unknown> {
  return {
    id: createEditorBlockId(),
    type: 'paragraph',
    content: [],
    children: [],
  }
}

function splitChildrenForBlock(
  block: Record<string, unknown>,
  children: unknown[],
): { safeChildren: unknown[], promotedChildren: unknown[] } {
  if (isListItemBlock(block)) {
    return { safeChildren: children, promotedChildren: [] }
  }

  const safeChildren: unknown[] = []
  const promotedChildren: unknown[] = []
  for (const child of children) {
    if (isEditorBlockRecord(child) && isListItemBlock(child)) {
      promotedChildren.push(child)
    } else {
      safeChildren.push(child)
    }
  }
  return { safeChildren, promotedChildren }
}

function repairBlockList(blocks: unknown[]): RepairResult {
  const repairedBlocks: unknown[] = []
  let changed = false

  for (const block of blocks) {
    const repaired = repairEditorBlock(block)
    repairedBlocks.push(...repaired.blocks)
    changed ||= repaired.changed || repaired.blocks.length !== 1 || repaired.blocks[0] !== block
  }

  return { blocks: changed ? repairedBlocks : blocks, changed }
}

function repairBlockChildren(block: Record<string, unknown>): ChildRepair {
  if (!Array.isArray(block.children)) {
    return { children: block.children, promoted: [], changed: false, writeChildren: false }
  }

  const repaired = repairBlockList(block.children)
  const { safeChildren, promotedChildren } = splitChildrenForBlock(block, repaired.blocks)
  const movedChildren = promotedChildren.length > 0
  return {
    children: safeChildren,
    promoted: promotedChildren,
    changed: repaired.changed || movedChildren,
    writeChildren: repaired.changed || movedChildren,
  }
}

function applyBlockRepair(
  block: Record<string, unknown>,
  missingId: boolean,
  childRepair: ChildRepair,
): Record<string, unknown> {
  return {
    ...block,
    ...(missingId ? { id: createEditorBlockId() } : {}),
    ...(childRepair.writeChildren ? { children: childRepair.children } : {}),
  }
}

function repairBlockRecord(block: Record<string, unknown>): RepairResult {
  const childRepair = repairBlockChildren(block)
  const missingId = !hasUsableBlockId(block)

  if (!missingId && !childRepair.changed) return { blocks: [block], changed: false }

  return {
    blocks: [applyBlockRepair(block, missingId, childRepair), ...childRepair.promoted],
    changed: true,
  }
}

function repairEditorBlock(block: unknown): RepairResult {
  if (!isEditorBlockRecord(block)) return { blocks: [fallbackParagraphBlock()], changed: true }
  return repairBlockRecord(block)
}

export function repairMalformedEditorBlocks(blocks: unknown[]): unknown[] {
  return repairBlockList(blocks).blocks
}
