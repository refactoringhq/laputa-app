import type { useCreateBlockNote } from '@blocknote/react'
import { preProcessWikilinks, injectWikilinks } from '../utils/wikilinks'
import { preProcessMathMarkdown, injectMathInBlocks } from '../utils/mathMarkdown'
import { preProcessSingleTildeStrikethrough } from '../utils/markdownStrikethrough'
import { injectDurableEditorMarkdownBlocks, preProcessDurableEditorMarkdown } from '../utils/editorDurableMarkdown'
import { injectMarkdownHighlightsInBlocks } from '../utils/markdownHighlightMarkdown'
import { resolveImageUrls } from '../utils/vaultImages'
import { repairMalformedEditorBlocks } from './editorBlockRepair'
import { inferCodeBlockLanguages } from '../utils/codeBlockLanguage'
import {
  blankParagraphBlocks,
  extractEditorBody,
} from './editorTabContent'
import {
  parseMarkdownBlocksWithFallback,
  type MarkdownParseResult,
} from './editorMarkdownParseFallback'
import {
  cacheParsedNoteBlocks,
  readParsedNoteBlocks,
  type EditorBlocks,
} from './editorParsedBlockCache'
import { tryParseFastMarkdownBlocksOffThread } from './editorFastMarkdownBlocks'
import { logEditorBlockResolutionTrace } from '../utils/editorPerformanceTrace'

export type { EditorBlocks }

type NotePath = string
type NoteContent = string
type MarkdownBody = string
type PreprocessedMarkdown = string
type VaultPath = string
type BlockResolutionStrategy =
  | 'blank'
  | 'blocknote-parser'
  | 'direct-markdown'
  | 'fast-h1'
  | 'parsed-cache'
  | 'tab-cache'

interface BlockResolutionContext {
  bytes: number
  cache: Map<NotePath, CachedTabState>
  content: NoteContent
  startedAt: number
  targetPath: NotePath
  vaultPath?: VaultPath
}

export type CachedTabState = {
  blocks: EditorBlocks
  scrollTop: number
  sourceContent: NoteContent
}

const TAB_STATE_CACHE_LIMIT = 8
const DIRECT_MARKDOWN_PARSE_MIN_BYTES = 16 * 1024
const EMPTY_CHECKLIST_ITEM_FILLER = '\u200B'
const EMPTY_CHECKLIST_ITEM_LINE_RE = /^([ \t]*[-*+][ \t]+\[[ xX]\])[ \t]*$/u
const sourceSizeEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

function sourceBytes(content: string): number {
  return sourceSizeEncoder ? sourceSizeEncoder.encode(content).byteLength : content.length
}

function traceResolvedBlocks(options: {
  blockCount: number
  durationMs: number
  fallbackReason?: string | null
  path: NotePath
  sourceBytes: number
  strategy: BlockResolutionStrategy
}): void {
  const { blockCount, durationMs, fallbackReason, path, sourceBytes: bytes, strategy } = options
  logEditorBlockResolutionTrace({
    blockCount,
    durationMs,
    fallbackReason,
    notePath: path,
    sourceBytes: bytes,
    strategy,
  })
}

export function cacheEditorState(
  cache: Map<NotePath, CachedTabState>,
  path: NotePath,
  nextState: CachedTabState,
) {
  if (cache.has(path)) cache.delete(path)
  cache.set(path, nextState)
  while (cache.size > TAB_STATE_CACHE_LIMIT) {
    const oldestPath = cache.keys().next().value
    if (!oldestPath) return
    cache.delete(oldestPath)
  }
}

export function cacheParsedEditorState(path: NotePath, nextState: CachedTabState, vaultPath?: VaultPath): void {
  cacheParsedNoteBlocks({
    path,
    blocks: nextState.blocks,
    scrollTop: nextState.scrollTop,
    sourceContent: nextState.sourceContent,
    vaultPath,
  })
}

export function cacheResolvedEditorState(
  cache: Map<NotePath, CachedTabState>,
  path: NotePath,
  nextState: CachedTabState,
  vaultPath?: VaultPath,
): CachedTabState {
  cacheEditorState(cache, path, nextState)
  cacheParsedEditorState(path, nextState, vaultPath)
  return nextState
}

