import { useCallback, useRef } from 'react'
import type { AiAgentId, AiAgentsStatus } from '../lib/aiAgents'
import type { AppLocale, UiLanguagePreference } from '../lib/i18n'
import type { VaultAiGuidanceStatus } from '../lib/vaultAiGuidance'
import { useAppKeyboard } from './useAppKeyboard'
import { useCommandRegistry } from './useCommandRegistry'
import type { CommandAction } from './useCommandRegistry'
import { useKeyboardNavigation } from './useKeyboardNavigation'
import { useMenuEvents } from './useMenuEvents'
import type { NoteLayout, SidebarSelection, SidebarFilter, VaultEntry } from '../types'
import { requestAddRemote } from '../utils/addRemoteEvents'
import type { NoteListFilter } from '../utils/noteListHelpers'
import type { ViewMode } from './useViewMode'
import type { NoteListMultiSelectionCommands } from '../components/note-list/multiSelectionCommands'

interface AppCommandsConfig {
  activeTabPath: string | null
  activeTabPathRef: React.MutableRefObject<string | null>
  entries: VaultEntry[]
  visibleNotesRef: React.RefObject<VaultEntry[]>
  multiSelectionCommandRef: React.MutableRefObject<NoteListMultiSelectionCommands | null>
  modifiedCount: number
  selection: SidebarSelection
  onQuickOpen: () => void
  onCommandPalette: () => void
  onSearch: () => void
  onFindInNote?: () => void
  onReplaceInNote?: () => void
  onCreateNote: () => void
  onCreateNoteOfType: (type: string) => void
  onSave: () => void
  onOpenSettings: () => void
  onOpenFeedback?: () => void
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
  noteLayout?: NoteLayout
  onToggleNoteLayout?: () => void
  activeNoteModified: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  zoomLevel: number
  onSelect: (sel: SidebarSelection) => void
  onRenameFolder?: () => void
  onDeleteFolder?: () => void
  showInbox?: boolean
  onReplaceActiveTab: (entry: VaultEntry) => void
  onSelectNote: (entry: VaultEntry) => void
  onGoBack?: () => void
  onGoForward?: () => void
  canGoBack?: boolean
  canGoForward?: boolean
  onOpenVault?: () => void
  onCreateEmptyVault?: () => void
  onAddRemote?: () => void
  canAddRemote?: boolean
  isGitVault?: boolean
  onInitializeGit?: () => void
  onCreateType?: () => void
  onToggleAIChat?: () => void
  onCheckForUpdates?: () => void
  onRemoveActiveVault?: () => void
  onRestoreGettingStarted?: () => void
  isGettingStartedHidden?: boolean
  vaultCount?: number
  locale?: AppLocale
  systemLocale?: AppLocale
  selectedUiLanguage?: UiLanguagePreference
  onSetUiLanguage?: (language: UiLanguagePreference) => void
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
  claudeCodeStatus?: string
  claudeCodeVersion?: string
  onReloadVault?: () => void
  onRepairVault?: () => void
  onSetNoteIcon?: () => void
  onRemoveNoteIcon?: () => void
  onChangeNoteType?: () => void
  onMoveNoteToFolder?: () => void
  canMoveNoteToFolder?: boolean
  activeNoteHasIcon?: boolean
  noteListFilter?: NoteListFilter
  onSetNoteListFilter?: (filter: NoteListFilter) => void
  onOpenInNewWindow?: () => void
  onRevealActiveFile?: (path: string) => void
  onCopyActiveFilePath?: (path: string) => void
  onOpenActiveFileExternal?: (path: string) => void
  onRevealSelectedFolder?: () => void
  onCopySelectedFolderPath?: () => void
  onToggleFavorite?: (path: string) => void
  onToggleOrganized?: (path: string) => void
  onCustomizeNoteListColumns?: () => void
  canCustomizeNoteListColumns?: boolean
  noteListColumnsLabel?: string
  onRestoreDeletedNote?: () => void
  canRestoreDeletedNote?: boolean
}

