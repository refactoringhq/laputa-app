import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { useCreateBlockNote } from '@blocknote/react'
import type { VaultEntry } from '../types'
import { splitFrontmatter, preProcessWikilinks, injectWikilinks, restoreWikilinksInBlocks } from '../utils/wikilinks'
import { compactMarkdown } from '../utils/compact-markdown'
import { injectMathInBlocks, preProcessMathMarkdown } from '../utils/mathMarkdown'
import { injectMermaidInBlocks, preProcessMermaidMarkdown, serializeMermaidAwareBlocks } from '../utils/mermaidMarkdown'
import { failNoteOpenTrace, finishNoteOpenTrace } from '../utils/noteOpenPerformance'
import { resolveImageUrls, portableImageUrls } from '../utils/vaultImages'
import { repairMalformedEditorBlocks } from './editorBlockRepair'
import {
  extractEditorBody,
  getH1TextFromBlocks,
  isUntitledPath,
  normalizeParsedImageBlocks,
  pathStem,
  slugifyPathStem,
} from './editorTabContent'
import { clearEditorDomSelection, EDITOR_CONTAINER_SELECTOR } from './editorDomSelection'
export { extractEditorBody, getH1TextFromBlocks, replaceTitleInFrontmatter } from './editorTabContent'

interface Tab {
  entry: VaultEntry
  content: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- BlockNote block arrays
type EditorBlocks = any[]
type CachedTabState = { blocks: EditorBlocks; scrollTop: number; sourceContent: string }
type PendingLocalContent = { path: string; content: string }
const TAB_STATE_CACHE_LIMIT = 24

interface TabSwapState {
  cache: Map<string, CachedTabState>
  prevPath: string | null
  pathChanged: boolean
  activeTab: Tab | undefined
  previousTab: Tab | undefined
  rawModeJustEnded: boolean
}

interface UseEditorTabSwapOptions {
  tabs: Tab[]
  activeTabPath: string | null
  editor: ReturnType<typeof useCreateBlockNote>
  onContentChange?: (path: string, content: string) => void
  /** When true, the BlockNote editor is hidden (raw/CodeMirror mode active). */
  rawMode?: boolean
  vaultPath?: string
}

function signalEditorTabSwapped(path: string): void {
  window.dispatchEvent(new CustomEvent('laputa:editor-tab-swapped', {
    detail: { path },
  }))
  finishNoteOpenTrace(path)
}

function readEditorScrollTop(): number {
  const scrollEl = document.querySelector(EDITOR_CONTAINER_SELECTOR)
  return scrollEl?.scrollTop ?? 0
}

function cacheEditorState(
  cache: Map<string, CachedTabState>,
  path: string,
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

function buildFastPathBlocks(options: { preprocessed: string }): EditorBlocks | null {
  const { preprocessed } = options
  const trimmed = preprocessed.trim()

  if (!trimmed) {
    return [{ type: 'paragraph', content: [] }]
  }

  if (trimmed === '#') {
    return [
      { type: 'heading', props: { level: 1, textColor: 'default', backgroundColor: 'default', textAlignment: 'left' }, content: [], children: [] },
      { type: 'paragraph', content: [], children: [] },
    ]
  }

  const h1OnlyMatch = trimmed.match(/^# (.+)$/)
  if (!h1OnlyMatch) return null

  return [
    { type: 'heading', props: { level: 1, textColor: 'default', backgroundColor: 'default', textAlignment: 'left' }, content: [{ type: 'text', text: h1OnlyMatch[1], styles: {} }], children: [] },
    { type: 'paragraph', content: [], children: [] },
  ]
}

function isBlankBodyContent(options: { content: string }): boolean {
  const { content } = options
  return extractEditorBody(content).trim() === ''
}

function extractBodyRemainderAfterEmptyH1(options: { content: string }): string | null {
  const { content } = options
  const body = extractEditorBody(content)
  const [firstLine, secondLine, ...rest] = body.split('\n')
  if (!firstLine) return null

  const normalizedFirstLine = firstLine.trimEnd()
  if (normalizedFirstLine !== '#' && normalizedFirstLine !== '# ') return null

  if (secondLine === '') {
    return rest.join('\n').trimStart()
  }

  return [secondLine, ...rest].join('\n').trimStart()
}

function blankParagraphBlocks(): EditorBlocks {
  return [{ type: 'paragraph', content: [], children: [] }]
}

async function parseMarkdownBlocks(
  editor: ReturnType<typeof useCreateBlockNote>,
  preprocessed: string,
): Promise<EditorBlocks> {
  const result = editor.tryParseMarkdownToBlocks(preprocessed)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tryParseMarkdownToBlocks returns sync or async BlockNote blocks
  if (result && typeof (result as any).then === 'function') {
    return (result as unknown as Promise<EditorBlocks>)
  }
  return result as EditorBlocks
}

function preProcessEditorMarkdown(markdown: string, vaultPath?: string): string {
  const withMermaid = preProcessMermaidMarkdown({ markdown })
  const withImages = vaultPath ? resolveImageUrls(withMermaid, vaultPath) : withMermaid
  const withWikilinks = preProcessWikilinks(withImages)
  return preProcessMathMarkdown({ markdown: withWikilinks })
}

function injectEditorMarkdownBlocks(blocks: EditorBlocks): EditorBlocks {
  const withWikilinks = injectWikilinks(blocks)
  const withMath = injectMathInBlocks(withWikilinks)
  return injectMermaidInBlocks(withMath) as EditorBlocks
}

async function resolveBlocksForTarget(
  options: {
    editor: ReturnType<typeof useCreateBlockNote>
    cache: Map<string, CachedTabState>
    targetPath: string
    content: string
    vaultPath?: string
  },
): Promise<CachedTabState> {
  const { editor, cache, targetPath, content, vaultPath } = options
  const cached = cache.get(targetPath)
  if (cached?.sourceContent === content) return cached

  const body = extractEditorBody(content)
  const preprocessed = preProcessEditorMarkdown(body, vaultPath)
  const fastPathBlocks = buildFastPathBlocks({ preprocessed })
  if (fastPathBlocks) {
    const nextState = {
      blocks: repairMalformedEditorBlocks(fastPathBlocks) as EditorBlocks,
      scrollTop: 0,
      sourceContent: content,
    }
    cacheEditorState(cache, targetPath, nextState)
    return nextState
  }

  const parsed = normalizeParsedImageBlocks(await parseMarkdownBlocks(editor, preprocessed)) as EditorBlocks
  const nextState = {
    blocks: repairMalformedEditorBlocks(injectEditorMarkdownBlocks(parsed)) as EditorBlocks,
    scrollTop: 0,
    sourceContent: content,
  }
  cacheEditorState(cache, targetPath, nextState)
  return nextState
}

function applyBlocksToEditor(
  editor: ReturnType<typeof useCreateBlockNote>,
  blocks: EditorBlocks,
  scrollTop: number,
  suppressChangeRef: MutableRefObject<boolean>,
) {
  const safeBlocks = repairMalformedEditorBlocks(blocks) as EditorBlocks
  suppressChangeRef.current = true
  try {
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
    queueMicrotask(() => { suppressChangeRef.current = false })
  }

  requestAnimationFrame(() => {
    const scrollEl = document.querySelector(EDITOR_CONTAINER_SELECTOR)
    if (scrollEl) scrollEl.scrollTop = scrollTop
  })
}

function applyBlankStateToEditor(
  editor: ReturnType<typeof useCreateBlockNote>,
  suppressChangeRef: MutableRefObject<boolean>,
) {
  suppressChangeRef.current = true
  try {
    editor._tiptapEditor.commands.setContent('<p></p>')
  } catch (err) {
    console.error('applyBlankStateToEditor failed, falling back to replaceBlocks:', err)
    applyBlocksToEditor(editor, blankParagraphBlocks(), 0, suppressChangeRef)
    return
  }

  queueMicrotask(() => { suppressChangeRef.current = false })
  requestAnimationFrame(() => {
    const scrollEl = document.querySelector(EDITOR_CONTAINER_SELECTOR)
    if (scrollEl) scrollEl.scrollTop = 0
  })
}

function applyHtmlStateToEditor(
  editor: ReturnType<typeof useCreateBlockNote>,
  html: string,
  suppressChangeRef: MutableRefObject<boolean>,
) {
  suppressChangeRef.current = true
  try {
    editor._tiptapEditor.commands.setContent(html)
  } catch (err) {
    console.error('applyHtmlStateToEditor failed:', err)
    suppressChangeRef.current = false
    throw err
  }

  queueMicrotask(() => { suppressChangeRef.current = false })
  requestAnimationFrame(() => {
    const scrollEl = document.querySelector(EDITOR_CONTAINER_SELECTOR)
    if (scrollEl) scrollEl.scrollTop = 0
  })
}

async function resolveEmptyHeadingHtml(
  editor: ReturnType<typeof useCreateBlockNote>,
  content: string,
  vaultPath?: string,
): Promise<string | null> {
  const remainder = extractBodyRemainderAfterEmptyH1({ content })
  if (remainder === null) return null
  if (!remainder.trim()) return '<h1></h1><p></p>'

  const parsed = normalizeParsedImageBlocks(
    await parseMarkdownBlocks(editor, preProcessEditorMarkdown(remainder, vaultPath)),
  ) as EditorBlocks
  return `<h1></h1>${editor.blocksToHTMLLossy(injectEditorMarkdownBlocks(parsed) as typeof parsed)}`
}

function findActiveTab(options: {
  tabs: Tab[]
  activeTabPath: string | null
}): Tab | undefined {
  const { tabs, activeTabPath } = options
  return activeTabPath
    ? tabs.find(tab => tab.entry.path === activeTabPath)
    : undefined
}

function serializeEditorBody(editor: ReturnType<typeof useCreateBlockNote>): string {
  const restored = restoreWikilinksInBlocks(editor.document)
  return compactMarkdown(serializeMermaidAwareBlocks(editor, restored))
}

function normalizeTabBody(options: { content: string }): string {
  const { content } = options
  return compactMarkdown(extractEditorBody(content))
}

function renameBodiesOverlap(options: {
  currentBody: string
  nextBody: string
}): boolean {
  const { currentBody, nextBody } = options
  const current = currentBody.trimEnd()
  const next = nextBody.trimEnd()
  return current === next
    || current.startsWith(next)
    || next.startsWith(current)
}

function isUntitledRenameTransition(
  prevPath: string | null,
  nextPath: string | null,
  activeTab: Tab | undefined,
  editor: ReturnType<typeof useCreateBlockNote>,
): boolean {
  if (!prevPath || !nextPath || !activeTab || !isUntitledPath(prevPath)) return false

  const currentHeading = getH1TextFromBlocks(editor.document)
  if (!currentHeading || slugifyPathStem(currentHeading) !== pathStem(nextPath)) return false

  return renameBodiesOverlap({
    currentBody: serializeEditorBody(editor),
    nextBody: normalizeTabBody({ content: activeTab.content }),
  })
}

function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}

function useEditorMountState(
  editor: ReturnType<typeof useCreateBlockNote>,
  editorMountedRef: MutableRefObject<boolean>,
  pendingSwapRef: MutableRefObject<(() => void) | null>,
) {
  useEffect(() => {
    if (editor.prosemirrorView) {
      editorMountedRef.current = true
    }
    const cleanup = editor.onMount(() => {
      editorMountedRef.current = true
      if (pendingSwapRef.current) {
        const swap = pendingSwapRef.current
        pendingSwapRef.current = null
        queueMicrotask(swap)
      }
    })
    return cleanup
  }, [editor, editorMountedRef, pendingSwapRef])
}

function useEditorChangeHandler(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  tabsRef: MutableRefObject<Tab[]>
  onContentChangeRef: MutableRefObject<((path: string, content: string) => void) | undefined>
  prevActivePathRef: MutableRefObject<string | null>
  suppressChangeRef: MutableRefObject<boolean>
  tabCacheRef: MutableRefObject<Map<string, CachedTabState>>
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
  vaultPathRef: MutableRefObject<string | undefined>
}) {
  const {
    editor,
    tabsRef,
    onContentChangeRef,
    prevActivePathRef,
    suppressChangeRef,
    tabCacheRef,
    pendingLocalContentRef,
    vaultPathRef,
  } = options

  return useCallback(() => {
    if (suppressChangeRef.current) return
    const path = prevActivePathRef.current
    if (!path) return

    const tab = tabsRef.current.find(t => t.entry.path === path)
    if (!tab) return

    const blocks = editor.document
    const rawBodyMarkdown = serializeEditorBody(editor)
    const bodyMarkdown = vaultPathRef.current
      ? portableImageUrls(rawBodyMarkdown, vaultPathRef.current)
      : rawBodyMarkdown
    const [frontmatter] = splitFrontmatter(tab.content)
    const nextContent = `${frontmatter}${bodyMarkdown}`
    pendingLocalContentRef.current = { path, content: nextContent }
    cacheEditorState(tabCacheRef.current, path, {
      blocks,
      scrollTop: readEditorScrollTop(),
      sourceContent: nextContent,
    })
    onContentChangeRef.current?.(path, nextContent)
  }, [editor, onContentChangeRef, pendingLocalContentRef, prevActivePathRef, suppressChangeRef, tabCacheRef, tabsRef, vaultPathRef])
}

function consumeRawModeTransition(
  prevRawModeRef: MutableRefObject<boolean>,
  rawMode: boolean | undefined,
) {
  const rawModeJustEnded = prevRawModeRef.current && !rawMode
  prevRawModeRef.current = !!rawMode
  return rawModeJustEnded
}

function cachePreviousTabOnPathChange(options: {
  prevPath: string | null
  previousTab: Tab | undefined
  pathChanged: boolean
  editorMountedRef: MutableRefObject<boolean>
  cache: Map<string, CachedTabState>
  editor: ReturnType<typeof useCreateBlockNote>
}) {
  const { prevPath, previousTab, pathChanged, editorMountedRef, cache, editor } = options
  if (!prevPath || !previousTab || !pathChanged || !editorMountedRef.current) return
  cacheEditorState(cache, prevPath, {
    blocks: editor.document,
    scrollTop: readEditorScrollTop(),
    sourceContent: previousTab.content,
  })
}

function shouldWaitForActiveTab(options: {
  pathChanged: boolean
  activeTabPath: string | null
  activeTab: Tab | undefined
}) {
  const { pathChanged, activeTabPath, activeTab } = options
  return pathChanged && !!activeTabPath && !activeTab
}

function syncActivePathTransition(options: {
  prevPath: string | null
  pathChanged: boolean
  activeTabPath: string | null
  activeTab: Tab | undefined
  previousTab: Tab | undefined
  cache: Map<string, CachedTabState>
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  prevActivePathRef: MutableRefObject<string | null>
}) {
  const {
    prevPath,
    pathChanged,
    activeTabPath,
    activeTab,
    previousTab,
    cache,
    editor,
    editorMountedRef,
    prevActivePathRef,
  } = options

  cachePreviousTabOnPathChange({
    prevPath,
    previousTab,
    pathChanged,
    editorMountedRef,
    cache,
    editor,
  })
  if (shouldWaitForActiveTab({ pathChanged, activeTabPath, activeTab })) return true

  if (!preserveUntitledRenameState({
    prevPath,
    activeTabPath,
    activeTab,
    cache,
    editor,
    editorMountedRef,
  })) {
    prevActivePathRef.current = activeTabPath
    return false
  }

  prevActivePathRef.current = activeTabPath
  return true
}

function markRawModeReswapPending(options: {
  activeTabPath: string | null
  cache: Map<string, CachedTabState>
  rawSwapPendingRef: MutableRefObject<boolean>
}) {
  const { activeTabPath, cache, rawSwapPendingRef } = options
  if (!activeTabPath) return false
  cache.delete(activeTabPath)
  rawSwapPendingRef.current = true
  return true
}

function currentEditorMatchesActiveTab(options: {
  activeTabPath: string | null
  activeTab: Tab | undefined
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
}) {
  const {
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
  } = options

  return Boolean(
    activeTabPath
      && activeTab
      && editorMountedRef.current
      && typeof editor.blocksToMarkdownLossy === 'function'
      && serializeEditorBody(editor) === normalizeTabBody({ content: activeTab.content }),
  )
}

function cacheStableActiveTabAndClearPending(options: {
  cache: Map<string, CachedTabState>
  activeTabPath: string | null
  activeTab: Tab | undefined
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
}) {
  const {
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    pendingLocalContentRef,
  } = options

  cacheStableActivePath({
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
  })
  pendingLocalContentRef.current = null
  return true
}

function shouldKeepPendingLocalContent(options: {
  activeTabPath: string | null
  activeTab: Tab | undefined
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
}) {
  const {
    activeTabPath,
    activeTab,
    pendingLocalContentRef,
  } = options

  const pendingLocalContent = pendingLocalContentRef.current
  if (!activeTabPath || !activeTab || pendingLocalContent?.path !== activeTabPath) return false
  return true
}

function consumePendingLocalContent(options: {
  cache: Map<string, CachedTabState>
  activeTabPath: string | null
  activeTab: Tab | undefined
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
}) {
  const {
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    pendingLocalContentRef,
  } = options

  const pendingLocalContent = pendingLocalContentRef.current
  if (!pendingLocalContent || pendingLocalContent.content !== activeTab?.content) return true
  return cacheStableActiveTabAndClearPending({
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    pendingLocalContentRef,
  })
}

function handleStableActivePath(options: {
  pathChanged: boolean
  rawModeJustEnded: boolean
  activeTabPath: string | null
  activeTab: Tab | undefined
  cache: Map<string, CachedTabState>
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  rawSwapPendingRef: MutableRefObject<boolean>
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
}) {
  const {
    pathChanged,
    rawModeJustEnded,
    activeTabPath,
    activeTab,
    cache,
    editor,
    editorMountedRef,
    rawSwapPendingRef,
    pendingLocalContentRef,
  } = options

  if (pathChanged) return false
  if (rawModeJustEnded) {
    return !markRawModeReswapPending({ activeTabPath, cache, rawSwapPendingRef })
  }
  if (currentEditorMatchesActiveTab({ activeTabPath, activeTab, editor, editorMountedRef })) {
    return cacheStableActiveTabAndClearPending({
      cache,
      activeTabPath,
      activeTab,
      editor,
      editorMountedRef,
      pendingLocalContentRef,
    })
  }
  if (shouldKeepPendingLocalContent({ activeTabPath, activeTab, pendingLocalContentRef })) {
    return consumePendingLocalContent({
      cache,
      activeTabPath,
      activeTab,
      editor,
      editorMountedRef,
      pendingLocalContentRef,
    })
  }
  if (shouldRefreshStableActivePath({ activeTabPath, activeTab, cache })) return false
  if (rawSwapPendingRef.current) return true

  cacheStableActivePath({
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
  })
  return true
}

function shouldRefreshStableActivePath(options: {
  activeTabPath: string | null
  activeTab: Tab | undefined
  cache: Map<string, CachedTabState>
}): boolean {
  const {
    activeTabPath,
    activeTab,
    cache,
  } = options

  if (!activeTabPath || !activeTab) return false
  const cachedState = cache.get(activeTabPath)
  return !cachedState || cachedState.sourceContent !== activeTab.content
}

function cacheStableActivePath(options: {
  cache: Map<string, CachedTabState>
  activeTabPath: string | null
  activeTab: Tab | undefined
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
}) {
  const {
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
  } = options

  if (!activeTabPath || !activeTab || !editorMountedRef.current) return
  cacheEditorState(cache, activeTabPath, {
    blocks: editor.document,
    scrollTop: readEditorScrollTop(),
    sourceContent: activeTab.content,
  })
}

function preserveUntitledRenameState(options: {
  prevPath: string | null
  activeTabPath: string | null
  activeTab: Tab | undefined
  cache: Map<string, CachedTabState>
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
}) {
  const {
    prevPath,
    activeTabPath,
    activeTab,
    cache,
    editor,
    editorMountedRef,
  } = options

  if (!prevPath || !activeTabPath) return false
  if (!isUntitledRenameTransition(prevPath, activeTabPath, activeTab, editor)) return false

  cache.delete(prevPath)
  cacheStableActivePath({
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
  })
  requestAnimationFrame(() => signalEditorTabSwapped(activeTabPath))
  return true
}

function signalTabSwap(options: { path: string }) {
  const { path } = options
  requestAnimationFrame(() => signalEditorTabSwapped(path))
}

function clearStaleSwap(options: {
  targetPath: string
  prevActivePathRef: MutableRefObject<string | null>,
  suppressChangeRef: MutableRefObject<boolean>,
}): boolean {
  const {
    targetPath,
    prevActivePathRef,
    suppressChangeRef,
  } = options
  if (prevActivePathRef.current === targetPath) return false
  suppressChangeRef.current = false
  return true
}

function applyBlankTabState(options: {
  cache: Map<string, CachedTabState>
  targetPath: string
  content: string
  editor: ReturnType<typeof useCreateBlockNote>
  suppressChangeRef: MutableRefObject<boolean>
}) {
  const {
    cache,
    targetPath,
    content,
    editor,
    suppressChangeRef,
  } = options

  cacheEditorState(cache, targetPath, {
    blocks: blankParagraphBlocks(),
    scrollTop: 0,
    sourceContent: content,
  })
  applyBlankStateToEditor(editor, suppressChangeRef)
  signalTabSwap({ path: targetPath })
}

function scheduleEmptyHeadingSwap(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  targetPath: string
  content: string
  prevActivePathRef: MutableRefObject<string | null>
  suppressChangeRef: MutableRefObject<boolean>
  vaultPath?: string
}) {
  const {
    editor,
    targetPath,
    content,
    prevActivePathRef,
    suppressChangeRef,
    vaultPath,
  } = options

  if (extractBodyRemainderAfterEmptyH1({ content }) === null) return false

  void resolveEmptyHeadingHtml(editor, content, vaultPath)
    .then((html) => {
      if (prevActivePathRef.current !== targetPath || !html) return
      applyHtmlStateToEditor(editor, html, suppressChangeRef)
      signalTabSwap({ path: targetPath })
    })
    .catch((err: unknown) => {
      suppressChangeRef.current = false
      console.error('Failed to render empty heading state:', err)
      failNoteOpenTrace(targetPath, 'empty-heading-swap-failed')
    })

  return true
}

