import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { useCreateBlockNote } from '@blocknote/react'
import type { VaultEntry } from '../types'
import { splitFrontmatter, restoreWikilinksInBlocks } from '../utils/wikilinks'
import { compactMarkdown } from '../utils/compact-markdown'
import { serializeDurableEditorBlocks } from '../utils/editorDurableMarkdown'
import { failNoteOpenTrace, finishNoteOpenTrace } from '../utils/noteOpenPerformance'
import { portableImageUrls } from '../utils/vaultImages'
import { useEditorMountState, useLatestRef } from './editorTabSwapLifecycle'
import {
  applyBlankStateToEditor,
  applyBlocksToEditor,
  type EditorContentPathRef,
} from './editorContentSwapApply'
import {
  consumeRawModeTransition,
  flushBeforePathChange,
  flushBeforeRawMode,
  useDebouncedEditorChange,
} from './editorChangeDebounce'
import {
  blankParagraphBlocks,
  extractEditorBody,
  getH1TextFromBlocks,
  isUntitledPath,
  pathStem,
  slugifyPathStem,
} from './editorTabContent'
import { clearEditorDomSelection, EDITOR_CONTAINER_SELECTOR } from './editorDomSelection'
import {
  cacheEditorState,
  cacheParsedEditorState,
  cacheResolvedEditorState,
  isBlankBodyContent,
  resolveBlocksForTarget,
  resolveEmptyHeadingBlocks,
  startsWithEmptyHeading,
  type CachedTabState,
} from './editorBlockResolution'
import {
  createSwapToken,
  invalidatePendingSwap,
  shouldAbortSwap,
  type SwapToken,
} from './editorSwapToken'
import { useParsedBlockPreload } from './editorParsedBlockPreload'
export { extractEditorBody, getH1TextFromBlocks, replaceTitleInFrontmatter } from './editorTabContent'
export { RICH_EDITOR_CHANGE_DEBOUNCE_MS } from './editorChangeDebounce'

interface Tab {
  entry: VaultEntry
  content: string
}

type PendingLocalContent = { path: string; content: string }

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

interface RunTabSwapEffectOptions {
  tabs: Tab[]
  activeTabPath: string | null
  editor: ReturnType<typeof useCreateBlockNote>
  rawMode?: boolean
  tabCacheRef: MutableRefObject<Map<string, CachedTabState>>
  tabsRef: MutableRefObject<Tab[]>
  prevActivePathRef: MutableRefObject<string | null>
  editorMountedRef: MutableRefObject<boolean>
  pendingSwapRef: MutableRefObject<(() => void) | null>
  swapSeqRef: MutableRefObject<number>
  prevRawModeRef: MutableRefObject<boolean>
  rawSwapPendingRef: MutableRefObject<boolean>
  suppressChangeRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
  flushPendingEditorChange: () => boolean
  vaultPath?: string
}

interface UseTabSwapEffectOptions extends Omit<RunTabSwapEffectOptions, 'vaultPath'> {
  vaultPathRef: MutableRefObject<string | undefined>
}

type ParsedBlockPreloadEvent = { path: string; content: string }

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
  return compactMarkdown(serializeDurableEditorBlocks(editor, restored))
}

function trySerializeEditorBody(
  editor: ReturnType<typeof useCreateBlockNote>,
  reason: string,
): string | null {
  try {
    return serializeEditorBody(editor)
  } catch (error) {
    console.warn(`[editor] Skipped ${reason} because BlockNote document could not be serialized:`, error)
    return null
  }
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
  const currentBody = trySerializeEditorBody(editor, 'untitled rename comparison')
  if (currentBody === null) return false

  return renameBodiesOverlap({
    currentBody,
    nextBody: normalizeTabBody({ content: activeTab.content }),
  })
}

