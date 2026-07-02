import type { MutableRefObject } from 'react'
import type { useCreateBlockNote } from '@blocknote/react'
import { trackEvent } from '../lib/telemetry'
import { classifyRichEditorRecoveryError } from '../components/richEditorRecoveryClassifier'
import { blankParagraphBlocks } from './editorTabContent'
import { EDITOR_CONTAINER_SELECTOR } from './editorDomSelection'
import { resetTextSelectionBeforeContentSwap } from './editorTiptapSelection'
import { repairMalformedEditorBlocks } from './editorBlockRepair'
import { logEditorBlockApplyTrace } from '../utils/editorPerformanceTrace'

type EditorBlocks = unknown[]

export type EditorContentPathRef = MutableRefObject<string | null>

export const PROGRESSIVE_BLOCK_APPLY_THRESHOLD = 320
export const PROGRESSIVE_INITIAL_BLOCK_APPLY_CHUNK_SIZE = 48
export const PROGRESSIVE_BLOCK_APPLY_CHUNK_SIZE = 120

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

interface ApplyBlocksToEditorProgressivelyOptions extends ApplyBlocksToEditorOptions {
  shouldAbort?: () => boolean
}

interface ApplyBlankStateToEditorOptions extends Omit<AppliedEditorContentCommit, 'scrollTop'> {
  editor: ReturnType<typeof useCreateBlockNote>
}

interface ApplyMarkupStateToEditorOptions extends Omit<AppliedEditorContentCommit, 'scrollTop'> {
  editor: ReturnType<typeof useCreateBlockNote>
  markup: string
}

interface ProgressiveAppendResult {
  aborted: boolean
  appliedChunks: number
}

interface ProgressiveRecoveryOptions {
  editor: ReturnType<typeof useCreateBlockNote>
  previousEditable: boolean | null
  safeBlocks: EditorBlocks
  suppressChangeRef: MutableRefObject<boolean>
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

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

function requestFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestNextFrame(() => resolve())
  })
}

function readEditorEditable(editor: ReturnType<typeof useCreateBlockNote>): boolean | null {
  return typeof editor.isEditable === 'boolean' ? editor.isEditable : null
}

function setEditorEditable(editor: ReturnType<typeof useCreateBlockNote>, editable: boolean | null): void {
  if (editable === null || typeof editor.isEditable !== 'boolean') return
  editor.isEditable = editable
}

function lastEditorBlock(editor: ReturnType<typeof useCreateBlockNote>): unknown | undefined {
  return editor.document.at(-1)
}

function applyPreparedBlocksToEditor(
  options: ApplyBlocksToEditorOptions,
  safeBlocks: EditorBlocks,
  startedAt: number,
): boolean {
  const { editor, suppressChangeRef, targetPath } = options
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

  logEditorBlockApplyTrace({
    blockCount: safeBlocks.length,
    durationMs: now() - startedAt,
    mode: 'sync',
    notePath: targetPath,
  })
  commitAppliedEditorContent(options)
  return true
}

function applyInitialProgressiveChunk(
  editor: ReturnType<typeof useCreateBlockNote>,
  safeBlocks: EditorBlocks,
): number {
  const current = editor.document
  const firstChunk = safeBlocks.slice(0, PROGRESSIVE_INITIAL_BLOCK_APPLY_CHUNK_SIZE)
  if (current.length > 0 && firstChunk.length > 0) {
    editor.replaceBlocks(current, firstChunk)
  } else if (firstChunk.length > 0) {
    editor.insertBlocks(firstChunk, current[0], 'before')
  }
  return firstChunk.length > 0 ? 1 : 0
}