function scheduleParsedBlockSwap(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  cache: Map<string, CachedTabState>
  targetPath: string
  content: string
  prevActivePathRef: MutableRefObject<string | null>
  suppressChangeRef: MutableRefObject<boolean>
  vaultPath?: string
}) {
  const {
    editor,
    cache,
    targetPath,
    content,
    prevActivePathRef,
    suppressChangeRef,
    vaultPath,
  } = options

  void resolveBlocksForTarget({ editor, cache, targetPath, content, vaultPath })
    .then(({ blocks, scrollTop }) => {
      if (prevActivePathRef.current !== targetPath) return
      applyBlocksToEditor(editor, blocks, scrollTop, suppressChangeRef)
      signalTabSwap({ path: targetPath })
    })
    .catch((err: unknown) => {
      suppressChangeRef.current = false
      console.error('Failed to parse/swap editor content:', err)
      failNoteOpenTrace(targetPath, 'parsed-swap-failed')
    })
}

function scheduleTabSwap(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  cache: Map<string, CachedTabState>
  targetPath: string
  activeTab: Tab
  clearDomSelection: boolean
  pendingSwapRef: MutableRefObject<(() => void) | null>
  prevActivePathRef: MutableRefObject<string | null>
  rawSwapPendingRef: MutableRefObject<boolean>
  suppressChangeRef: MutableRefObject<boolean>
  vaultPath?: string
}) {
  const {
    editor,
    cache,
    targetPath,
    activeTab,
    clearDomSelection,
    pendingSwapRef,
    prevActivePathRef,
    rawSwapPendingRef,
    suppressChangeRef,
    vaultPath,
  } = options

  suppressChangeRef.current = true

  const doSwap = () => {
    if (clearStaleSwap({ targetPath, prevActivePathRef, suppressChangeRef })) return
    rawSwapPendingRef.current = false
    if (clearDomSelection) clearEditorDomSelection()

    if (isBlankBodyContent({ content: activeTab.content })) {
      applyBlankTabState({
        cache,
        targetPath,
        content: activeTab.content,
        editor,
        suppressChangeRef,
      })
      return
    }

    if (scheduleEmptyHeadingSwap({
      editor,
      targetPath,
      content: activeTab.content,
      prevActivePathRef,
      suppressChangeRef,
      vaultPath,
    })) {
      return
    }

    scheduleParsedBlockSwap({
      editor,
      cache,
      targetPath,
      content: activeTab.content,
      prevActivePathRef,
      suppressChangeRef,
      vaultPath,
    })
  }

  if (editor.prosemirrorView) {
    queueMicrotask(doSwap)
    return
  }
  pendingSwapRef.current = doSwap
}

