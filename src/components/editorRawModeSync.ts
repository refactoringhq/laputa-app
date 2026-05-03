import type { useCreateBlockNote } from '@blocknote/react'
import type { VaultEntry } from '../types'
import { splitFrontmatter, restoreWikilinksInBlocks } from '../utils/wikilinks'
import { compactMarkdown } from '../utils/compact-markdown'
import { serializeMermaidAwareBlocks } from '../utils/mermaidMarkdown'
import { portableImageUrls } from '../utils/vaultImages'

interface Tab {
  entry: VaultEntry
  content: string
}

export interface PendingRawExitContent {
  path: string
  content: string
}

export function buildPendingRawExitContent(
  path: string | null,
  content: string | null,
): PendingRawExitContent | null {
  if (!path || content === null) return null
  return { path, content }
}

export function serializeEditorDocumentToMarkdown(
  editor: ReturnType<typeof useCreateBlockNote>,
  tabContent: string,
  vaultPath?: string,
): string {
  const blocks = editor.document
  const restored = restoreWikilinksInBlocks(blocks)
  const rawBodyMarkdown = compactMarkdown(serializeMermaidAwareBlocks(editor, restored))
  const bodyMarkdown = vaultPath ? portableImageUrls(rawBodyMarkdown, vaultPath) : rawBodyMarkdown
  const [frontmatter] = splitFrontmatter(tabContent)
  return `${frontmatter}${bodyMarkdown}`
}

export function applyPendingRawExitContent(
  tabs: Tab[],
  pendingRawExitContent: PendingRawExitContent | null,
): Tab[] {
  if (!pendingRawExitContent) return tabs

  let changed = false
  const nextTabs = tabs.map((tab) => {
    if (tab.entry.path !== pendingRawExitContent.path || tab.content === pendingRawExitContent.content) {
      return tab
    }

    changed = true
    return {
      ...tab,
      content: pendingRawExitContent.content,
    }
  })

  return changed ? nextTabs : tabs
}

function syncContentIfChanged({
  currentContent,
  nextContent,
  path,
  onContentChange,
}: {
  currentContent: string | null
  nextContent: string
  path: string
  onContentChange?: (path: string, content: string) => void
}) {
  if (currentContent === nextContent) return
  onContentChange?.(path, nextContent)
}

export function syncActiveTabIntoRawBuffer(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  activeTabPath: string | null
  activeTabContent: string | null
  rawLatestContentRef: React.MutableRefObject<string | null>
  serializeRichEditorContent?: boolean
  vaultPath?: string
}) {
  const {
    editor,
    activeTabPath,
    activeTabContent,
    rawLatestContentRef,
    serializeRichEditorContent = true,
    vaultPath,
  } = options
  if (!activeTabPath || activeTabContent === null) return null

  const syncedContent = serializeRichEditorContent
    ? serializeEditorDocumentToMarkdown(editor, activeTabContent, vaultPath)
    : activeTabContent
  rawLatestContentRef.current = syncedContent
  return syncedContent
}

export function rememberPendingRawExitContent(options: {
  activeTabPath: string | null
  activeTabContent: string | null
  rawInitialContent: string | null
  rawLatestContentRef: React.MutableRefObject<string | null>
  onContentChange?: (path: string, content: string) => void
}) {
  const {
    activeTabPath,
    activeTabContent,
    rawInitialContent,
    rawLatestContentRef,
    onContentChange,
  } = options
  const pendingRawExitContent = buildPendingRawExitContent(activeTabPath, rawLatestContentRef.current)
  if (!pendingRawExitContent) return null
  if (pendingRawExitContent.content === rawInitialContent) return null
  if (pendingRawExitContent.content === activeTabContent) return null

  syncContentIfChanged({
    currentContent: activeTabContent,
    nextContent: pendingRawExitContent.content,
    path: pendingRawExitContent.path,
    onContentChange,
  })
  return pendingRawExitContent
}

export function resolvePendingRawExitContent(options: {
  activeTabPath: string | null
  tabs: Tab[]
  pendingRawExitContent: PendingRawExitContent | null
}) {
  const { activeTabPath, tabs, pendingRawExitContent } = options
  if (!pendingRawExitContent) return null

  if (activeTabPath !== pendingRawExitContent.path) {
    return null
  }

  const syncedTab = tabs.find((tab) => tab.entry.path === pendingRawExitContent.path)
  if (syncedTab?.content === pendingRawExitContent.content) {
    return null
  }

  return pendingRawExitContent
}

export function resolveRawModeContent(options: {
  activeTab: Tab | null
  rawModeContentOverride: PendingRawExitContent | null
}) {
  const { activeTab, rawModeContentOverride } = options
  if (!activeTab) return null
  if (rawModeContentOverride?.path === activeTab.entry.path) {
    return rawModeContentOverride.content
  }
  return activeTab.content
}
