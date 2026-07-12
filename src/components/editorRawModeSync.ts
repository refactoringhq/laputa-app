import type { useCreateBlockNote } from '@blocknote/react'
import type { MutableRefObject, SetStateAction } from 'react'
import type { VaultEntry } from '../types'
import {
  hasRichEditorDurableBlocks,
  serializeRichEditorDocumentToMarkdown,
} from '../utils/richEditorMarkdown'

interface Tab {
  entry: VaultEntry
  content: string
}

export interface PendingRawExitContent {
  path: string
  content: string
}

export interface RawModeContentTransition {
  pendingExitContent: PendingRawExitContent | null
  rawModeContentOverride: PendingRawExitContent | null
}

export function createRawModeContentTransition(): RawModeContentTransition {
  return {
    pendingExitContent: null,
    rawModeContentOverride: null,
  }
}

function resolvePendingRawExitContentAction(
  action: SetStateAction<PendingRawExitContent | null>,
  current: PendingRawExitContent | null,
): PendingRawExitContent | null {
  return typeof action === 'function' ? action(current) : action
}

export function withPendingRawExitContent(
  transition: RawModeContentTransition,
  action: SetStateAction<PendingRawExitContent | null>,
): RawModeContentTransition {
  return {
    ...transition,
    pendingExitContent: resolvePendingRawExitContentAction(action, transition.pendingExitContent),
  }
}

export function withRawModeContentOverride(
  transition: RawModeContentTransition,
  action: SetStateAction<PendingRawExitContent | null>,
): RawModeContentTransition {
  return {
    ...transition,
    rawModeContentOverride: resolvePendingRawExitContentAction(action, transition.rawModeContentOverride),
  }
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
  notePath?: string,
): string {
  return serializeRichEditorDocumentToMarkdown({ editor, notePath, tabContent, vaultPath })
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
  rawLatestContentRef: MutableRefObject<string | null>
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

  const shouldSerializeRichEditorContent = serializeRichEditorContent || hasRichEditorDurableBlocks(editor.document)
  const syncedContent = shouldSerializeRichEditorContent
    ? serializeEditorDocumentToMarkdown(editor, activeTabContent, vaultPath, activeTabPath)
    : activeTabContent
  rawLatestContentRef.current = syncedContent
  return syncedContent
}

export function rememberPendingRawExitContent(options: {
  activeTabPath: string | null
  activeTabContent: string | null
  rawInitialContent: string | null
  rawLatestContentRef: MutableRefObject<string | null>
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