function resolveTabSwapState(options: {
  tabs: Tab[]
  activeTabPath: string | null
  tabCacheRef: MutableRefObject<Map<string, CachedTabState>>
  prevActivePathRef: MutableRefObject<string | null>
  rawModeJustEnded: boolean
}): TabSwapState {
  const {
    tabs,
    activeTabPath,
    tabCacheRef,
    prevActivePathRef,
    rawModeJustEnded,
  } = options

  const prevPath = prevActivePathRef.current
  return {
    cache: tabCacheRef.current,
    prevPath,
    pathChanged: prevPath !== activeTabPath,
    activeTab: findActiveTab({ tabs, activeTabPath }),
    previousTab: findActiveTab({ tabs, activeTabPath: prevPath }),
    rawModeJustEnded,
  }
}

function shouldSkipScheduledTabSwap(options: {
  state: TabSwapState
  activeTabPath: string | null
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  prevActivePathRef: MutableRefObject<string | null>
  rawSwapPendingRef: MutableRefObject<boolean>
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
}) {
  const {
    state,
    activeTabPath,
    editor,
    editorMountedRef,
    prevActivePathRef,
    rawSwapPendingRef,
    pendingLocalContentRef,
  } = options

  if (state.pathChanged) {
    pendingLocalContentRef.current = null
  }

  if (syncActivePathTransition({
    prevPath: state.prevPath,
    pathChanged: state.pathChanged,
    activeTabPath,
    activeTab: state.activeTab,
    previousTab: state.previousTab,
    cache: state.cache,
    editor,
    editorMountedRef,
    prevActivePathRef,
  })) {
    return true
  }

  return handleStableActivePath({
    pathChanged: state.pathChanged,
    rawModeJustEnded: state.rawModeJustEnded,
    activeTabPath,
    activeTab: state.activeTab,
    cache: state.cache,
    editor,
    editorMountedRef,
    rawSwapPendingRef,
    pendingLocalContentRef,
  })
}

