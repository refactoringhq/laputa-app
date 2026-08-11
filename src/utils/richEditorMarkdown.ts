import { compactMarkdown } from './compact-markdown'
import { injectCalloutBlocks } from './calloutMarkdown'
import {
  hasDurableEditorBlocks,
  injectDurableEditorMarkdownBlocks,
  preProcessDurableEditorMarkdown,
  serializeDurableEditorBlocks,
} from './editorDurableMarkdown'
import { portableFileAttachmentUrls } from './fileAttachmentMarkdown'
import { logRichEditorSerializationTrace } from './editorPerformanceTrace'
import { injectMarkdownHighlightsInBlocks } from './markdownHighlightMarkdown'
import { injectMathInBlocks, preProcessMathMarkdown } from './mathMarkdown'
import { advanceMarkdownFence, type MarkdownFence } from './markdownFences'
import { preProcessSingleTildeStrikethrough } from './markdownStrikethrough'
import { normalizeBareImageUrls, portableImageUrls, resolveImageUrls } from './vaultImages'
import { injectWikilinks, preProcessWikilinks, splitFrontmatter } from './wikilinks'
import type {
  BlockNoteDirectMarkdownMetrics,
  DirectMarkdownCapableSerializer,
} from './blockNoteDirectMarkdown'
import { installBlockNoteDirectMarkdown } from './blockNoteDirectMarkdown'

type EditorBlocksSnapshot = unknown[]
type MarkdownBody = string
type NotePath = string
type PreprocessedMarkdown = string
type VaultPath = string

export interface RichEditorMarkdownSerializer extends DirectMarkdownCapableSerializer {
  document: EditorBlocksSnapshot
}

interface RichEditorDocumentSerializationOptions {
  blocks?: EditorBlocksSnapshot
  editor: RichEditorMarkdownSerializer
  notePath?: string
  tabContent: string
  vaultPath?: string
}

interface RichEditorBlockSerializationOptions {
  blocks: EditorBlocksSnapshot
  editor: DirectMarkdownCapableSerializer
  notePath?: string
  vaultPath?: string
}

const EMPTY_CHECKLIST_ITEM_FILLER = '\u200B'
const EMPTY_CHECKLIST_ITEM_LINE_RE = /^([ \t]*[-*+][ \t]+\[[ xX]\])[ \t]*$/u
const BLANK_PARAGRAPH_PLACEHOLDER = '\u200B'

interface ParsedBlockquoteSourceLine {
  content: string
  marker: string
}

interface MarkdownSourceLine {
  content: string
  newline: string
}

