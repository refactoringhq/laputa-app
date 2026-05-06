import { TLDRAW_BLOCK_TYPE, TLDRAW_DEFAULT_HEIGHT } from '../utils/tldrawMarkdown'

export interface TldrawBlockProps {
  boardId: string
  height: string
  snapshot: string
  width: string
}

export interface TldrawBlockMutationEditor {
  getBlock: (blockId: string) => unknown
  updateBlock: (blockId: string, update: TldrawBlockUpdate) => unknown
}

interface TldrawBlockUpdate {
  props: TldrawBlockProps
  type: typeof TLDRAW_BLOCK_TYPE
}

interface LiveTldrawBlock {
  id: string
  props: TldrawBlockProps
}

interface TldrawBlockMutation {
  blockId: string
  editor: TldrawBlockMutationEditor
  nextProps: (props: TldrawBlockProps) => TldrawBlockProps
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringProp(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback
}

function tldrawBlockProps(value: unknown): TldrawBlockProps | null {
  if (!isRecord(value)) return null
  if (typeof value.boardId !== 'string' || typeof value.snapshot !== 'string') return null

  return {
    boardId: value.boardId,
    height: stringProp(value.height, TLDRAW_DEFAULT_HEIGHT),
    snapshot: value.snapshot,
    width: stringProp(value.width, ''),
  }
}

function liveTldrawBlock(value: unknown): LiveTldrawBlock | null {
  if (!isRecord(value)) return null
  if (value.type !== TLDRAW_BLOCK_TYPE || typeof value.id !== 'string') return null

  const props = tldrawBlockProps(value.props)
  return props ? { id: value.id, props } : null
}

function isMissingBlockError(error: unknown) {
  return error instanceof Error
    && error.message.includes('Block with ID')
    && error.message.includes('not found')
}

export function updateTldrawBlockPropsSafely({ blockId, editor, nextProps }: TldrawBlockMutation) {
  const liveBlock = liveTldrawBlock(editor.getBlock(blockId))
  if (!liveBlock) return false

  try {
    editor.updateBlock(liveBlock.id, {
      props: nextProps(liveBlock.props),
      type: TLDRAW_BLOCK_TYPE,
    })
    return true
  } catch (error) {
    if (!isMissingBlockError(error)) throw error

    console.warn('[editor] Ignored stale whiteboard block update:', error)
    return false
  }
}