type CommandRegistryConfig = Parameters<typeof useCommandRegistry>[0]
type CommandRegistrySelectionState = Pick<
  CommandRegistryConfig,
  | 'activeNoteModified'
  | 'onZoomIn'
  | 'onZoomOut'
  | 'onZoomReset'
  | 'zoomLevel'
  | 'onSelect'
  | 'onRenameFolder'
  | 'onDeleteFolder'
  | 'onRevealSelectedFolder'
  | 'onCopySelectedFolderPath'
  | 'showInbox'
  | 'onGoBack'
  | 'onGoForward'
  | 'canGoBack'
  | 'canGoForward'
  | 'selection'
>
type CommandRegistryCoreActions = Pick<
  CommandRegistryConfig,
  | 'activeTabPath'
  | 'entries'
  | 'modifiedCount'
  | 'onQuickOpen'
  | 'onCreateNote'
  | 'onCreateNoteOfType'
  | 'onSave'
  | 'onFindInNote'
  | 'onReplaceInNote'
  | 'onOpenSettings'
  | 'onOpenFeedback'
  | 'onDeleteNote'
  | 'onArchiveNote'
  | 'onUnarchiveNote'
  | 'onCommitPush'
  | 'onPull'
  | 'onResolveConflicts'
  | 'onSetViewMode'
  | 'onToggleInspector'
  | 'onToggleDiff'
  | 'onToggleRawEditor'
  | 'noteLayout'
  | 'onToggleNoteLayout'
  | 'onToggleAIChat'
>
type CommandRegistryVaultActions = Pick<
  CommandRegistryConfig,
  | 'onOpenVault'
  | 'onCreateEmptyVault'
  | 'onAddRemote'
  | 'canAddRemote'
  | 'isGitVault'
  | 'onInitializeGit'
  | 'onCheckForUpdates'
  | 'onCreateType'
  | 'locale'
  | 'systemLocale'
  | 'selectedUiLanguage'
  | 'onSetUiLanguage'
  | 'onRemoveActiveVault'
  | 'onRestoreGettingStarted'
  | 'isGettingStartedHidden'
  | 'vaultCount'
  | 'onReloadVault'
  | 'onRepairVault'
  | 'onOpenInNewWindow'
  | 'onRevealActiveFile'
  | 'onCopyActiveFilePath'
  | 'onOpenActiveFileExternal'
  | 'onRestoreDeletedNote'
  | 'canRestoreDeletedNote'
>
type CommandRegistryAiActions = Pick<
  CommandRegistryConfig,
  | 'mcpStatus'
  | 'onInstallMcp'
  | 'aiAgentsStatus'
  | 'vaultAiGuidanceStatus'
  | 'onOpenAiAgents'
  | 'onRestoreVaultAiGuidance'
  | 'onSetDefaultAiAgent'
  | 'selectedAiAgent'
  | 'onCycleDefaultAiAgent'
  | 'selectedAiAgentLabel'
>
type CommandRegistryNoteActions = Pick<
  CommandRegistryConfig,
  | 'onSetNoteIcon'
  | 'onRemoveNoteIcon'
  | 'onChangeNoteType'
  | 'onMoveNoteToFolder'
  | 'canMoveNoteToFolder'
  | 'activeNoteHasIcon'
  | 'noteListFilter'
  | 'onSetNoteListFilter'
  | 'onToggleFavorite'
  | 'onToggleOrganized'
  | 'onCustomizeNoteListColumns'
  | 'canCustomizeNoteListColumns'
  | 'noteListColumnsLabel'
>

function createKeyboardActions(
  config: AppCommandsConfig,
): Omit<Parameters<typeof useAppKeyboard>[0], 'onArchiveNote'> {
  return {
    onQuickOpen: config.onQuickOpen,
    onCommandPalette: config.onCommandPalette,
    onSearch: config.onSearch,
    onFindInNote: config.onFindInNote,
    onReplaceInNote: config.onReplaceInNote,
    onCreateNote: config.onCreateNote,
    onSave: config.onSave,
    onOpenSettings: config.onOpenSettings,
    onDeleteNote: config.onDeleteNote,
    onSetViewMode: config.onSetViewMode,
    onZoomIn: config.onZoomIn,
    onZoomOut: config.onZoomOut,
    onZoomReset: config.onZoomReset,
    onGoBack: config.onGoBack,
    onGoForward: config.onGoForward,
    onToggleAIChat: config.onToggleAIChat,
    onToggleRawEditor: config.onToggleRawEditor,
    onToggleInspector: config.onToggleInspector,
    onToggleFavorite: config.onToggleFavorite,
    onToggleOrganized: config.onToggleOrganized,
    onOpenInNewWindow: config.onOpenInNewWindow,
    activeTabPathRef: config.activeTabPathRef,
    multiSelectionCommandRef: config.multiSelectionCommandRef,
  }
}