interface BlankParagraphPreprocessState {
  fence: MarkdownFence | null
  output: string[]
  pendingBlanks: MarkdownSourceLine[]
  precedingContent: boolean
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readDirectMarkdownMetrics(
  editor: DirectMarkdownCapableSerializer,
): BlockNoteDirectMarkdownMetrics | undefined {
  return editor.__tolariaLastDirectMarkdownMetrics
}

export function installRichEditorMarkdownSerializer(editor: unknown): void {
  if (!isDirectMarkdownCapableSerializer(editor)) return
  installBlockNoteDirectMarkdown(editor)
}

function isDirectMarkdownCapableSerializer(editor: unknown): editor is DirectMarkdownCapableSerializer {
  return typeof editor === 'object'
    && editor !== null
    && 'blocksToMarkdownLossy' in editor
    && typeof editor.blocksToMarkdownLossy === 'function'
}

export function preProcessRichEditorMarkdown(
  markdown: MarkdownBody,
  vaultPath?: VaultPath,
  notePath?: NotePath,
): PreprocessedMarkdown {
  const withDurableBlocks = preProcessDurableEditorMarkdown({ markdown })
  const withEmptyChecklists = preProcessEmptyChecklistItems(withDurableBlocks)
  const withBlankQuotes = preProcessBlankBlockquoteParagraphs(withEmptyChecklists)
  const withBlankParagraphs = preProcessBlankParagraphs(withBlankQuotes)
  const withBareImages = normalizeBareImageUrls(withBlankParagraphs)
  const withImages = vaultPath ? resolveImageUrls(withBareImages, vaultPath, notePath) : withBareImages
  const withWikilinks = preProcessWikilinks(withImages)
  const withMath = preProcessMathMarkdown({ markdown: withWikilinks })
  return preProcessSingleTildeStrikethrough({ markdown: withMath })
}

export function injectRichEditorMarkdownBlocks(blocks: EditorBlocksSnapshot): EditorBlocksSnapshot {
  const withWikilinks = injectWikilinks(blocks)
  const withMath = injectMathInBlocks(withWikilinks)
  const withHighlights = injectMarkdownHighlightsInBlocks(withMath)
  const withDurableBlocks = injectDurableEditorMarkdownBlocks(withHighlights)
  const withCallouts = injectCalloutBlocks(withDurableBlocks)
  return injectBlankParagraphBlocks(withCallouts)
}

export function hasRichEditorDurableBlocks(blocks: EditorBlocksSnapshot): boolean {
  return hasDurableEditorBlocks(blocks)
}

export function serializeRichEditorBodyToMarkdown(
  editor: RichEditorMarkdownSerializer,
  vaultPath?: string,
): string {
  return serializeRichEditorBlocksToMarkdown({ blocks: editor.document, editor, vaultPath })
}

export function serializeRichEditorBlocksToMarkdown({
  blocks,
  editor,
  notePath,
  vaultPath,
}: RichEditorBlockSerializationOptions): string {
  return serializeRichEditorBodyToMarkdownWithTrace(editor, vaultPath, notePath, blocks)
}

function serializeRichEditorBodyToMarkdownWithTrace(
  editor: DirectMarkdownCapableSerializer,
  vaultPath?: string,
  notePath?: string,
  blocks: EditorBlocksSnapshot = [],
): string {
  const startedAt = now()
  const directEditor = editor as DirectMarkdownCapableSerializer
  delete directEditor.__tolariaLastDirectMarkdownMetrics
  const document = blocks
  const serialized = serializeDurableEditorBlocks(editor, document, vaultPath)
  const body = compactMarkdown(
    restoreBlankBlockquoteParagraphs(serialized),
    { preserveConsecutiveBlankLines: true },
  )
  const metrics = readDirectMarkdownMetrics(directEditor)
  logRichEditorSerializationTrace({
    blockCount: metrics?.blockCount ?? document.length,
    cacheHits: metrics?.cacheHits,
    cacheMisses: metrics?.cacheMisses,
    durationMs: now() - startedAt,
    fallbackReason: metrics?.fallbackReason,
    notePath,
  })
  return body
}

function preProcessEmptyChecklistItems(markdown: MarkdownBody): MarkdownBody {
  return markdown.split(/(\r?\n)/u).map(part => {
    if (part === '\n' || part === '\r\n') return part
    return preProcessEmptyChecklistLine(part)
  }).join('')
}

function preProcessEmptyChecklistLine(line: MarkdownBody): MarkdownBody {
  const match = EMPTY_CHECKLIST_ITEM_LINE_RE.exec(line)
  return match ? `${match[1]} ${EMPTY_CHECKLIST_ITEM_FILLER}` : line
}

function preProcessBlankBlockquoteParagraphs(markdown: MarkdownBody): MarkdownBody {
  const lines = splitMarkdownSourceLines(markdown)
  return lines.map((line, index) => {
    const parsed = parseBlockquoteSourceLine(line.content)
    if (!parsed || parsed.content.trim() !== '') return markdownSourceLineText(line)
    if (!hasQuotedContentNeighbor(lines, index - 1) || !hasQuotedContentNeighbor(lines, index + 1)) {
      return markdownSourceLineText(line)
    }

    const newline = line.newline || '\n'
    const marker = parsed.marker.trimEnd()
    return `${newline}${marker} ${BLANK_PARAGRAPH_PLACEHOLDER}${newline}${newline}`
  }).join('')
}

function hasQuotedContentNeighbor(lines: MarkdownSourceLine[], index: number): boolean {
  const content = lines.at(index)?.content
  if (content === undefined) return false
  const parsed = parseBlockquoteSourceLine(content)
  return parsed !== null && parsed.content.trim() !== ''
}

function restoreBlankBlockquoteParagraphs(markdown: MarkdownBody): MarkdownBody {
  const pendingLines = markdown.split('\n')
  const restored: string[] = []

  while (pendingLines.length > 0) {
    const line = pendingLines.shift() ?? ''
    const parsed = parseBlockquoteSourceLine(line)
    if (!isBlankSerializedBlockquoteGap(parsed, restored.at(-1), pendingLines.at(0))) {
      restored.push(line)
      continue
    }

    restored.pop()
    restored.push(parsed.marker.trimEnd())
    pendingLines.shift()
  }

  return restored.join('\n')
}

function isBlankSerializedBlockquoteGap(
  parsed: ParsedBlockquoteSourceLine | null,
  previous: string | undefined,
  next: string | undefined,
): parsed is ParsedBlockquoteSourceLine {
  if (!parsed) return false
  if (parsed.content.trim() !== '') return false
  if (previous !== '') return false
  return next === ''
}

function parseBlockquoteSourceLine(line: string): ParsedBlockquoteSourceLine | null {
  let cursor = 0
  while (cursor < 3 && isHorizontalWhitespace(line.charAt(cursor))) cursor += 1
  if (line.charAt(cursor) !== '>') return null

  do {
    cursor += 1
    if (isHorizontalWhitespace(line.charAt(cursor))) cursor += 1
  } while (line.charAt(cursor) === '>')

  return { content: line.slice(cursor), marker: line.slice(0, cursor) }
}

function isHorizontalWhitespace(character: string): boolean {
  return character === ' ' || character === '\t'
}

function preProcessBlankParagraphs(markdown: MarkdownBody): MarkdownBody {
  const lines = splitMarkdownSourceLines(markdown)
  if (lines.length === 0) return markdown

  const state: BlankParagraphPreprocessState = {
    fence: null,
    output: [],
    pendingBlanks: [],
    precedingContent: false,
  }

  for (const line of lines) {
    processBlankParagraphSourceLine(state, line)
  }

  flushPendingBlankParagraphsAtEnd(state)
  return state.output.join('')
}

function processBlankParagraphSourceLine(
  state: BlankParagraphPreprocessState,
  line: MarkdownSourceLine,
): void {
  if (state.fence) {
    processFencedBlankParagraphLine(state, line)
    return
  }

  if (isBlankMarkdownSourceLine(line)) {
    state.pendingBlanks.push(line)
    return
  }

  flushPendingBlankParagraphsBeforeContent(state)
  state.output.push(markdownSourceLineText(line))
  state.precedingContent = true
  state.fence = advanceMarkdownFence(line.content, null)
}

function processFencedBlankParagraphLine(
  state: BlankParagraphPreprocessState,
  line: MarkdownSourceLine,
): void {
  state.output.push(markdownSourceLineText(line))
  state.fence = advanceMarkdownFence(line.content, state.fence)
  if (!state.fence) state.precedingContent = true
}

function flushPendingBlankParagraphsBeforeContent(state: BlankParagraphPreprocessState): void {
  if (state.pendingBlanks.length === 0) return
  if (!state.precedingContent || state.pendingBlanks.length === 1) {
    flushPendingBlankParagraphsAtEnd(state)
    return
  }

  const [separator, ...blankParagraphs] = state.pendingBlanks
  state.output.push(markdownSourceLineText(separator))
  for (const blank of blankParagraphs) {
    appendBlankParagraphPlaceholder(state, blank)
  }
  state.pendingBlanks = []
}

function flushPendingBlankParagraphsAtEnd(state: BlankParagraphPreprocessState): void {
  state.output.push(...state.pendingBlanks.map(markdownSourceLineText))
  state.pendingBlanks = []
}

function appendBlankParagraphPlaceholder(
  state: BlankParagraphPreprocessState,
  blank: MarkdownSourceLine,
): void {
  const newline = blank.newline || '\n'
  state.output.push(`${BLANK_PARAGRAPH_PLACEHOLDER}${newline}`)
  state.output.push(newline)
}

function isBlankMarkdownSourceLine(line: MarkdownSourceLine): boolean {
  return line.content.trim() === ''
}

function splitMarkdownSourceLines(markdown: MarkdownBody): MarkdownSourceLine[] {
  const lines: MarkdownSourceLine[] = []
  const lineRe = /([^\r\n]*)(\r\n|\n|$)/gu

  for (;;) {
    const match = lineRe.exec(markdown)
    if (!match) break

    const [rawLine, content = '', newline = ''] = match
    if (rawLine === '' && match.index === markdown.length) break

    lines.push({ content, newline })
    if (newline === '') break
  }

  return lines
}

function markdownSourceLineText(line: MarkdownSourceLine): string {
  return `${line.content}${line.newline}`
}

function injectBlankParagraphBlocks(blocks: EditorBlocksSnapshot): EditorBlocksSnapshot {
  let changed = false
  const nextBlocks = blocks.map(block => {
    const nextBlock = injectBlankParagraphBlock(block)
    if (nextBlock !== block) changed = true
    return nextBlock
  })
  return changed ? nextBlocks : blocks
}

function injectBlankParagraphBlock(block: unknown): unknown {
  if (!isRecord(block)) return block

  const children = Array.isArray(block.children)
    ? injectBlankParagraphBlocks(block.children)
    : undefined
  const childrenChanged = children !== undefined && children !== block.children

  if (isBlankParagraphPlaceholderBlock(block)) {
    return childrenChanged
      ? { ...block, content: [], children }
      : { ...block, content: [] }
  }

  return childrenChanged ? { ...block, children } : block
}

function isBlankParagraphPlaceholderBlock(block: Record<string, unknown>): boolean {
  return (block.type === 'paragraph' || block.type === 'quote')
    && isBlankParagraphPlaceholderContent(block.content)
}

function isBlankParagraphPlaceholderContent(content: unknown): boolean {
  if (!Array.isArray(content) || content.length !== 1) return false

  const [item] = content
  return isRecord(item)
    && item.type === 'text'
    && item.text === BLANK_PARAGRAPH_PLACEHOLDER
}

export function serializeRichEditorDocumentToMarkdown({
  blocks,
  editor,
  notePath,
  tabContent,
  vaultPath,
}: RichEditorDocumentSerializationOptions): string {
  const rawBodyMarkdown = serializeRichEditorBlocksToMarkdown({
    blocks: blocks ?? editor.document,
    editor,
    notePath,
    vaultPath,
  })
  const bodyMarkdown = vaultPath
    ? portableFileAttachmentUrls(
      portableImageUrls(rawBodyMarkdown, vaultPath, notePath),
      vaultPath,
    )
    : rawBodyMarkdown
  const [frontmatter] = splitFrontmatter(tabContent)
  return `${frontmatter}${bodyMarkdown}`
}
