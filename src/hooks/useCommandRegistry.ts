import { useMemo } from 'react'
import type { AiAgentId, AiAgentsStatus } from '../lib/aiAgents'
import type { AppLocale, UiLanguagePreference } from '../lib/i18n'
import type { ThemeMode } from '../lib/themeMode'
import type { VaultAiGuidanceStatus } from '../lib/vaultAiGuidance'
import type { NoteWidthMode, SidebarSelection, VaultEntry } from '../types'
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
import type { GitRepositoryOption } from '../utils/gitRepositories'
import type { ImmediateCreateOptions } from './useNoteCreation'
import type { RichEditorBlockTypeDefinition } from '../utils/richEditorBlockTypes'

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
  aiFeaturesEnabled?: boolean
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
  onSetThemeMode?: (mode: ThemeMode) => void
  onChangeNoteType?: () => void
  onMoveNoteToFolder?: () => void
  canMoveNoteToFolder?: boolean
  onTurnCurrentBlockInto?: (target: RichEditorBlockTypeDefinition) => void
  onOpenInNewWindow?: () => void
  onRevealActiveFile?: (path: string) => void
  onCopyActiveFilePath?: (path: string) => void
  onCopyActiveDeepLink?: (path: string) => void
  onOpenActiveFileExternal?: (path: string) => void
  onExportNoteAsPdf?: () => void
  onToggleFavorite?: (path: string) => void
  onToggleOrganized?: (path: string) => void
  onCustomizeNoteListColumns?: () => void
  canCustomizeNoteListColumns?: boolean
  noteListColumnsLabel?: string
  onRestoreDeletedNote?: () => void
  canRestoreDeletedNote?: boolean
  onQuickOpen: () => void
  onCreateNote: (type?: string, options?: ImmediateCreateOptions) => void
  onCreateNoteOfType: (type: string) => void
  onSave: () => void
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  undoLabel?: string | null
  redoLabel?: string | null
  onPastePlainText: () => void
  onOpenSettings: () => void
  onOpenFeedback?: () => void
  onOpenVault?: () => void
  onCreateEmptyVault?: () => void
  onAddRemote?: () => void
  canAddRemote?: boolean
  gitFeaturesEnabled?: boolean
  isGitVault?: boolean
  gitRepositories?: GitRepositoryOption[]
  onInitializeGit?: () => void
  onCreateType?: () => void
  onDeleteNote: (path: string) => void
  onArchiveNote: (path: string) => void
  onUnarchiveNote: (path: string) => void
  onCommitPush: () => void
  onPull?: () => void
  onPullRepository?: (path: string) => void
  onResolveConflicts?: () => void
  onSetViewMode: (mode: ViewMode) => void
  onToggleInspector: () => void
  onToggleDiff?: () => void
  onToggleRawEditor?: () => void
  selectedViewName?: string
  onMoveSelectedViewUp?: () => void
  onMoveSelectedViewDown?: () => void
  canMoveSelectedViewUp?: boolean
  canMoveSelectedViewDown?: boolean
  onFindInNote?: () => void
  onReplaceInNote?: () => void
  noteWidth?: NoteWidthMode
  defaultNoteWidth?: NoteWidthMode
  onSetNoteWidth?: (mode: NoteWidthMode) => void
  onSetDefaultNoteWidth?: (mode: NoteWidthMode) => void
  onToggleAIChat?: () => void
  onToggleTableOfContents?: () => void
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

function currentFolderCreateOptions(selection: SidebarSelection | undefined): ImmediateCreateOptions | undefined {
  if (selection?.kind !== 'folder') return undefined
  return {
    creationPath: 'folder_command_palette',
    folderPath: selection.path,
    vaultPath: selection.rootPath,
  }
}

