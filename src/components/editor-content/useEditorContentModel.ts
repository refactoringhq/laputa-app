import type React from 'react'
import { useRef } from 'react'
import type { useCreateBlockNote } from '@blocknote/react'
import type { AppLocale } from '../../lib/i18n'
import type { NoteWidthMode, NoteStatus, VaultEntry } from '../../types'
import { useEditorTheme } from '../../hooks/useTheme'
import { deriveEditorContentState } from './editorContentState'
import type { RawEditorFindRequest } from '../RawEditorFindBar'

export interface Tab {
  entry: VaultEntry
  content: string
}

export interface EditorContentProps {
  activeTab: Tab | null
  activeTabPath: string | null
  isLoadingNewTab: boolean
  isVaultLoading?: boolean
  entries: VaultEntry[]
  editor: ReturnType<typeof useCreateBlockNote>
  diffMode: boolean
  diffContent: string | null
  diffLoading: boolean
  onToggleDiff: () => void
  rawMode: boolean
  onToggleRaw: () => void
  onRawContentChange?: (path: string, content: string) => void
  onSave?: () => void
  activeStatus: NoteStatus
  showDiffToggle: boolean
  showAIChat?: boolean
  onToggleAIChat?: () => void
  inspectorCollapsed: boolean
  onToggleInspector: () => void
  onNavigateWikilink: (target: string) => void
  onEditorChange?: () => void
  onToggleFavorite?: (path: string) => void
  onToggleOrganized?: (path: string) => void
  onRevealFile?: (path: string) => void
  onCopyFilePath?: (path: string) => void
  onDeleteNote?: (path: string) => void
  onArchiveNote?: (path: string) => void
  onUnarchiveNote?: (path: string) => void
  vaultPath?: string
  rawModeContent?: string | null
  findRequest?: RawEditorFindRequest | null
  rawLatestContentRef?: React.MutableRefObject<string | null>
  onRenameFilename?: (path: string, newFilenameStem: string) => void
  noteWidth?: NoteWidthMode
  onToggleNoteWidth?: () => void
  isConflicted?: boolean
  onKeepMine?: (path: string) => void
  onKeepTheirs?: (path: string) => void
  locale?: AppLocale
}

export function useEditorContentModel(props: EditorContentProps) {
  const {
    activeTab,
    activeTabPath,
    entries,
    rawMode,
    diffMode,
  } = props

  const { cssVars } = useEditorTheme()
  const {
    isArchived,
    isDeletedPreview,
    isNonMarkdownText,
    effectiveRawMode,
    showEditor: showContentEditor,
    path,
    wordCount,
  } = deriveEditorContentState({
    activeTab,
    entries,
    rawMode,
    activeStatus: props.activeStatus,
  })
  const showEditor = !diffMode && showContentEditor
  const loadingEntry = !activeTab && activeTabPath
    ? entries.find((entry) => entry.path === activeTabPath) ?? null
    : null
  const loadingTab = loadingEntry ? { entry: loadingEntry, content: '' } : null

  const breadcrumbBarRef = useRef<HTMLDivElement | null>(null)

  return {
    ...props,
    cssVars,
    isArchived,
    isDeletedPreview,
    effectiveRawMode,
    forceRawMode: isNonMarkdownText || isDeletedPreview,
    showEditor,
    loadingTab,
    path,
    breadcrumbBarRef,
    wordCount,
  }
}