async function appendRemainingProgressiveBlocks(
  editor: ReturnType<typeof useCreateBlockNote>,
  safeBlocks: EditorBlocks,
  shouldAbort?: () => boolean,
): Promise<ProgressiveAppendResult> {
  let appliedChunks = 0
  for (
    let index = PROGRESSIVE_INITIAL_BLOCK_APPLY_CHUNK_SIZE;
    index < safeBlocks.length;
    index += PROGRESSIVE_BLOCK_APPLY_CHUNK_SIZE
  ) {
    await requestFrame()
    if (shouldAbort?.()) return { aborted: true, appliedChunks }

    const nextChunk = safeBlocks.slice(index, index + PROGRESSIVE_BLOCK_APPLY_CHUNK_SIZE)
    const reference = lastEditorBlock(editor)
    if (!reference) throw new Error('Missing progressive block insertion reference')
    editor.insertBlocks(nextChunk, reference, 'after')
    appliedChunks += 1
  }
  return { aborted: false, appliedChunks }
}

function recoverProgressiveEditorContent(options: ProgressiveRecoveryOptions): boolean {
  const {
    editor,
    previousEditable,
    safeBlocks,
    suppressChangeRef,
  } = options
  try {
    const markup = editor.blocksToHTMLLossy(safeBlocks)
    editor._tiptapEditor.commands.setContent(markup)
    return true
  } catch (err) {
    console.error('Fallback also failed:', err)
    suppressChangeRef.current = false
    setEditorEditable(editor, previousEditable)
    return false
  }
}

function abortProgressiveApply(
  editor: ReturnType<typeof useCreateBlockNote>,
  previousEditable: boolean | null,
): false {
  setEditorEditable(editor, previousEditable)
  return false
}

export function applyBlocksToEditor(options: ApplyBlocksToEditorOptions): boolean {
  const {
    blocks,
  } = options
  const startedAt = now()
  const safeBlocks = repairMalformedEditorBlocks(blocks)
  return applyPreparedBlocksToEditor(options, safeBlocks, startedAt)
}

export async function applyBlocksToEditorProgressively(
  options: ApplyBlocksToEditorProgressivelyOptions,
): Promise<boolean> {
  const { blocks, editor, shouldAbort, suppressChangeRef, targetPath } = options
  if (blocks.length < PROGRESSIVE_BLOCK_APPLY_THRESHOLD) return applyBlocksToEditor(options)

  const startedAt = now()
  const safeBlocks = repairMalformedEditorBlocks(blocks)
  const previousEditable = readEditorEditable(editor)
  let appliedChunks = 0

  suppressChangeRef.current = true
  setEditorEditable(editor, false)
  try {
    resetTextSelectionBeforeContentSwap(editor)
    appliedChunks = applyInitialProgressiveChunk(editor, safeBlocks)
    const appendResult = await appendRemainingProgressiveBlocks(editor, safeBlocks, shouldAbort)
    if (appendResult.aborted) return abortProgressiveApply(editor, previousEditable)
    appliedChunks += appendResult.appliedChunks
  } catch (err) {
    reportEditorContentSwapFailure(err)
    if (!recoverProgressiveEditorContent({
      editor,
      previousEditable,
      safeBlocks,
      suppressChangeRef,
    })) return false
    appliedChunks = 1
  }

  if (shouldAbort?.()) return abortProgressiveApply(editor, previousEditable)

  logEditorBlockApplyTrace({
    blockCount: safeBlocks.length,
    chunks: appliedChunks,
    durationMs: now() - startedAt,
    mode: 'progressive',
    notePath: targetPath,
  })
  commitAppliedEditorContent(options, () => {
    setEditorEditable(editor, previousEditable)
  }, shouldAbort)
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

function commitAppliedEditorContent(
  options: AppliedEditorContentCommit,
  onCommitted?: () => void,
  shouldAbort?: () => boolean,
) {
  const {
    editorContentPathRef,
    scrollTop,
    suppressChangeRef,
    targetPath,
  } = options

  requestNextFrame(() => {
    if (shouldAbort?.()) {
      onCommitted?.()
      return
    }
    editorContentPathRef.current = targetPath
    const scrollEl = document.querySelector(EDITOR_CONTAINER_SELECTOR)
    if (scrollEl) scrollEl.scrollTop = scrollTop
    onCommitted?.()
    suppressChangeRef.current = false
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