export function useCommandRegistry(config: CommandRegistryConfig): import('./commands/types').CommandAction[] {
  const {
    activeTabPath, entries, modifiedCount,
    onQuickOpen, onCreateNote, onCreateNoteOfType, onSave, onUndo, onRedo, canUndo, canRedo, undoLabel, redoLabel,
    onPastePlainText, onOpenSettings, onOpenFeedback,
    onDeleteNote, onArchiveNote, onUnarchiveNote,
    onCommitPush, onPull, onResolveConflicts, onSetViewMode, onToggleInspector, onToggleDiff, onToggleRawEditor, onFindInNote, onReplaceInNote,
    noteWidth, defaultNoteWidth, onSetNoteWidth, onSetDefaultNoteWidth, onToggleAIChat, onToggleTableOfContents, onOpenVault, onCreateEmptyVault,
    selectedViewName, onMoveSelectedViewUp, onMoveSelectedViewDown, canMoveSelectedViewUp, canMoveSelectedViewDown,
    activeNoteModified,
    onZoomIn, onZoomOut, onZoomReset, zoomLevel,
    onSelect, onRenameFolder, onDeleteFolder, onRevealSelectedFolder, onCopySelectedFolderPath,
    showInbox,
    onGoBack, onGoForward, canGoBack, canGoForward,
    onCheckForUpdates, onCreateType,
    onRemoveActiveVault, onRestoreGettingStarted, isGettingStartedHidden, vaultCount,
    mcpStatus, onInstallMcp, aiFeaturesEnabled,
    aiAgentsStatus, vaultAiGuidanceStatus,
    onOpenAiAgents, onRestoreVaultAiGuidance, onSetDefaultAiAgent, selectedAiAgent, onCycleDefaultAiAgent, selectedAiAgentLabel,
    onReloadVault, onRepairVault,
    locale, systemLocale, selectedUiLanguage, onSetUiLanguage, onSetThemeMode,
    onSetNoteIcon, onRemoveNoteIcon, activeNoteHasIcon, onChangeNoteType, onMoveNoteToFolder, canMoveNoteToFolder, onTurnCurrentBlockInto,
    onOpenInNewWindow, onRevealActiveFile, onCopyActiveFilePath, onCopyActiveDeepLink, onOpenActiveFileExternal, onExportNoteAsPdf, onToggleFavorite, onToggleOrganized,
    onCustomizeNoteListColumns, canCustomizeNoteListColumns,
    onRestoreDeletedNote, canRestoreDeletedNote,
    selection, noteListFilter, onSetNoteListFilter,
    gitFeaturesEnabled, isGitVault, gitRepositories, onInitializeGit, onPullRepository,
  } = config

  const hasActiveNote = activeTabPath !== null

  const activeEntry = useMemo(
    () => (hasActiveNote ? entries.find(e => e.path === activeTabPath) : undefined),
    [entries, activeTabPath, hasActiveNote],
  )
  const isArchived = activeEntry?.archived ?? false
  const isFavorite = activeEntry?.favorite ?? false
  const isSectionGroup = selection?.kind === 'sectionGroup'
  const folderCreateOptions = useMemo(() => currentFolderCreateOptions(selection), [selection])
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
    hasActiveNote, activeTabPath, activeFileKind: activeEntry?.fileKind ?? 'markdown', isArchived, locale,
    currentFolderCreateOptions: folderCreateOptions, onCreateNote, onCreateType, onSave,
    onUndo, onRedo, canUndo, canRedo, undoLabel, redoLabel,
    onFindInNote, onReplaceInNote, onPastePlainText,
    onDeleteNote, onArchiveNote, onUnarchiveNote,
    onChangeNoteType, onMoveNoteToFolder, canMoveNoteToFolder,
    onTurnCurrentBlockInto,
    onSetNoteIcon, onRemoveNoteIcon, activeNoteHasIcon, onOpenInNewWindow,
    onRevealActiveFile, onCopyActiveFilePath, onOpenActiveFileExternal,
    onCopyActiveDeepLink, onExportNoteAsPdf,
    onToggleFavorite, isFavorite,
    onToggleOrganized, isOrganized: activeEntry?.organized ?? false,
    onRestoreDeletedNote, canRestoreDeletedNote,
  }), [
    hasActiveNote, activeTabPath, activeEntry?.fileKind, isArchived, locale,
    folderCreateOptions, onCreateNote, onCreateType, onSave, onUndo, onRedo, canUndo, canRedo, undoLabel, redoLabel,
    onFindInNote, onReplaceInNote, onPastePlainText, onDeleteNote, onArchiveNote, onUnarchiveNote,
    onChangeNoteType, onMoveNoteToFolder, canMoveNoteToFolder, onTurnCurrentBlockInto,
    onSetNoteIcon, onRemoveNoteIcon, activeNoteHasIcon, onOpenInNewWindow,
    onRevealActiveFile, onCopyActiveFilePath, onOpenActiveFileExternal,
    onCopyActiveDeepLink, onExportNoteAsPdf,
    onToggleFavorite, isFavorite,
    onToggleOrganized, activeEntry?.organized, onRestoreDeletedNote, canRestoreDeletedNote,
  ])

  const gitCommands = useMemo(() => buildGitCommands({
    modifiedCount,
    gitFeaturesEnabled,
    isGitVault,
    repositories: gitRepositories,
    canAddRemote: config.canAddRemote ?? false,
    onAddRemote: config.onAddRemote,
    onCommitPush,
    onInitializeGit,
    onPull,
    onPullRepository,
    onResolveConflicts,
    onSelect,
  }), [
    modifiedCount, gitFeaturesEnabled, isGitVault, gitRepositories, config.canAddRemote, config.onAddRemote,
    onCommitPush, onInitializeGit, onPull, onPullRepository, onResolveConflicts, onSelect,
  ])

  const viewCommands = useMemo(() => buildViewCommands({
    aiFeaturesEnabled,
    hasActiveNote, activeNoteModified, onSetViewMode, onToggleInspector,
    onToggleDiff, onToggleRawEditor, noteWidth, defaultNoteWidth, onSetNoteWidth, onSetDefaultNoteWidth, onToggleAIChat, onToggleTableOfContents, zoomLevel, onZoomIn, onZoomOut, onZoomReset,
    onCustomizeNoteListColumns, canCustomizeNoteListColumns, noteListColumnsLabel,
    selectedViewName, onMoveSelectedViewUp, onMoveSelectedViewDown, canMoveSelectedViewUp, canMoveSelectedViewDown,
  }), [
    aiFeaturesEnabled,
    hasActiveNote, activeNoteModified, onSetViewMode, onToggleInspector,
    onToggleDiff, onToggleRawEditor, noteWidth, defaultNoteWidth, onSetNoteWidth, onSetDefaultNoteWidth, onToggleAIChat, onToggleTableOfContents,
    zoomLevel, onZoomIn, onZoomOut, onZoomReset,
    onCustomizeNoteListColumns, canCustomizeNoteListColumns, noteListColumnsLabel,
    selectedViewName, onMoveSelectedViewUp, onMoveSelectedViewDown, canMoveSelectedViewUp, canMoveSelectedViewDown,
  ])

  const settingsCommands = useMemo(() => buildSettingsCommands({
    mcpStatus, vaultCount, isGettingStartedHidden,
    onOpenSettings, onOpenFeedback, onOpenVault, onCreateEmptyVault, onRemoveActiveVault, onRestoreGettingStarted,
    onCheckForUpdates, onInstallMcp, onReloadVault, onRepairVault,
    locale, systemLocale, selectedUiLanguage, onSetUiLanguage, onSetThemeMode,
  }), [
    mcpStatus, vaultCount, isGettingStartedHidden, onOpenSettings, onOpenFeedback,
    onOpenVault, onCreateEmptyVault, onRemoveActiveVault, onRestoreGettingStarted,
    onCheckForUpdates, onInstallMcp, onReloadVault, onRepairVault,
    locale, systemLocale, selectedUiLanguage, onSetUiLanguage, onSetThemeMode,
  ])

  const aiCommands = useMemo(() => buildAiAgentCommands({
    aiFeaturesEnabled,
    aiAgentsStatus,
    vaultAiGuidanceStatus,
    selectedAiAgent,
    selectedAiAgentLabel,
    onOpenAiAgents,
    onRestoreVaultAiGuidance,
    onSetDefaultAiAgent,
    onCycleDefaultAiAgent,
  }), [
    aiFeaturesEnabled,
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
