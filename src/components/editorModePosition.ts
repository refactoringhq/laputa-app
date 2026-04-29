import { compactMarkdown } from '../utils/compact-markdown'
import { restoreWikilinksInBlocks, splitFrontmatter } from '../utils/wikilinks'
import { serializeMermaidAwareBlocks } from '../utils/mermaidMarkdown'
import { findNearestTextCursorBlockById } from './blockNoteCursorTarget'

interface BlockLike {
  id: string
  content?: unknown
}

interface BlockSelectionLike {
  blocks: BlockLike[]
}

interface TextCursorPositionLike {
  block: BlockLike
}

export interface BlockNotePositionEditor {
  document: BlockLike[]
  getSelection?: () => BlockSelectionLike | undefined
  getTextCursorPosition?: () => TextCursorPositionLike
  blocksToMarkdownLossy: (blocks: unknown[]) => string
  setSelection: (startBlock: string, endBlock: string) => void
  setTextCursorPosition: (targetBlock: string, placement: 'start' | 'end') => void
  focus: () => void
}

export interface CodeMirrorViewLike {
  state: {
    doc: { toString: () => string }
    selection: {
      main: {
        anchor: number
        head: number
      }
    }
  }
  scrollDOM: {
    scrollTop: number
  }
  dispatch: (spec: { selection: { anchor: number; head: number } }) => void
  focus: () => void
}

interface RawEditorHost extends Element {
  __cmView?: CodeMirrorViewLike
}

export interface RichEditorPositionSnapshot {
  anchorBlockIndex: number
  headBlockIndex: number
  scrollTop: number
}

export interface RawEditorPositionSnapshot {
  anchorLineRatio: number
  headLineRatio: number
}

export interface CodeMirrorRestoreState {
  anchor: number
  head: number
  scrollTop: number
}

interface BlockNoteRestoreState {
  startBlockId: string
  endBlockId: string
}

interface BlockLineRange {
  startLine: number
  endLine: number
}

const RAW_EDITOR_SELECTOR = '[data-testid="raw-editor-codemirror"]'
const BLOCKNOTE_SCROLL_SELECTOR = '.editor-scroll-area'

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function clampSelectionOffset(value: number, maxOffset: number): number {
  return Number.isFinite(value) ? clamp(value, 0, maxOffset) : 0
}

function countLines({ text }: { text: string }): number {
  return text.length === 0 ? 1 : text.split('\n').length
}

function countLineBreaks({ text }: { text: string }): number {
  return [...text].filter(char => char === '\n').length
}

function getLineStartOffset({ text, lineIndex }: { text: string; lineIndex: number }): number {
  if (lineIndex <= 0 || text.length === 0) return 0

  let currentLine = 0
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '\n') continue
    currentLine += 1
    if (currentLine === lineIndex) {
      return index + 1
    }
  }

  return text.length
}

function getLineEndOffset({ text, lineIndex }: { text: string; lineIndex: number }): number {
  const start = getLineStartOffset({ text, lineIndex })
  const nextBreak = text.indexOf('\n', start)
  return nextBreak === -1 ? text.length : nextBreak
}

function getLineIndexForOffset({ text, offset }: { text: string; offset: number }): number {
  if (text.length === 0) return 0
  const clampedOffset = clamp(offset, 0, text.length)
  return countLineBreaks({ text: text.slice(0, clampedOffset) })
}

function getLineRatio({ text, offset }: { text: string; offset: number }): number {
  const totalLines = countLines({ text })
  if (totalLines <= 1) return 0
  const lineIndex = getLineIndexForOffset({ text, offset })
  return lineIndex / (totalLines - 1)
}

function getLineIndexFromRatio({ totalLines, ratio }: { totalLines: number; ratio: number }): number {
  if (totalLines <= 1) return 0
  return Math.round(clamp(ratio, 0, 1) * (totalLines - 1))
}

function serializeBlock(editor: BlockNotePositionEditor, block: BlockLike): string {
  return compactMarkdown(serializeMermaidAwareBlocks(editor, restoreWikilinksInBlocks([block])))
}

function serializeEditorBody(editor: BlockNotePositionEditor): string {
  return compactMarkdown(serializeMermaidAwareBlocks(editor, restoreWikilinksInBlocks(editor.document)))
}

