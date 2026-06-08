let fallbackBlockIdSequence = 0
const NESTABLE_LIST_ITEM_TYPES = new Set([
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'toggleListItem',
])

type RepairResult = {
  blocks: unknown[]
  changed: boolean
}

type RepairContext = {
  seenIds: Set<string>
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

function createUniqueEditorBlockId(context: RepairContext): string {
  let id = createEditorBlockId()
  while (context.seenIds.has(id)) {
    id = createEditorBlockId()
  }
  context.seenIds.add(id)
  return id
}

function isEditorBlockRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canNestChildBlocks(block: Record<string, unknown>): boolean {
  return typeof block.type === 'string' && NESTABLE_LIST_ITEM_TYPES.has(block.type)
}

function hasUsableBlockId(block: Record<string, unknown>): boolean {
  return typeof block.id === 'string' && block.id.trim().length > 0
}

function replacementBlockId(block: Record<string, unknown>, context: RepairContext): string | null {
  if (hasUsableBlockId(block)) {
    const id = block.id as string
    if (!context.seenIds.has(id)) {
      context.seenIds.add(id)
      return null
    }
  }

  return createUniqueEditorBlockId(context)
}

function fallbackParagraphBlock(context: RepairContext): Record<string, unknown> {
  return {
    id: createUniqueEditorBlockId(context),
    type: 'paragraph',
    content: [],
    children: [],
  }
}

function splitChildrenForBlock(
  block: Record<string, unknown>,
  children: unknown[],
): { safeChildren: unknown[], promotedChildren: unknown[] } {
  if (canNestChildBlocks(block)) {
    return { safeChildren: children, promotedChildren: [] }
  }

  return { safeChildren: [], promotedChildren: children }
}

function repairBlockList(blocks: unknown[], context: RepairContext): RepairResult {
  const repairedBlocks: unknown[] = []
  let changed = false

  for (const block of blocks) {
    const repaired = repairEditorBlock(block, context)
    repairedBlocks.push(...repaired.blocks)
    changed ||= repaired.changed || repaired.blocks.length !== 1 || repaired.blocks[0] !== block
  }

  return { blocks: changed ? repairedBlocks : blocks, changed }
}

function repairBlockChildren(block: Record<string, unknown>, context: RepairContext): ChildRepair {
  if (!Array.isArray(block.children)) {
    return { children: block.children, promoted: [], changed: false, writeChildren: false }
  }

  const repaired = repairBlockList(block.children, context)
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
  replacementId: string | null,
  childRepair: ChildRepair,
): Record<string, unknown> {
  return {
    ...block,
    ...(replacementId ? { id: replacementId } : {}),
    ...(childRepair.writeChildren ? { children: childRepair.children } : {}),
  }
}

function repairBlockRecord(block: Record<string, unknown>, context: RepairContext): RepairResult {
  const replacementId = replacementBlockId(block, context)
  const childRepair = repairBlockChildren(block, context)

  if (!replacementId && !childRepair.changed) return { blocks: [block], changed: false }

  return {
    blocks: [applyBlockRepair(block, replacementId, childRepair), ...childRepair.promoted],
    changed: true,
  }
}

function repairEditorBlock(block: unknown, context: RepairContext): RepairResult {
  if (!isEditorBlockRecord(block)) return { blocks: [fallbackParagraphBlock(context)], changed: true }
  return repairBlockRecord(block, context)
}

export function repairMalformedEditorBlocks(blocks: unknown[]): unknown[] {
  return repairBlockList(blocks, { seenIds: new Set() }).blocks
}
