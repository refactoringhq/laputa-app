import { useMemo } from 'react'
import type { VaultEntry } from '../types'
import { noteDisplaysAsSheet } from '../utils/noteFormat'
import {
  applyPendingRawExitContent,
  type PendingRawExitContent,
} from './editorRawModeSync'

type SheetTransitionTab = {
  entry: VaultEntry
  content: string
}

interface RichEditorSheetSwapParams<Tab extends SheetTransitionTab> {
  activeTab: Tab | null
  activeTabPath: string | null
  tabs: Tab[]
  pendingRawExitContent: PendingRawExitContent | null
}

interface RichEditorReadinessParams<Tab extends SheetTransitionTab> {
  activeTab: Tab | null
  activeTabIsSheet: boolean
  editorContentPath: string | null
}

function tabDisplaysAsSheet(tab: SheetTransitionTab | null): boolean {
  if (!tab) return false
  return noteDisplaysAsSheet({
    content: tab.content,
    display: tab.entry.display,
    fileKind: tab.entry.fileKind,
  })
}

export function useRichEditorSheetSwapState<Tab extends SheetTransitionTab>({
  activeTab,
  activeTabPath,
  tabs,
  pendingRawExitContent,
}: RichEditorSheetSwapParams<Tab>) {
  const activeTabIsSheet = tabDisplaysAsSheet(activeTab)
  const richEditorActiveTabPath = activeTabIsSheet ? null : activeTabPath
  const tabsForEditorSwap = useMemo(
    () => activeTabIsSheet ? [] : applyPendingRawExitContent(tabs, pendingRawExitContent),
    [activeTabIsSheet, pendingRawExitContent, tabs],
  )

  return {
    activeTabIsSheet,
    richEditorActiveTabPath,
    tabsForEditorSwap,
  }
}

export function useRichEditorContentReadiness<Tab extends SheetTransitionTab>({
  activeTab,
  activeTabIsSheet,
  editorContentPath,
}: RichEditorReadinessParams<Tab>) {
  const activePath = activeTab?.entry.path ?? null
  if (!activePath || activeTabIsSheet) return true
  if (editorContentPath === null) return true
  return editorContentPath === activePath
}
