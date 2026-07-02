import { trackEvent } from '../lib/telemetry'
import type { RichEditorBlockTypeDefinition } from '../utils/richEditorBlockTypes'

export type RichEditorBlockTypeCommandSource = 'block_menu' | 'command_palette'

type RichEditorBlock = {
  id: string
  props?: Record<string, unknown>
  type: string
}

type RichEditorBlockTypeUpdate = {
  props?: never
  type: never
}

export type RichEditorBlockTypeCommandEditor = {
  focus?: () => void
  getBlock?: (id: string) => RichEditorBlock | undefined
  getTextCursorPosition?: () => { block?: RichEditorBlock | null }
  transact?: (callback: () => void) => void
  updateBlock: (blockId: string, update: RichEditorBlockTypeUpdate) => unknown
}

function blockTypeTelemetry(
  target: RichEditorBlockTypeDefinition,
  source: RichEditorBlockTypeCommandSource,
) {
  const metadata: Record<string, string | number> = {
    block_type: target.type,
    source,
  }
  const level = target.props?.level
  if (typeof level === 'number') metadata.level = level
  return metadata
}

function resolveCurrentBlock(editor: RichEditorBlockTypeCommandEditor): RichEditorBlock | null {
  try {
    const cursorBlock = editor.getTextCursorPosition?.().block
    if (!cursorBlock?.id) return null

    return editor.getBlock?.(cursorBlock.id) ?? cursorBlock
  } catch {
    return null
  }
}

function applyBlockTypeUpdate(
  editor: RichEditorBlockTypeCommandEditor,
  block: RichEditorBlock,
  target: RichEditorBlockTypeDefinition,
  source: RichEditorBlockTypeCommandSource,
): boolean {
  const update = {
    type: target.type as never,
    props: target.props as never,
  }
  const runUpdate = () => {
    editor.updateBlock(block.id, update)
  }

  editor.focus?.()
  if (editor.transact) {
    editor.transact(runUpdate)
  } else {
    runUpdate()
  }
  trackEvent('editor_block_type_changed', blockTypeTelemetry(target, source))
  return true
}

export function turnCurrentBlockIntoType(
  editor: RichEditorBlockTypeCommandEditor,
  target: RichEditorBlockTypeDefinition,
  source: RichEditorBlockTypeCommandSource,
): boolean {
  const block = resolveCurrentBlock(editor)
  if (!block) return false

  return applyBlockTypeUpdate(editor, block, target, source)
}

export function turnBlockIntoType(
  editor: RichEditorBlockTypeCommandEditor,
  blockId: string,
  target: RichEditorBlockTypeDefinition,
  source: RichEditorBlockTypeCommandSource,
): boolean {
  const block = editor.getBlock?.(blockId)
  if (!block) return false

  return applyBlockTypeUpdate(editor, block, target, source)
}
