import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { NoteList } from './components/NoteList'
import { Editor } from './components/Editor'
import { ResizeHandle } from './components/ResizeHandle'
import { CreateTypeDialog } from './components/CreateTypeDialog'
import { CreateViewDialog } from './components/CreateViewDialog'
import { QuickOpenPalette } from './components/QuickOpenPalette'
import { CommandPalette } from './components/CommandPalette'
import { SearchPanel } from './components/SearchPanel'
import { Toast } from './components/Toast'
import { CommitDialog } from './components/CommitDialog'
import { PulseView } from './components/PulseView'
import { StatusBar } from './components/StatusBar'
import { AppAiWorkspaceSurface } from './components/AppAiWorkspaceSurface'
import { AiWorkspaceWindowApp } from './components/AiWorkspaceWindowApp'
import { SettingsPanel } from './components/SettingsPanel'
import { CloneVaultModal } from './components/CloneVaultModal'
import { FeedbackDialog } from './components/FeedbackDialog'
import { McpSetupDialog } from './components/McpSetupDialog'
import { NoteRetargetingDialogs } from './components/note-retargeting/NoteRetargetingDialogs'
import { StartupScreen } from './components/StartupScreen'
import { useMcpStatus } from './hooks/useMcpStatus'
import { useAiAgentsOnboarding } from './hooks/useAiAgentsOnboarding'
import { useAiAgentsStatus } from './hooks/useAiAgentsStatus'
import { useVaultAiGuidanceStatus } from './hooks/useVaultAiGuidanceStatus'
import { useAutoGit } from './hooks/useAutoGit'
import { useVaultLoader } from './hooks/useVaultLoader'
import { useRecentVaultWrites, useVaultWatcher } from './hooks/useVaultWatcher'
import { useSettings } from './hooks/useSettings'
import { useNoteWidthMode } from './hooks/useNoteWidthMode'
import { useNoteActions } from './hooks/useNoteActions'
import { planNewTypeCreation } from './hooks/useNoteCreation'
import { useCommitFlow } from './hooks/useCommitFlow'
import { useGitRepositories } from './hooks/useGitRepositories'
import { useViewMode, type ViewMode } from './hooks/useViewMode'
import { useEntryActions } from './hooks/useEntryActions'
import { useAppCommands } from './hooks/useAppCommands'
import { triggerCommitEntryAction } from './utils/commitEntryAction'
import { generateCommitMessage } from './utils/commitMessage'
import { useDialogs } from './hooks/useDialogs'
import { useVaultSwitcher } from './hooks/useVaultSwitcher'
import { useGitHistory } from './hooks/useGitHistory'
import { useUpdater, restartApp } from './hooks/useUpdater'
import { useAutoSync } from './hooks/useAutoSync'
import { useConflictResolver } from './hooks/useConflictResolver'
import { useZoom } from './hooks/useZoom'
import { useVaultConfig } from './hooks/useVaultConfig'
import { useBuildNumber } from './hooks/useBuildNumber'
import { useOnboarding } from './hooks/useOnboarding'
import { useGettingStartedClone } from './hooks/useGettingStartedClone'
import { useNetworkStatus } from './hooks/useNetworkStatus'
import { useAppNavigation } from './hooks/useAppNavigation'
import {
  applyMainWindowSizeConstraints,
  getMainWindowMinWidth,
  useMainWindowSizeConstraints,
} from './hooks/useMainWindowSizeConstraints'
import { useAiActivity } from './hooks/useAiActivity'
import { useBulkActions } from './hooks/useBulkActions'
import { useDeleteActions } from './hooks/useDeleteActions'
import { useFolderActions } from './hooks/useFolderActions'
import { useFileActions } from './hooks/useFileActions'
import { useLayoutPanels } from './hooks/useLayoutPanels'
import { useConflictFlow } from './hooks/useConflictFlow'
import { useAppSave } from './hooks/useAppSave'
import { useNoteRetargetingUi } from './hooks/useNoteRetargetingUi'
import { useVaultBridge } from './hooks/useVaultBridge'
import { useSavedViewOrdering } from './hooks/useSavedViewOrdering'
import {
  useNeighborhoodEntry,
  useNeighborhoodEscape,
  useNeighborhoodHistoryBack,
  useSelectionSanitizer,
} from './hooks/useNeighborhoodSelection'
import { createViewFilename } from './utils/viewFilename'
import { nextViewOrder } from './utils/viewOrdering'
import { viewMatchesSelection, viewVaultPath } from './utils/viewIdentity'
import { viewCreationVaultPath } from './utils/viewTargetVault'
import { ConflictResolverModal } from './components/ConflictResolverModal'
import { ConfirmDeleteDialog } from './components/ConfirmDeleteDialog'
import { DeleteProgressNotice } from './components/DeleteProgressNotice'
import { UpdateBanner } from './components/UpdateBanner'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from './mock-tauri'
import type { AiWorkspaceConversationSetting, GitSetupPreference, SidebarSelection, InboxPeriod, ModifiedFile, VaultEntry, ViewDefinition, ViewFile, WorkspaceIdentity } from './types'
import type { NoteListItem } from './utils/ai-context'
import { initializeNoteProperties } from './utils/initializeNoteProperties'
import { filterEntries, filterInboxEntries, type NoteListFilter } from './utils/noteListHelpers'
import { openNoteInNewWindow } from './utils/openNoteWindow'
import { isWindows } from './utils/platform'
import { getPulledVaultUpdateOptions, refreshPulledVaultState } from './utils/pulledVaultRefresh'
import { isAiWorkspaceWindow, isNoteWindow, getNoteWindowParams, type NoteWindowParams } from './utils/windowMode'
import { GitSetupDialog } from './components/GitRequiredModal'
import { RenameDetectedBanner } from './components/RenameDetectedBanner'
import { openNoteListPropertiesPicker } from './components/note-list/noteListPropertiesEvents'
import type { NoteListMultiSelectionCommands } from './components/note-list/multiSelectionCommands'
import { focusNoteIconPropertyEditor } from './components/noteIconPropertyEvents'
import { trackEvent } from './lib/telemetry'
import { areAiFeaturesEnabled } from './lib/aiFeatures'
import { areGitFeaturesEnabled } from './lib/gitSettings'
import { useAppCommandAiActions } from './hooks/useAppCommandAiActions'
import { TOLARIA_DOCS_URL } from './constants/feedback'
import { openExternalUrl } from './utils/url'
import {
  translate,
} from './lib/i18n'
import { normalizeReleaseChannel } from './lib/releaseChannel'
import {
  buildVaultAiGuidanceRefreshKey,
} from './lib/vaultAiGuidance'
import { isActiveVaultUnavailableError } from './utils/vaultErrors'
import { hasNoteIconValue } from './utils/noteIcon'
import {
  INBOX_SELECTION,
  isExplicitOrganizationEnabled,
  sanitizeSelectionForOrganization,
} from './utils/organizationWorkflow'
import { requestPlainTextPaste } from './utils/plainTextPaste'
import { SETTINGS_SECTION_IDS } from './components/settingsSectionIds'
import {
  vaultPathForEntry,
} from './utils/workspaces'
import { activeGitRepositories } from './utils/gitRepositories'
import { useVisibleWorkspaceEntries, useWorkspaceGraphState } from './hooks/useWorkspaceGraphState'
import { useGitSetupState } from './hooks/useGitSetupState'
import { AppPreferencesProvider, useAppPreferences } from './hooks/useAppPreferences'
import { useInboxOrganizeAdvance } from './hooks/useInboxOrganizeAdvance'
import { syncVaultAssetScope, useNoteWindowLifecycle } from './hooks/useNoteWindowLifecycle'
import { useVaultRenameDetection } from './hooks/useVaultRenameDetection'
import { useVaultOpenedTelemetry } from './hooks/useVaultOpenedTelemetry'
import { useStartupScreenState } from './hooks/useStartupScreenState'
import { useGitFileWorkflows } from './hooks/useGitFileWorkflows'
import { useAutoGitWork } from './hooks/useAutoGitWork'
import { useAppAiWorkspaceBridge } from './hooks/useAppAiWorkspaceBridge'
import type { AiWorkspaceWindowContext } from './utils/openAiWorkspaceWindow'
import './App.css'

const ACTIVE_EDITOR_SURFACE_SELECTOR = '.editor__blocknote-container, .raw-editor-codemirror'

function isActiveElementInsideEditorSurface(): boolean {
  const activeElement = document.activeElement
  if (!(activeElement instanceof HTMLElement)) return false
  return Boolean(activeElement.closest(ACTIVE_EDITOR_SURFACE_SELECTOR))
}

function isTextEditingElementFocused(): boolean {
  const activeElement = document.activeElement
  if (!(activeElement instanceof HTMLElement)) return false
  return activeElement.tagName === 'INPUT'
    || activeElement.tagName === 'TEXTAREA'
    || activeElement.isContentEditable
    || activeElement.closest('[contenteditable="true"]') !== null
}

function runNativeTextHistoryCommand(command: 'undo' | 'redo'): boolean {
  if (!isTextEditingElementFocused()) return false
  document.execCommand(command)
  return true
}

// Type declarations for mock content storage and test overrides
declare global {
  interface Window {
    __mockContent?: Record<string, string>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock handler map for Playwright test overrides
    __mockHandlers?: Record<string, (args: any) => any>
  }
}

const DEFAULT_SELECTION: SidebarSelection = INBOX_SELECTION

function modifiedFileKey(file: ModifiedFile): string {
  return `${file.vaultPath ?? ''}\0${file.relativePath}\0${file.status}`
}

function activeVaultModifiedFiles(files: ModifiedFile[], vaultPath: string): ModifiedFile[] {
  return files.map((file) => ({ ...file, vaultPath: file.vaultPath ?? vaultPath }))
}

function mergeModifiedFiles(...groups: ModifiedFile[][]): ModifiedFile[] {
  const byKey = new Map<string, ModifiedFile>()
  for (const group of groups) {
    for (const file of group) {
      byKey.set(modifiedFileKey(file), file)
    }
  }
  return [...byKey.values()]
}

function shouldPreferOnboardingVaultPath(
  onboardingState: { status: string; vaultPath?: string },
  vaults: Array<{ path: string }>,
): onboardingState is { status: 'ready'; vaultPath: string } {
  return onboardingState.status === 'ready'
    && typeof onboardingState.vaultPath === 'string'
    && onboardingState.vaultPath.length > 0
    && !vaults.some((vault) => vault.path === onboardingState.vaultPath)
}

function canCustomizeColumnsForSelection(
  selection: SidebarSelection,
  explicitOrganizationEnabled: boolean,
): boolean {
  if (selection.kind === 'view') return true
  if (selection.kind !== 'filter') return false
  if (selection.filter === 'all') return true
  return explicitOrganizationEnabled && selection.filter === 'inbox'
}

function viewsForVault(views: ViewFile[], vaultPath: string): ViewFile[] {
  return views.filter((view) => !view.rootPath || view.rootPath === vaultPath)
}

function viewSelection(filename: string, rootPath?: string): SidebarSelection {
  return rootPath
    ? { kind: 'view', filename, rootPath }
    : { kind: 'view', filename }
}

function savedViewFilename(
  definition: ViewDefinition,
  editingView: { filename: string } | null,
  existingViews: ViewFile[],
): string {
  return editingView
    ? editingView.filename
    : createViewFilename(definition.name, existingViews.map((view) => view.filename))
}

function savedViewDefinition(
  definition: ViewDefinition,
  editingView: { definition: ViewDefinition } | null,
  existingViews: ViewFile[],
): ViewDefinition {
  return editingView
    ? { ...editingView.definition, ...definition }
    : { ...definition, order: nextViewOrder(existingViews) }
}

function shouldPreserveViewRootPath(views: ViewFile[], editingRootPath?: string): boolean {
  return Boolean(editingRootPath) || views.some((view) => view.rootPath)
}

function aiWorkspaceWindowContextForPath(resolvedPath: string): AiWorkspaceWindowContext {
  return {
    vaultPath: resolvedPath,
    vaultPaths: resolvedPath ? [resolvedPath] : [],
  }
}

/** Wraps useEditorSave to also keep outgoingLinks in sync on save and on content change. */
function App() {
  const noteWindowParams = useMemo(() => isNoteWindow() ? getNoteWindowParams() : null, [])
  const aiWorkspaceWindow = useMemo(() => isAiWorkspaceWindow(), [])

  if (aiWorkspaceWindow) return <AiWorkspaceWindowApp />

  return <MainApp noteWindowParams={noteWindowParams} />
}

