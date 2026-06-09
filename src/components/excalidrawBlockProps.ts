import { EXCALIDRAW_BLOCK_TYPE, EXCALIDRAW_DEFAULT_HEIGHT } from '../utils/excalidrawMarkdown'

export interface ExcalidrawBlockProps {
  boardId: string
  height: string
  snapshot: string
  width: string
}

export interface ExcalidrawBlockMutationEditor {
  getBlock: (blockId: string) => unknown
  updateBlock: (blockId: string, update: ExcalidrawBlockUpdate) => unknown
}

interface ExcalidrawBlockUpdate {
  props: ExcalidrawBlockProps
  type: typeof EXCALIDRAW_BLOCK_TYPE
}

interface LiveExcalidrawBlock {
  id: string
  props: ExcalidrawBlockProps
}

interface ExcalidrawBlockMutation {
  blockId: string
  editor: ExcalidrawBlockMutationEditor
  nextProps: (props: ExcalidrawBlockProps) => ExcalidrawBlockProps
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringProp(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback
}

function excalidrawBlockProps(value: unknown): ExcalidrawBlockProps | null {
  if (!isRecord(value)) return null
  if (typeof value.boardId !== 'string' || typeof value.snapshot !== 'string') return null

  return {
    boardId: value.boardId,
    height: stringProp(value.height, EXCALIDRAW_DEFAULT_HEIGHT),
    snapshot: value.snapshot,
    width: stringProp(value.width, ''),
  }
}

function liveExcalidrawBlock(value: unknown): LiveExcalidrawBlock | null {
  if (!isRecord(value)) return null
  if (value.type !== EXCALIDRAW_BLOCK_TYPE || typeof value.id !== 'string') return null

  const props = excalidrawBlockProps(value.props)
  return props ? { id: value.id, props } : null
}

function isMissingBlockError(error: unknown) {
  return error instanceof Error
    && error.message.includes('Block with ID')
    && error.message.includes('not found')
}

export function updateExcalidrawBlockPropsSafely({ blockId, editor, nextProps }: ExcalidrawBlockMutation) {
  const liveBlock = liveExcalidrawBlock(editor.getBlock(blockId))
  if (!liveBlock) return false

  try {
    editor.updateBlock(liveBlock.id, {
      props: nextProps(liveBlock.props),
      type: EXCALIDRAW_BLOCK_TYPE,
    })
    return true
  } catch (error) {
    if (!isMissingBlockError(error)) throw error

    console.warn('[editor] Ignored stale excalidraw block update:', error)
    return false
  }
}
