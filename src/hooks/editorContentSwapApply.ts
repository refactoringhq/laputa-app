import type { MutableRefObject } from 'react'
import type { useCreateBlockNote } from '@blocknote/react'
import type { Transaction } from '@tiptap/pm/state'
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

function mutateEditorWithoutHistory(
  editor: ReturnType<typeof useCreateBlockNote>,
  mutate: () => void,
): void {
  if (typeof editor.transact !== 'function') {
    mutate()
    return
  }
  editor.transact((transaction: Transaction | undefined) => {
    transaction?.setMeta('addToHistory', false)
    mutate()
  })
}

function replaceBlocksWithoutHistory(
  editor: ReturnType<typeof useCreateBlockNote>,
  current: EditorBlocks,
  next: EditorBlocks,
): void {
  mutateEditorWithoutHistory(editor, () => editor.replaceBlocks(current, next))
}

function insertBlocksWithoutHistory(
  editor: ReturnType<typeof useCreateBlockNote>,
  next: EditorBlocks,
  reference: unknown,
  placement: 'before' | 'after',
): void {
  mutateEditorWithoutHistory(editor, () => editor.insertBlocks(next, reference, placement))
}

function setContentWithoutHistory(
  editor: ReturnType<typeof useCreateBlockNote>,
  markup: string,
): void {
  const chain = editor._tiptapEditor.chain
  if (typeof chain !== 'function') {
    editor._tiptapEditor.commands.setContent(markup)
    return
  }
  chain.call(editor._tiptapEditor)
    .setContent(markup)
    .setMeta('addToHistory', false)
    .run()
}

function lastEditorBlock(editor: ReturnType<typeof useCreateBlockNote>): unknown | undefined {
  return editor.document.at(-1)
}

function isNumberedListItem(block: unknown): boolean {
  return (block as { type?: unknown } | null)?.type === 'numberedListItem'
}

function numberedListContinuesAt(blocks: EditorBlocks, index: number): boolean {
  if (index >= blocks.length) return false
  if (!isNumberedListItem(blocks.at(index - 1))) return false
  return isNumberedListItem(blocks.at(index))
}

function progressiveChunkEnd(blocks: EditorBlocks, start: number, size: number): number {
  let end = Math.min(start + size, blocks.length)
  while (numberedListContinuesAt(blocks, end)) {
    end += 1
  }
  return end
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
      replaceBlocksWithoutHistory(editor, current, safeBlocks)
    } else if (safeBlocks.length > 0) {
      insertBlocksWithoutHistory(editor, safeBlocks, current[0], 'before')
    }
  } catch (err) {
    reportEditorContentSwapFailure(err)
    try {
      const markup = editor.blocksToHTMLLossy(safeBlocks)
      setContentWithoutHistory(editor, markup)
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
  const chunkEnd = progressiveChunkEnd(safeBlocks, 0, PROGRESSIVE_INITIAL_BLOCK_APPLY_CHUNK_SIZE)
  const firstChunk = safeBlocks.slice(0, chunkEnd)
  if (current.length > 0 && firstChunk.length > 0) {
    replaceBlocksWithoutHistory(editor, current, firstChunk)
  } else if (firstChunk.length > 0) {
    insertBlocksWithoutHistory(editor, firstChunk, current[0], 'before')
  }
  return firstChunk.length
}

async function appendRemainingProgressiveBlocks(
  editor: ReturnType<typeof useCreateBlockNote>,
  safeBlocks: EditorBlocks,
  initialBlockCount: number,
  shouldAbort?: () => boolean,
): Promise<ProgressiveAppendResult> {
  let appliedChunks = 0
  let index = initialBlockCount
  while (index < safeBlocks.length) {
    await requestFrame()
    if (shouldAbort?.()) return { aborted: true, appliedChunks }

    const chunkEnd = progressiveChunkEnd(safeBlocks, index, PROGRESSIVE_BLOCK_APPLY_CHUNK_SIZE)
    const nextChunk = safeBlocks.slice(index, chunkEnd)
    const reference = lastEditorBlock(editor)
    if (!reference) throw new Error('Missing progressive block insertion reference')
    insertBlocksWithoutHistory(editor, nextChunk, reference, 'after')
    appliedChunks += 1
    index = chunkEnd
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
    setContentWithoutHistory(editor, markup)
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
    const initialBlockCount = applyInitialProgressiveChunk(editor, safeBlocks)
    appliedChunks = initialBlockCount > 0 ? 1 : 0
    const appendResult = await appendRemainingProgressiveBlocks(
      editor,
      safeBlocks,
      initialBlockCount,
      shouldAbort,
    )
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
    setContentWithoutHistory(editor, markup)
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
