import { trackEvent } from '../lib/telemetry'
import {
  RICH_EDITOR_BLOCK_TYPE_DEFINITIONS,
  type RichEditorBlockTypeDefinition,
  type RichEditorBlockTypeKey,
} from '../utils/richEditorBlockTypes'

export type RichEditorBlockTypeCommandSource = 'block_menu' | 'command_palette' | 'keyboard_shortcut'

type RichEditorBlock = {
  id: string
  props?: Record<string, unknown>
  type: string
}

type RichEditorBlockTypeUpdate = {
  props?: never
  type: never
}

type TurnBlocksIntoTypeOptions = {
  blockIds: string[]
  editor: RichEditorBlockTypeCommandEditor
  source: RichEditorBlockTypeCommandSource
  target: RichEditorBlockTypeDefinition
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

function findBlockTypeDefinition(key: RichEditorBlockTypeKey): RichEditorBlockTypeDefinition {
  const definition = RICH_EDITOR_BLOCK_TYPE_DEFINITIONS.find((blockType) => blockType.key === key)
  if (!definition) throw new Error(`Missing rich editor block type definition: ${key}`)
  return definition
}

const CHECKLIST_BLOCK_TYPE = findBlockTypeDefinition('checklist')
const PARAGRAPH_BLOCK_TYPE = findBlockTypeDefinition('paragraph')

function resolveCurrentBlock(editor: RichEditorBlockTypeCommandEditor): RichEditorBlock | null {
  try {
    const cursorBlock = editor.getTextCursorPosition?.().block
    if (!cursorBlock?.id) return null

    return editor.getBlock?.(cursorBlock.id) ?? cursorBlock
  } catch {
    return null
  }
}

function applyBlockTypeUpdates(
  editor: RichEditorBlockTypeCommandEditor,
  blocks: RichEditorBlock[],
  target: RichEditorBlockTypeDefinition,
  source: RichEditorBlockTypeCommandSource,
): boolean {
  const update = {
    type: target.type as never,
    props: target.props as never,
  }
  const runUpdate = () => {
    for (const block of blocks) {
      editor.updateBlock(block.id, update)
    }
  }

  if (editor.transact) {
    editor.transact(runUpdate)
  } else {
    runUpdate()
  }
  editor.focus?.()
  trackEvent('editor_block_type_changed', blockTypeTelemetry(target, source))
  return true
}

function applyResolvedBlockTypeUpdates(
  editor: RichEditorBlockTypeCommandEditor,
  blocks: RichEditorBlock[],
  target: RichEditorBlockTypeDefinition,
  source: RichEditorBlockTypeCommandSource,
): boolean {
  if (!blocks.length) return false

  return applyBlockTypeUpdates(editor, blocks, target, source)
}

function resolveBlocksById(
  editor: RichEditorBlockTypeCommandEditor,
  blockIds: string[],
): RichEditorBlock[] {
  const blocks: RichEditorBlock[] = []
  for (const blockId of blockIds) {
    try {
      const block = editor.getBlock?.(blockId)
      if (!block) return []
      blocks.push(block)
    } catch {
      return []
    }
  }
  return blocks
}

export function turnCurrentBlockIntoType(
  editor: RichEditorBlockTypeCommandEditor,
  target: RichEditorBlockTypeDefinition,
  source: RichEditorBlockTypeCommandSource,
): boolean {
  const block = resolveCurrentBlock(editor)
  return applyResolvedBlockTypeUpdates(editor, block ? [block] : [], target, source)
}

export function toggleCurrentBlockTodoType(
  editor: RichEditorBlockTypeCommandEditor,
  source: RichEditorBlockTypeCommandSource,
): boolean {
  const block = resolveCurrentBlock(editor)
  if (!block) return false

  const target = block.type === CHECKLIST_BLOCK_TYPE.type
    ? PARAGRAPH_BLOCK_TYPE
    : CHECKLIST_BLOCK_TYPE
  return applyResolvedBlockTypeUpdates(editor, [block], target, source)
}

export function turnBlockIntoType(
  editor: RichEditorBlockTypeCommandEditor,
  blockId: string,
  target: RichEditorBlockTypeDefinition,
  source: RichEditorBlockTypeCommandSource,
): boolean {
  return turnBlocksIntoType({
    blockIds: [blockId],
    editor,
    source,
    target,
  })
}

export function turnBlocksIntoType({
  blockIds,
  editor,
  source,
  target,
}: TurnBlocksIntoTypeOptions): boolean {
  return applyResolvedBlockTypeUpdates(
    editor,
    resolveBlocksById(editor, blockIds),
    target,
    source,
  )
}