function MainApp({ noteWindowParams }: { noteWindowParams: NoteWindowParams | null }) {
  const aiWorkspaceWindow = false
  const [selection, setSelection] = useState<SidebarSelection>(DEFAULT_SELECTION)
  const [noteListFilter, setNoteListFilter] = useState<NoteListFilter>('open')
  const selectionRef = useRef<SidebarSelection>(DEFAULT_SELECTION)
  const neighborhoodHistoryRef = useRef<SidebarSelection[]>([])
  const inboxPeriod: InboxPeriod = 'all'
  const handleSetSelection = useCallback((sel: SidebarSelection, options?: { preserveNeighborhoodHistory?: boolean }) => {
    if (!options?.preserveNeighborhoodHistory && sel.kind !== 'entity') {
      neighborhoodHistoryRef.current = []
    }
    selectionRef.current = sel
    setSelection(sel)
    setNoteListFilter('open')
  }, [])
  const handleEnterNeighborhood = useNeighborhoodEntry({
    neighborhoodHistoryRef,
    selectionRef,
    setSelection: handleSetSelection,
  })
  const layout = useLayoutPanels(noteWindowParams || aiWorkspaceWindow ? { initialInspectorCollapsed: true } : undefined)
  const { setInspectorCollapsed } = layout
  const visibleNotesRef = useRef<VaultEntry[]>([])
  const multiSelectionCommandRef = useRef<NoteListMultiSelectionCommands | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const dialogs = useDialogs()
  const { closeAIChat, openAIChat, showAIChat } = dialogs
  const [showFeedback, setShowFeedback] = useState(false)
  const [showMcpSetupDialog, setShowMcpSetupDialog] = useState(false)
  const [mcpDialogAction, setMcpDialogAction] = useState<'connect' | 'disconnect' | null>(null)
  const openFeedback = useCallback(() => setShowFeedback(true), [])
  const closeFeedback = useCallback(() => setShowFeedback(false), [])
  const openDocs = useCallback(() => {
    void openExternalUrl(TOLARIA_DOCS_URL)
  }, [])
  const networkStatus = useNetworkStatus()
  const { settings, loaded: settingsLoaded, saveSettings } = useSettings()
  const aiFeaturesEnabled = areAiFeaturesEnabled(settings)

  // onSwitch closure captures `notes` declared below — safe because it's only
  // called on user interaction, never during render (refs inside the hook
  // guarantee the latest closure is always used).
  const vaultSwitcher = useVaultSwitcher({
    onSwitch: () => {
      if (noteWindowParams || aiWorkspaceWindow) return
      handleSetSelection(DEFAULT_SELECTION)
      notes.closeAllTabs()
    },
    onToast: (msg) => setToastMessage(msg),
  })
  const {
    allVaults,
    defaultWorkspacePath,
    registerVaultSelection,
    selectedVaultPath,
    syncVaultSelection,
    switchVault,
  } = vaultSwitcher

  const rememberVaultChoice = useCallback((vaultPath: string) => {
    if (!vaultPath) return

    if (allVaults.some((vault) => vault.path === vaultPath)) {
      switchVault(vaultPath)
      return
    }

    const label = vaultPath.split('/').filter(Boolean).pop() || 'Local Vault'
    syncVaultSelection(vaultPath, label)
  }, [allVaults, switchVault, syncVaultSelection])

  const handleGettingStartedVaultReady = useCallback((vaultPath: string) => {
    rememberVaultChoice(vaultPath)
    setToastMessage(`Getting Started vault cloned and opened at ${vaultPath}`)
  }, [rememberVaultChoice])

  const handleOnboardingVaultReady = useCallback((vaultPath: string, source: 'template' | 'empty' | 'existing') => {
    rememberVaultChoice(vaultPath)
    if (source === 'template') {
      setToastMessage(`Getting Started vault cloned and opened at ${vaultPath}`)
    }
  }, [rememberVaultChoice])
  const cloneGettingStartedVault = useGettingStartedClone({
    onError: (message) => setToastMessage(message),
    onSuccess: handleGettingStartedVaultReady,
  })
  const onboarding = useOnboarding(vaultSwitcher.vaultPath, {
    onVaultReady: handleOnboardingVaultReady,
    registerVault: registerVaultSelection,
  }, vaultSwitcher.loaded)
  const aiAgentsStatus = useAiAgentsStatus()
  const aiAgentsOnboarding = useAiAgentsOnboarding(
    aiFeaturesEnabled && onboarding.state.status === 'ready' && !noteWindowParams && !aiWorkspaceWindow,
  )

  // Onboarding can briefly own the vault path for a newly created/opened vault
  // before the persisted switcher catches up, but once the path is already in
  // the switcher list we should trust the explicit switcher state.
  const resolvedPath = noteWindowParams?.vaultPath ?? (
    shouldPreferOnboardingVaultPath(onboarding.state, vaultSwitcher.allVaults)
      ? onboarding.state.vaultPath
      : vaultSwitcher.vaultPath
  )
  const aiWorkspaceWindowContext = aiWorkspaceWindowContextForPath(resolvedPath)
  const [settingsInitialSectionId, setSettingsInitialSectionId] = useState<string | null>(null)
  const {
    effectiveShowAIChat,
    handleDockCurrentAiWorkspaceWindow,
    handleOpenAiSettings,
    handleOpenDockedAiWorkspace,
    handlePopOutAiWorkspace,
  } = useAppAiWorkspaceBridge({
    aiFeaturesEnabled,
    aiWorkspaceWindow,
    closeAIChat,
    openAIChat,
    openSettings: dialogs.openSettings,
    setSettingsInitialSectionId,
    showAIChat,
    windowContext: aiWorkspaceWindowContext,
  })
  const {
    folderVaults,
    graphDefaultWorkspacePath,
    graphVaults,
    inspectorWorkspaces,
    multiWorkspaceEnabled,
    visibleWorkspacePathList,
    writableVaultPaths,
  } = useWorkspaceGraphState({
    allVaults,
    defaultWorkspacePath,
    resolvedPath,
    settings,
    vaultSwitcherLoaded: vaultSwitcher.loaded,
    windowMode: Boolean(noteWindowParams) || aiWorkspaceWindow,
  })
  const vaultWorkspaceOrder = useMemo(
    () => vaultSwitcher.allVaults.map((vault) => vault.path),
    [vaultSwitcher.allVaults],
  )
  const { config: vaultConfig, updateConfig } = useVaultConfig(resolvedPath)
  const gitFeaturesEnabled = areGitFeaturesEnabled(settings)
  const handleGitSetupPreferenceChange = useCallback((preference: GitSetupPreference) => {
    updateConfig('git_setup_preference', preference)
  }, [updateConfig])
  const {
    dismissGitSetupDialog,
    gitRepoState,
    handleInitGitRepo,
    neverForVaultGitSetupDialog,
    openGitSetupDialog,
    shouldShowGitSetupDialog,
  } = useGitSetupState({
    gitSetupPreference: vaultConfig.git_setup_preference,
    onGitSetupPreferenceChange: handleGitSetupPreferenceChange,
    onToast: setToastMessage,
    resolvedPath,
    windowMode: Boolean(noteWindowParams) || aiWorkspaceWindow,
  })

  const vault = useVaultLoader(resolvedPath, graphVaults, multiWorkspaceEnabled ? defaultWorkspacePath : null, folderVaults)
  const gitRepositories = useMemo(() => activeGitRepositories({
    defaultVaultPath: graphDefaultWorkspacePath,
    multiWorkspaceEnabled,
    vaults: allVaults,
  }), [allVaults, graphDefaultWorkspacePath, multiWorkspaceEnabled])
  const activeGitRepositoryPaths = useMemo(
    () => gitRepositories.map((repository) => repository.path),
    [gitRepositories],
  )
  const gitSurfaces = useGitRepositories({
    defaultVaultPath: graphDefaultWorkspacePath,
    repositories: gitRepositories,
  })
  const watchedVaultPaths = useMemo(() => {
    if (visibleWorkspacePathList && visibleWorkspacePathList.length > 0) return visibleWorkspacePathList
    return resolvedPath.trim() ? [resolvedPath] : []
  }, [resolvedPath, visibleWorkspacePathList])
  const visibleEntries = useVisibleWorkspaceEntries({
    entries: vault.entries,
    multiWorkspaceEnabled,
    visibleWorkspacePathList,
  })
  const runtimeMissingVaultPath = vault.unavailableVaultPath
  const {
    markInternalWrite: markRecentVaultWrite,
    filterExternalPaths: filterExternalVaultPaths,
  } = useRecentVaultWrites({
    vaultPath: resolvedPath,
    vaultPaths: watchedVaultPaths,
  })
  const {
    status: vaultAiGuidanceStatus,
    refresh: refreshVaultAiGuidance,
  } = useVaultAiGuidanceStatus(
    aiFeaturesEnabled ? resolvedPath : null,
    buildVaultAiGuidanceRefreshKey(vault.entries),
  )
  const explicitOrganizationEnabled = isExplicitOrganizationEnabled(vaultConfig.inbox?.explicitOrganization)
  const effectiveSelection = sanitizeSelectionForOrganization(selection, vaultConfig.inbox?.explicitOrganization)
  const isChangesSelection = effectiveSelection.kind === 'filter' && effectiveSelection.filter === 'changes'

  useSelectionSanitizer({
    effectiveSelection,
    neighborhoodHistoryRef,
    selection,
    selectionRef,
    setNoteListFilter,
    setSelection,
  })

  const handleNeighborhoodHistoryBack = useNeighborhoodHistoryBack({
    neighborhoodHistoryRef,
    setSelection: handleSetSelection,
  })

  const handleSaveExplicitOrganization = useCallback((enabled: boolean) => {
    updateConfig('inbox', {
      noteListProperties: vaultConfig.inbox?.noteListProperties ?? null,
      explicitOrganization: enabled,
    })
  }, [updateConfig, vaultConfig.inbox?.noteListProperties])
  const {
    aiAgentPreferences,
    allNotesFileVisibility,
    appLocale,
    dateDisplayFormat,
    documentThemeMode,
    handleSetThemeMode,
    handleSetUiLanguage,
    handleToggleThemeMode,
    selectedUiLanguage,
    systemLocale,
  } = useAppPreferences({
    aiAgentsStatus,
    onToast: setToastMessage,
    saveSettings,
    settings,
    settingsLoaded,
  })

  useVaultOpenedTelemetry({
    entryCount: vault.entries.length,
    gitRepoState,
    resolvedPath,
  })
  const {
    mcpStatus,
    connectMcp,
    disconnectMcp,
    mcpConfigSnippet,
    mcpConfigLoading,
    mcpConfigError,
    loadMcpConfigSnippet,
    copyMcpConfig,
  } = useMcpStatus(resolvedPath, setToastMessage, appLocale)
  const loadDefaultVaultModifiedFiles = vault.loadModifiedFiles
  const loadAllGitModifiedFiles = gitSurfaces.loadAllModifiedFiles
  const loadModifiedFilesForRepository = gitSurfaces.loadModifiedFilesForRepository
  const refreshAllGitRemoteStatuses = gitSurfaces.refreshAllRemoteStatuses
  const refreshRemoteStatusForRepository = gitSurfaces.refreshRemoteStatusForRepository
  const refreshGitRemoteStatus = useCallback(
    () => refreshRemoteStatusForRepository(resolvedPath),
    [refreshRemoteStatusForRepository, resolvedPath],
  )
  const refreshGitModifiedFiles = useCallback(async () => {
    if (!gitFeaturesEnabled) return
    await Promise.all([
      loadDefaultVaultModifiedFiles(),
      loadAllGitModifiedFiles({ includeStats: isChangesSelection }),
    ])
  }, [gitFeaturesEnabled, isChangesSelection, loadAllGitModifiedFiles, loadDefaultVaultModifiedFiles])
  const loadVaultModifiedFiles = refreshGitModifiedFiles

  useEffect(() => {
    if (!gitFeaturesEnabled) return
    if (gitRepoState !== 'ready') return
    void loadVaultModifiedFiles()
    void refreshGitRemoteStatus()
    void refreshAllGitRemoteStatuses()
  }, [gitFeaturesEnabled, gitRepoState, loadVaultModifiedFiles, refreshAllGitRemoteStatuses, refreshGitRemoteStatus])

  const openMcpSetupDialog = useCallback(() => {
    setShowMcpSetupDialog(true)
  }, [])

  const closeMcpSetupDialog = useCallback(() => {
    if (mcpDialogAction !== null) return
    setShowMcpSetupDialog(false)
  }, [mcpDialogAction])

  const handleConnectMcp = useCallback(async () => {
    setMcpDialogAction('connect')
    try {
      const didConnect = await connectMcp()
      if (didConnect) setShowMcpSetupDialog(false)
    } finally {
      setMcpDialogAction(null)
    }
  }, [connectMcp])

  const handleDisconnectMcp = useCallback(async () => {
    setMcpDialogAction('disconnect')
    try {
      const didDisconnect = await disconnectMcp()
      if (didDisconnect) setShowMcpSetupDialog(false)
    } finally {
      setMcpDialogAction(null)
    }
  }, [disconnectMcp])

  const handleCopyMcpConfig = useCallback(() => {
    void copyMcpConfig()
  }, [copyMcpConfig])

  const handleOpenSettings = useCallback(() => {
    setSettingsInitialSectionId(null)
    dialogs.openSettings()
  }, [dialogs])

  const handleOpenVaultSettings = useCallback(() => {
    setSettingsInitialSectionId(SETTINGS_SECTION_IDS.workspaces)
    dialogs.openSettings()
  }, [dialogs])

  const handleLoadMcpConfigSnippet = useCallback(() => {
    void loadMcpConfigSnippet().catch(() => undefined)
  }, [loadMcpConfigSnippet])

  const {
    detectedRenames,
    handleUpdateWikilinks,
    handleDismissRenames,
  } = useVaultRenameDetection({
    reloadVault: vault.reloadVault,
    setToastMessage,
    vaultPath: resolvedPath,
  })

  const conflictResolver = useConflictResolver({
    vaultPath: resolvedPath,
    onResolved: () => {
      dialogs.closeConflictResolver()
      autoSync.resumePull()
      vault.reloadVault()
      autoSync.triggerSync()
    },
    onToast: (msg) => setToastMessage(msg),
    onOpenFile: (relativePath) => conflictFlow.openConflictFileRef.current(relativePath),
  })
  const flushPendingEditorContentRef = useRef<((path: string) => void) | null>(null)
  const flushPendingRawContentRef = useRef<((path: string) => void) | null>(null)
  const appSaveFlushBeforeActionRef = useRef<((path: string) => Promise<unknown>) | null>(null)
  const flushEditorStateBeforeAction = useCallback(async (path: string) => {
    flushPendingEditorContentRef.current?.(path)
    flushPendingRawContentRef.current?.(path)
    await appSaveFlushBeforeActionRef.current?.(path)
  }, [])
  const handleCreatedVaultEntryPersisting = useCallback((path: string) => {
    markRecentVaultWrite(path)
    vault.addPendingSave(path)
  }, [markRecentVaultWrite, vault])
  const handleCreatedVaultEntryPersisted = useCallback((path: string) => {
    markRecentVaultWrite(path)
    void refreshGitModifiedFiles()
  }, [markRecentVaultWrite, refreshGitModifiedFiles])
  const handleMissingActiveVault = useCallback(() => {
    if (!noteWindowParams && !aiWorkspaceWindow && resolvedPath) vault.markVaultUnavailable(resolvedPath)
  }, [aiWorkspaceWindow, noteWindowParams, resolvedPath, vault])

  const notes = useNoteActions({
    addEntry: vault.addEntry,
    removeEntry: vault.removeEntry,
    entries: visibleEntries,
    flushBeforeNoteSwitch: flushEditorStateBeforeAction,
    flushBeforeNoteMutation: flushEditorStateBeforeAction,
    reloadVault: vault.reloadVault,
    setToastMessage,
    updateEntry: vault.updateEntry,
    vaultPath: resolvedPath,
    defaultWorkspacePath: multiWorkspaceEnabled ? defaultWorkspacePath : null,
    vaults: graphVaults ?? [],
    addPendingSave: handleCreatedVaultEntryPersisting,
    removePendingSave: vault.removePendingSave,
    trackUnsaved: vault.trackUnsaved,
    clearUnsaved: vault.clearUnsaved,
    unsavedPaths: vault.unsavedPaths,
    markContentPending: (path, content) => appSave.contentChangeRef.current(path, content),
    onNewNotePersisted: handleCreatedVaultEntryPersisted,
    onMissingActiveVault: handleMissingActiveVault,
    onTypeStateChanged: async () => { await vault.reloadVault() },
    replaceEntry: vault.replaceEntry,
    onInternalVaultWrite: markRecentVaultWrite,
    onFrontmatterPersisted: refreshGitModifiedFiles,
    onPathRenamed: (oldPath, newPath) => appSave.trackRenamedPath(oldPath, newPath),
  })
  const {
    handleSelectNote,
    handleReplaceActiveTab,
    closeAllTabs,
    openTabWithContent,
  } = notes
  useNoteWindowLifecycle({
    activeTabPath: notes.activeTabPath,
    handleSelectNote,
    noteWindowParams,
    openTabWithContent,
    setToastMessage,
    tabs: notes.tabs,
  })
  const handleVaultUpdate = useCallback(async (
    updatedFiles: string[],
    options: { preserveFocusedEditor?: boolean; vaultPath?: string } = {},
  ) => {
    const updateVaultPath = options.vaultPath ?? resolvedPath
    await refreshPulledVaultState({
      activeTabPath: notes.activeTabPath,
      closeAllTabs,
      getActiveTabPath: () => notes.activeTabPathRef.current,
      hasUnsavedChanges: (path) => vault.unsavedPaths.has(path),
      shouldKeepActiveEditorMounted: options.preserveFocusedEditor
        ? isActiveElementInsideEditorSurface
        : undefined,
      reloadFolders: vault.reloadFolders,
      reloadVault: vault.reloadVault,
      reloadViews: vault.reloadViews,
      replaceActiveTab: handleReplaceActiveTab,
      updatedFiles,
      vaultPath: updateVaultPath,
    })
    await refreshGitModifiedFiles()
  }, [
      closeAllTabs,
      handleReplaceActiveTab,
      notes.activeTabPath,
      notes.activeTabPathRef,
      refreshGitModifiedFiles,
      resolvedPath,
      vault.reloadFolders,
      vault.reloadVault,
      vault.reloadViews,
      vault.unsavedPaths,
    ])
  const handlePulledVaultUpdate = useCallback(
    (updatedFiles: string[], vaultPath: string) => handleVaultUpdate(updatedFiles, {
      ...getPulledVaultUpdateOptions(),
      vaultPath,
    }),
    [handleVaultUpdate],
  )
  const handleFocusedVaultUpdate = useCallback(
    (updatedFiles: string[]) => handleVaultUpdate(updatedFiles, { preserveFocusedEditor: true }),
    [handleVaultUpdate],
  )
  useEffect(() => {
    if (watchedVaultPaths.length === 0) return
    let cancelled = false
    for (const vaultPath of watchedVaultPaths) {
      void syncVaultAssetScope(vaultPath).catch((err) => {
        if (!cancelled) console.warn('[vault] Failed to sync asset scope:', err)
      })
    }
    return () => {
      cancelled = true
    }
  }, [watchedVaultPaths])
  useVaultWatcher({
    vaultPath: resolvedPath,
    vaultPaths: watchedVaultPaths,
    onVaultChanged: handleFocusedVaultUpdate,
    filterChangedPaths: filterExternalVaultPaths,
  })
  const autoSync = useAutoSync({
    enabled: gitFeaturesEnabled && gitRepoState === 'ready',
    vaultPath: gitSurfaces.syncRepositoryPath,
    vaultPaths: activeGitRepositoryPaths,
    intervalMinutes: settings.auto_pull_interval_minutes,
    onVaultUpdated: handlePulledVaultUpdate,
    onConflict: (files) => {
      const names = files.map((f) => f.split('/').pop()).join(', ')
      setToastMessage(`Conflict in ${names} — click to resolve`)
    },
    onToast: (msg) => setToastMessage(msg),
  })
  // Keep note entry in sync with vault entries so banners (trash/archive)
  // and read-only state react immediately without reopening the note.
  useEffect(() => {
    notes.setTabs(prev => {
      let changed = false
      const next = prev.map(tab => {
        const fresh = visibleEntries.find(e => e.path === tab.entry.path)
        if (fresh && fresh !== tab.entry) {
          changed = true
          return { ...tab, entry: fresh }
        }
        return tab
      })
      return changed ? next : prev
    })
  }, [visibleEntries, notes.setTabs]) // eslint-disable-line react-hooks/exhaustive-deps -- notes.setTabs is stable (useState setter)

  const { handleGoBack, handleGoForward, canGoBack, canGoForward, entriesByPath } = useAppNavigation({
    entries: visibleEntries,
    activeTabPath: notes.activeTabPath,
    onSelectNote: notes.handleSelectNote,
  })

  const handleOpenFavorite = useCallback(async (entry: VaultEntry) => {
    await handleReplaceActiveTab(entry)
    handleEnterNeighborhood(entry)
  }, [handleEnterNeighborhood, handleReplaceActiveTab])

  const vaultBridge = useVaultBridge({
    entriesByPath,
    resolvedPath,
    reloadVault: vault.reloadVault,
    reloadFolders: vault.reloadFolders,
    reloadViews: vault.reloadViews,
    closeAllTabs,
    replaceActiveTab: handleReplaceActiveTab,
    hasUnsavedChanges: (path) => vault.unsavedPaths.has(path),
    shouldKeepActiveEditorMounted: isActiveElementInsideEditorSurface,
    onSelectNote: notes.handleSelectNote,
    activeTabPath: notes.activeTabPath,
    getActiveTabPath: () => notes.activeTabPathRef.current,
  })

  const conflictFlow = useConflictFlow({
    resolvedPath: autoSync.conflictVaultPath ?? graphDefaultWorkspacePath,
    entries: visibleEntries,
    conflictFiles: autoSync.conflictFiles,
    pausePull: autoSync.pausePull, resumePull: autoSync.resumePull,
    triggerSync: autoSync.triggerSync, reloadVault: vault.reloadVault,
    initConflictFiles: conflictResolver.initFiles,
    openConflictResolver: dialogs.openConflictResolver,
    closeConflictResolver: dialogs.closeConflictResolver,
    onSelectNote: notes.handleSelectNote,
    activeTabPath: notes.activeTabPath,
    setToastMessage,
  })

  const appSave = useAppSave({
    updateEntry: vault.updateEntry, setTabs: notes.setTabs, handleSwitchTab: notes.handleSwitchTab, setToastMessage,
    loadModifiedFiles: refreshGitModifiedFiles, reloadViews: async () => { await vault.reloadViews() },
    trackUnsaved: vault.trackUnsaved, clearUnsaved: vault.clearUnsaved, unsavedPaths: vault.unsavedPaths,
    tabs: notes.tabs, activeTabPath: notes.activeTabPath,
    handleRenameNote: notes.handleRenameNote, handleRenameFilename: notes.handleRenameFilename,
    replaceEntry: vault.replaceEntry, resolvedPath,
    writableVaultPaths,
    initialH1AutoRenameEnabled: settings.initial_h1_auto_rename_enabled !== false,
    onInternalVaultWrite: markRecentVaultWrite,
    locale: appLocale,
  })
  useEffect(() => {
    appSaveFlushBeforeActionRef.current = appSave.flushBeforeAction
  }, [appSave.flushBeforeAction])

  const handleChangeWorkspace = useCallback(async (entry: VaultEntry, workspace: WorkspaceIdentity) => {
    const sourceVaultPath = vaultPathForEntry(entry, resolvedPath)
    if (sourceVaultPath === workspace.path) return

    try {
      await flushEditorStateBeforeAction(entry.path)
      const result = await notes.handleMoveNoteToWorkspace(
        entry.path,
        workspace,
        sourceVaultPath,
        (oldPath, newEntry) => {
          appSave.trackRenamedPath(oldPath, newEntry.path)
          vault.replaceEntry(oldPath, newEntry)
          if (effectiveSelection.kind === 'entity' && effectiveSelection.entry.path === oldPath) {
            handleSetSelection({
              kind: 'entity',
              entry: {
                ...effectiveSelection.entry,
                ...newEntry,
              },
            })
          }
        },
      )
      if (!result) return

      markRecentVaultWrite(entry.path)
      markRecentVaultWrite(result.new_path)
      await refreshGitModifiedFiles()
    } catch (err) {
      console.error('Failed to change note workspace:', err)
      setToastMessage(`Failed to move note: ${String(err)}`)
    }
  }, [
    appSave,
    effectiveSelection,
    flushEditorStateBeforeAction,
    handleSetSelection,
    markRecentVaultWrite,
    notes,
    refreshGitModifiedFiles,
    resolvedPath,
    vault
  ])

  const aiActivity = useAiActivity({
    onOpenNote: vaultBridge.openNoteByPath,
    onOpenTab: vaultBridge.openNoteByPath,
    onSetFilter: (filterType) => {
      handleSetSelection({ kind: 'sectionGroup', type: filterType })
    },
    onVaultChanged: (path) => { void handlePulledVaultUpdate(path ? [path] : [], resolvedPath) },
  })

  const handleInitializeProperties = useCallback((path: string) => {
    void initializeNoteProperties(notes.handleUpdateFrontmatter, path).catch((err) => {
      console.warn('Failed to initialize note properties:', err)
    })
  }, [notes])

  const handleRemoveNoteIcon = useCallback(async (path: string) => {
    await notes.handleDeleteProperty(path, 'icon')
  }, [notes])

  const handleSetNoteIconCommand = useCallback(() => {
    setInspectorCollapsed(false)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        focusNoteIconPropertyEditor()
      })
    })
  }, [setInspectorCollapsed])

  const handleCustomizeNoteListColumns = useCallback(() => {
    if (effectiveSelection.kind === 'view') {
      openNoteListPropertiesPicker('view')
      return
    }

    if (effectiveSelection.kind !== 'filter') return
    if (effectiveSelection.filter === 'all') {
      openNoteListPropertiesPicker('all')
      return
    }
    if (effectiveSelection.filter === 'inbox') {
      openNoteListPropertiesPicker('inbox')
    }
  }, [effectiveSelection])

  const handleUpdateAllNotesNoteListProperties = useCallback((value: string[] | null) => {
    updateConfig('allNotes', {
      ...(vaultConfig.allNotes ?? { noteListProperties: null }),
      noteListProperties: value && value.length > 0 ? value : null,
    })
  }, [updateConfig, vaultConfig.allNotes])

  const handleUpdateInboxNoteListProperties = useCallback((value: string[] | null) => {
    updateConfig('inbox', {
      ...(vaultConfig.inbox ?? { noteListProperties: null }),
      noteListProperties: value && value.length > 0 ? value : null,
    })
  }, [updateConfig, vaultConfig.inbox])

  const handleCreateFolder = useCallback(async (
    name: string,
    parent?: { path: string; rootPath?: string },
  ) => {
    try {
      const vaultPath = parent?.rootPath?.trim() ? parent.rootPath : resolvedPath
      const parentPath = parent?.path && parent.path.length > 0 ? parent.path : null
      const args = { vaultPath, folderName: name, parentPath }
      if (isTauri()) {
        await invoke('create_vault_folder', args)
      } else {
        await mockInvoke('create_vault_folder', args)
      }
      await vault.reloadFolders()
      setToastMessage(`Created folder "${name}"`)
      return true
    } catch (e) {
      setToastMessage(`Failed to create folder: ${e}`)
      return false
    }
  }, [resolvedPath, vault])

  const folderActions = useFolderActions({
    vaultPath: resolvedPath,
    selection: effectiveSelection,
    setSelection: handleSetSelection,
    setTabs: notes.setTabs,
    activeTabPathRef: notes.activeTabPathRef,
    handleSwitchTab: notes.handleSwitchTab,
    closeAllTabs: notes.closeAllTabs,
    reloadVault: vault.reloadVault,
    reloadFolders: vault.reloadFolders,
    setToastMessage,
  })
  const fileActions = useFileActions({
    selection: effectiveSelection,
    setToastMessage,
    vaultPath: resolvedPath,
  })

  const handleRemoveNoteIconCommand = useCallback(() => {
    if (notes.activeTabPath) handleRemoveNoteIcon(notes.activeTabPath)
  }, [notes.activeTabPath, handleRemoveNoteIcon])

  const handleOpenInNewWindow = useCallback(() => {
    const activeTab = notes.tabs.find(t => t.entry.path === notes.activeTabPath)
    if (activeTab) {
      openNoteInNewWindow(
        activeTab.entry.path,
        vaultPathForEntry(activeTab.entry, resolvedPath),
        activeTab.entry.title,
      )
    }
  }, [notes.tabs, notes.activeTabPath, resolvedPath])

  const handleOpenEntryInNewWindow = useCallback((entry: Pick<VaultEntry, 'path' | 'title' | 'workspace'>) => {
    openNoteInNewWindow(entry.path, vaultPathForEntry(entry, resolvedPath), entry.title)
  }, [resolvedPath])

  const allGitModifiedFiles = useMemo(
    () => mergeModifiedFiles(
      gitSurfaces.allModifiedFiles,
      activeVaultModifiedFiles(vault.modifiedFiles, resolvedPath),
    ),
    [gitSurfaces.allModifiedFiles, resolvedPath, vault.modifiedFiles],
  )
  const selectedChangesModifiedFiles = gitSurfaces.changesModifiedFiles
  const commitModifiedFiles = gitSurfaces.commitModifiedFiles
  const changesRepositoryPath = gitSurfaces.changesRepositoryPath
  const gitModifiedCount = gitFeaturesEnabled ? allGitModifiedFiles.length : 0

  const {
    activeDeletedFile,
    activeNoteModified,
    handleDiscardFile,
    handleOpenDeletedNote,
    handlePendingDiffHandled,
    handlePulseOpenNote,
    handleReplaceActiveTabWithQueuedDiff,
    loadDiffAtCommitForPath,
    loadDiffForPath,
    loadGitHistoryForPath,
    pendingDiffRequest,
  } = useGitFileWorkflows({
    activeTabPath: notes.activeTabPath,
    allGitModifiedFiles,
    changesRepositoryPath,
    effectiveSelection,
    entriesByPath,
    historyRepositoryPath: gitSurfaces.historyRepositoryPath,
    loadModifiedFilesForRepository,
    onCloseAllTabs: notes.closeAllTabs,
    onOpenTabWithContent: notes.openTabWithContent,
    onReplaceActiveTab: notes.handleReplaceActiveTab,
    onSelectNote: notes.handleSelectNote,
    reloadVault: vault.reloadVault,
    resolvedPath,
    selectedChangesModifiedFiles,
    setToastMessage,
    tabs: notes.tabs,
    vaultEntries: vault.entries,
    visibleEntries,
  })

  const commitFlow = useCommitFlow({
    savePending: appSave.savePending,
    loadModifiedFiles: refreshGitModifiedFiles,
    loadModifiedFilesForVaultPath: loadModifiedFilesForRepository,
    resolveRemoteStatusForVaultPath: refreshRemoteStatusForRepository,
    setToastMessage,
    onPushRejected: autoSync.handlePushRejected,
    automaticVaultPaths: gitFeaturesEnabled ? activeGitRepositoryPaths : [],
    locale: appLocale,
    manualVaultPath: gitSurfaces.commitRepositoryPath,
    vaultPath: resolvedPath,
  })
  const suggestedCommitMessage = useMemo(() => generateCommitMessage(commitModifiedFiles), [commitModifiedFiles])
  const isGitVault = gitFeaturesEnabled && gitRepoState !== 'missing'
  const {
    activitySignature: autoGitActivitySignature,
    hasPendingWork: autoGitHasPendingWork,
  } = useAutoGitWork({
    activeRemoteStatus: autoSync.remoteStatus,
    activeVaultPath: resolvedPath,
    modifiedFiles: allGitModifiedFiles,
    repositoryPaths: activeGitRepositoryPaths,
    remoteStatusForRepository: gitSurfaces.remoteStatusForRepository,
  })
  const autoGit = useAutoGit({
    enabled: settings.autogit_enabled === true,
    idleThresholdSeconds: settings.autogit_idle_threshold_seconds ?? 90,
    inactiveThresholdSeconds: settings.autogit_inactive_threshold_seconds ?? 30,
    isGitVault,
    hasPendingChanges: autoGitHasPendingWork,
    hasUnsavedChanges: vault.unsavedPaths.size > 0,
    onCheckpoint: () => commitFlow.runAutomaticCheckpoint(),
  })
  const recordAutoGitActivity = autoGit.recordActivity
  const openCommitDialog = commitFlow.openCommitDialog
  const runAutomaticCheckpoint = commitFlow.runAutomaticCheckpoint
  const handleAppContentChange = appSave.handleContentChange
  const handleAppSave = appSave.handleSave
  const loadModifiedFiles = refreshGitModifiedFiles
  const triggerSync = autoSync.triggerSync
  const pullAndPush = autoSync.pullAndPush

  useEffect(() => {
    if (!gitFeaturesEnabled) return
    if (!isChangesSelection) return
    void loadModifiedFilesForRepository(changesRepositoryPath, { includeStats: true })
  }, [changesRepositoryPath, gitFeaturesEnabled, isChangesSelection, loadModifiedFilesForRepository])

  useEffect(() => {
    if (autoGitActivitySignature.length === 0) return
    recordAutoGitActivity()
  }, [autoGitActivitySignature, recordAutoGitActivity])

  const handleCommitPush = useCallback(() => {
    if (!gitFeaturesEnabled) return
    triggerCommitEntryAction({
      autoGitEnabled: settings.autogit_enabled === true,
      openCommitDialog,
      runAutomaticCheckpoint,
    })
  }, [gitFeaturesEnabled, openCommitDialog, runAutomaticCheckpoint, settings.autogit_enabled])
  const handlePullRepository = useCallback((targetVaultPath: string) => {
    if (!gitFeaturesEnabled) return
    triggerSync(targetVaultPath)
  }, [gitFeaturesEnabled, triggerSync])
  const handlePullSelectedRepository = useCallback(() => {
    if (!gitFeaturesEnabled) return
    triggerSync()
  }, [gitFeaturesEnabled, triggerSync])
  const handlePullAndPushSelectedRepository = useCallback(() => {
    pullAndPush()
  }, [pullAndPush])

  const handleTrackedContentChange = useCallback((path: string, content: string) => {
    recordAutoGitActivity()
    handleAppContentChange(path, content)
  }, [handleAppContentChange, recordAutoGitActivity])

  const handleTrackedSave = useCallback(async (...args: Parameters<typeof handleAppSave>) => {
    if (notes.activeTabPath) {
      flushPendingEditorContentRef.current?.(notes.activeTabPath)
      flushPendingRawContentRef.current?.(notes.activeTabPath)
    }
    const result = await handleAppSave(...args)
    const activeTab = notes.activeTabPath
      ? notes.tabs.find((tab) => tab.entry.path === notes.activeTabPath)
      : null
    if (activeTab) {
      await loadModifiedFilesForRepository(vaultPathForEntry(activeTab.entry, resolvedPath), {
        includeStats: isChangesSelection,
      })
    }
    recordAutoGitActivity()
    return result
  }, [
    handleAppSave,
    isChangesSelection,
    loadModifiedFilesForRepository,
    notes.activeTabPath,
    notes.tabs,
    recordAutoGitActivity,
    resolvedPath,
  ])

  const seedAutoGitSavedChange = useCallback(async () => {
    if (isTauri()) {
      throw new Error('seedAutoGitSavedChange is only available in browser smoke tests')
    }

    const activePath = notes.activeTabPath
    const activeTab = activePath
      ? notes.tabs.find((tab) => tab.entry.path === activePath)
      : null

    if (!activePath || !activeTab) {
      throw new Error('No active note is available for the AutoGit test bridge')
    }

    const saveNoteContent = window.__mockHandlers?.save_note_content
    const activeVaultPath = vaultPathForEntry(activeTab.entry, resolvedPath)
    if (typeof saveNoteContent === 'function') {
      await Promise.resolve(saveNoteContent({ path: activePath, content: activeTab.content, vaultPath: activeVaultPath }))
    } else {
      await mockInvoke('save_note_content', { path: activePath, content: activeTab.content, vaultPath: activeVaultPath })
    }

    await loadModifiedFiles()
    recordAutoGitActivity()
  }, [loadModifiedFiles, notes.activeTabPath, notes.tabs, recordAutoGitActivity, resolvedPath])

  useEffect(() => {
    window.__laputaTest = {
      ...window.__laputaTest,
      activeTabPath: notes.activeTabPath,
      seedAutoGitSavedChange,
    }

    return () => {
      if (window.__laputaTest?.seedAutoGitSavedChange === seedAutoGitSavedChange) {
        delete window.__laputaTest.seedAutoGitSavedChange
      }
    }
  }, [notes.activeTabPath, seedAutoGitSavedChange])

  const entryActions = useEntryActions({
    entries: visibleEntries, updateEntry: vault.updateEntry,
    handleUpdateFrontmatter: notes.handleUpdateFrontmatter,
    handleDeleteProperty: notes.handleDeleteProperty, setToastMessage,
    createTypeEntry: notes.createTypeEntrySilent,
    onBeforeAction: flushEditorStateBeforeAction,
    actionHistory: notes.actionHistory,
  })

  const resolveVaultPathForNotePath = useCallback((path: string) => {
    const entry = vault.entries.find((candidate) => candidate.path === path)
    return entry ? vaultPathForEntry(entry, resolvedPath) : resolvedPath
  }, [resolvedPath, vault.entries])

  const deleteActions = useDeleteActions({
    onDeselectNote: (path: string) => { if (notes.activeTabPath === path) notes.closeAllTabs() },
    removeEntry: vault.removeEntry,
    removeEntries: vault.removeEntries,
    resolveVaultPathForPath: resolveVaultPathForNotePath,
    refreshModifiedFiles: refreshGitModifiedFiles,
    reloadVault: vault.reloadVault,
    setToastMessage,
  })

  const handleDeleteType = useCallback((typeName: string) => {
    const typeEntry = visibleEntries.find((entry) => entry.isA === 'Type' && entry.title === typeName)
    if (!typeEntry) return

    trackEvent('sidebar_type_delete_requested')
    deleteActions.handleDeleteNote(typeEntry.path)
  }, [deleteActions, visibleEntries])

  const shouldLoadGitHistory = !layout.inspectorCollapsed && !effectiveShowAIChat
  const gitHistory = useGitHistory(notes.activeTabPath, loadGitHistoryForPath, shouldLoadGitHistory)

  const handleCreateType = useCallback(async (name: string) => {
    const created = await notes.handleCreateType(name)
    if (created) setToastMessage(`Type "${name}" created`)
    return created
  }, [notes])

  const handleCreateMissingType = useCallback(async (path: string, missingType: string, nextTypeName: string) => {
    const trimmed = nextTypeName.trim()
    if (!trimmed) return false

    const plan = planNewTypeCreation({ entries: visibleEntries, typeName: trimmed, vaultPath: resolvedPath })
    if (plan.status === 'blocked') {
      setToastMessage(plan.message)
      return false
    }

    let resolvedTypeName = plan.status === 'existing' ? plan.entry.title : trimmed

    if (plan.status === 'create') {
      try {
        resolvedTypeName = (await notes.createTypeEntrySilent(trimmed)).title
      } catch {
        return false
      }
    }

    await notes.handleUpdateFrontmatter(path, 'type', resolvedTypeName)
    setToastMessage(
      plan.status === 'create' && resolvedTypeName === missingType
        ? `Type "${resolvedTypeName}" created`
        : `Type set to "${resolvedTypeName}"`,
    )
    return true
  }, [notes, resolvedPath, visibleEntries])

  const handleCreateOrUpdateView = useCallback(async (definition: ViewDefinition) => {
    const editing = dialogs.editingView
    const targetVaultPath = viewCreationVaultPath({
      editingRootPath: editing?.rootPath,
      fallbackVaultPath: resolvedPath,
      graphDefaultWorkspacePath,
      multiWorkspaceEnabled,
    })
    const activeVaultViews = viewsForVault(vault.views, targetVaultPath)
    const filename = savedViewFilename(definition, editing, activeVaultViews)
    const nextDefinition = savedViewDefinition(definition, editing, activeVaultViews)
    const target = isTauri() ? invoke : mockInvoke
    try {
      await target('save_view_cmd', { vaultPath: targetVaultPath, filename, definition: nextDefinition })
      trackEvent(editing ? 'view_updated' : 'view_created')
      await vault.reloadViews()
      await vault.reloadVault()
      vault.reloadFolders()
      setToastMessage(editing ? `View "${nextDefinition.name}" updated` : `View "${nextDefinition.name}" created`)
      handleSetSelection(viewSelection(
        filename,
        shouldPreserveViewRootPath(vault.views, editing?.rootPath) ? targetVaultPath : undefined,
      ))
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setToastMessage(`Could not save view: ${message}`)
      return false
    }
  }, [graphDefaultWorkspacePath, multiWorkspaceEnabled, resolvedPath, vault, handleSetSelection, dialogs.editingView])

  const handleUpdateViewDefinition = useCallback(async (filename: string, patch: Partial<ViewDefinition>, rootPath?: string) => {
    const existing = vault.views.find((view) => viewMatchesSelection(view, viewSelection(filename, rootPath)))
    if (!existing) return

    const targetVaultPath = viewVaultPath(existing, resolvedPath)
    const target = isTauri() ? invoke : mockInvoke
    await target('save_view_cmd', {
      vaultPath: targetVaultPath,
      filename,
      definition: { ...existing.definition, ...patch },
    })
    await vault.reloadViews()
  }, [resolvedPath, vault])

  const handleSidebarUpdateViewDefinition = useCallback((filename: string, patch: Partial<ViewDefinition>, rootPath?: string) => {
    void handleUpdateViewDefinition(filename, patch, rootPath)
      .then(() => {
        trackEvent('view_updated', { source: 'sidebar_view_actions' })
        if (typeof patch.name === 'string') setToastMessage(`View "${patch.name}" renamed`)
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        setToastMessage(`Could not save view: ${message}`)
      })
  }, [handleUpdateViewDefinition])

  const handleEditView = useCallback((filename: string, rootPath?: string) => {
    const view = vault.views.find((candidate) => viewMatchesSelection(candidate, viewSelection(filename, rootPath)))
    if (view) dialogs.openEditView(filename, view.definition, view.rootPath)
  }, [vault.views, dialogs])

  const handleDeleteView = useCallback(async (filename: string, rootPath?: string) => {
    const existing = vault.views.find((view) => viewMatchesSelection(view, viewSelection(filename, rootPath)))
    if (!existing) return

    const targetVaultPath = viewVaultPath(existing, resolvedPath)
    const target = isTauri() ? invoke : mockInvoke
    try {
      await target('delete_view_cmd', { vaultPath: targetVaultPath, filename })
    } catch (err) {
      if (isActiveVaultUnavailableError(err)) {
        vault.markVaultUnavailable(targetVaultPath)
        return
      }
      throw err
    }
    await vault.reloadViews()
    await vault.reloadVault()
    vault.reloadFolders()
    if (selection.kind === 'view' && viewMatchesSelection(existing, selection)) {
      handleSetSelection({ kind: 'filter', filter: 'all' })
    }
    setToastMessage('View deleted')
  }, [resolvedPath, vault, selection, handleSetSelection])

  const availableFields = useMemo(() => {
    const builtIn = ['type', 'status', 'title', 'favorite', 'body']
    if (!visibleEntries?.length) return builtIn
    const customFields = new Set<string>()
    for (const e of visibleEntries) {
      if (e.properties) {
        for (const key of Object.keys(e.properties)) customFields.add(key)
      }
      if (e.relationships) {
        for (const key of Object.keys(e.relationships)) customFields.add(key)
      }
    }
    return [...builtIn, ...Array.from(customFields).sort()]
  }, [visibleEntries])

  const bulkActions = useBulkActions(entryActions, visibleEntries, setToastMessage)

  // Raw-toggle ref: Editor registers its handleToggleRaw here so the command palette can call it
  const rawToggleRef = useRef<() => void>(() => {})
  const tableOfContentsToggleRef = useRef<() => void>(() => {})
  // Diff-toggle ref: Editor registers its handleToggleDiff here so the command palette can call it
  const diffToggleRef = useRef<() => void>(() => {})
  const findInNoteRef = useRef<((options?: { replace?: boolean }) => void) | null>(null)

  const { setViewMode, sidebarVisible, noteListVisible } = useViewMode(
    noteWindowParams || aiWorkspaceWindow ? 'editor-only' : undefined,
  )
  const zoom = useZoom()
  const buildNumber = useBuildNumber()

  const updateMainWindowConstraints = useCallback((
    nextSidebarVisible: boolean,
    nextNoteListVisible: boolean,
    nextInspectorCollapsed: boolean = layout.inspectorCollapsed,
  ) => {
    if (noteWindowParams || aiWorkspaceWindow) return

    const minWidth = getMainWindowMinWidth({
      sidebarVisible: nextSidebarVisible,
      noteListVisible: nextNoteListVisible,
      inspectorCollapsed: nextInspectorCollapsed,
      sidebarWidth: layout.sidebarWidth,
      noteListWidth: layout.noteListWidth,
      inspectorWidth: layout.inspectorWidth,
    })

    void applyMainWindowSizeConstraints(minWidth, { growToFit: !isWindows() }).catch((err) => console.warn('[window] Size constraints failed:', err))
  }, [aiWorkspaceWindow, layout.inspectorCollapsed, layout.inspectorWidth, layout.noteListWidth, layout.sidebarWidth, noteWindowParams])

  const handleSetViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode)
    updateMainWindowConstraints(mode === 'all', mode !== 'editor-only')
  }, [setViewMode, updateMainWindowConstraints])

  const handleCollapseSidebar = useCallback(() => {
    handleSetViewMode('editor-list')
  }, [handleSetViewMode])

  const handleToggleInspector = useCallback(() => {
    const nextInspectorCollapsed = !layout.inspectorCollapsed
    layout.setInspectorCollapsed(nextInspectorCollapsed)
    updateMainWindowConstraints(sidebarVisible, noteListVisible, nextInspectorCollapsed)
  }, [
    layout,
    noteListVisible,
    sidebarVisible,
    updateMainWindowConstraints,
  ])

  useMainWindowSizeConstraints({
    enabled: !noteWindowParams && !aiWorkspaceWindow,
    sidebarVisible,
    noteListVisible,
    inspectorCollapsed: layout.inspectorCollapsed,
    sidebarWidth: layout.sidebarWidth,
    noteListWidth: layout.noteListWidth,
    inspectorWidth: layout.inspectorWidth,
  })

  const { status: updateStatus, actions: updateActions } = useUpdater(settings.release_channel)

  const handleCheckForUpdates = useCallback(async () => {
    if (updateStatus.state === 'downloading') {
      setToastMessage('Update is downloading…')
      return
    }
    if (updateStatus.state === 'ready') {
      await restartApp()
      return
    }
    setToastMessage(translate(appLocale, 'update.checking'))
    const result = await updateActions.checkForUpdates()
    if (result.kind === 'up-to-date') {
      const checkedChannel = normalizeReleaseChannel(settings.release_channel)
      setToastMessage(`No newer ${checkedChannel} update is available right now`)
    } else if (result.kind === 'available') {
      setToastMessage(`Tolaria ${result.displayVersion} is available`)
    } else {
      setToastMessage(result.message)
    }
  }, [appLocale, settings.release_channel, updateActions, updateStatus.state])

  const handleRepairVault = useCallback(async () => {
    if (!resolvedPath) return
    try {
      const tauriInvoke = isTauri() ? invoke : mockInvoke
      const msg = await tauriInvoke<string>('repair_vault', { vaultPath: resolvedPath })
      await vault.reloadVault()
      await refreshVaultAiGuidance()
      setToastMessage(msg)
    } catch (err) {
      setToastMessage(`Failed to repair vault: ${err}`)
    }
  }, [refreshVaultAiGuidance, resolvedPath, vault])

  const restoreVaultAiGuidance = useCallback(async (successToast: string | null = 'Tolaria AI guidance restored') => {
    if (!resolvedPath) return
    try {
      const tauriInvoke = isTauri() ? invoke : mockInvoke
      await tauriInvoke('restore_vault_ai_guidance', { vaultPath: resolvedPath })
      await vault.reloadVault()
      await refreshVaultAiGuidance()
      if (successToast) setToastMessage(successToast)
    } catch (err) {
      setToastMessage(`Failed to restore Tolaria AI guidance: ${err}`)
    }
  }, [refreshVaultAiGuidance, resolvedPath, vault])

  const activeCommandEntry = useMemo(() => {
    if (!notes.activeTabPath) return null
    return notes.tabs.find((tab) => tab.entry.path === notes.activeTabPath)?.entry
      ?? vault.entries.find((entry) => entry.path === notes.activeTabPath)
      ?? null
  }, [notes.activeTabPath, notes.tabs, vault.entries])
  const noteRetargetingUi = useNoteRetargetingUi({
    activeEntry: activeCommandEntry,
    activeNoteBlocked: !!activeDeletedFile,
    entries: visibleEntries,
    folders: vault.folders,
    selection: effectiveSelection,
    setSelection: handleSetSelection,
    setToastMessage,
    vaultPath: resolvedPath,
    updateFrontmatter: notes.handleUpdateFrontmatter,
    moveNoteToFolder: notes.handleMoveNoteToFolder,
  })

  const canToggleRichEditor = !!activeCommandEntry
    && activeCommandEntry.filename.toLowerCase().endsWith('.md')
    && !activeDeletedFile
  const shouldBlockNeighborhoodEscape = (
    dialogs.showCreateTypeDialog
    || dialogs.showQuickOpen
    || dialogs.showCommandPalette
    || effectiveShowAIChat
    || dialogs.showSettings
    || dialogs.showCloneVault
    || dialogs.showSearch
    || dialogs.showConflictResolver
    || dialogs.showCreateViewDialog
    || noteRetargetingUi.isDialogOpen
    || showFeedback
  )

  useNeighborhoodEscape({
    onBack: handleNeighborhoodHistoryBack,
    selectionRef,
    shouldBlockNeighborhoodEscape,
  })

  const noteListColumnsLabel = useMemo(() => {
    if (effectiveSelection.kind === 'view') {
      const selectedView = vault.views.find((view) => viewMatchesSelection(view, effectiveSelection))
      return selectedView ? `Customize ${selectedView.definition.name} columns` : 'Customize View columns'
    }

    return effectiveSelection.kind === 'filter' && effectiveSelection.filter === 'all'
      ? 'Customize All Notes columns'
      : 'Customize Inbox columns'
  }, [effectiveSelection, vault.views])
  const viewOrdering = useSavedViewOrdering({
    views: vault.views,
    selection: effectiveSelection,
    vaultPath: resolvedPath,
    reloadViews: vault.reloadViews,
    loadModifiedFiles: refreshGitModifiedFiles,
    onToast: setToastMessage,
    locale: appLocale,
  })
  const canReorderSavedViews = useMemo(() => (
    vault.views.every((view) => !view.rootPath)
  ), [vault.views])
  const toggleDiffCommand = useCallback(() => diffToggleRef.current(), [])
  const toggleRawEditorCommand = useMemo(
    () => canToggleRichEditor ? () => rawToggleRef.current() : undefined,
    [canToggleRichEditor],
  )
  const toggleTableOfContentsCommand = useCallback(() => {
    if (notes.activeTabPath) tableOfContentsToggleRef.current()
  }, [notes.activeTabPath])
  const findInNoteCommand = useCallback(() => {
    findInNoteRef.current?.({ replace: false })
  }, [])
  const replaceInNoteCommand = useCallback(() => {
    findInNoteRef.current?.({ replace: true })
  }, [])
  const pastePlainTextCommand = useCallback(() => {
    void requestPlainTextPaste().catch((error) => {
      console.warn('[paste] Failed to paste plain text:', error)
    })
  }, [])
  const removeActiveVaultCommand = useCallback(() => {
    vaultSwitcher.removeVault(vaultSwitcher.vaultPath)
  }, [vaultSwitcher])
  const restoreVaultAiGuidanceCommand = useCallback(() => {
    void restoreVaultAiGuidance()
  }, [restoreVaultAiGuidance])
  const changeNoteTypeCommand = useMemo(
    () => noteRetargetingUi.canChangeActiveNoteType ? noteRetargetingUi.openChangeNoteTypeDialog : undefined,
    [noteRetargetingUi.canChangeActiveNoteType, noteRetargetingUi.openChangeNoteTypeDialog],
  )
  const moveNoteToFolderCommand = useMemo(
    () => noteRetargetingUi.canMoveActiveNoteToFolder ? noteRetargetingUi.openMoveNoteToFolderDialog : undefined,
    [noteRetargetingUi.canMoveActiveNoteToFolder, noteRetargetingUi.openMoveNoteToFolderDialog],
  )
  const activeNoteHasIcon = useMemo(() => {
    const entry = vault.entries.find((candidate) => candidate.path === notes.activeTabPath)
    return hasNoteIconValue(entry?.icon)
  }, [notes.activeTabPath, vault.entries])
  const handleToggleOrganizedWithInboxAdvance = useInboxOrganizeAdvance({
    activeTabPath: notes.activeTabPath,
    activeTabPathRef: notes.activeTabPathRef,
    autoAdvanceEnabled: settings.auto_advance_inbox_after_organize === true,
    entries: visibleEntries,
    onSelectNote: notes.handleSelectNote,
    onToggleOrganized: entryActions.handleToggleOrganized,
    requestedActiveTabPathRef: notes.requestedActiveTabPathRef,
    selection: effectiveSelection,
    visibleNotesRef,
  })
  const toggleOrganizedCommand = explicitOrganizationEnabled ? handleToggleOrganizedWithInboxAdvance : undefined
  const canCustomizeNoteListColumns = useMemo(() => (
    canCustomizeColumnsForSelection(effectiveSelection, explicitOrganizationEnabled)
  ), [effectiveSelection, explicitOrganizationEnabled])
  const restoreDeletedNoteCommand = useMemo(
    () => activeDeletedFile ? () => { void handleDiscardFile(activeDeletedFile.relativePath) } : undefined,
    [activeDeletedFile, handleDiscardFile],
  )
  const reloadVaultForCommand = vault.reloadVault
  const handleManualVaultReload = useCallback(async () => {
    const entries = await reloadVaultForCommand()
    setToastMessage(`Vault reloaded (${entries.length} ${entries.length === 1 ? 'entry' : 'entries'})`)
    return entries
  }, [reloadVaultForCommand])

  const {
    activeTab,
    defaultNoteWidth,
    noteWidth: activeNoteWidth,
    setDefaultNoteWidth: handleSetDefaultNoteWidth,
    setNoteWidth: handleSetActiveNoteWidth,
    toggleNoteWidth: handleToggleNoteWidth,
  } = useNoteWidthMode({
    tabs: notes.tabs,
    activeTabPath: notes.activeTabPath,
    settings,
    saveSettings,
    updateFrontmatter: notes.handleUpdateFrontmatter,
    setToastMessage,
  })
  const activeEditorVaultPath = activeTab ? vaultPathForEntry(activeTab.entry, resolvedPath) : resolvedPath
  const commandAiActions = useAppCommandAiActions(aiFeaturesEnabled, dialogs, aiAgentsStatus, vaultAiGuidanceStatus, restoreVaultAiGuidanceCommand, aiAgentPreferences)
  const undoCommand = useCallback(() => {
    if (runNativeTextHistoryCommand('undo')) return
    void notes.handleUndo()
  }, [notes])
  const redoCommand = useCallback(() => {
    if (runNativeTextHistoryCommand('redo')) return
    void notes.handleRedo()
  }, [notes])

  const commands = useAppCommands({
    activeTabPath: notes.activeTabPath, activeTabPathRef: notes.activeTabPathRef,
    entries: visibleEntries,
    visibleNotesRef,
    multiSelectionCommandRef,
    modifiedCount: gitModifiedCount,
    activeNoteModified,
    selection: effectiveSelection,
    onQuickOpen: dialogs.openQuickOpen, onCommandPalette: dialogs.openCommandPalette,
    onSearch: dialogs.openSearch,
    onFindInNote: findInNoteCommand,
    onReplaceInNote: activeDeletedFile ? undefined : replaceInNoteCommand,
    onPastePlainText: pastePlainTextCommand,
    onCreateNote: notes.handleCreateNoteImmediate,
    onCreateNoteOfType: notes.handleCreateNoteImmediate,
    onSave: appSave.handleSave,
    onUndo: undoCommand,
    onRedo: redoCommand,
    canUndo: notes.canUndo,
    canRedo: notes.canRedo,
    undoLabel: notes.undoLabel,
    redoLabel: notes.redoLabel,
    onOpenSettings: handleOpenSettings,
    onOpenFeedback: openFeedback,
    onDeleteNote: deleteActions.handleDeleteNote,
    onArchiveNote: entryActions.handleArchiveNote, onUnarchiveNote: entryActions.handleUnarchiveNote,
    onCommitPush: handleCommitPush,
    gitRepositories,
    gitFeaturesEnabled,
    isGitVault,
    onInitializeGit: openGitSetupDialog,
    onPull: handlePullSelectedRepository,
    onPullRepository: handlePullRepository,
    onResolveConflicts: conflictFlow.handleOpenConflictResolver,
    onSetViewMode: handleSetViewMode,
    onToggleInspector: handleToggleInspector,
    onToggleDiff: toggleDiffCommand,
    onToggleRawEditor: toggleRawEditorCommand,
    onToggleTableOfContents: toggleTableOfContentsCommand,
    noteWidth: activeNoteWidth,
    defaultNoteWidth,
    onSetNoteWidth: handleSetActiveNoteWidth,
    onSetDefaultNoteWidth: handleSetDefaultNoteWidth,
    selectedViewName: viewOrdering.selectedViewName,
    onMoveSelectedViewUp: viewOrdering.onMoveSelectedViewUp,
    onMoveSelectedViewDown: viewOrdering.onMoveSelectedViewDown,
    canMoveSelectedViewUp: viewOrdering.canMoveSelectedViewUp,
    canMoveSelectedViewDown: viewOrdering.canMoveSelectedViewDown,
    onZoomIn: zoom.zoomIn, onZoomOut: zoom.zoomOut, onZoomReset: zoom.zoomReset,
    zoomLevel: zoom.zoomLevel,
    onSelect: handleSetSelection,
    onRenameFolder: folderActions.renameSelectedFolder,
    onDeleteFolder: folderActions.deleteSelectedFolder,
    onRevealSelectedFolder: fileActions.revealSelectedFolder,
    onCopySelectedFolderPath: fileActions.copySelectedFolderPath,
    showInbox: explicitOrganizationEnabled,
    onReplaceActiveTab: notes.handleReplaceActiveTab,
    onSelectNote: notes.handleSelectNote,
    onGoBack: handleGoBack, onGoForward: handleGoForward,
    canGoBack: canGoBack, canGoForward: canGoForward,
    onOpenVault: vaultSwitcher.handleOpenLocalFolder,
    onCreateEmptyVault: vaultSwitcher.handleCreateEmptyVault,
    onCreateType: dialogs.openCreateType,
    ...commandAiActions,
    onCheckForUpdates: handleCheckForUpdates,
    onRemoveActiveVault: removeActiveVaultCommand,
    onRestoreGettingStarted: cloneGettingStartedVault,
    isGettingStartedHidden: vaultSwitcher.isGettingStartedHidden,
    vaultCount: vaultSwitcher.allVaults.length,
    locale: appLocale,
    systemLocale,
    selectedUiLanguage,
    onSetUiLanguage: handleSetUiLanguage,
    onSetThemeMode: handleSetThemeMode,
    mcpStatus,
    onInstallMcp: openMcpSetupDialog,
    onReloadVault: handleManualVaultReload,
    onRepairVault: handleRepairVault,
    onSetNoteIcon: handleSetNoteIconCommand,
    onRemoveNoteIcon: handleRemoveNoteIconCommand,
    onChangeNoteType: changeNoteTypeCommand,
    onMoveNoteToFolder: moveNoteToFolderCommand,
    canMoveNoteToFolder: noteRetargetingUi.canMoveActiveNoteToFolder,
    activeNoteHasIcon,
    noteListFilter,
    onSetNoteListFilter: setNoteListFilter,
    onOpenInNewWindow: handleOpenInNewWindow,
    onRevealActiveFile: fileActions.revealFile,
    onCopyActiveFilePath: fileActions.copyFilePath,
    onOpenActiveFileExternal: fileActions.openExternalFile,
    onToggleFavorite: entryActions.handleToggleFavorite,
    onToggleOrganized: toggleOrganizedCommand,
    onCustomizeNoteListColumns: handleCustomizeNoteListColumns,
    canCustomizeNoteListColumns,
    noteListColumnsLabel,
    onRestoreDeletedNote: restoreDeletedNoteCommand,
    canRestoreDeletedNote: !!activeDeletedFile,
  })

  const inboxCount = useMemo(() => filterInboxEntries(visibleEntries, inboxPeriod).length, [visibleEntries])

  const aiNoteList = useMemo<NoteListItem[]>(() => {
    const isInbox = effectiveSelection.kind === 'filter' && effectiveSelection.filter === 'inbox'
    const filtered = isInbox
      ? filterInboxEntries(visibleEntries, inboxPeriod)
      : filterEntries(visibleEntries, effectiveSelection, {
        views: vault.views,
        allNotesFileVisibility,
      })
    return filtered.map(e => ({
      path: e.path, title: e.title, type: e.isA ?? 'Note',
    }))
  }, [allNotesFileVisibility, visibleEntries, vault.views, effectiveSelection])

  const aiNoteListFilter = useMemo(() => {
    if (effectiveSelection.kind === 'sectionGroup') return { type: effectiveSelection.type, query: '' }
    if (effectiveSelection.kind === 'entity') return { type: null, query: effectiveSelection.entry.title }
    return { type: null, query: '' }
  }, [effectiveSelection])

  const {
    isStartupLoading,
    isVaultContentLoading,
    shouldResumeFreshStartOnboarding,
    shouldShowStartupScreen,
  } = useStartupScreenState({
    aiAgentsPromptVisible: aiAgentsOnboarding.showPrompt,
    isNoteWindow: Boolean(noteWindowParams) || aiWorkspaceWindow,
    onboardingState: onboarding.state,
    runtimeMissingVaultPath,
    selectedVaultPath,
    settingsLoaded,
    showMcpSetupDialog,
    telemetryConsent: settings.telemetry_consent,
    vaultIsLoading: vault.isLoading,
    vaultSwitcher,
  })
  const handleAiWorkspaceConversationsChange = useCallback((conversations: AiWorkspaceConversationSetting[]) => {
    void saveSettings({ ...settings, ai_workspace_conversations: conversations })
  }, [saveSettings, settings])
  const aiWorkspaceSurface = <AppAiWorkspaceSurface mode={aiWorkspaceWindow ? 'window' : 'docked'} open={aiWorkspaceWindow || effectiveShowAIChat} aiAgentsStatus={aiAgentsStatus} aiModelProviders={settings.ai_model_providers ?? []} conversationSettings={settings.ai_workspace_conversations ?? null} conversationSettingsReady={settingsLoaded} defaultAiAgent={aiAgentPreferences.defaultAiAgent} defaultAiTarget={aiAgentPreferences.defaultAiTarget} defaultAiAgentReadiness={aiAgentPreferences.defaultAiAgentReadiness} defaultAiAgentReady={aiAgentPreferences.defaultAiAgentReady} activeEntry={activeTab?.entry ?? null} activeNoteContent={activeTab?.content ?? null} entries={visibleEntries} openTabs={notes.tabs.map((tab) => tab.entry)} noteList={aiNoteList} noteListFilter={aiNoteListFilter} onClose={aiWorkspaceWindow ? handleDockCurrentAiWorkspaceWindow : closeAIChat} onConversationSettingsChange={handleAiWorkspaceConversationsChange} onDock={aiWorkspaceWindow ? handleDockCurrentAiWorkspaceWindow : undefined} onPopOut={aiWorkspaceWindow ? undefined : handlePopOutAiWorkspace} onOpenAiSettings={aiWorkspaceWindow ? undefined : handleOpenAiSettings} onOpenNote={notes.handleNavigateWikilink} onRestoreVaultAiGuidance={aiFeaturesEnabled ? () => { void restoreVaultAiGuidance() } : undefined} onUnsupportedAiPaste={setToastMessage} onFileCreated={vaultBridge.handleAgentFileCreated} onFileModified={vaultBridge.handleAgentFileModified} onVaultChanged={vaultBridge.handleAgentVaultChanged} vaultAiGuidanceStatus={vaultAiGuidanceStatus} vaultPath={activeEditorVaultPath} vaultPaths={writableVaultPaths} locale={appLocale} />
  if (shouldShowStartupScreen) {
    return (
      <StartupScreen
        aiAgentsOnboarding={aiAgentsOnboarding}
        aiAgentsStatus={aiAgentsStatus}
        isOffline={networkStatus.isOffline}
        isStartupLoading={isStartupLoading}
        noteWindowParams={noteWindowParams}
        onboarding={onboarding}
        runtimeMissingVaultPath={runtimeMissingVaultPath}
        saveSettings={saveSettings}
        settings={settings}
        settingsLoaded={settingsLoaded}
        shouldResumeFreshStartOnboarding={shouldResumeFreshStartOnboarding}
        showMcpSetupDialog={showMcpSetupDialog}
        setToastMessage={setToastMessage}
        toastMessage={toastMessage}
        vaultSwitcher={vaultSwitcher}
      />
    )
  }

  if (aiWorkspaceWindow) {
    return (
      <AppPreferencesProvider dateDisplayFormat={dateDisplayFormat}>
        {aiWorkspaceSurface}
      </AppPreferencesProvider>
    )
  }

  const noteListModifiedFiles = isChangesSelection ? selectedChangesModifiedFiles : undefined
  const noteListModifiedFilesError = isChangesSelection ? gitSurfaces.changesModifiedFilesError : null

  return (
    <AppPreferencesProvider dateDisplayFormat={dateDisplayFormat}>
      <div className="app-shell">
        <div className="app">
          {sidebarVisible && (
            <>
              <div className="app__sidebar" style={{ width: layout.sidebarWidth }}>
                <Sidebar entries={visibleEntries} folders={vault.folders} views={vault.views} selection={effectiveSelection} onSelect={handleSetSelection} onSelectNote={notes.handleSelectNote} onSelectFavorite={handleOpenFavorite} onReorderFavorites={entryActions.handleReorderFavorites} onCreateType={notes.handleCreateNoteImmediate} onCreateNewType={dialogs.openCreateType} onCustomizeType={entryActions.handleCustomizeType} onUpdateTypeTemplate={entryActions.handleUpdateTypeTemplate} onReorderSections={entryActions.handleReorderSections} onRenameSection={entryActions.handleRenameSection} onDeleteType={handleDeleteType} onToggleTypeVisibility={entryActions.handleToggleTypeVisibility} onCreateFolder={handleCreateFolder} onRenameFolder={folderActions.renameFolder} onDeleteFolder={folderActions.requestDeleteFolder} folderFileActions={fileActions.folderActions} renamingFolderPath={folderActions.renamingFolderPath} onStartRenameFolder={folderActions.startFolderRename} onCancelRenameFolder={folderActions.cancelFolderRename} onCreateView={dialogs.openCreateView} onEditView={handleEditView} onDeleteView={handleDeleteView} onUpdateViewDefinition={handleSidebarUpdateViewDefinition} onReorderViews={canReorderSavedViews ? viewOrdering.onReorderViews : undefined} showInbox={explicitOrganizationEnabled} inboxCount={inboxCount} allNotesFileVisibility={allNotesFileVisibility} pluralizeTypeLabels={settings.sidebar_type_pluralization_enabled ?? true} onCollapse={handleCollapseSidebar} onGoBack={handleGoBack} onGoForward={handleGoForward} canGoBack={canGoBack} canGoForward={canGoForward} locale={appLocale} loading={isVaultContentLoading} vaultRootPath={resolvedPath} workspaceOrder={vaultWorkspaceOrder} />
              </div>
              <ResizeHandle onResize={layout.handleSidebarResize} />
            </>
          )}
          {noteListVisible && (
            <>
              <div className={`app__note-list${aiActivity.highlightElement === 'notelist' ? ' ai-highlight' : ''}`} style={{ width: layout.noteListWidth }}>
                {effectiveSelection.kind === 'filter' && effectiveSelection.filter === 'pulse' ? (
                  <PulseView vaultPath={gitSurfaces.historyRepositoryPath} onOpenNote={handlePulseOpenNote} sidebarCollapsed={!sidebarVisible} onExpandSidebar={() => handleSetViewMode('all')} repositories={gitRepositories} selectedRepositoryPath={gitSurfaces.historyRepositoryPath} onRepositoryChange={gitSurfaces.setHistoryRepositoryPath} locale={appLocale} />
                ) : (
                  <NoteList entries={visibleEntries} selection={effectiveSelection} selectedNote={activeTab?.entry ?? null} loading={isVaultContentLoading} noteListFilter={noteListFilter} onNoteListFilterChange={setNoteListFilter} inboxPeriod={inboxPeriod} modifiedFiles={noteListModifiedFiles} modifiedFilesError={noteListModifiedFilesError} gitRepositories={gitRepositories} selectedGitRepositoryPath={gitSurfaces.changesRepositoryPath} onGitRepositoryChange={gitSurfaces.setChangesRepositoryPath} getNoteStatus={vault.getNoteStatus} sidebarCollapsed={!sidebarVisible} onSelectNote={notes.handleSelectNote} onReplaceActiveTab={handleReplaceActiveTabWithQueuedDiff} onEnterNeighborhood={handleEnterNeighborhood} onCreateNote={notes.handleCreateNoteImmediate} onBulkOrganize={explicitOrganizationEnabled ? bulkActions.handleBulkOrganize : undefined} onBulkArchive={bulkActions.handleBulkArchive} onBulkDeletePermanently={deleteActions.handleBulkDeletePermanently} onUpdateTypeSort={notes.handleUpdateFrontmatter} onUpdateViewDefinition={handleUpdateViewDefinition} updateEntry={vault.updateEntry} onOpenInNewWindow={handleOpenEntryInNewWindow} onToggleFavorite={entryActions.handleToggleFavorite} onToggleOrganized={explicitOrganizationEnabled ? entryActions.handleToggleOrganized : undefined} onRevealFile={fileActions.revealFile} onCopyFilePath={fileActions.copyFilePath} onDiscardFile={handleDiscardFile} onOpenDeletedNote={handleOpenDeletedNote} allNotesNoteListProperties={vaultConfig.allNotes?.noteListProperties ?? null} onUpdateAllNotesNoteListProperties={handleUpdateAllNotesNoteListProperties} inboxNoteListProperties={vaultConfig.inbox?.noteListProperties ?? null} onUpdateInboxNoteListProperties={handleUpdateInboxNoteListProperties} views={vault.views} visibleNotesRef={visibleNotesRef} allNotesFileVisibility={allNotesFileVisibility} multiSelectionCommandRef={multiSelectionCommandRef} locale={appLocale} />
                )}
              </div>
              <ResizeHandle onResize={layout.handleNoteListResize} />
            </>
          )}
          <div className={`app__editor${aiActivity.highlightElement === 'editor' || aiActivity.highlightElement === 'tab' ? ' ai-highlight' : ''}`}>
            <Editor
              tabs={notes.tabs}
              activeTabPath={notes.activeTabPath}
              isVaultLoading={isVaultContentLoading}
              entries={visibleEntries}
              onNavigateWikilink={notes.handleNavigateWikilink}
              onLoadDiff={loadDiffForPath}
              onLoadDiffAtCommit={loadDiffAtCommitForPath}
              pendingCommitDiffRequest={pendingDiffRequest}
              onPendingCommitDiffHandled={handlePendingDiffHandled}
              getNoteStatus={vault.getNoteStatus}
              onCreateNote={notes.handleCreateNoteImmediate}
              inspectorCollapsed={layout.inspectorCollapsed}
              onToggleInspector={handleToggleInspector}
              inspectorWidth={layout.inspectorWidth}
              defaultAiAgent={aiAgentPreferences.defaultAiAgent}
              defaultAiTarget={aiAgentPreferences.defaultAiTarget}
              defaultAiAgentReadiness={aiAgentPreferences.defaultAiAgentReadiness}
              defaultAiAgentReady={aiAgentPreferences.defaultAiAgentReady}
              onUnsupportedAiPaste={setToastMessage}
              onInspectorResize={layout.handleInspectorResize}
              inspectorEntry={activeTab?.entry ?? null}
              inspectorContent={activeTab?.content ?? null}
              gitHistory={gitHistory}
              onUpdateFrontmatter={notes.handleUpdateFrontmatter}
              onDeleteProperty={notes.handleDeleteProperty}
              onAddProperty={notes.handleAddProperty}
              onCreateMissingType={handleCreateMissingType}
              onCreateAndOpenNote={notes.handleCreateNoteForRelationship}
              onChangeWorkspace={activeDeletedFile ? undefined : handleChangeWorkspace}
              onInitializeProperties={handleInitializeProperties}
              showAIChat={effectiveShowAIChat}
              onToggleAIChat={aiFeaturesEnabled ? dialogs.toggleAIChat : undefined}
              vaultPath={activeEditorVaultPath}
              vaultPaths={writableVaultPaths}
              noteList={aiNoteList}
              noteListFilter={aiNoteListFilter}
              onToggleFavorite={activeDeletedFile ? undefined : entryActions.handleToggleFavorite}
              onToggleOrganized={activeDeletedFile || !explicitOrganizationEnabled ? undefined : toggleOrganizedCommand}
              onEnterNeighborhood={activeDeletedFile ? undefined : handleEnterNeighborhood}
              onRevealFile={fileActions.revealFile}
              onCopyFilePath={fileActions.copyFilePath}
              onOpenExternalFile={fileActions.openExternalFile}
              onDeleteNote={activeDeletedFile ? undefined : deleteActions.handleDeleteNote}
              onArchiveNote={activeDeletedFile ? undefined : entryActions.handleArchiveNote}
              onUnarchiveNote={activeDeletedFile ? undefined : entryActions.handleUnarchiveNote}
              onContentChange={handleTrackedContentChange}
              onSave={handleTrackedSave}
              onRenameFilename={activeDeletedFile ? undefined : appSave.handleFilenameRename}
              noteWidth={activeNoteWidth}
              onToggleNoteWidth={handleToggleNoteWidth}
              rawToggleRef={rawToggleRef}
              tableOfContentsToggleRef={tableOfContentsToggleRef}
              findInNoteRef={findInNoteRef}
              diffToggleRef={diffToggleRef}
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              onGoBack={handleGoBack}
              onGoForward={handleGoForward}
              leftPanelsCollapsed={!sidebarVisible && !noteListVisible}
              onFileCreated={vaultBridge.handleAgentFileCreated}
              onFileModified={vaultBridge.handleAgentFileModified}
              onVaultChanged={vaultBridge.handleAgentVaultChanged}
              workspaces={inspectorWorkspaces}
              isConflicted={conflictFlow.isConflicted}
              onKeepMine={conflictFlow.handleKeepMine}
              onKeepTheirs={conflictFlow.handleKeepTheirs}
              flushPendingEditorContentRef={flushPendingEditorContentRef}
              flushPendingRawContentRef={flushPendingRawContentRef}
              locale={appLocale}
            />
          </div>
          {effectiveShowAIChat && aiWorkspaceSurface}
        </div>
        <UpdateBanner status={updateStatus} actions={updateActions} locale={appLocale} />
        <RenameDetectedBanner renames={detectedRenames} onUpdate={handleUpdateWikilinks} onDismiss={handleDismissRenames} />
        <StatusBar noteCount={visibleEntries.length} modifiedCount={gitModifiedCount} vaultPath={resolvedPath} defaultWorkspacePath={defaultWorkspacePath} vaults={vaultSwitcher.allVaults} multiWorkspaceEnabled={multiWorkspaceEnabled} onSwitchVault={vaultSwitcher.switchVault} onSetDefaultWorkspace={vaultSwitcher.setDefaultWorkspace} onOpenSettings={handleOpenSettings} onOpenVaultSettings={handleOpenVaultSettings} onOpenFeedback={openFeedback} onOpenDocs={openDocs} onOpenLocalFolder={vaultSwitcher.handleOpenLocalFolder} onCreateEmptyVault={vaultSwitcher.handleCreateEmptyVault} onCloneVault={dialogs.openCloneVault} onCloneGettingStarted={cloneGettingStartedVault} onClickPending={() => handleSetSelection({ kind: 'filter', filter: 'changes' })} onClickPulse={() => handleSetSelection({ kind: 'filter', filter: 'pulse' })} onCommitPush={handleCommitPush} commitActionPending={commitFlow.isOpeningCommitDialog} gitFeaturesEnabled={gitFeaturesEnabled} onInitializeGit={openGitSetupDialog} isOffline={networkStatus.isOffline} isGitVault={isGitVault} isVaultReloading={vault.isReloading || isVaultContentLoading} syncStatus={autoSync.syncStatus} lastSyncTime={autoSync.lastSyncTime} conflictCount={autoSync.conflictFiles.length} remoteStatus={autoSync.remoteStatus} repositories={gitRepositories} selectedRepositoryPath={gitSurfaces.syncRepositoryPath} onRepositoryChange={gitSurfaces.setSyncRepositoryPath} onTriggerSync={handlePullSelectedRepository} onPullAndPush={handlePullAndPushSelectedRepository} onOpenConflictResolver={conflictFlow.handleOpenConflictResolver} zoomLevel={zoom.zoomLevel} themeMode={documentThemeMode} onZoomReset={zoom.zoomReset} onToggleThemeMode={settingsLoaded ? handleToggleThemeMode : undefined} buildNumber={buildNumber} onCheckForUpdates={handleCheckForUpdates} onRemoveVault={vaultSwitcher.removeVault} onReorderVaults={vaultSwitcher.reorderVaults} onUpdateWorkspaceIdentity={vaultSwitcher.updateWorkspaceIdentity} aiFeaturesEnabled={aiFeaturesEnabled} mcpStatus={mcpStatus} onInstallMcp={openMcpSetupDialog} aiAgentsStatus={aiFeaturesEnabled ? aiAgentsStatus : undefined} vaultAiGuidanceStatus={aiFeaturesEnabled ? vaultAiGuidanceStatus : undefined} defaultAiAgent={aiFeaturesEnabled ? aiAgentPreferences.defaultAiAgent : undefined} defaultAiTarget={aiFeaturesEnabled ? settings.default_ai_target ?? undefined : undefined} aiModelProviders={aiFeaturesEnabled ? settings.ai_model_providers ?? [] : []} onSetDefaultAiAgent={aiFeaturesEnabled ? aiAgentPreferences.setDefaultAiAgent : undefined} onSetDefaultAiTarget={aiFeaturesEnabled ? aiAgentPreferences.setDefaultAiTarget : undefined} onOpenAiWorkspace={aiFeaturesEnabled ? handleOpenDockedAiWorkspace : undefined} onRestoreVaultAiGuidance={aiFeaturesEnabled ? () => { void restoreVaultAiGuidance() } : undefined} locale={appLocale} />
        <GitSetupDialog open={gitFeaturesEnabled && shouldShowGitSetupDialog} onInitGit={handleInitGitRepo} onDismiss={dismissGitSetupDialog} onNeverForVault={neverForVaultGitSetupDialog} />
        <DeleteProgressNotice count={deleteActions.pendingDeleteCount} />
        <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
        <QuickOpenPalette open={dialogs.showQuickOpen} entries={visibleEntries} isLoading={vault.isLoading} onSelect={notes.handleSelectNote} onCreateNote={(title) => notes.handleCreateNote(title, 'Note', 'quick_open')} onClose={dialogs.closeQuickOpen} locale={appLocale} />
        <CommandPalette
          open={dialogs.showCommandPalette}
          commands={commands}
          entries={visibleEntries}
          aiAgentReady={aiAgentPreferences.defaultAiAgentReady}
          aiAgentLabel={aiAgentPreferences.defaultAiAgentLabel}
          aiModeEnabled={aiFeaturesEnabled}
          locale={appLocale}
          onClose={dialogs.closeCommandPalette}
        />
        <SearchPanel open={dialogs.showSearch} vaultPath={resolvedPath} entries={visibleEntries} onSelectNote={notes.handleSelectNote} onClose={dialogs.closeSearch} />
        <CreateTypeDialog open={dialogs.showCreateTypeDialog} onClose={dialogs.closeCreateType} onCreate={handleCreateType} />
        <NoteRetargetingDialogs
          dialogState={noteRetargetingUi.dialogState}
          dialogEntry={noteRetargetingUi.dialogEntry}
          typeOptions={noteRetargetingUi.typeOptions}
          folderOptions={noteRetargetingUi.folderOptions}
          onClose={noteRetargetingUi.closeDialog}
          onSelectType={noteRetargetingUi.selectType}
          onSelectFolder={noteRetargetingUi.selectFolder}
        />
        <CreateViewDialog open={dialogs.showCreateViewDialog} onClose={dialogs.closeCreateView} onCreate={handleCreateOrUpdateView} availableFields={availableFields} locale={appLocale} editingView={dialogs.editingView?.definition ?? null} />
        <CommitDialog
          open={commitFlow.showCommitDialog}
          modifiedCount={commitModifiedFiles.length}
          commitMode={commitFlow.commitMode}
          locale={appLocale}
          repositories={gitRepositories}
          selectedRepositoryPath={gitSurfaces.commitRepositoryPath}
          suggestedMessage={suggestedCommitMessage}
          onRepositoryChange={gitSurfaces.setCommitRepositoryPath}
          onCommit={commitFlow.handleCommitPush}
          onClose={commitFlow.closeCommitDialog}
        />
        <ConflictResolverModal
          open={dialogs.showConflictResolver}
          fileStates={conflictResolver.fileStates}
          allResolved={conflictResolver.allResolved}
          committing={conflictResolver.committing}
          error={conflictResolver.error}
          onResolveFile={conflictResolver.resolveFile}
          onOpenInEditor={conflictResolver.openInEditor}
          onCommit={conflictResolver.commitResolution}
          onClose={conflictFlow.handleCloseConflictResolver}
        />
        <SettingsPanel open={dialogs.showSettings} initialSectionId={settingsInitialSectionId} settings={settings} aiAgentsStatus={aiAgentsStatus} locale={appLocale} systemLocale={systemLocale} vaults={vaultSwitcher.allVaults} defaultWorkspacePath={vaultSwitcher.defaultWorkspacePath} onSetDefaultWorkspace={vaultSwitcher.setDefaultWorkspace} onRemoveVault={vaultSwitcher.removeVault} onReorderVaults={vaultSwitcher.reorderVaults} onUpdateWorkspaceIdentity={vaultSwitcher.updateWorkspaceIdentity} isGitVault={gitRepoState !== 'missing'} onSave={saveSettings} onCopyMcpConfig={handleCopyMcpConfig} explicitOrganizationEnabled={explicitOrganizationEnabled} onSaveExplicitOrganization={handleSaveExplicitOrganization} onClose={dialogs.closeSettings} />
        <FeedbackDialog open={showFeedback} onClose={closeFeedback} />
        <McpSetupDialog open={showMcpSetupDialog} status={mcpStatus} busyAction={mcpDialogAction} manualConfigSnippet={mcpConfigSnippet} manualConfigLoading={mcpConfigLoading} manualConfigError={mcpConfigError} locale={appLocale} onClose={closeMcpSetupDialog} onConnect={handleConnectMcp} onCopyManualConfig={handleCopyMcpConfig} onDisconnect={handleDisconnectMcp} onLoadManualConfig={handleLoadMcpConfigSnippet} />
        <CloneVaultModal key={dialogs.showCloneVault ? 'clone-open' : 'clone-closed'} open={dialogs.showCloneVault} onClose={dialogs.closeCloneVault} onVaultCloned={vaultSwitcher.handleVaultCloned} />
        {deleteActions.confirmDelete && (
          <ConfirmDeleteDialog
            open={true}
            title={deleteActions.confirmDelete.title}
            message={deleteActions.confirmDelete.message}
            confirmLabel={deleteActions.confirmDelete.confirmLabel}
            onConfirm={deleteActions.confirmDelete.onConfirm}
            onCancel={() => deleteActions.setConfirmDelete(null)}
          />
        )}
        {folderActions.confirmDeleteFolder && (
          <ConfirmDeleteDialog
            open={true}
            title={folderActions.confirmDeleteFolder.title}
            message={folderActions.confirmDeleteFolder.message}
            confirmLabel={folderActions.confirmDeleteFolder.confirmLabel}
            onConfirm={folderActions.confirmDeleteSelectedFolder}
            onCancel={folderActions.cancelDeleteFolder}
          />
        )}
      </div>
    </AppPreferencesProvider>
  )
}

export default App