function useEditorChangeHandler(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  tabsRef: MutableRefObject<Tab[]>
  onContentChangeRef: MutableRefObject<((path: string, content: string) => void) | undefined>
  prevActivePathRef: MutableRefObject<string | null>
  editorContentPathRef: EditorContentPathRef
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
    editorContentPathRef,
    suppressChangeRef,
    tabCacheRef,
    pendingLocalContentRef,
    vaultPathRef,
  } = options

  const propagateEditorChange = useCallback(() => {
    const path = prevActivePathRef.current
    if (!path) return
    if (editorContentPathRef.current !== path) return

    const tab = tabsRef.current.find(t => t.entry.path === path)
    const previousContent = tab?.content ?? tabCacheRef.current.get(path)?.sourceContent
    if (!previousContent) return

    const blocks = editor.document
    const rawBodyMarkdown = trySerializeEditorBody(editor, 'editor change')
    if (rawBodyMarkdown === null) return
    const bodyMarkdown = vaultPathRef.current
      ? portableImageUrls(rawBodyMarkdown, vaultPathRef.current, path)
      : rawBodyMarkdown
    const [frontmatter] = splitFrontmatter(previousContent)
    const nextContent = `${frontmatter}${bodyMarkdown}`
    pendingLocalContentRef.current = { path, content: nextContent }
    cacheResolvedEditorState(tabCacheRef.current, path, {
      blocks,
      scrollTop: readEditorScrollTop(),
      sourceContent: nextContent,
    }, vaultPathRef.current)
    onContentChangeRef.current?.(path, nextContent)
  }, [editor, editorContentPathRef, onContentChangeRef, pendingLocalContentRef, prevActivePathRef, tabCacheRef, tabsRef, vaultPathRef])

  return useDebouncedEditorChange({ onFlush: propagateEditorChange, suppressChangeRef })
}

