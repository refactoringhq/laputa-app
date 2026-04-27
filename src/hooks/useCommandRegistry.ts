import { useMemo } from 'react'
import type { AiAgentId, AiAgentsStatus } from '../lib/aiAgents'
import type { AppLocale, UiLanguagePreference } from '../lib/i18n'
import type { VaultAiGuidanceStatus } from '../lib/vaultAiGuidance'
import type { NoteLayout, SidebarSelection, VaultEntry } from '../types'
import type { NoteListFilter } from '../utils/noteListHelpers'
import type { ViewMode } from './useViewMode'
import { buildNavigationCommands } from './commands/navigationCommands'
import { buildNoteCommands } from './commands/noteCommands'
import { buildGitCommands } from './commands/gitCommands'
import { buildViewCommands } from './commands/viewCommands'
import { buildSettingsCommands } from './commands/settingsCommands'
import { buildAiAgentCommands } from './commands/aiAgentCommands'
import { buildTypeCommands } from './commands/typeCommands'
import { buildFilterCommands } from './commands/filterCommands'
import { localizeCommandActions } from './commands/localizeCommands'
import { extractVaultTypes } from '../utils/vaultTypes'

// Re-export types and helpers for backward compatibility
export type { CommandAction, CommandGroup } from './commands/types'
export { groupSortKey } from './commands/types'
export { pluralizeType, buildTypeCommands } from './commands/typeCommands'
export { extractVaultTypes } from '../utils/vaultTypes'
export { buildViewCommands } from './commands/viewCommands'

interface CommandRegistryConfig {
  activeTabPath: string | null
  entries: VaultEntry[]
  modifiedCount: number
  activeNoteHasIcon?: boolean
  mcpStatus?: string
  onInstallMcp?: () => void
  aiAgentsStatus?: AiAgentsStatus
  vaultAiGuidanceStatus?: VaultAiGuidanceStatus
  onOpenAiAgents?: () => void
  onRestoreVaultAiGuidance?: () => void
  onSetDefaultAiAgent?: (agent: AiAgentId) => void
  selectedAiAgent?: AiAgentId
  onCycleDefaultAiAgent?: () => void
  selectedAiAgentLabel?: string
  onReloadVault?: () => void
  onRepairVault?: () => void
  onSetNoteIcon?: () => void
  onRemoveNoteIcon?: () => void
  locale?: AppLocale
  systemLocale?: AppLocale
  selectedUiLanguage?: UiLanguagePreference
  onSetUiLanguage?: (language: UiLanguagePreference) => void
  onChangeNoteType?: () => void
  onMoveNoteToFolder?: () => void
  canMoveNoteToFolder?: boolean
  onOpenInNewWindow?: () => void
  onRevealActiveFile?: (path: string) => void
  onCopyActiveFilePath?: (path: string) => void
  onOpenActiveFileExternal?: (path: string) => void
  onToggleFavorite?: (path: string) => void
  onToggleOrganized?: (path: string) => void
  onCustomizeNoteListColumns?: () => void
  canCustomizeNoteListColumns?: boolean
  noteListColumnsLabel?: string
  onRestoreDeletedNote?: () => void
  canRestoreDeletedNote?: boolean
  onQuickOpen: () => void
  onCreateNote: () => void
  onCreateNoteOfType: (type: string) => void
  onSave: () => void
  onOpenSettings: () => void
  onOpenFeedback?: () => void
  onOpenVault?: () => void
  onCreateEmptyVault?: () => void
  onAddRemote?: () => void
  canAddRemote?: boolean
  isGitVault?: boolean
  onInitializeGit?: () => void
  onCreateType?: () => void
  onDeleteNote: (path: string) => void
  onArchiveNote: (path: string) => void
  onUnarchiveNote: (path: string) => void
  onCommitPush: () => void
  onPull?: () => void
  onResolveConflicts?: () => void
  onSetViewMode: (mode: ViewMode) => void
  onToggleInspector: () => void
  onToggleDiff?: () => void
  onToggleRawEditor?: () => void
  onFindInNote?: () => void
  onReplaceInNote?: () => void
  noteLayout?: NoteLayout
  onToggleNoteLayout?: () => void
  onToggleAIChat?: () => void
  activeNoteModified: boolean
  onCheckForUpdates?: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  zoomLevel: number
  onSelect: (sel: SidebarSelection) => void
  onRenameFolder?: () => void
  onDeleteFolder?: () => void
  onRevealSelectedFolder?: () => void
  onCopySelectedFolderPath?: () => void
  showInbox?: boolean
  onGoBack?: () => void
  onGoForward?: () => void
  canGoBack?: boolean
  canGoForward?: boolean
  onRemoveActiveVault?: () => void
  onRestoreGettingStarted?: () => void
  isGettingStartedHidden?: boolean
  vaultCount?: number
  selection?: SidebarSelection
  noteListFilter?: NoteListFilter
  onSetNoteListFilter?: (filter: NoteListFilter) => void
}