function createMenuEventHandlers(
  config: AppCommandsConfig,
  selectFilter: (filter: SidebarFilter) => void,
  viewChanges: () => void,
): Omit<Parameters<typeof useMenuEvents>[0], 'onArchiveNote'> {
  return {
    ...createMenuEventActionHandlers(config, selectFilter),
    ...createMenuEventVaultHandlers(config, viewChanges),
    ...createMenuEventState(config),
  }
}

function createMenuEventActionHandlers(
  config: AppCommandsConfig,
  selectFilter: (filter: SidebarFilter) => void,
): Pick<
  Omit<Parameters<typeof useMenuEvents>[0], 'onArchiveNote'>,
  | 'onSetViewMode'
  | 'onCreateNote'
  | 'onCreateType'
  | 'onQuickOpen'
  | 'onSave'
  | 'onOpenSettings'
  | 'onToggleInspector'
  | 'onCommandPalette'
  | 'onZoomIn'
  | 'onZoomOut'
  | 'onZoomReset'
  | 'onDeleteNote'
  | 'onFindInNote'
  | 'onReplaceInNote'
  | 'onSearch'
  | 'onToggleRawEditor'
  | 'onToggleDiff'
  | 'onToggleAIChat'
  | 'onToggleOrganized'
  | 'onGoBack'
  | 'onGoForward'
  | 'onCheckForUpdates'
  | 'onSelectFilter'
> {
  return {
    onSetViewMode: config.onSetViewMode,
    onCreateNote: config.onCreateNote,
    onCreateType: config.onCreateType,
    onQuickOpen: config.onQuickOpen,
    onSave: config.onSave,
    onOpenSettings: config.onOpenSettings,
    onToggleInspector: config.onToggleInspector,
    onCommandPalette: config.onCommandPalette,
    onZoomIn: config.onZoomIn,
    onZoomOut: config.onZoomOut,
    onZoomReset: config.onZoomReset,
    onDeleteNote: config.onDeleteNote,
    onFindInNote: config.onFindInNote,
    onReplaceInNote: config.onReplaceInNote,
    onSearch: config.onSearch,
    onToggleRawEditor: config.onToggleRawEditor,
    onToggleDiff: config.onToggleDiff,
    onToggleAIChat: config.onToggleAIChat,
    onToggleOrganized: config.onToggleOrganized,
    onGoBack: config.onGoBack,
    onGoForward: config.onGoForward,
    onCheckForUpdates: config.onCheckForUpdates,
    onSelectFilter: selectFilter,
  }
}

function createMenuEventVaultHandlers(
  config: AppCommandsConfig,
  viewChanges: () => void,
): Pick<
  Omit<Parameters<typeof useMenuEvents>[0], 'onArchiveNote'>,
  | 'onOpenVault'
  | 'onRemoveActiveVault'
  | 'onRestoreGettingStarted'
  | 'onAddRemote'
  | 'onCommitPush'
  | 'onPull'
  | 'onResolveConflicts'
  | 'onViewChanges'
  | 'onInstallMcp'
  | 'onReloadVault'
  | 'onRepairVault'
  | 'onOpenInNewWindow'
  | 'onRestoreDeletedNote'
> {
  return {
    onOpenVault: config.onOpenVault,
    onRemoveActiveVault: config.onRemoveActiveVault,
    onRestoreGettingStarted: config.onRestoreGettingStarted,
    onAddRemote: config.onAddRemote ?? requestAddRemote,
    onCommitPush: config.onCommitPush,
    onPull: config.onPull,
    onResolveConflicts: config.onResolveConflicts,
    onViewChanges: viewChanges,
    onInstallMcp: config.onInstallMcp,
    onReloadVault: config.onReloadVault,
    onRepairVault: config.onRepairVault,
    onOpenInNewWindow: config.onOpenInNewWindow,
    onRestoreDeletedNote: config.onRestoreDeletedNote,
  }
}

