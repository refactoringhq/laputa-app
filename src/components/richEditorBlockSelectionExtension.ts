import { createExtension } from '@blocknote/core'
import type { Node as ProsemirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, Selection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

export const RICH_EDITOR_BLOCK_SELECTION_CLASS = 'tolaria-rich-editor-block-selected'
const RICH_EDITOR_BLOCK_SELECTION_META = 'tolariaRichEditorBlockSelection'

type BlockLike = {
  children?: unknown[]
  id: string
}

type BlockSelectionState = {
  blockIds: string[]
}

type BlockSelectionMeta =
  | { blockIds: string[]; type: 'set' }
  | { type: 'clear' }

type RichEditorBlockSelectionEditor = {
  document?: unknown[]
  focus?: () => void
  getSelection?: () => unknown
  getTextCursorPosition?: () => unknown
  isEditable?: boolean
  moveBlocksDown?: () => unknown
  moveBlocksUp?: () => unknown
  removeBlocks?: (blocks: string[]) => unknown
  setSelection?: (anchorBlock: string, headBlock: string) => void
  setTextCursorPosition?: (targetBlock: string, placement?: 'start' | 'end') => void
}

export const richEditorBlockSelectionPluginKey = new PluginKey<BlockSelectionState | null>(
  RICH_EDITOR_BLOCK_SELECTION_META,
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isBlockLike(value: unknown): value is BlockLike {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0
}

function uniqueBlockIds(blockIds: readonly string[]): string[] {
  return Array.from(new Set(blockIds.filter((id) => id.length > 0)))
}

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

function blockIdFromNode(node: ProsemirrorNode): string | null {
  const attrs = node.attrs as Record<string, unknown>
  return typeof attrs.id === 'string' && attrs.id.length > 0 ? attrs.id : null
}

function isBlockNode(node: ProsemirrorNode): boolean {
  return node.type.isInGroup('bnBlock')
}

function prosemirrorDocumentBlockIds(doc: ProsemirrorNode): string[] {
  const ids: string[] = []
  doc.descendants((node) => {
    if (!isBlockNode(node)) return true

    const id = blockIdFromNode(node)
    if (id) ids.push(id)
    return true
  })
  return uniqueBlockIds(ids)
}

function blockPositionById(doc: ProsemirrorNode, blockId: string): { node: ProsemirrorNode; pos: number } | null {
  let match: { node: ProsemirrorNode; pos: number } | null = null
  doc.descendants((node, pos) => {
    if (match) return false
    if (isBlockNode(node) && blockIdFromNode(node) === blockId) {
      match = { node, pos }
      return false
    }
    return true
  })
  return match
}

function nearestBlockId(doc: ProsemirrorNode, pos: number): string | null {
  const resolved = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))
  if (resolved.nodeAfter && isBlockNode(resolved.nodeAfter)) {
    return blockIdFromNode(resolved.nodeAfter)
  }

  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth)
    if (isBlockNode(node)) return blockIdFromNode(node)
  }

  const fallback = prosemirrorDocumentBlockIds(doc)
  return fallback[0] ?? null
}

function selectedProsemirrorBlockIds(state: EditorState): string[] {
  const { doc, selection } = state
  if (selection.empty) {
    const id = nearestBlockId(doc, selection.from)
    return id ? [id] : []
  }

  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  const ids: string[] = []
  doc.descendants((node, pos) => {
    if (!isBlockNode(node)) return true

    const id = blockIdFromNode(node)
    if (id && pos < to && pos + node.nodeSize > from) ids.push(id)
    return true
  })
  return uniqueBlockIds(ids)
}

function selectionBlocks(editor: RichEditorBlockSelectionEditor): string[] {
  const selection = editor.getSelection?.()
  if (!isRecord(selection)) return []

  const blocks = selection.blocks
  return Array.isArray(blocks)
    ? uniqueBlockIds(blocks.filter(isBlockLike).map((block) => block.id))
    : []
}

function cursorBlock(editor: RichEditorBlockSelectionEditor): string[] {
  try {
    const position = editor.getTextCursorPosition?.()
    if (!isRecord(position) || !isBlockLike(position.block)) return []
    return [position.block.id]
  } catch {
    return []
  }
}