function buildBlockLineRanges({
  body,
  editor,
}: {
  body: string
  editor: BlockNotePositionEditor
}): BlockLineRange[] {
  let searchStart = 0
  let fallbackStartLine = 0

  return editor.document.map((block) => {
    const serializedBlock = serializeBlock(editor, block)
    if (!serializedBlock) {
      return { startLine: fallbackStartLine, endLine: fallbackStartLine }
    }

    const bodyIndex = body.indexOf(serializedBlock, searchStart)
    if (bodyIndex === -1) {
      const lineCount = countLines({ text: serializedBlock })
      const range = {
        startLine: fallbackStartLine,
        endLine: fallbackStartLine + Math.max(lineCount - 1, 0),
      }
      fallbackStartLine = range.endLine + 1
      return range
    }

    const startLine = countLineBreaks({ text: body.slice(0, bodyIndex) })
    const endLine = countLineBreaks({ text: body.slice(0, bodyIndex + serializedBlock.length) })
    searchStart = bodyIndex + serializedBlock.length
    fallbackStartLine = endLine + 1
    return { startLine, endLine }
  })
}

function findNearestBlockIndex({
  ranges,
  targetLine,
}: {
  ranges: BlockLineRange[]
  targetLine: number
}): number {
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY

  ranges.forEach((range, index) => {
    if (targetLine >= range.startLine && targetLine <= range.endLine) {
      nearestIndex = index
      nearestDistance = 0
      return
    }

    const distance = targetLine < range.startLine
      ? range.startLine - targetLine
      : targetLine - range.endLine
    if (distance < nearestDistance) {
      nearestIndex = index
      nearestDistance = distance
    }
  })

  return nearestIndex
}

function getSelectionIndexes(editor: BlockNotePositionEditor): [number, number] | null {
  if (typeof editor.getSelection !== 'function') return null

  const selection = editor.getSelection()
  const selectedBlocks = selection?.blocks ?? []
  if (selectedBlocks.length === 0) return null

  const startIndex = editor.document.findIndex(block => block.id === selectedBlocks[0].id)
  const endIndex = editor.document.findIndex(block => block.id === selectedBlocks[selectedBlocks.length - 1].id)
  if (startIndex === -1 || endIndex === -1) return null

  return [startIndex, endIndex]
}

function getCursorIndex(editor: BlockNotePositionEditor): number | null {
  if (typeof editor.getTextCursorPosition !== 'function') return null

  const cursorBlockId = editor.getTextCursorPosition().block.id
  const cursorIndex = editor.document.findIndex(block => block.id === cursorBlockId)
  return cursorIndex === -1 ? null : cursorIndex
}

function buildBlockNoteRestoreState(
  editor: BlockNotePositionEditor,
  snapshot: RawEditorPositionSnapshot,
): BlockNoteRestoreState | null {
  if (editor.document.length === 0) return null

  const body = serializeEditorBody(editor)
  const ranges = buildBlockLineRanges({ body, editor })
  const totalLines = countLines({ text: body })
  const anchorLine = getLineIndexFromRatio({ totalLines, ratio: snapshot.anchorLineRatio })
  const headLine = getLineIndexFromRatio({ totalLines, ratio: snapshot.headLineRatio })
  const anchorIndex = findNearestBlockIndex({ ranges, targetLine: anchorLine })
  const headIndex = findNearestBlockIndex({ ranges, targetLine: headLine })
  const startIndex = Math.min(anchorIndex, headIndex)
  const endIndex = Math.max(anchorIndex, headIndex)
  const startBlockId = findNearestTextCursorBlockById(
    editor.document,
    editor.document[startIndex].id,
  )?.id
  const endBlockId = findNearestTextCursorBlockById(
    editor.document,
    editor.document[endIndex].id,
  )?.id
  if (!startBlockId || !endBlockId) return null

  return {
    startBlockId,
    endBlockId,
  }
}

export function readBlockNoteScrollTop(documentObject: Document): number {
  const scrollElement = documentObject.querySelector<HTMLElement>(BLOCKNOTE_SCROLL_SELECTOR)
  return scrollElement?.scrollTop ?? 0
}

