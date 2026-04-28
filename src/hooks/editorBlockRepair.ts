let fallbackBlockIdSequence = 0

function createEditorBlockId(): string {
  const randomUUID = globalThis.crypto?.randomUUID
  if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto)

  fallbackBlockIdSequence += 1
  return `tolaria-block-${fallbackBlockIdSequence}`
}

function isEditorBlockRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasUsableBlockId(block: Record<string, unknown>): boolean {
  return typeof block.id === 'string' && block.id.trim().length > 0
}

function repairEditorBlock(block: unknown): unknown {
  if (!isEditorBlockRecord(block)) return block

  const children = Array.isArray(block.children)
    ? repairMalformedEditorBlocks(block.children)
    : block.children
  const missingId = !hasUsableBlockId(block)

  if (!missingId && children === block.children) return block

  return {
    ...block,
    ...(missingId ? { id: createEditorBlockId() } : {}),
    ...(children === block.children ? {} : { children }),
  }
}

export function repairMalformedEditorBlocks(blocks: unknown[]): unknown[] {
  return blocks.map(repairEditorBlock)
}