function blockIdsFromEditorSelection(editor: RichEditorBlockSelectionEditor, state: EditorState): string[] {
  return uniqueBlockIds([
    ...selectionBlocks(editor),
    ...cursorBlock(editor),
    ...selectedProsemirrorBlockIds(state),
  ])
}

function existingSelectionIds(source: { doc: ProsemirrorNode }, blockIds: readonly string[]): string[] {
  const existing = new Set(prosemirrorDocumentBlockIds(source.doc))
  return uniqueBlockIds(blockIds).filter((id) => existing.has(id))
}

function readBlockSelection(state: EditorState): BlockSelectionState | null {
  return richEditorBlockSelectionPluginKey.getState(state) ?? null
}

export function blockSelectionAfterArrow(
  selectedBlockIds: readonly string[],
  allBlockIds: readonly string[],
  direction: 'down' | 'up',
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

function blockSelectionAfterDelete(
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

function stopEditorKey(event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

function isPlainEscape(event: KeyboardEvent): boolean {
  return event.key === 'Escape'
    && !event.isComposing
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
}

function isPlainEnter(event: KeyboardEvent): boolean {
  return event.key === 'Enter'
    && !event.isComposing
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
}

function isBlockNavigationArrow(event: KeyboardEvent): event is KeyboardEvent & { key: 'ArrowDown' | 'ArrowUp' } {
  return (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    && !event.isComposing
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
}

function isBlockMoveArrow(event: KeyboardEvent): event is KeyboardEvent & { key: 'ArrowDown' | 'ArrowUp' } {
  return (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    && !event.isComposing
    && !event.altKey
    && (event.ctrlKey || event.metaKey)
    && event.shiftKey
}

function isDeleteKey(event: KeyboardEvent): boolean {
  return (event.key === 'Delete' || event.key === 'Backspace')
    && !event.isComposing
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
}

function isPrintableTextKey(event: KeyboardEvent): boolean {
  return event.key.length === 1
    && !event.isComposing
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
}

function blockSelectionMeta(transaction: Transaction): BlockSelectionMeta | undefined {
  const meta = transaction.getMeta(richEditorBlockSelectionPluginKey)
  if (!isRecord(meta)) return undefined
  if (meta.type === 'clear') return { type: 'clear' }
  if (meta.type === 'set' && Array.isArray(meta.blockIds)) {
    return { type: 'set', blockIds: meta.blockIds.filter((id): id is string => typeof id === 'string') }
  }
  return undefined
}

function withCollapsedSelectionNearBlock(
  transaction: Transaction,
  blockId: string,
): Transaction {
  const position = blockPositionById(transaction.doc, blockId)
  if (!position) return transaction

  try {
    const resolved = transaction.doc.resolve(Math.min(position.pos + 1, transaction.doc.content.size))
    return transaction.setSelection(Selection.near(resolved))
  } catch {
    return transaction
  }
}

function dispatchBlockSelection(view: EditorView, blockIds: readonly string[]): boolean {
  const nextBlockIds = existingSelectionIds(view.state, blockIds)
  if (nextBlockIds.length === 0) return false

  const transaction = withCollapsedSelectionNearBlock(
    view.state.tr.setMeta(richEditorBlockSelectionPluginKey, { type: 'set', blockIds: nextBlockIds } satisfies BlockSelectionMeta),
    nextBlockIds[0],
  )
  view.dispatch(transaction)
  return true
}

function clearBlockSelection(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(richEditorBlockSelectionPluginKey, { type: 'clear' } satisfies BlockSelectionMeta))
}

function focusBlockForEditing(
  editor: RichEditorBlockSelectionEditor,
  view: EditorView,
  blockId: string,
): void {
  try {
    editor.setTextCursorPosition?.(blockId, 'end')
    editor.focus?.()
  } catch {
    const transaction = withCollapsedSelectionNearBlock(
      view.state.tr.setMeta(richEditorBlockSelectionPluginKey, { type: 'clear' } satisfies BlockSelectionMeta),
      blockId,
    )
    view.dispatch(transaction)
  }
}

function handleDeleteSelection(
  editor: RichEditorBlockSelectionEditor,
  view: EditorView,
  selectedBlockIds: readonly string[],
): void {
  const currentDocumentIds = documentBlockIds(editor.document)
  const nextSelection = blockSelectionAfterDelete(selectedBlockIds, currentDocumentIds)

  try {
    editor.removeBlocks?.([...selectedBlockIds])
    editor.focus?.()
  } catch {
    clearBlockSelection(view)
    return
  }

  const nextExistingIds = existingSelectionIds(view.state, nextSelection)
  if (nextExistingIds.length > 0) {
    dispatchBlockSelection(view, nextExistingIds)
    return
  }

  const fallbackIds = documentBlockIds(editor.document)
  if (!dispatchBlockSelection(view, fallbackIds.slice(0, 1))) {
    clearBlockSelection(view)
  }
}

function selectBlocksForMove(
  editor: RichEditorBlockSelectionEditor,
  view: EditorView,
  selectedBlockIds: readonly string[],
): void {
  if (selectedBlockIds.length > 1) {
    try {
      editor.setSelection?.(selectedBlockIds[0], selectedBlockIds[selectedBlockIds.length - 1])
      return
    } catch {
      // Fall back to the collapsed selection used by single-block moves.
    }
  }

  const transaction = withCollapsedSelectionNearBlock(view.state.tr, selectedBlockIds[0])
  view.dispatch(transaction)
}

function handleMoveSelection(
  editor: RichEditorBlockSelectionEditor,
  view: EditorView,
  selectedBlockIds: readonly string[],
  direction: 'down' | 'up',
): void {
  const moveBlocks = direction === 'up' ? editor.moveBlocksUp : editor.moveBlocksDown
  if (!moveBlocks) return

  try {
    selectBlocksForMove(editor, view, selectedBlockIds)
    moveBlocks.call(editor)
    editor.focus?.()
  } finally {
    if (!dispatchBlockSelection(view, selectedBlockIds)) {
      clearBlockSelection(view)
    }
  }
}

function handleActiveEscapeKey(view: EditorView, event: KeyboardEvent): boolean {
  if (!isPlainEscape(event)) return false

  clearBlockSelection(view)
  return false
}

function handleActiveNavigationKey(
  editor: RichEditorBlockSelectionEditor,
  view: EditorView,
  event: KeyboardEvent,
  selection: BlockSelectionState,
): boolean {
  if (!isBlockNavigationArrow(event)) return false

  stopEditorKey(event)
  const direction = event.key === 'ArrowUp' ? 'up' : 'down'
  const nextSelection = blockSelectionAfterArrow(
    selection.blockIds,
    documentBlockIds(editor.document),
    direction,
    event.shiftKey,
  )
  dispatchBlockSelection(view, nextSelection)
  return true
}

function handleActiveMoveKey(
  editor: RichEditorBlockSelectionEditor,
  view: EditorView,
  event: KeyboardEvent,
  selection: BlockSelectionState,
): boolean {
  if (!isBlockMoveArrow(event)) return false

  stopEditorKey(event)
  handleMoveSelection(
    editor,
    view,
    selection.blockIds,
    event.key === 'ArrowUp' ? 'up' : 'down',
  )
  return true
}

function handleActiveEnterKey(
  editor: RichEditorBlockSelectionEditor,
  view: EditorView,
  event: KeyboardEvent,
  selection: BlockSelectionState,
): boolean {
  if (!isPlainEnter(event)) return false

  stopEditorKey(event)
  clearBlockSelection(view)
  focusBlockForEditing(editor, view, selection.blockIds[selection.blockIds.length - 1])
  return true
}

function handleActiveDeleteKey(
  editor: RichEditorBlockSelectionEditor,
  view: EditorView,
  event: KeyboardEvent,
  selection: BlockSelectionState,
): boolean {
  if (!isDeleteKey(event)) return false

  stopEditorKey(event)
  handleDeleteSelection(editor, view, selection.blockIds)
  return true
}

function handleActivePrintableKey(event: KeyboardEvent): boolean {
  if (!isPrintableTextKey(event)) return false

  stopEditorKey(event)
  return true
}

function handleActiveBlockSelectionKey(
  editor: RichEditorBlockSelectionEditor,
  view: EditorView,
  event: KeyboardEvent,
  selection: BlockSelectionState,
): boolean {
  return handleActiveEscapeKey(view, event)
    || handleActiveNavigationKey(editor, view, event, selection)
    || handleActiveMoveKey(editor, view, event, selection)
    || handleActiveEnterKey(editor, view, event, selection)
    || handleActiveDeleteKey(editor, view, event, selection)
    || handleActivePrintableKey(event)
}

function handleInactiveBlockSelectionKey(
  editor: RichEditorBlockSelectionEditor,
  view: EditorView,
  event: KeyboardEvent,
): boolean {
  if (!isPlainEscape(event)) return false
  if (editor.isEditable === false) return false

  const blockIds = blockIdsFromEditorSelection(editor, view.state)
  if (!dispatchBlockSelection(view, blockIds)) return false

  stopEditorKey(event)
  editor.focus?.()
  return true
}

function blockSelectionDecorations(state: EditorState): DecorationSet {
  const selection = readBlockSelection(state)
  if (!selection) return DecorationSet.empty

  const selected = new Set(selection.blockIds)
  const decorations: Decoration[] = []
  const mode = selection.blockIds.length > 1 ? 'range' : 'single'

  state.doc.descendants((node, pos) => {
    if (!isBlockNode(node)) return true
    const id = blockIdFromNode(node)
    if (!id || !selected.has(id)) return true

    decorations.push(Decoration.node(pos, pos + node.nodeSize, {
      class: RICH_EDITOR_BLOCK_SELECTION_CLASS,
      'data-tolaria-block-selection': mode,
    }))
    return true
  })

  return DecorationSet.create(state.doc, decorations)
}

function blockSelectionStateFromIds(source: { doc: ProsemirrorNode }, blockIds: readonly string[]): BlockSelectionState | null {
  const nextBlockIds = existingSelectionIds(source, blockIds)
  return nextBlockIds.length > 0 ? { blockIds: nextBlockIds } : null
}

function reduceExplicitBlockSelectionState(
  transaction: Transaction,
  meta: BlockSelectionMeta,
): BlockSelectionState | null {
  return meta.type === 'clear'
    ? null
    : blockSelectionStateFromIds(transaction, meta.blockIds)
}

function reduceImplicitBlockSelectionState(
  transaction: Transaction,
  previous: BlockSelectionState | null,
): BlockSelectionState | null {
  if (!previous || transaction.selectionSet) return null

  const blockIds = existingSelectionIds(transaction, previous.blockIds)
  return blockIds.length > 0 ? { blockIds } : null
}

function reduceBlockSelectionState(transaction: Transaction, previous: BlockSelectionState | null): BlockSelectionState | null {
  const meta = blockSelectionMeta(transaction)
  return meta
    ? reduceExplicitBlockSelectionState(transaction, meta)
    : reduceImplicitBlockSelectionState(transaction, previous)
}

export const createRichEditorBlockSelectionExtension = createExtension(({ editor }) => {
  const blockSelectionEditor = editor as unknown as RichEditorBlockSelectionEditor

  return {
    key: RICH_EDITOR_BLOCK_SELECTION_META,
    prosemirrorPlugins: [
      new Plugin<BlockSelectionState | null>({
        key: richEditorBlockSelectionPluginKey,
        props: {
          decorations: blockSelectionDecorations,
          handleKeyDown: (view, event) => {
            const selection = readBlockSelection(view.state)
            return selection
              ? handleActiveBlockSelectionKey(blockSelectionEditor, view, event, selection)
              : handleInactiveBlockSelectionKey(blockSelectionEditor, view, event)
          },
        },
        state: {
          init: () => null,
          apply: (transaction, previous) => reduceBlockSelectionState(transaction, previous),
        },
      }),
    ],
  } as const
})
