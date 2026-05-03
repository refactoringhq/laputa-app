import type { useCreateBlockNote } from '@blocknote/react'
import { preProcessWikilinks, injectWikilinks } from '../utils/wikilinks'
import { preProcessMathMarkdown, injectMathInBlocks } from '../utils/mathMarkdown'
import { preProcessMermaidMarkdown, injectMermaidInBlocks } from '../utils/mermaidMarkdown'
import { preProcessTldrawMarkdown, injectTldrawInBlocks } from '../utils/tldrawMarkdown'
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

export type { EditorBlocks }

type NotePath = string
type NoteContent = string
type MarkdownBody = string
type PreprocessedMarkdown = string
type VaultPath = string

export type CachedTabState = {
  blocks: EditorBlocks
  scrollTop: number
  sourceContent: NoteContent
}

const TAB_STATE_CACHE_LIMIT = 24

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

function preProcessEditorMarkdown(markdown: MarkdownBody, vaultPath?: VaultPath): PreprocessedMarkdown {
  const withTldraw = preProcessTldrawMarkdown({ markdown })
  const withMermaid = preProcessMermaidMarkdown({ markdown: withTldraw })
  const withImages = vaultPath ? resolveImageUrls(withMermaid, vaultPath) : withMermaid
  const withWikilinks = preProcessWikilinks(withImages)
  return preProcessMathMarkdown({ markdown: withWikilinks })
}

function injectEditorMarkdownBlocks(blocks: EditorBlocks): EditorBlocks {
  const withWikilinks = injectWikilinks(blocks)
  const withMath = injectMathInBlocks(withWikilinks)
  const withMermaid = injectMermaidInBlocks(withMath)
  return injectTldrawInBlocks(withMermaid) as EditorBlocks
}

function repairParsedMarkdownBlocks(parsed: MarkdownParseResult): EditorBlocks {
  const parseSafeBlocks = repairMalformedEditorBlocks(parsed.blocks) as EditorBlocks
  if (parsed.usedSourceFallback) return parseSafeBlocks
  return inferCodeBlockLanguages(
    repairMalformedEditorBlocks(injectEditorMarkdownBlocks(parseSafeBlocks)) as EditorBlocks,
  ) as EditorBlocks
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
  const cached = cache.get(targetPath)
  if (cached?.sourceContent === content) return cached

  const parsedCache = readParsedNoteBlocks({ path: targetPath, content, vaultPath })
  if (parsedCache) {
    return cacheResolvedEditorState(cache, targetPath, {
      blocks: parsedCache.blocks,
      scrollTop: parsedCache.scrollTop,
      sourceContent: content,
    }, vaultPath)
  }

  const body = extractEditorBody(content)
  const preprocessed = preProcessEditorMarkdown(body, vaultPath)
  const fastPathBlocks = buildFastPathBlocks({ preprocessed })
  if (fastPathBlocks) {
    return cacheResolvedEditorState(cache, targetPath, {
      blocks: repairMalformedEditorBlocks(fastPathBlocks) as EditorBlocks,
      scrollTop: 0,
      sourceContent: content,
    }, vaultPath)
  }

  const parsed = await parseMarkdownBlocksWithFallback({
    parseMarkdownBlocks: markdown => parseMarkdownBlocks(editor, markdown),
    preprocessed,
    sourceMarkdown: body,
    context: targetPath,
  })
  return cacheResolvedEditorState(cache, targetPath, {
    blocks: repairParsedMarkdownBlocks(parsed),
    scrollTop: 0,
    sourceContent: content,
  }, vaultPath)
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
    preprocessed: preProcessEditorMarkdown(remainder, vaultPath),
    sourceMarkdown: remainder,
    context: targetPath,
  })
  return [emptyHeadingBlock(), ...repairParsedMarkdownBlocks(parsed)] as EditorBlocks
}
