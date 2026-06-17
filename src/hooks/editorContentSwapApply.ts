import type { MutableRefObject } from 'react'
import type { useCreateBlockNote } from '@blocknote/react'
import { trackEvent } from '../lib/telemetry'
import { classifyRichEditorRecoveryError } from '../components/richEditorRecoveryClassifier'
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

interface ApplyMarkupStateToEditorOptions extends Omit<AppliedEditorContentCommit, 'scrollTop'> {
  editor: ReturnType<typeof useCreateBlockNote>
  markup: string
}

function reportEditorContentSwapFailure(error: unknown): void {
  const reason = classifyRichEditorRecoveryError(error, 'transform')
  if (!reason) {
    console.error('applyBlocks failed, trying fallback:', error)
    return
  }

  console.warn('[editor] Recovered rich-editor content swap:', error)
  trackEvent('rich_editor_transform_error_recovered', { reason })
}

export function applyBlocksToEditor(options: ApplyBlocksToEditorOptions): boolean {
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
    reportEditorContentSwapFailure(err)
    try {
      const markup = editor.blocksToHTMLLossy(safeBlocks)
      editor._tiptapEditor.commands.setContent(markup)
    } catch (err2) {
      console.error('Fallback also failed:', err2)
      suppressChangeRef.current = false
      return false
    }
  }

  commitAppliedEditorContent(options)
  return true
}

export function applyBlankStateToEditor(options: ApplyBlankStateToEditorOptions): boolean {
  return applyBlocksToEditor({ ...options, blocks: blankParagraphBlocks(), scrollTop: 0 })
}

export function applyHtmlStateToEditor(options: ApplyMarkupStateToEditorOptions) {
  const {
    editor,
    markup,
    suppressChangeRef,
  } = options
  suppressChangeRef.current = true
  try {
    resetTextSelectionBeforeContentSwap(editor)
    editor._tiptapEditor.commands.setContent(markup)
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

  requestNextFrame(() => {
    editorContentPathRef.current = targetPath
    suppressChangeRef.current = false
    const scrollEl = document.querySelector(EDITOR_CONTAINER_SELECTOR)
    if (scrollEl) scrollEl.scrollTop = scrollTop
  })
}

function requestNextFrame(callback: FrameRequestCallback): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(callback)
    return
  }

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback)
    return
  }

  setTimeout(() => callback(Date.now()), 0)
}