function cachePreviousTabOnPathChange(options: {
  prevPath: string | null
  previousTab: Tab | undefined
  pathChanged: boolean
  editorMountedRef: MutableRefObject<boolean>
  cache: Map<string, CachedTabState>
  editor: ReturnType<typeof useCreateBlockNote>
  editorContentPathRef: EditorContentPathRef
}) {
  const { prevPath, previousTab, pathChanged, editorMountedRef, cache, editor, editorContentPathRef } = options
  if (!prevPath || !previousTab || !pathChanged || !editorMountedRef.current) return
  if (editorContentPathRef.current !== prevPath) return
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
  editorContentPathRef: EditorContentPathRef
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
    editorContentPathRef,
  } = options

  cachePreviousTabOnPathChange({
    prevPath,
    previousTab,
    pathChanged,
    editorMountedRef,
    cache,
    editor,
    editorContentPathRef,
  })
  if (shouldWaitForActiveTab({ pathChanged, activeTabPath, activeTab })) return true

  if (!preserveUntitledRenameState({
    prevPath,
    activeTabPath,
    activeTab,
    cache,
    editor,
    editorMountedRef,
    editorContentPathRef,
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

  if (!activeTabPath || !activeTab || !editorMountedRef.current) return false
  if (typeof editor.blocksToMarkdownLossy !== 'function') return false

  const bodyMarkdown = trySerializeEditorBody(editor, 'active tab comparison')
  return bodyMarkdown === normalizeTabBody({ content: activeTab.content })
}

function cacheStableActiveTabAndClearPending(options: {
  cache: Map<string, CachedTabState>
  activeTabPath: string | null
  activeTab: Tab | undefined
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
}) {
  const {
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    editorContentPathRef,
    pendingLocalContentRef,
  } = options

  cacheStableActivePath({
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    editorContentPathRef,
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
  editorContentPathRef: EditorContentPathRef
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
}) {
  const {
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    editorContentPathRef,
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
    editorContentPathRef,
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
  editorContentPathRef: EditorContentPathRef
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
    editorContentPathRef,
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
      editorContentPathRef,
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
      editorContentPathRef,
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
    editorContentPathRef,
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

function shouldClearDomSelectionForScheduledSwap(options: {
  activeTabPath: string | null
  state: TabSwapState
}): boolean {
  const { activeTabPath, state } = options
  if (state.pathChanged) return true
  if (!activeTabPath || !state.activeTab) return false

  const cachedState = state.cache.get(activeTabPath)
  return !!cachedState && cachedState.sourceContent !== state.activeTab.content
}

function cacheStableActivePath(options: {
  cache: Map<string, CachedTabState>
  activeTabPath: string | null
  activeTab: Tab | undefined
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
}) {
  const {
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    editorContentPathRef,
  } = options

  if (!activeTabPath || !activeTab || !editorMountedRef.current) return
  editorContentPathRef.current = activeTabPath
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
  editorContentPathRef: EditorContentPathRef
}) {
  const {
    prevPath,
    activeTabPath,
    activeTab,
    cache,
    editor,
    editorMountedRef,
    editorContentPathRef,
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
    editorContentPathRef,
  })
  requestNextFrame(() => signalEditorTabSwapped(activeTabPath))
  return true
}

function signalTabSwap(options: { path: string }) {
  const { path } = options
  requestNextFrame(() => signalEditorTabSwapped(path))
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

function schedulePostPaint(callback: () => void): void {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    setTimeout(callback, 0)
    return
  }

  window.requestAnimationFrame(() => {
    window.setTimeout(callback, 0)
  })
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
  editorContentPathRef: EditorContentPathRef
}): boolean {
  const {
    cache,
    targetPath,
    content,
    editor,
    suppressChangeRef,
    editorContentPathRef,
  } = options

  cacheEditorState(cache, targetPath, {
    blocks: blankParagraphBlocks(),
    scrollTop: 0,
    sourceContent: content,
  })
  if (!applyBlankStateToEditor({ editor, suppressChangeRef, editorContentPathRef, targetPath })) {
    return false
  }

  signalTabSwap({ path: targetPath })
  return true
}

function scheduleEmptyHeadingSwap(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  targetPath: string
  content: string
  prevActivePathRef: MutableRefObject<string | null>
  suppressChangeRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  swapSeqRef: MutableRefObject<number>
  tabsRef: MutableRefObject<Tab[]>
  token: SwapToken
  vaultPath?: string
}) {
  const {
    editor,
    targetPath,
    content,
    prevActivePathRef,
    suppressChangeRef,
    editorContentPathRef,
    swapSeqRef,
    tabsRef,
    token,
    vaultPath,
  } = options

  if (!startsWithEmptyHeading({ content })) return false

  void resolveEmptyHeadingBlocks(editor, content, vaultPath, targetPath)
    .then((blocks) => {
      if (!blocks || shouldAbortSwap({ prevActivePathRef, suppressChangeRef, swapSeqRef, tabsRef, token })) return
      cacheParsedEditorState(targetPath, { blocks, scrollTop: 0, sourceContent: content }, vaultPath)
      if (!applyBlocksToEditor({ editor, blocks, scrollTop: 0, suppressChangeRef, editorContentPathRef, targetPath })) return
      signalTabSwap({ path: targetPath })
    })
    .catch((err: unknown) => {
      if (swapSeqRef.current === token.seq) suppressChangeRef.current = false
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
  editorContentPathRef: EditorContentPathRef
  swapSeqRef: MutableRefObject<number>
  tabsRef: MutableRefObject<Tab[]>
  token: SwapToken
  vaultPath?: string
}) {
  const {
    editor,
    cache,
    targetPath,
    content,
    prevActivePathRef,
    suppressChangeRef,
    editorContentPathRef,
    swapSeqRef,
    tabsRef,
    token,
    vaultPath,
  } = options

  void resolveBlocksForTarget({ editor, cache, targetPath, content, vaultPath })
    .then(({ blocks, scrollTop }) => {
      if (shouldAbortSwap({ prevActivePathRef, suppressChangeRef, swapSeqRef, tabsRef, token })) return
      if (!applyBlocksToEditor({ editor, blocks, scrollTop, suppressChangeRef, editorContentPathRef, targetPath })) return
      signalTabSwap({ path: targetPath })
    })
    .catch((err: unknown) => {
      if (swapSeqRef.current === token.seq) suppressChangeRef.current = false
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
  swapSeqRef: MutableRefObject<number>
  tabsRef: MutableRefObject<Tab[]>
  prevActivePathRef: MutableRefObject<string | null>
  rawSwapPendingRef: MutableRefObject<boolean>
  suppressChangeRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  vaultPath?: string
}) {
  const {
    editor,
    cache,
    targetPath,
    activeTab,
    clearDomSelection,
    pendingSwapRef,
    swapSeqRef,
    tabsRef,
    prevActivePathRef,
    rawSwapPendingRef,
    suppressChangeRef,
    editorContentPathRef,
    vaultPath,
  } = options

  const token = createSwapToken(swapSeqRef, targetPath, activeTab.content)
  suppressChangeRef.current = true

  const doSwap = () => {
    if (shouldAbortSwap({ prevActivePathRef, suppressChangeRef, swapSeqRef, tabsRef, token })) return
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
        editorContentPathRef,
      })
      return
    }

    if (scheduleEmptyHeadingSwap({
      editor,
      targetPath,
      content: activeTab.content,
      prevActivePathRef,
      suppressChangeRef,
      editorContentPathRef,
      swapSeqRef,
      tabsRef,
      token,
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
      editorContentPathRef,
      swapSeqRef,
      tabsRef,
      token,
      vaultPath,
    })
  }

  if (editor.prosemirrorView) {
    schedulePostPaint(doSwap)
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
  editorContentPathRef: EditorContentPathRef
  rawSwapPendingRef: MutableRefObject<boolean>
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
}) {
  const {
    state,
    activeTabPath,
    editor,
    editorMountedRef,
    prevActivePathRef,
    editorContentPathRef,
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
    editorContentPathRef,
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
    editorContentPathRef,
    rawSwapPendingRef,
    pendingLocalContentRef,
  })
}

