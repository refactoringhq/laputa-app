import { rebuildEditorBlocksWithFreshIds, repairMalformedEditorBlocks } from '../hooks/editorBlockRepair'
import type { BlockNoteRenderRecoveryReason } from './blockNoteRenderRecovery'

interface RepairableBlockNoteEditor {
  document: unknown[]
  replaceBlocks: (currentBlocks: unknown[], nextBlocks: unknown[]) => unknown
  blocksToHTMLLossy: (blocks: unknown[]) => string
  _tiptapEditor: {
    commands: {
      setContent: (markup: string) => unknown
    }
  }
}

function blocksForRenderRecovery(
  current: unknown[],
  reason: BlockNoteRenderRecoveryReason,
): unknown[] {
  if (reason === 'stale_block_reference') {
    return rebuildEditorBlocksWithFreshIds(current)
  }

  return repairMalformedEditorBlocks(current)
}

export function repairEditorDocumentForRenderRecovery(
  editor: RepairableBlockNoteEditor,
  reason: BlockNoteRenderRecoveryReason,
) {
  const current = editor.document
  const safeBlocks = blocksForRenderRecovery(current, reason)
  if (safeBlocks === current) return

  try {
    editor.replaceBlocks(current, safeBlocks)
  } catch (error) {
    console.warn('[editor] Failed to repair BlockNote document before render recovery:', error)
    try {
      const markup = editor.blocksToHTMLLossy(safeBlocks)
      editor._tiptapEditor.commands.setContent(markup)
    } catch (fallbackError) {
      console.warn('[editor] Failed to apply repaired BlockNote document fallback:', fallbackError)
    }
  }
}