function runTabSwapEffect(options: {
  tabs: Tab[]
  activeTabPath: string | null
  editor: ReturnType<typeof useCreateBlockNote>
  rawMode?: boolean
  tabCacheRef: MutableRefObject<Map<string, CachedTabState>>
  prevActivePathRef: MutableRefObject<string | null>
  editorMountedRef: MutableRefObject<boolean>
  pendingSwapRef: MutableRefObject<(() => void) | null>
  prevRawModeRef: MutableRefObject<boolean>
  rawSwapPendingRef: MutableRefObject<boolean>
  suppressChangeRef: MutableRefObject<boolean>
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
  vaultPath?: string
}) {
  const {
    tabs,
    activeTabPath,
    editor,
    rawMode,
    tabCacheRef,
    prevActivePathRef,
    editorMountedRef,
    pendingSwapRef,
    prevRawModeRef,
    rawSwapPendingRef,
    suppressChangeRef,
    pendingLocalContentRef,
    vaultPath,
  } = options

  const rawModeJustEnded = consumeRawModeTransition(prevRawModeRef, rawMode)
  if (rawMode) return
  const state = resolveTabSwapState({
    tabs,
    activeTabPath,
    tabCacheRef,
    prevActivePathRef,
    rawModeJustEnded,
  })

  if (shouldSkipScheduledTabSwap({
    state,
    activeTabPath,
    editor,
    editorMountedRef,
    prevActivePathRef,
    rawSwapPendingRef,
    pendingLocalContentRef,
  })) {
    return
  }

  if (!activeTabPath || !state.activeTab) return

  scheduleTabSwap({
    editor,
    cache: state.cache,
    targetPath: activeTabPath,
    activeTab: state.activeTab,
    clearDomSelection: state.pathChanged,
    pendingSwapRef,
    prevActivePathRef,
    rawSwapPendingRef,
    suppressChangeRef,
    vaultPath,
  })
}

