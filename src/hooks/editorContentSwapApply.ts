import type { MutableRefObject } from 'react'
import type { useCreateBlockNote } from '@blocknote/react'
import { blankParagraphBlocks } from './editorTabContent'
import { EDITOR_CONTAINER_SELECTOR } from './editorDomSelection'
import { resetTextSelectionBeforeContentSwap } from './editorTiptapSelection'
import { repairMalformedEditorBlocks } from './editorBlockRepair'

type EditorBlocks = unknown[]

export type EditorContentPathRef = MutableRefObject<string | null>

interface AppliedEditorContentCommit {
  editorContentPathRef: EditorContentPathRef
  scrollTop: number
  suppressChangeRef: MutableRefObject<boolean>
  targetPath: string
}

interface ApplyBlocksToEditorOptions extends AppliedEditorContentCommit {
  editor: ReturnType<typeof useCreateBlockNote>
  blocks: EditorBlocks
}

interface ApplyBlankStateToEditorOptions extends Omit<AppliedEditorContentCommit, 'scrollTop'> {
  editor: ReturnType<typeof useCreateBlockNote>
}

interface ApplyHtmlStateToEditorOptions extends Omit<AppliedEditorContentCommit, 'scrollTop'> {
  editor: ReturnType<typeof useCreateBlockNote>
  html: string
}

export function applyBlocksToEditor(options: ApplyBlocksToEditorOptions) {
  const {
    editor,
    blocks,
    suppressChangeRef,
  } = options
  const safeBlocks = repairMalformedEditorBlocks(blocks)
  suppressChangeRef.current = true
  try {
    resetTextSelectionBeforeContentSwap(editor)
    const current = editor.document
    if (current.length > 0 && safeBlocks.length > 0) {
      editor.replaceBlocks(current, safeBlocks)
    } else if (safeBlocks.length > 0) {
      editor.insertBlocks(safeBlocks, current[0], 'before')
    }
  } catch (err) {
    console.error('applyBlocks failed, trying fallback:', err)
    try {
      const html = editor.blocksToHTMLLossy(safeBlocks)
      editor._tiptapEditor.commands.setContent(html)
    } catch (err2) {
      console.error('Fallback also failed:', err2)
    }
  } finally {
    commitAppliedEditorContent(options)
  }
}

export function applyBlankStateToEditor(options: ApplyBlankStateToEditorOptions) {
  applyBlocksToEditor({ ...options, blocks: blankParagraphBlocks(), scrollTop: 0 })
}

export function applyHtmlStateToEditor(options: ApplyHtmlStateToEditorOptions) {
  const {
    editor,
    html,
    suppressChangeRef,
  } = options
  suppressChangeRef.current = true
  try {
    resetTextSelectionBeforeContentSwap(editor)
    editor._tiptapEditor.commands.setContent(html)
  } catch (err) {
    console.error('applyHtmlStateToEditor failed:', err)
    suppressChangeRef.current = false
    throw err
  }

  commitAppliedEditorContent({ ...options, scrollTop: 0 })
}

function commitAppliedEditorContent(options: AppliedEditorContentCommit) {
  const {
    editorContentPathRef,
    scrollTop,
    suppressChangeRef,
    targetPath,
  } = options

  requestAnimationFrame(() => {
    editorContentPathRef.current = targetPath
    suppressChangeRef.current = false
    const scrollEl = document.querySelector(EDITOR_CONTAINER_SELECTOR)
    if (scrollEl) scrollEl.scrollTop = scrollTop
  })
}
