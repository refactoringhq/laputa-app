export type BlockSelectionDirection = 'down' | 'up'

export type BlockLike = {
  children?: unknown[]
  id: string
}

export type DocumentBlockEntry = {
  id: string
  parentId: string | null
}

export type BlockSelectionState = {
  blockIds: string[]
}

export type BlockSelectionMeta =
  | { blockIds: string[]; type: 'set' }
  | { type: 'clear' }

export type ClipboardDataLike = Pick<DataTransfer, 'clearData' | 'getData' | 'setData'>

export type RichEditorBlockSelectionEditor = {
  document?: unknown[]
  focus?: () => void
  getSelection?: () => unknown
  getTextCursorPosition?: () => unknown
  blocksToFullHTML?: (blocks: unknown[]) => string
  blocksToHTMLLossy?: (blocks: unknown[]) => string
  blocksToMarkdownLossy?: (blocks: unknown[]) => string
  insertBlocks?: (blocks: unknown[], referenceBlock: string, placement?: 'after' | 'before') => BlockLike[]
  isEditable?: boolean
  moveBlocksDown?: () => unknown
  moveBlocksUp?: () => unknown
  removeBlocks?: (blocks: string[]) => unknown
  setSelection?: (anchorBlock: string, headBlock: string) => void
  setTextCursorPosition?: (targetBlock: string, placement?: 'start' | 'end') => void
  transact?: <T>(callback: () => T) => T
  tryParseHTMLToBlocks?: (html: string) => unknown[]
  tryParseMarkdownToBlocks?: (markdown: string) => unknown[]
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isBlockLike(value: unknown): value is BlockLike {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0
}

export function documentBlock(value: unknown): (BlockLike & Record<string, unknown>) | null {
  return isBlockLike(value) ? value : null
}

export function uniqueBlockIds(blockIds: readonly string[]): string[] {
  return Array.from(new Set(blockIds.filter((id) => id.length > 0)))
}