function useTabSwapEffect(options: {
  tabs: Tab[]
  activeTabPath: string | null
  editor: ReturnType<typeof useCreateBlockNote>
  rawMode?: boolean
  tabCacheRef: MutableRefObject<Map<string, CachedTabState>>
  prevActivePathRef: MutableRefObject<string | null>
  editorMountedRef: MutableRefObject<boolean>
  pendingSwapRef: MutableRefObject<(() => void) | null>
  prevRawModeRef: MutableRefObject<boolean>
  rawSwapPendingRef: MutableRefObject<boolean>
  suppressChangeRef: MutableRefObject<boolean>
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
  vaultPathRef: MutableRefObject<string | undefined>
}) {
  const {
    tabs,
    activeTabPath,
    editor,
    rawMode,
    tabCacheRef,
    prevActivePathRef,
    editorMountedRef,
    pendingSwapRef,
    prevRawModeRef,
    rawSwapPendingRef,
    suppressChangeRef,
    pendingLocalContentRef,
    vaultPathRef,
  } = options

  useEffect(() => {
    runTabSwapEffect({
      tabs,
      activeTabPath,
      editor,
      rawMode,
      tabCacheRef,
      editorMountedRef,
      prevActivePathRef,
      pendingSwapRef,
      prevRawModeRef,
      rawSwapPendingRef,
      suppressChangeRef,
      pendingLocalContentRef,
      vaultPath: vaultPathRef.current,
    })
  }, [
    activeTabPath,
    editor,
    editorMountedRef,
    pendingSwapRef,
    prevActivePathRef,
    prevRawModeRef,
    rawMode,
    rawSwapPendingRef,
    suppressChangeRef,
    tabCacheRef,
    tabs,
    pendingLocalContentRef,
    vaultPathRef,
  ])
}