export function captureRichEditorPositionSnapshot(
  editor: BlockNotePositionEditor,
  documentObject: Document,
): RichEditorPositionSnapshot | null {
  if (editor.document.length === 0) return null

  const selectionIndexes = getSelectionIndexes(editor)
  const [anchorBlockIndex, headBlockIndex] = selectionIndexes ?? [getCursorIndex(editor), getCursorIndex(editor)]
  if (anchorBlockIndex === null || headBlockIndex === null) return null

  return {
    anchorBlockIndex,
    headBlockIndex,
    scrollTop: readBlockNoteScrollTop(documentObject),
  }
}

export function buildCodeMirrorRestoreState(
  editor: BlockNotePositionEditor,
  content: string,
  snapshot: RichEditorPositionSnapshot,
): CodeMirrorRestoreState | null {
  if (editor.document.length === 0) return null

  const [frontmatter, body] = splitFrontmatter(content)
  const ranges = buildBlockLineRanges({ body, editor })
  if (ranges.length === 0) return null

  const anchorRange = ranges[clamp(snapshot.anchorBlockIndex, 0, ranges.length - 1)]
  const headRange = ranges[clamp(snapshot.headBlockIndex, 0, ranges.length - 1)]
  const anchorBodyOffset = getLineStartOffset({ text: body, lineIndex: anchorRange.startLine })
  const headBodyOffset = getLineEndOffset({ text: body, lineIndex: headRange.endLine })

  return {
    anchor: frontmatter.length + anchorBodyOffset,
    head: frontmatter.length + headBodyOffset,
    scrollTop: snapshot.scrollTop,
  }
}

export function getRawEditorView(documentObject: Document): CodeMirrorViewLike | null {
  const host = documentObject.querySelector<RawEditorHost>(RAW_EDITOR_SELECTOR)
  return host?.__cmView ?? null
}

export function captureRawEditorPositionSnapshot(documentObject: Document): RawEditorPositionSnapshot | null {
  const view = getRawEditorView(documentObject)
  if (!view) return null

  const content = view.state.doc.toString()
  const [frontmatter, body] = splitFrontmatter(content)
  const bodyLength = body.length
  const anchorOffset = clamp(view.state.selection.main.anchor - frontmatter.length, 0, bodyLength)
  const headOffset = clamp(view.state.selection.main.head - frontmatter.length, 0, bodyLength)
  return {
    anchorLineRatio: getLineRatio({ text: body, offset: anchorOffset }),
    headLineRatio: getLineRatio({ text: body, offset: headOffset }),
  }
}

export function captureRawCodeMirrorRestoreState(documentObject: Document): CodeMirrorRestoreState | null {
  const view = getRawEditorView(documentObject)
  if (!view) return null

  return {
    anchor: view.state.selection.main.anchor,
    head: view.state.selection.main.head,
    scrollTop: view.scrollDOM.scrollTop,
  }
}

export function restoreCodeMirrorView(
  documentObject: Document,
  state: CodeMirrorRestoreState,
): boolean {
  const view = getRawEditorView(documentObject)
  if (!view) return false

  const maxOffset = view.state.doc.toString().length
  const selection = {
    anchor: clampSelectionOffset(state.anchor, maxOffset),
    head: clampSelectionOffset(state.head, maxOffset),
  }

  try {
    view.dispatch({ selection })
  } catch {
    return false
  }
  view.scrollDOM.scrollTop = state.scrollTop
  view.focus()
  return true
}

export function restoreBlockNoteView(
  editor: BlockNotePositionEditor,
  snapshot: RawEditorPositionSnapshot,
  documentObject: Document,
): boolean {
  const state = buildBlockNoteRestoreState(editor, snapshot)
  if (!state) return false

  try {
    if (state.startBlockId === state.endBlockId) {
      editor.setTextCursorPosition(state.endBlockId, 'end')
    } else {
      editor.setSelection(state.startBlockId, state.endBlockId)
    }
  } catch {
    return false
  }
  editor.focus()
  documentObject
    .querySelector<HTMLElement>(`[data-id="${state.endBlockId}"]`)
    ?.scrollIntoView({ block: 'center' })
  return true
}