export function useCommandRegistry(config: CommandRegistryConfig): import('./commands/types').CommandAction[] {
  const {
    activeTabPath, entries, modifiedCount,
    onQuickOpen, onCreateNote, onCreateNoteOfType, onSave, onOpenSettings, onOpenFeedback,
    onDeleteNote, onArchiveNote, onUnarchiveNote,
    onCommitPush, onPull, onResolveConflicts, onSetViewMode, onToggleInspector, onToggleDiff, onToggleRawEditor, onFindInNote, onReplaceInNote, noteLayout, onToggleNoteLayout, onToggleAIChat, onOpenVault, onCreateEmptyVault,
    activeNoteModified,
    onZoomIn, onZoomOut, onZoomReset, zoomLevel,
    onSelect, onRenameFolder, onDeleteFolder, onRevealSelectedFolder, onCopySelectedFolderPath,
    showInbox,
    onGoBack, onGoForward, canGoBack, canGoForward,
    onCheckForUpdates, onCreateType,
    onRemoveActiveVault, onRestoreGettingStarted, isGettingStartedHidden, vaultCount,
    mcpStatus, onInstallMcp, aiAgentsStatus, vaultAiGuidanceStatus,
    onOpenAiAgents, onRestoreVaultAiGuidance, onSetDefaultAiAgent, selectedAiAgent, onCycleDefaultAiAgent, selectedAiAgentLabel,
    onReloadVault, onRepairVault,
    locale, systemLocale, selectedUiLanguage, onSetUiLanguage,
    onSetNoteIcon, onRemoveNoteIcon, activeNoteHasIcon, onChangeNoteType, onMoveNoteToFolder, canMoveNoteToFolder,
    onOpenInNewWindow, onRevealActiveFile, onCopyActiveFilePath, onOpenActiveFileExternal, onToggleFavorite, onToggleOrganized,
    onCustomizeNoteListColumns, canCustomizeNoteListColumns,
    onRestoreDeletedNote, canRestoreDeletedNote,
    selection, noteListFilter, onSetNoteListFilter,
    isGitVault, onInitializeGit,
  } = config

  const hasActiveNote = activeTabPath !== null

  const activeEntry = useMemo(
    () => (hasActiveNote ? entries.find(e => e.path === activeTabPath) : undefined),
    [entries, activeTabPath, hasActiveNote],
  )
  const isArchived = activeEntry?.archived ?? false
  const isFavorite = activeEntry?.favorite ?? false
  const isSectionGroup = selection?.kind === 'sectionGroup'
  const noteListColumnsLabel = config.noteListColumnsLabel ?? (
    selection?.kind === 'filter' && selection.filter === 'all'
      ? 'Customize All Notes columns'
      : 'Customize Inbox columns'
  )

  const vaultTypes = useMemo(() => extractVaultTypes(entries), [entries])

  const navigationCommands = useMemo(() => buildNavigationCommands({
    onQuickOpen,
    onSelect,
    selection,
    onRenameFolder,
    onDeleteFolder,
    onRevealSelectedFolder,
    onCopySelectedFolderPath,
    showInbox,
    onGoBack,
    onGoForward,
    canGoBack,
    canGoForward,
  }), [
    onQuickOpen, onSelect, selection, onRenameFolder, onDeleteFolder,
    onRevealSelectedFolder, onCopySelectedFolderPath, showInbox,
    onGoBack, onGoForward, canGoBack, canGoForward,
  ])

  const noteCommands = useMemo(() => buildNoteCommands({
    hasActiveNote, activeTabPath, activeFileKind: activeEntry?.fileKind ?? 'markdown', isArchived,
    onCreateNote, onCreateType, onSave,
    onFindInNote, onReplaceInNote,
    onDeleteNote, onArchiveNote, onUnarchiveNote,
    onChangeNoteType, onMoveNoteToFolder, canMoveNoteToFolder,
    onSetNoteIcon, onRemoveNoteIcon, activeNoteHasIcon, onOpenInNewWindow,
    onRevealActiveFile, onCopyActiveFilePath, onOpenActiveFileExternal,
    onToggleFavorite, isFavorite,
    onToggleOrganized, isOrganized: activeEntry?.organized ?? false,
    onRestoreDeletedNote, canRestoreDeletedNote,
  }), [
    hasActiveNote, activeTabPath, activeEntry?.fileKind, isArchived,
    onCreateNote, onCreateType, onSave, onFindInNote, onReplaceInNote, onDeleteNote, onArchiveNote, onUnarchiveNote,
    onChangeNoteType, onMoveNoteToFolder, canMoveNoteToFolder,
    onSetNoteIcon, onRemoveNoteIcon, activeNoteHasIcon, onOpenInNewWindow,
    onRevealActiveFile, onCopyActiveFilePath, onOpenActiveFileExternal,
    onToggleFavorite, isFavorite,
    onToggleOrganized, activeEntry?.organized, onRestoreDeletedNote, canRestoreDeletedNote,
  ])

  const gitCommands = useMemo(() => buildGitCommands({
    modifiedCount,
    isGitVault,
    canAddRemote: config.canAddRemote ?? false,
    onAddRemote: config.onAddRemote,
    onCommitPush,
    onInitializeGit,
    onPull,
    onResolveConflicts,
    onSelect,
  }), [
    modifiedCount, isGitVault, config.canAddRemote, config.onAddRemote,
    onCommitPush, onInitializeGit, onPull, onResolveConflicts, onSelect,
  ])

  const viewCommands = useMemo(() => buildViewCommands({
    hasActiveNote, activeNoteModified, onSetViewMode, onToggleInspector,
    onToggleDiff, onToggleRawEditor, noteLayout, onToggleNoteLayout, onToggleAIChat, zoomLevel, onZoomIn, onZoomOut, onZoomReset,
    onCustomizeNoteListColumns, canCustomizeNoteListColumns, noteListColumnsLabel,
  }), [
    hasActiveNote, activeNoteModified, onSetViewMode, onToggleInspector,
    onToggleDiff, onToggleRawEditor, noteLayout, onToggleNoteLayout, onToggleAIChat,
    zoomLevel, onZoomIn, onZoomOut, onZoomReset,
    onCustomizeNoteListColumns, canCustomizeNoteListColumns, noteListColumnsLabel,
  ])

  const settingsCommands = useMemo(() => buildSettingsCommands({
    mcpStatus, vaultCount, isGettingStartedHidden,
    onOpenSettings, onOpenFeedback, onOpenVault, onCreateEmptyVault, onRemoveActiveVault, onRestoreGettingStarted,
    onCheckForUpdates, onInstallMcp, onReloadVault, onRepairVault,
    locale, systemLocale, selectedUiLanguage, onSetUiLanguage,
  }), [
    mcpStatus, vaultCount, isGettingStartedHidden, onOpenSettings, onOpenFeedback,
    onOpenVault, onCreateEmptyVault, onRemoveActiveVault, onRestoreGettingStarted,
    onCheckForUpdates, onInstallMcp, onReloadVault, onRepairVault,
    locale, systemLocale, selectedUiLanguage, onSetUiLanguage,
  ])

  const aiCommands = useMemo(() => buildAiAgentCommands({
    aiAgentsStatus,
    vaultAiGuidanceStatus,
    selectedAiAgent,
    selectedAiAgentLabel,
    onOpenAiAgents,
    onRestoreVaultAiGuidance,
    onSetDefaultAiAgent,
    onCycleDefaultAiAgent,
  }), [
    aiAgentsStatus, vaultAiGuidanceStatus, selectedAiAgent, selectedAiAgentLabel,
    onOpenAiAgents, onRestoreVaultAiGuidance, onSetDefaultAiAgent, onCycleDefaultAiAgent,
  ])

  const typeCommands = useMemo(
    () => buildTypeCommands(vaultTypes, onCreateNoteOfType, onSelect),
    [vaultTypes, onCreateNoteOfType, onSelect],
  )
  const filterCommands = useMemo(
    () => buildFilterCommands({ isSectionGroup, noteListFilter, onSetNoteListFilter }),
    [isSectionGroup, noteListFilter, onSetNoteListFilter],
  )
  const commands = useMemo(() => [
    ...navigationCommands,
    ...noteCommands,
    ...gitCommands,
    ...viewCommands,
    ...settingsCommands,
    ...aiCommands,
    ...typeCommands,
    ...filterCommands,
  ], [
    navigationCommands, noteCommands, gitCommands, viewCommands,
    settingsCommands, aiCommands, typeCommands, filterCommands,
  ])

  return useMemo(() => localizeCommandActions(commands, locale), [commands, locale])
}