function createMenuEventState(
  config: AppCommandsConfig,
): Pick<
  Omit<Parameters<typeof useMenuEvents>[0], 'onArchiveNote'>,
  | 'activeTabPathRef'
  | 'multiSelectionCommandRef'
  | 'activeTabPath'
  | 'modifiedCount'
  | 'hasRestorableDeletedNote'
  | 'hasNoRemote'
> {
  return {
    activeTabPathRef: config.activeTabPathRef,
    multiSelectionCommandRef: config.multiSelectionCommandRef,
    activeTabPath: config.activeTabPath,
    modifiedCount: config.modifiedCount,
    hasRestorableDeletedNote: config.canRestoreDeletedNote,
    hasNoRemote: config.canAddRemote ?? true,
  }
}

function createCommandRegistrySelectionConfig(
  config: AppCommandsConfig,
): CommandRegistrySelectionState {
  return {
    activeNoteModified: config.activeNoteModified,
    onZoomIn: config.onZoomIn,
    onZoomOut: config.onZoomOut,
    onZoomReset: config.onZoomReset,
    zoomLevel: config.zoomLevel,
    onSelect: config.onSelect,
    onRenameFolder: config.onRenameFolder,
    onDeleteFolder: config.onDeleteFolder,
    onRevealSelectedFolder: config.onRevealSelectedFolder,
    onCopySelectedFolderPath: config.onCopySelectedFolderPath,
    showInbox: config.showInbox,
    onGoBack: config.onGoBack,
    onGoForward: config.onGoForward,
    canGoBack: config.canGoBack,
    canGoForward: config.canGoForward,
    selection: config.selection,
  }
}

function createCommandRegistryCoreConfig(
  config: AppCommandsConfig,
): CommandRegistryCoreActions {
  return {
    activeTabPath: config.activeTabPath,
    entries: config.entries,
    modifiedCount: config.modifiedCount,
    onQuickOpen: config.onQuickOpen,
    onCreateNote: config.onCreateNote,
    onCreateNoteOfType: config.onCreateNoteOfType,
    onSave: config.onSave,
    onOpenSettings: config.onOpenSettings,
    onOpenFeedback: config.onOpenFeedback,
    onDeleteNote: config.onDeleteNote,
    onArchiveNote: config.onArchiveNote,
    onUnarchiveNote: config.onUnarchiveNote,
    onCommitPush: config.onCommitPush,
    onPull: config.onPull,
    onResolveConflicts: config.onResolveConflicts,
    onSetViewMode: config.onSetViewMode,
    onToggleInspector: config.onToggleInspector,
    onToggleDiff: config.onToggleDiff,
    onToggleRawEditor: config.onToggleRawEditor,
    onFindInNote: config.onFindInNote,
    onReplaceInNote: config.onReplaceInNote,
    noteLayout: config.noteLayout,
    onToggleNoteLayout: config.onToggleNoteLayout,
    onToggleAIChat: config.onToggleAIChat,
  }
}

function createCommandRegistryVaultConfig(
  config: AppCommandsConfig,
): CommandRegistryVaultActions {
  return {
    onOpenVault: config.onOpenVault,
    onCreateEmptyVault: config.onCreateEmptyVault,
    onAddRemote: config.onAddRemote ?? requestAddRemote,
    canAddRemote: config.canAddRemote ?? true,
    isGitVault: config.isGitVault,
    onInitializeGit: config.onInitializeGit,
    onCheckForUpdates: config.onCheckForUpdates,
    onCreateType: config.onCreateType,
    locale: config.locale,
    systemLocale: config.systemLocale,
    selectedUiLanguage: config.selectedUiLanguage,
    onSetUiLanguage: config.onSetUiLanguage,
    onRemoveActiveVault: config.onRemoveActiveVault,
    onRestoreGettingStarted: config.onRestoreGettingStarted,
    isGettingStartedHidden: config.isGettingStartedHidden,
    vaultCount: config.vaultCount,
    onReloadVault: config.onReloadVault,
    onRepairVault: config.onRepairVault,
    onOpenInNewWindow: config.onOpenInNewWindow,
    onRevealActiveFile: config.onRevealActiveFile,
    onCopyActiveFilePath: config.onCopyActiveFilePath,
    onOpenActiveFileExternal: config.onOpenActiveFileExternal,
    onRestoreDeletedNote: config.onRestoreDeletedNote,
    canRestoreDeletedNote: config.canRestoreDeletedNote,
  }
}