function buildFastPathBlocks(options: { preprocessed: PreprocessedMarkdown }): EditorBlocks | null {
  const { preprocessed } = options
  const trimmed = preprocessed.trim()

  if (!trimmed) return [{ type: 'paragraph', content: [] }]
  if (trimmed === '#') return [emptyHeadingBlock(), { type: 'paragraph', content: [], children: [] }]

  const h1OnlyMatch = trimmed.match(/^# (.+)$/)
  if (!h1OnlyMatch) return null

  return [
    {
      type: 'heading',
      props: { level: 1, textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
      content: [{ type: 'text', text: h1OnlyMatch[1], styles: {} }],
      children: [],
    },
    { type: 'paragraph', content: [], children: [] },
  ]
}

function emptyHeadingBlock(): Record<string, unknown> {
  return {
    type: 'heading',
    props: { level: 1, textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
    content: [],
    children: [],
  }
}

export function isBlankBodyContent(options: { content: NoteContent }): boolean {
  const { content } = options
  return extractEditorBody(content).trim() === ''
}

function extractBodyRemainderAfterEmptyH1(options: { content: NoteContent }): MarkdownBody | null {
  const { content } = options
  const body = extractEditorBody(content)
  const [firstLine, secondLine, ...rest] = body.split('\n')
  if (!firstLine) return null

  const normalizedFirstLine = firstLine.trimEnd()
  if (normalizedFirstLine !== '#' && normalizedFirstLine !== '# ') return null
  return secondLine === '' ? rest.join('\n').trimStart() : [secondLine, ...rest].join('\n').trimStart()
}

export function startsWithEmptyHeading(options: { content: NoteContent }): boolean {
  return extractBodyRemainderAfterEmptyH1(options) !== null
}

async function parseMarkdownBlocks(
  editor: ReturnType<typeof useCreateBlockNote>,
  preprocessed: PreprocessedMarkdown,
): Promise<EditorBlocks> {
  const result = editor.tryParseMarkdownToBlocks(preprocessed)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tryParseMarkdownToBlocks returns sync or async BlockNote blocks
  if (result && typeof (result as any).then === 'function') {
    return (result as unknown as Promise<EditorBlocks>)
  }
  return result as EditorBlocks
}

export function preProcessEditorMarkdown(
  markdown: MarkdownBody,
  vaultPath?: VaultPath,
  notePath?: NotePath,
): PreprocessedMarkdown {
  const withDurableBlocks = preProcessDurableEditorMarkdown({ markdown })
  const withEmptyChecklists = preProcessEmptyChecklistItems(withDurableBlocks)
  const withImages = vaultPath ? resolveImageUrls(withEmptyChecklists, vaultPath, notePath) : withEmptyChecklists
  const withWikilinks = preProcessWikilinks(withImages)
  const withMath = preProcessMathMarkdown({ markdown: withWikilinks })
  return preProcessSingleTildeStrikethrough({ markdown: withMath })
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

function injectEditorMarkdownBlocks(blocks: EditorBlocks): EditorBlocks {
  const withWikilinks = injectWikilinks(blocks)
  const withMath = injectMathInBlocks(withWikilinks)
  const withHighlights = injectMarkdownHighlightsInBlocks(withMath)
  return injectDurableEditorMarkdownBlocks(withHighlights) as EditorBlocks
}

function stripEmptyChecklistFillers(blocks: EditorBlocks): EditorBlocks {
  for (const block of blocks as Array<{ children?: unknown; content?: unknown; type?: string }>) {
    if (block.type === 'checkListItem' && isEmptyChecklistFillerContent(block.content)) {
      block.content = []
    }
    if (Array.isArray(block.children)) {
      stripEmptyChecklistFillers(block.children as EditorBlocks)
    }
  }
  return blocks
}

function isEmptyChecklistFillerContent(content: unknown): boolean {
  if (!Array.isArray(content) || content.length !== 1) return false
  const [item] = content as Array<{ text?: unknown; type?: unknown }>
  return item?.type === 'text' && item.text === EMPTY_CHECKLIST_ITEM_FILLER
}

function repairParsedMarkdownBlocks(parsed: MarkdownParseResult): EditorBlocks {
  const parseSafeBlocks = stripEmptyChecklistFillers(
    repairMalformedEditorBlocks(parsed.blocks) as EditorBlocks,
  )
  if (parsed.usedSourceFallback) return parseSafeBlocks
  return inferCodeBlockLanguages(
    repairMalformedEditorBlocks(injectEditorMarkdownBlocks(parseSafeBlocks)) as EditorBlocks,
  ) as EditorBlocks
}

function traceResolvedState(
  context: BlockResolutionContext,
  resolved: CachedTabState,
  strategy: BlockResolutionStrategy,
  fallbackReason?: string | null,
): CachedTabState {
  traceResolvedBlocks({
    blockCount: resolved.blocks.length,
    durationMs: now() - context.startedAt,
    fallbackReason,
    path: context.targetPath,
    sourceBytes: context.bytes,
    strategy,
  })
  return resolved
}

function cachedTabResolution(context: BlockResolutionContext): CachedTabState | null {
  const cached = context.cache.get(context.targetPath)
  if (cached?.sourceContent !== context.content) return null
  return traceResolvedState(context, cached, 'tab-cache')
}

function parsedCacheResolution(context: BlockResolutionContext): CachedTabState | null {
  const parsedCache = readParsedNoteBlocks({
    path: context.targetPath,
    content: context.content,
    vaultPath: context.vaultPath,
  })
  if (!parsedCache) return null

  const resolved = cacheResolvedEditorState(context.cache, context.targetPath, {
    blocks: parsedCache.blocks,
    scrollTop: parsedCache.scrollTop,
    sourceContent: context.content,
  }, context.vaultPath)
  return traceResolvedState(context, resolved, 'parsed-cache')
}

function fastPathResolution(
  context: BlockResolutionContext,
  body: MarkdownBody,
  preprocessed: PreprocessedMarkdown,
): CachedTabState | null {
  const fastPathBlocks = buildFastPathBlocks({ preprocessed })
  if (!fastPathBlocks) return null

  const resolved = cacheResolvedEditorState(context.cache, context.targetPath, {
    blocks: repairMalformedEditorBlocks(injectEditorMarkdownBlocks(fastPathBlocks)) as EditorBlocks,
    scrollTop: 0,
    sourceContent: context.content,
  }, context.vaultPath)
  return traceResolvedState(context, resolved, body.trim() ? 'fast-h1' : 'blank')
}

async function directMarkdownResolution(
  context: BlockResolutionContext,
  preprocessed: PreprocessedMarkdown,
): Promise<{ fallbackReason: string | null; resolved: CachedTabState | null }> {
  if (context.bytes < DIRECT_MARKDOWN_PARSE_MIN_BYTES) return { fallbackReason: null, resolved: null }

  const direct = await tryParseFastMarkdownBlocksOffThread(preprocessed)
  if (!direct.supported) return { fallbackReason: direct.metrics.fallbackReason, resolved: null }

  const resolved = cacheResolvedEditorState(context.cache, context.targetPath, {
    blocks: repairParsedMarkdownBlocks({ blocks: direct.blocks, usedSourceFallback: false }),
    scrollTop: 0,
    sourceContent: context.content,
  }, context.vaultPath)
  return { fallbackReason: null, resolved: traceResolvedState(context, resolved, 'direct-markdown') }
}

async function blockNoteParserResolution(options: {
  body: MarkdownBody
  context: BlockResolutionContext
  directFallbackReason: string | null
  editor: ReturnType<typeof useCreateBlockNote>
  preprocessed: PreprocessedMarkdown
}): Promise<CachedTabState> {
  const { body, context, directFallbackReason, editor, preprocessed } = options
  const parsed = await parseMarkdownBlocksWithFallback({
    parseMarkdownBlocks: markdown => parseMarkdownBlocks(editor, markdown),
    preprocessed,
    sourceMarkdown: body,
    context: context.targetPath,
  })
  const resolved = cacheResolvedEditorState(context.cache, context.targetPath, {
    blocks: repairParsedMarkdownBlocks(parsed),
    scrollTop: 0,
    sourceContent: context.content,
  }, context.vaultPath)
  return traceResolvedState(context, resolved, 'blocknote-parser', directFallbackReason)
}

export async function resolveBlocksForTarget(
  options: {
    editor: ReturnType<typeof useCreateBlockNote>
    cache: Map<NotePath, CachedTabState>
    targetPath: NotePath
    content: NoteContent
    vaultPath?: VaultPath
  },
): Promise<CachedTabState> {
  const { editor, cache, targetPath, content, vaultPath } = options
  const context = { bytes: sourceBytes(content), cache, content, startedAt: now(), targetPath, vaultPath }
  const cached = cachedTabResolution(context) ?? parsedCacheResolution(context)
  if (cached) return cached

  const body = extractEditorBody(content)
  const preprocessed = preProcessEditorMarkdown(body, vaultPath, targetPath)
  const fastPath = fastPathResolution(context, body, preprocessed)
  if (fastPath) return fastPath

  const direct = await directMarkdownResolution(context, preprocessed)
  if (direct.resolved) return direct.resolved

  return blockNoteParserResolution({
    body,
    context,
    directFallbackReason: direct.fallbackReason,
    editor,
    preprocessed,
  })
}

export async function resolveEmptyHeadingBlocks(
  editor: ReturnType<typeof useCreateBlockNote>,
  content: NoteContent,
  vaultPath?: VaultPath,
  targetPath: NotePath = 'empty heading note',
): Promise<EditorBlocks | null> {
  const remainder = extractBodyRemainderAfterEmptyH1({ content })
  if (remainder === null) return null
  if (!remainder.trim()) return [emptyHeadingBlock(), ...blankParagraphBlocks()] as EditorBlocks

  const parsed = await parseMarkdownBlocksWithFallback({
    parseMarkdownBlocks: markdown => parseMarkdownBlocks(editor, markdown),
    preprocessed: preProcessEditorMarkdown(remainder, vaultPath, targetPath),
    sourceMarkdown: remainder,
    context: targetPath,
  })
  return [emptyHeadingBlock(), ...repairParsedMarkdownBlocks(parsed)] as EditorBlocks
}