function runTabSwapEffect(options: RunTabSwapEffectOptions) {
  const {
    tabs,
    activeTabPath,
    editor,
    rawMode,
    tabCacheRef,
    tabsRef,
    prevActivePathRef,
    editorMountedRef,
    pendingSwapRef,
    swapSeqRef,
    prevRawModeRef,
    rawSwapPendingRef,
    suppressChangeRef,
    editorContentPathRef,
    pendingLocalContentRef,
    flushPendingEditorChange,
    vaultPath,
  } = options

  const rawModeJustEnded = consumeRawModeTransition(prevRawModeRef, rawMode)
  if (flushBeforeRawMode({ rawMode, flushPendingEditorChange })) return
  const state = resolveTabSwapState({
    tabs,
    activeTabPath,
    tabCacheRef,
    prevActivePathRef,
    rawModeJustEnded,
  })
  if (state.pathChanged) invalidatePendingSwap({ pendingSwapRef, swapSeqRef })
  flushBeforePathChange({ pathChanged: state.pathChanged, flushPendingEditorChange })

  if (shouldSkipScheduledTabSwap({
    state,
    activeTabPath,
    editor,
    editorMountedRef,
    prevActivePathRef,
    editorContentPathRef,
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
    clearDomSelection: shouldClearDomSelectionForScheduledSwap({ activeTabPath, state }),
    pendingSwapRef,
    swapSeqRef,
    tabsRef,
    prevActivePathRef,
    rawSwapPendingRef,
    suppressChangeRef,
    editorContentPathRef,
    vaultPath,
  })
}

function useTabSwapEffect(options: UseTabSwapEffectOptions) {
  const {
    tabs,
    activeTabPath,
    editor,
    rawMode,
    tabCacheRef,
    tabsRef,
    prevActivePathRef,
    editorMountedRef,
    pendingSwapRef,
    swapSeqRef,
    prevRawModeRef,
    rawSwapPendingRef,
    suppressChangeRef,
    editorContentPathRef,
    pendingLocalContentRef,
    vaultPathRef,
    flushPendingEditorChange,
  } = options

  useEffect(() => {
    runTabSwapEffect({
      tabs,
      activeTabPath,
      editor,
      rawMode,
      tabCacheRef,
      tabsRef,
      editorMountedRef,
      prevActivePathRef,
      pendingSwapRef,
      swapSeqRef,
      prevRawModeRef,
      rawSwapPendingRef,
      suppressChangeRef,
      editorContentPathRef,
      pendingLocalContentRef,
      flushPendingEditorChange,
      vaultPath: vaultPathRef.current,
    })
  }, [
    activeTabPath,
    editor,
    editorMountedRef,
    pendingSwapRef,
    swapSeqRef,
    prevActivePathRef,
    prevRawModeRef,
    rawMode,
    rawSwapPendingRef,
    suppressChangeRef,
    editorContentPathRef,
    tabCacheRef,
    tabsRef,
    tabs,
    pendingLocalContentRef,
    vaultPathRef,
    flushPendingEditorChange,
  ])
}

function useForegroundWorkTracker(
  activeTabPath: string | null,
  handleEditorChange: () => void,
) {
  const foregroundWorkAtRef = useRef(0)
  useEffect(() => {
    foregroundWorkAtRef.current = Date.now()
  }, [activeTabPath])
  const handleForegroundEditorChange = useCallback(() => {
    foregroundWorkAtRef.current = Date.now()
    handleEditorChange()
  }, [handleEditorChange])
  return { foregroundWorkAtRef, handleForegroundEditorChange }
}

function usePrepareParsedBlocks(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  tabCacheRef: MutableRefObject<Map<string, CachedTabState>>
  vaultPathRef: MutableRefObject<string | undefined>
}) {
  const { editor, tabCacheRef, vaultPathRef } = options
  return useCallback(async (event: ParsedBlockPreloadEvent) => {
    await resolveBlocksForTarget({
      editor,
      cache: tabCacheRef.current,
      targetPath: event.path,
      content: event.content,
      vaultPath: vaultPathRef.current,
    })
  }, [editor, tabCacheRef, vaultPathRef])
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
 * Returns the onChange callback for SingleEditorView and a flush hook for
 * save/navigation paths that need the latest rich-editor content immediately.
 */
export function useEditorTabSwap({ tabs, activeTabPath, editor, onContentChange, rawMode, vaultPath }: UseEditorTabSwapOptions) {
  const tabCacheRef = useRef<Map<string, CachedTabState>>(new Map())
  const pendingLocalContentRef = useRef<PendingLocalContent | null>(null)
  const prevActivePathRef = useRef<string | null>(null)
  const activeTabPathLatestRef = useLatestRef(activeTabPath)
  const editorContentPathRef = useRef<string | null>(null)
  const editorMountedRef = useRef(false)
  const pendingSwapRef = useRef<(() => void) | null>(null)
  const swapSeqRef = useRef(0)
  const prevRawModeRef = useRef(!!rawMode)
  const rawModeLatestRef = useLatestRef(!!rawMode)
  const rawSwapPendingRef = useRef(false)
  const suppressChangeRef = useRef(false)
  const onContentChangeRef = useLatestRef(onContentChange)
  const tabsRef = useLatestRef(tabs)
  const vaultPathRef = useLatestRef(vaultPath)
  const { handleEditorChange, flushPendingEditorChange } = useEditorChangeHandler({
    editor,
    tabsRef,
    onContentChangeRef,
    prevActivePathRef,
    editorContentPathRef,
    suppressChangeRef,
    tabCacheRef,
    pendingLocalContentRef,
    vaultPathRef,
  })
  const { foregroundWorkAtRef, handleForegroundEditorChange } = useForegroundWorkTracker(activeTabPath, handleEditorChange)
  const prepareParsedBlocks = usePrepareParsedBlocks({ editor, tabCacheRef, vaultPathRef })
  useEditorMountState(editor, editorMountedRef, pendingSwapRef)
  useParsedBlockPreload({
    activeTabPathRef: activeTabPathLatestRef,
    editorMountedRef,
    foregroundWorkAtRef,
    prepareParsedBlocks,
    rawModeRef: rawModeLatestRef,
  })
  useTabSwapEffect({
    tabs,
    activeTabPath,
    editor,
    rawMode,
    tabCacheRef,
    tabsRef,
    prevActivePathRef,
    editorMountedRef,
    pendingSwapRef,
    swapSeqRef,
    prevRawModeRef,
    rawSwapPendingRef,
    suppressChangeRef,
    editorContentPathRef,
    pendingLocalContentRef,
    vaultPathRef,
    flushPendingEditorChange,
  })

  return { handleEditorChange: handleForegroundEditorChange, flushPendingEditorChange, editorMountedRef }
}