function createCommandRegistryAiConfig(
  config: AppCommandsConfig,
): CommandRegistryAiActions {
  return {
    mcpStatus: config.mcpStatus,
    onInstallMcp: config.onInstallMcp,
    aiAgentsStatus: config.aiAgentsStatus,
    vaultAiGuidanceStatus: config.vaultAiGuidanceStatus,
    onOpenAiAgents: config.onOpenAiAgents,
    onRestoreVaultAiGuidance: config.onRestoreVaultAiGuidance,
    onSetDefaultAiAgent: config.onSetDefaultAiAgent,
    selectedAiAgent: config.selectedAiAgent,
    onCycleDefaultAiAgent: config.onCycleDefaultAiAgent,
    selectedAiAgentLabel: config.selectedAiAgentLabel,
  }
}

function createCommandRegistryNoteConfig(
  config: AppCommandsConfig,
): CommandRegistryNoteActions {
  return {
    onSetNoteIcon: config.onSetNoteIcon,
    onRemoveNoteIcon: config.onRemoveNoteIcon,
    onChangeNoteType: config.onChangeNoteType,
    onMoveNoteToFolder: config.onMoveNoteToFolder,
    canMoveNoteToFolder: config.canMoveNoteToFolder,
    activeNoteHasIcon: config.activeNoteHasIcon,
    noteListFilter: config.noteListFilter,
    onSetNoteListFilter: config.onSetNoteListFilter,
    onToggleFavorite: config.onToggleFavorite,
    onToggleOrganized: config.onToggleOrganized,
    onCustomizeNoteListColumns: config.onCustomizeNoteListColumns,
    canCustomizeNoteListColumns: config.canCustomizeNoteListColumns,
    noteListColumnsLabel: config.noteListColumnsLabel,
  }
}

function createCommandRegistryConfig(config: AppCommandsConfig): CommandRegistryConfig {
  return {
    ...createCommandRegistryCoreConfig(config),
    ...createCommandRegistrySelectionConfig(config),
    ...createCommandRegistryVaultConfig(config),
    ...createCommandRegistryAiConfig(config),
    ...createCommandRegistryNoteConfig(config),
  }
}

/** Sets up keyboard shortcuts, command registry, menu events, and keyboard navigation. */
export function useAppCommands(config: AppCommandsConfig): CommandAction[] {
  const entriesRef = useRef(config.entries)
  // eslint-disable-next-line react-hooks/refs
  entriesRef.current = config.entries

  const toggleArchive = useCallback((path: string) => {
    const entry = entriesRef.current.find(e => e.path === path)
    ;(entry?.archived ? config.onUnarchiveNote : config.onArchiveNote)(path)
  }, [config.onArchiveNote, config.onUnarchiveNote])


  const { onSelect } = config

  const selectFilter = useCallback((filter: SidebarFilter) => {
    const safeFilter = !config.showInbox && filter === 'inbox' ? 'all' : filter
    onSelect({ kind: 'filter', filter: safeFilter })
  }, [config.showInbox, onSelect])

  const viewChanges = useCallback(() => {
    onSelect({ kind: 'filter', filter: 'changes' })
  }, [onSelect])

  const keyboardActions = createKeyboardActions(config)
  const menuEventHandlers = createMenuEventHandlers(config, selectFilter, viewChanges)

  useAppKeyboard({ ...keyboardActions, onArchiveNote: toggleArchive })

  useMenuEvents({ ...menuEventHandlers, onArchiveNote: toggleArchive })

  const commands = useCommandRegistry(createCommandRegistryConfig(config))

  useKeyboardNavigation({
    activeTabPath: config.activeTabPath,
    visibleNotesRef: config.visibleNotesRef,
    onReplaceActiveTab: config.onReplaceActiveTab,
    onSelectNote: config.onSelectNote,
  })

  return commands
}