/**
 * Manages the tab content-swap machinery for the BlockNote editor.
 *
 * Owns all refs and effects related to:
 * - Tracking editor mount state (editorMountedRef, pendingSwapRef)
 * - Swapping document content when the active tab changes (with caching)
 * - Cleaning up the block cache when tabs are closed
 * - Serializing editor blocks → markdown on change (suppressChangeRef)
 *
 * Returns `handleEditorChange`, the onChange callback for SingleEditorView.
 */
export function useEditorTabSwap({ tabs, activeTabPath, editor, onContentChange, rawMode, vaultPath }: UseEditorTabSwapOptions) {
  const tabCacheRef = useRef<Map<string, CachedTabState>>(new Map())
  const pendingLocalContentRef = useRef<PendingLocalContent | null>(null)
  const prevActivePathRef = useRef<string | null>(null)
  const editorMountedRef = useRef(false)
  const pendingSwapRef = useRef<(() => void) | null>(null)
  const prevRawModeRef = useRef(!!rawMode)
  const rawSwapPendingRef = useRef(false)
  const suppressChangeRef = useRef(false)
  const onContentChangeRef = useLatestRef(onContentChange)
  const tabsRef = useLatestRef(tabs)
  const vaultPathRef = useLatestRef(vaultPath)
  const handleEditorChange = useEditorChangeHandler({
    editor,
    tabsRef,
    onContentChangeRef,
    prevActivePathRef,
    suppressChangeRef,
    tabCacheRef,
    pendingLocalContentRef,
    vaultPathRef,
  })

  useEditorMountState(editor, editorMountedRef, pendingSwapRef)
  useTabSwapEffect({
    tabs,
    activeTabPath,
    editor,
    rawMode,
    tabCacheRef,
    prevActivePathRef,
    editorMountedRef,
    pendingSwapRef,
    prevRawModeRef,
    rawSwapPendingRef,
    suppressChangeRef,
    pendingLocalContentRef,
    vaultPathRef,
  })

  return { handleEditorChange, editorMountedRef }
}
