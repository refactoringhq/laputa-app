import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CaretDown, GearSix } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { DEFAULT_AI_AGENT, type AiAgentId, type AiAgentReadiness, type AiAgentsStatus } from '../lib/aiAgents'
import { resolveAiTargetReadiness, targetAgent, type AiModelProvider, type AiTarget } from '../lib/aiTargets'
import { aiAgentPermissionModeLabels, type AiAgentPermissionMode } from '../lib/aiAgentPermissionMode'
import type { VaultAiGuidanceStatus } from '../lib/vaultAiGuidance'
import { translate, type AppLocale } from '../lib/i18n'
import { trackAiWorkspaceChatTitled, trackAiWorkspaceSidebarToggled } from '../lib/productAnalytics'
import { type modelOptionsForAgent, preferredAgentModel, type AiAgentModelCatalog } from '../lib/aiAgentModels'
import { useAiAgentModelCatalog } from '../hooks/useAiAgentModelCatalog'
import { resolveAgentModelSelection, useAiAgentModelActions } from '../hooks/useAiAgentModelSelection'
import type { AgentStatus, AiAgentMessage } from '../hooks/useCliAiAgent'
import type { AiWorkspaceConversationSetting } from '../types'
import type { NoteListItem } from '../utils/ai-context'
import type { VaultEntry } from '../types'
import { NEW_AI_CHAT_EVENT } from '../utils/aiPromptBridge'
import type { GenerateAiConversationTitleRequest } from '../utils/aiConversationTitle'
import { cloneAiWorkspaceSessionUntilMessage } from '../lib/aiWorkspaceSessionStore'
import { AiPanelView } from './AiPanel'
import { GuidanceWarning, WorkspaceHeader } from './AiWorkspaceChrome'
import { WorkspaceResizeHandles } from './AiWorkspaceResizeHandles'
import { AiTargetModelPicker } from './AiAgentModelPicker'
import { ConversationSidebar } from './AiWorkspaceSidebar'
import { ResizeHandle } from './ResizeHandle'
import { SideWorkspaceHeader } from './AiWorkspaceSideHeader'
import { useAiPanelController } from './useAiPanelController'
import { buildAiWorkspaceTargetGroups, type AiWorkspaceTargetGroups } from './aiWorkspaceTargetGroups'
import {
  activeConversationForState,
  canArchiveConversation,
  firstTarget,
  flatTargets,
  resolveTarget,
  useConversations,
  type AiConversation,
} from './aiWorkspaceConversations'
import {
  useAiWorkspaceSizing,
  workspaceClassName,
  workspaceStyle,
  type AiWorkspaceMode,
  type AiWorkspaceSizing,
} from './aiWorkspaceSizing'

export type { AiConversation } from './aiWorkspaceConversations'

interface AiWorkspaceProps {
  activeEntry?: VaultEntry | null
  activeNoteContent?: string | null
  aiAgentsStatus: AiAgentsStatus
  aiModelProviders?: AiModelProvider[]
  conversationSettings?: AiWorkspaceConversationSetting[] | null
  conversationSettingsReady?: boolean
  defaultAiAgent?: AiAgentId
  defaultAiAgentReadiness?: AiAgentReadiness
  defaultAiAgentReady?: boolean
  defaultAiTarget?: AiTarget
  entries?: VaultEntry[]
  initialActiveConversationId?: string
  locale?: AppLocale
  mode?: 'docked' | 'side' | 'window'
  noteList?: NoteListItem[]
  noteListFilter?: { type: string | null; query: string }
  onActiveConversationChange?: (id: string) => void
  onActiveTargetChange?: (target: AiTarget) => void
  onClose: () => void
  onConversationSettingsChange?: (conversations: AiWorkspaceConversationSetting[]) => void
  onDock?: () => void
  onFileCreated?: (relativePath: string) => void
  onFileModified?: (relativePath: string) => void
  onOpenAiSettings?: () => void
  onOpenNote?: (path: string) => void
  onPopOut?: (context?: { activeConversationId?: string }) => void
  onRestoreVaultAiGuidance?: () => void
  onUnsupportedAiPaste?: (message: string) => void
  onVaultChanged?: () => void
  open: boolean
  openTabs?: VaultEntry[]
  vaultAiGuidanceStatus?: VaultAiGuidanceStatus
  vaultPath: string
  vaultPaths?: string[]
}

function PermissionPicker({
  compact = false,
  disabled,
  locale,
  permissionMode,
  side = 'bottom',
  targetKind,
  onChange,
}: {
  compact?: boolean
  disabled: boolean
  locale: AppLocale
  permissionMode: AiAgentPermissionMode
  side?: 'bottom' | 'top'
  targetKind: AiTarget['kind']
  onChange: (mode: AiAgentPermissionMode) => void
}) {
  if (targetKind === 'api_model') {
    return (
      <Button
        type="button"
        variant={compact ? 'ghost' : 'outline'}
        size={compact ? 'xs' : 'sm'}
        disabled
        className="rounded-full px-2 text-[12px] text-muted-foreground"
      >
        {translate(locale, 'ai.panel.mode.chat')}
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={compact ? 'ghost' : 'outline'}
          size={compact ? 'xs' : 'sm'}
          className={cn(
            'justify-between text-muted-foreground hover:text-foreground',
            compact ? 'rounded-full px-2 text-[12px]' : 'gap-2',
          )}
          disabled={disabled}
          aria-label={translate(locale, 'ai.workspace.permissionMode')}
          data-testid="ai-workspace-permission-trigger"
        >
          {aiAgentPermissionModeLabels(permissionMode, locale).control}
          <CaretDown size={compact ? 12 : 13} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={side} className="min-w-[180px]">
        {(['safe', 'power_user'] as const).map((mode) => (
          <DropdownMenuItem key={mode} onSelect={() => onChange(mode)}>
            {aiAgentPermissionModeLabels(mode, locale).control}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type ConversationSessionProps = {
  active: boolean
  activeEntry?: VaultEntry | null
  activeNoteContent?: string | null
  aiAgentsStatus: AiAgentsStatus
  conversation: AiConversation
  defaultAiAgentReady: boolean
  entries?: VaultEntry[]
  groups: AiWorkspaceTargetGroups
  locale: AppLocale
  mode: AiWorkspaceMode
  noteList?: NoteListItem[]
  noteListFilter?: { type: string | null; query: string }
  onArchive: () => void
  onClose: () => void
  onDock?: () => void
  onFileCreated?: (relativePath: string) => void
  onFileModified?: (relativePath: string) => void
  onForkMessage?: (messageId: string) => void
  onMessageHistoryScrollStateChange?: (scrolled: boolean) => void
  onOpenAiSettings?: () => void
  onOpenNote?: (path: string) => void
  onPopOut?: () => void
  onRestoreVaultAiGuidance?: () => void
  onSelectModel: (modelId: string | null) => void
  onSelectTarget: (targetId: string) => void
  onStatusChange: (id: string, status: AgentStatus) => void
  onPromptSubmitted: (id: string) => void
  onTitleFromAnswer: (request: GenerateAiConversationTitleRequest & { id: string }) => void
  onUnsupportedAiPaste?: (message: string) => void
  onVaultChanged?: () => void
  openTabs?: VaultEntry[]
  readyFallbackTargetId: string
  target: AiTarget
  modelCatalog: AiAgentModelCatalog
  modelCatalogReady: boolean
  vaultAiGuidanceStatus?: VaultAiGuidanceStatus
  vaultPath: string
  vaultPaths?: string[]
}

function firstCompletedAssistantMessage(messages: AiAgentMessage[]): AiAgentMessage | undefined {
  return messages.find(
    (message) =>
      !message.localMarker && !message.isStreaming && !!message.userMessage.trim() && !!message.response?.trim(),
  )
}

function useGeneratedConversationTitle(options: {
  aiAgentsStatus: AiAgentsStatus
  conversation: AiConversation
  defaultAiAgentReady: boolean
  messages: AiAgentMessage[]
  onTitleFromAnswer: (request: GenerateAiConversationTitleRequest & { id: string }) => void
  permissionMode: AiAgentPermissionMode
  readyFallbackTargetId: string
  target: AiTarget
  vaultPath: string
  vaultPaths?: string[]
}) {
  const {
    aiAgentsStatus,
    conversation,
    defaultAiAgentReady,
    messages,
    onTitleFromAnswer,
    permissionMode,
    readyFallbackTargetId,
    target,
    vaultPath,
    vaultPaths,
  } = options
  const requestedTitleKeysRef = useRef(new Set<string>())

  useEffect(() => {
    if (!conversation.usesDefaultTitle) return

    const firstMessage = firstCompletedAssistantMessage(messages)
    const prompt = firstMessage?.userMessage.trim()
    const assistantResponse = firstMessage?.response?.trim()
    if (!firstMessage || !prompt || !assistantResponse) return

    const titleKey = `${conversation.id}:${firstMessage.id ?? prompt}`
    if (requestedTitleKeysRef.current.has(titleKey)) return
    requestedTitleKeysRef.current.add(titleKey)

    onTitleFromAnswer({
      assistantResponse,
      id: conversation.id,
      permissionMode,
      prompt,
      target,
      targetReady: resolveAiTargetReadiness(target, aiAgentsStatus, {
        readyFallbackTargetId,
        readyFallbackTargetReady: defaultAiAgentReady,
      }).ready,
      vaultPath,
      vaultPaths,
    })
  }, [
    aiAgentsStatus,
    conversation.id,
    conversation.usesDefaultTitle,
    defaultAiAgentReady,
    messages,
    onTitleFromAnswer,
    permissionMode,
    readyFallbackTargetId,
    target,
    vaultPath,
    vaultPaths,
  ])
}

interface ConversationSessionContext {
  activeEntry: VaultEntry | null
  activeNoteContent: string | null
  entries?: VaultEntry[]
  noteList?: NoteListItem[]
  noteListFilter?: { type: string | null; query: string }
  openTabs?: VaultEntry[]
}

function activeContextForSession({
  active,
  activeEntry,
  activeNoteContent,
  entries,
  noteList,
  noteListFilter,
  openTabs,
}: Pick<
  ConversationSessionProps,
  'active' | 'activeEntry' | 'activeNoteContent' | 'entries' | 'noteList' | 'noteListFilter' | 'openTabs'
>): ConversationSessionContext {
  if (!active) {
    return {
      activeEntry: null,
      activeNoteContent: null,
    }
  }

  return {
    activeEntry: activeEntry ?? null,
    activeNoteContent: activeNoteContent ?? null,
    entries,
    noteList,
    noteListFilter,
    openTabs,
  }
}

function ConversationComposerControls(options: {
  catalog: AiAgentModelCatalog
  catalogReady: boolean
  disabled: boolean
  groups: AiWorkspaceTargetGroups
  locale: AppLocale
  onOpenAiSettings?: () => void
  onPermissionModeChange: (mode: AiAgentPermissionMode) => void
  onSelectModel: (agentId: AiAgentId, modelId: string) => void
  onSelectTarget: (targetId: string) => void
  permissionMode: AiAgentPermissionMode
  side: 'bottom' | 'top'
  target: AiTarget
  modelOptions: ReturnType<typeof modelOptionsForAgent>
  selectedModelId: string
}) {
  const {
    catalog,
    catalogReady,
    disabled,
    groups,
    locale,
    onOpenAiSettings,
    onPermissionModeChange,
    onSelectModel,
    onSelectTarget,
    permissionMode,
    side,
    target,
    modelOptions,
    selectedModelId,
  } = options
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
      data-testid="ai-workspace-composer-controls"
    >
      <AiTargetModelPicker
        catalog={catalog}
        catalogReady={catalogReady}
        disabled={disabled}
        groups={groups}
        locale={locale}
        modelOptions={modelOptions}
        onSelectAgentModel={onSelectModel}
        onSelectTarget={onSelectTarget}
        selectedModelId={selectedModelId}
        selectedTarget={target}
        side={side}
      />
      <div className="flex shrink-0 items-center gap-1">
        <PermissionPicker
          compact
          disabled={disabled}
          locale={locale}
          permissionMode={permissionMode}
          side={side}
          targetKind={target.kind}
          onChange={onPermissionModeChange}
        />
        {onOpenAiSettings && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground"
            aria-label={translate(locale, 'ai.workspace.settings')}
            title={translate(locale, 'ai.workspace.settings')}
            onClick={onOpenAiSettings}
            data-testid="ai-workspace-composer-settings"
          >
            <GearSix size={16} weight="regular" />
          </Button>
        )}
      </div>
    </div>
  )
}

function ConversationWorkspaceHeader(
  options: Pick<
  ConversationSessionProps,
  'conversation' | 'locale' | 'mode' | 'onArchive' | 'onClose' | 'onDock' | 'onOpenAiSettings' | 'onPopOut'
  >,
) {
  const { conversation, locale, mode, onArchive, onClose, onDock, onOpenAiSettings, onPopOut } = options
  if (mode === 'side') return null

  return (
    <WorkspaceHeader
      archiveDisabled={!canArchiveConversation(conversation)}
      conversation={conversation}
      locale={locale}
      mode={mode}
      onArchive={onArchive}
      onClose={onClose}
      onDock={onDock}
      onOpenAiSettings={onOpenAiSettings}
      onPopOut={onPopOut}
    />
  )
}

interface ConversationSessionViewProps {
  active: boolean
  composerControls: ReactNode
  context: ConversationSessionContext
  controller: ReturnType<typeof useAiPanelController>
  conversation: AiConversation
  locale: AppLocale
  mode: AiWorkspaceMode
  onArchive: () => void
  onClose: () => void
  onDock?: () => void
  onForkMessage?: (messageId: string) => void
  onMessageHistoryScrollStateChange?: (scrolled: boolean) => void
  onOpenAiSettings?: () => void
  onOpenNote?: (path: string) => void
  onPopOut?: () => void
  onPromptSubmitted: (id: string) => void
  onRestoreVaultAiGuidance?: () => void
  onSelectTarget: (targetId: string) => void
  onUnsupportedAiPaste?: (message: string) => void
  target: AiTarget
  targetReadiness: { readiness: AiAgentReadiness; ready: boolean }
  vaultAiGuidanceStatus?: VaultAiGuidanceStatus
}

function ConversationSessionView(options: ConversationSessionViewProps) {
  const {
    active,
    composerControls,
    context,
    controller,
    conversation,
    locale,
    mode,
    onArchive,
    onClose,
    onDock,
    onForkMessage,
    onMessageHistoryScrollStateChange,
    onOpenAiSettings,
    onOpenNote,
    onPopOut,
    onPromptSubmitted,
    onRestoreVaultAiGuidance,
    onSelectTarget,
    onUnsupportedAiPaste,
    target,
    targetReadiness,
    vaultAiGuidanceStatus,
  } = options
  return (
    <div
      className={active ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
      data-testid={`ai-workspace-session-${conversation.id}`}
    >
      <ConversationWorkspaceHeader
        conversation={conversation}
        locale={locale}
        mode={mode}
        onArchive={onArchive}
        onClose={onClose}
        onDock={onDock}
        onOpenAiSettings={onOpenAiSettings}
        onPopOut={onPopOut}
      />
      <GuidanceWarning locale={locale} onRestore={onRestoreVaultAiGuidance} status={vaultAiGuidanceStatus} />
      <div className="flex min-h-0 flex-1">
        <AiPanelView
          controller={controller}
          defaultAiAgent={targetAgent(target)}
          defaultAiAgentReadiness={targetReadiness.readiness}
          defaultAiAgentReady={targetReadiness.ready}
          defaultAiTarget={target}
          entries={context.entries}
          activeEntry={context.activeEntry}
          composerControls={composerControls}
          interactive={active}
          locale={locale}
          onClose={onClose}
          onForkMessage={onForkMessage}
          onMessageHistoryScrollStateChange={active ? onMessageHistoryScrollStateChange : undefined}
          onOpenNote={onOpenNote}
          onSendPrompt={() => onPromptSubmitted(conversation.id)}
          onQueuedPromptTarget={onSelectTarget}
          onUnsupportedAiPaste={onUnsupportedAiPaste}
          showHeader={false}
          showLeftBorder={false}
          surface={mode === 'side' ? 'sidebar' : 'default'}
          targetId={target.id}
        />
      </div>
    </div>
  )
}

function ConversationSession(functionOptions: ConversationSessionProps) {
  const {
    active,
    activeEntry,
    activeNoteContent,
    aiAgentsStatus,
    conversation,
    defaultAiAgentReady,
    entries,
    groups,
    locale,
    modelCatalog,
    modelCatalogReady,
    mode,
    noteList,
    noteListFilter,
    onArchive,
    onClose,
    onDock,
    onFileCreated,
    onFileModified,
    onForkMessage,
    onMessageHistoryScrollStateChange,
    onOpenAiSettings,
    onOpenNote,
    onPopOut,
    onRestoreVaultAiGuidance,
    onSelectTarget,
    onSelectModel,
    onStatusChange,
    onPromptSubmitted,
    onTitleFromAnswer,
    onUnsupportedAiPaste,
    onVaultChanged,
    openTabs,
    readyFallbackTargetId,
    target,
    vaultAiGuidanceStatus,
    vaultPath,
    vaultPaths,
  } = functionOptions
  const context = activeContextForSession({
    active,
    activeEntry,
    activeNoteContent,
    entries,
    noteList,
    noteListFilter,
    openTabs,
  })
  const targetReadiness = resolveAiTargetReadiness(target, aiAgentsStatus, {
    readyFallbackTargetId,
    readyFallbackTargetReady: defaultAiAgentReady,
  })
  const targetAgentId = target.kind === 'agent' ? target.agent : null
  const modelSelection = resolveAgentModelSelection({
    agentId: targetAgentId,
    catalog: modelCatalog,
    defaultLabel: translate(locale, 'ai.workspace.modelDefault'),
    ready: modelCatalogReady,
    selectedModelId: conversation.modelId,
  })
  const controller = useAiPanelController({
    vaultPath,
    vaultPaths,
    defaultAiAgent: targetAgent(target),
    defaultAiTarget: target,
    defaultAiAgentReady: targetReadiness.ready,
    defaultAiAgentReadiness: targetReadiness.readiness,
    activeEntry: context.activeEntry,
    activeNoteContent: context.activeNoteContent,
    entries: context.entries,
    openTabs: context.openTabs,
    noteList: context.noteList,
    noteListFilter: context.noteListFilter,
    locale,
    model: modelSelection.streamModelId,
    onOpenNote,
    onFileCreated,
    onFileModified,
    onVaultChanged,
    sessionId: conversation.id,
  })
  const running = controller.agent.status === 'thinking' || controller.agent.status === 'tool-executing'
  const composerMenuSide = mode === 'window' ? 'bottom' : 'top'
  const handleModelChange = useAiAgentModelActions({
    addLocalMarker: controller.agent.addLocalMarker,
    disabled: running,
    fallbackMessage: translate(locale, 'ai.workspace.modelUnavailable'),
    onSelectModel,
    selection: modelSelection,
    surface: mode,
  })
  const composerControls = (
    <ConversationComposerControls
      catalog={modelCatalog}
      catalogReady={modelCatalogReady}
      disabled={running}
      groups={groups}
      locale={locale}
      onOpenAiSettings={onOpenAiSettings}
      onPermissionModeChange={controller.handlePermissionModeChange}
      onSelectModel={handleModelChange}
      onSelectTarget={onSelectTarget}
      permissionMode={controller.permissionMode}
      side={composerMenuSide}
      target={target}
      modelOptions={modelSelection.options}
      selectedModelId={modelSelection.selectedId}
    />
  )

  useEffect(() => {
    onStatusChange(conversation.id, controller.agent.status)
  }, [conversation.id, controller.agent.status, onStatusChange])
  useGeneratedConversationTitle({
    aiAgentsStatus,
    conversation,
    messages: controller.agent.messages,
    onTitleFromAnswer,
    permissionMode: controller.permissionMode,
    readyFallbackTargetId,
    target,
    defaultAiAgentReady,
    vaultPath,
    vaultPaths,
  })

  return (
    <ConversationSessionView
      active={active}
      composerControls={composerControls}
      context={context}
      controller={controller}
      conversation={conversation}
      locale={locale}
      mode={mode}
      onArchive={onArchive}
      onClose={onClose}
      onDock={onDock}
      onForkMessage={onForkMessage}
      onMessageHistoryScrollStateChange={onMessageHistoryScrollStateChange}
      onOpenAiSettings={onOpenAiSettings}
      onOpenNote={onOpenNote}
      onPopOut={onPopOut}
      onPromptSubmitted={onPromptSubmitted}
      onRestoreVaultAiGuidance={onRestoreVaultAiGuidance}
      onSelectTarget={onSelectTarget}
      onUnsupportedAiPaste={onUnsupportedAiPaste}
      target={target}
      targetReadiness={targetReadiness}
      vaultAiGuidanceStatus={vaultAiGuidanceStatus}
    />
  )
}

type ResolvedAiWorkspaceProps = AiWorkspaceProps & {
  defaultAiAgent: AiAgentId
  defaultAiAgentReady: boolean
  entries: VaultEntry[]
  locale: AppLocale
  mode: AiWorkspaceMode
}

interface AiWorkspaceModel {
  activeConversation: AiConversation | undefined
  activeId: string
  addDefaultConversation: () => void
  archiveConversationSafely: (id: string) => void
  canArchiveConversation: (conversation: AiConversation) => boolean
  closeConversationSafely: (id: string) => void
  conversations: AiConversation[]
  fallbackTarget: AiTarget
  forkConversationUntilMessage: (sourceId: string, messageId: string) => void
  groups: AiWorkspaceTargetGroups
  modelCatalog: AiAgentModelCatalog
  modelCatalogReady: boolean
  handleStatusChange: (id: string, status: AgentStatus) => void
  renameConversation: (id: string, title: string) => void
  reorderConversation: (activeId: string, overId: string) => void
  restoreConversation: (id: string) => void
  sidebarCollapsed: boolean
  setActiveId: (id: string) => void
  setConversationTarget: (id: string, targetId: string) => void
  setConversationModel: (id: string, modelId: string | null) => void
  setShowArchived: (show: boolean) => void
  showArchived: boolean
  statuses: Record<string, AgentStatus>
  markConversationActivity: (id: string) => void
  titleConversationFromAnswer: (request: GenerateAiConversationTitleRequest & { id: string }) => void
  toggleSidebarCollapsed: () => void
  updateDefaultConversationTargets: (targetId: string) => void
}

function resolveAiWorkspaceProps(props: AiWorkspaceProps): ResolvedAiWorkspaceProps {
  return {
    ...props,
    defaultAiAgent: props.defaultAiAgent ?? DEFAULT_AI_AGENT,
    defaultAiAgentReady: props.defaultAiAgentReady ?? true,
    entries: props.entries ?? [],
    locale: props.locale ?? 'en',
    mode: props.mode ?? 'docked',
  }
}

function SideAiWorkspaceLayout({
  model,
  sizing,
  workspace,
}: {
  model: AiWorkspaceModel
  sizing: AiWorkspaceSizing
  workspace: ResolvedAiWorkspaceProps
}) {
  const [expanded, setExpanded] = useState(false)
  const [headerSeparated, setHeaderSeparated] = useState(false)

  return (
    <aside
      className={workspaceClassName('side', expanded)}
      style={workspaceStyle('side', sizing.workspaceSize, expanded)}
      data-testid="ai-workspace"
      data-ai-workspace-mode="side"
      data-ai-workspace-expanded={expanded ? 'true' : 'false'}
      aria-label={translate(workspace.locale, 'ai.workspace.title')}
    >
      {!expanded && <WorkspaceResizeHandles mode="side" onResize={sizing.onWorkspaceResize} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <SideWorkspaceHeader
          activeId={model.activeId}
          conversations={model.conversations}
          expanded={expanded}
          locale={workspace.locale}
          onClose={workspace.onClose}
          onCloseConversation={model.closeConversationSafely}
          onNewChat={model.addDefaultConversation}
          onRename={model.renameConversation}
          onReorder={model.reorderConversation}
          onSelect={model.setActiveId}
          onToggleExpanded={() => setExpanded((current) => !current)}
          separated={headerSeparated}
          statuses={model.statuses}
        />
        <ConversationSessions
          model={model}
          workspace={workspace}
          onMessageHistoryScrollStateChange={setHeaderSeparated}
        />
      </div>
    </aside>
  )
}

function useActiveConversationSync(
  activeConversation: AiConversation | undefined,
  activeId: string,
  setActiveId: (id: string) => void,
) {
  useEffect(() => {
    if (activeConversation && activeConversation.id !== activeId) setActiveId(activeConversation.id)
  }, [activeConversation, activeId, setActiveId])
}

function useArchiveConversationSafely({
  addConversation,
  archiveConversation,
  conversations,
  fallbackTarget,
}: {
  addConversation: (target: AiTarget) => void
  archiveConversation: (id: string) => void
  conversations: AiConversation[]
  fallbackTarget: AiTarget
}) {
  return useCallback(
    (id: string) => {
    const conversation = conversations.find((candidate) => candidate.id === id)
    if (!conversation || !canArchiveConversation(conversation)) return

    const activeCount = conversations.filter((conversation) => !conversation.archived).length
    archiveConversation(id)
    if (activeCount <= 1) addConversation(fallbackTarget)
    },
    [addConversation, archiveConversation, conversations, fallbackTarget],
  )
}

function useTrackedConversationActions({
  conversations,
  renameConversation,
  titleConversationFromAnswer,
}: {
  conversations: AiConversation[]
  renameConversation: (id: string, title: string) => void
  titleConversationFromAnswer: (request: GenerateAiConversationTitleRequest & { id: string }) => void
}) {
  const trackedRenameConversation = useCallback(
    (id: string, title: string) => {
    if (!title.trim()) return
    renameConversation(id, title)
    trackAiWorkspaceChatTitled('manual')
    },
    [renameConversation],
  )
  const trackedTitleConversationFromAnswer = useCallback(
    (request: GenerateAiConversationTitleRequest & { id: string }) => {
    const conversation = conversations.find((candidate) => candidate.id === request.id)
    titleConversationFromAnswer(request)
    if (conversation?.usesDefaultTitle) trackAiWorkspaceChatTitled('generated')
    },
    [conversations, titleConversationFromAnswer],
  )

  return { trackedRenameConversation, trackedTitleConversationFromAnswer }
}

function useAiWorkspaceNewChatEvent(open: boolean, addDefaultConversation: () => void) {
  useEffect(() => {
    if (!open) return
    const handleNewChat = () => addDefaultConversation()
    window.addEventListener(NEW_AI_CHAT_EVENT, handleNewChat)
    return () => window.removeEventListener(NEW_AI_CHAT_EVENT, handleNewChat)
  }, [addDefaultConversation, open])
}

function useActiveTargetChange({
  fallbackTarget,
  groups,
  onActiveTargetChange,
  open,
  conversation,
}: {
  fallbackTarget: AiTarget
  groups: AiWorkspaceTargetGroups
  onActiveTargetChange?: (target: AiTarget) => void
  open: boolean
  conversation: AiConversation | undefined
}) {
  const activeTarget = useMemo(
    () => (conversation ? resolveTarget(conversation, groups, fallbackTarget) : undefined),
    [conversation, fallbackTarget, groups],
  )
  const notifiedTargetIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open || !activeTarget) {
      notifiedTargetIdRef.current = null
      return
    }
    if (notifiedTargetIdRef.current === activeTarget.id) return

    notifiedTargetIdRef.current = activeTarget.id
    onActiveTargetChange?.(activeTarget)
  }, [activeTarget, onActiveTargetChange, open])
}

function useAiWorkspaceModel(workspace: ResolvedAiWorkspaceProps): AiWorkspaceModel {
  const groups = useMemo(
    () => buildAiWorkspaceTargetGroups(workspace.aiAgentsStatus, workspace.aiModelProviders),
    [workspace.aiAgentsStatus, workspace.aiModelProviders],
  )
  const fallbackTarget = useMemo(
    () => firstTarget(groups, workspace.defaultAiTarget, workspace.defaultAiAgent),
    [groups, workspace.defaultAiAgent, workspace.defaultAiTarget],
  )
  const { catalog: modelCatalog, ready: modelCatalogReady } = useAiAgentModelCatalog(workspace.open)
  const fallbackModelId = fallbackTarget.kind === 'agent' ? preferredAgentModel(fallbackTarget.agent) : null
  const {
    activeId,
    addConversation,
    archiveConversation,
    closeConversation,
    conversations,
    forkConversation,
    renameConversation,
    reorderConversation,
    restoreConversation,
    setActiveId,
    setConversationModel,
    setConversationTarget,
    setShowArchived,
    showArchived,
    markConversationActivity,
    titleConversationFromAnswer,
    updateDefaultConversationTargets,
  } = useConversations({
    fallbackModelId,
    fallbackTarget,
    initialActiveConversationId: workspace.initialActiveConversationId,
    locale: workspace.locale,
    onSettingsChange: workspace.onConversationSettingsChange,
    settings: workspace.conversationSettings,
    settingsReady: workspace.conversationSettingsReady ?? true,
  })
  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>({})
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const activeConversation = activeConversationForState(conversations, activeId, showArchived)

  const addDefaultConversation = useCallback(() => {
    addConversation(fallbackTarget, fallbackModelId)
  }, [addConversation, fallbackModelId, fallbackTarget])
  const selectConversationTarget = useCallback(
    (id: string, targetId: string) => {
    const nextTarget = flatTargets(groups).find((target) => target.id === targetId)
    if (!nextTarget) return
    setConversationTarget(id, targetId)
      setConversationModel(id, nextTarget.kind === 'agent' ? preferredAgentModel(nextTarget.agent) : null)
    },
    [groups, setConversationModel, setConversationTarget],
    )
  const archiveConversationSafely = useArchiveConversationSafely({
    addConversation,
    archiveConversation,
    conversations,
    fallbackTarget,
  })
  useActiveConversationSync(activeConversation, activeId, setActiveId)
  const handleStatusChange = useCallback((id: string, status: AgentStatus) => {
    setStatuses((current) => (Reflect.get(current, id) === status ? current : { ...current, [id]: status }))
  }, [])
  const forkConversationUntilMessage = useCallback(
    (sourceId: string, messageId: string) => {
    const targetId = forkConversation(sourceId)
    if (!targetId) return

    cloneAiWorkspaceSessionUntilMessage(sourceId, targetId, messageId)
    },
    [forkConversation],
  )
  const { trackedRenameConversation, trackedTitleConversationFromAnswer } = useTrackedConversationActions({
    conversations,
    renameConversation,
    titleConversationFromAnswer,
  })
  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current
      trackAiWorkspaceSidebarToggled(next, workspace.mode)
      return next
    })
  }, [workspace.mode])

  useAiWorkspaceNewChatEvent(workspace.open, addDefaultConversation)
  useEffect(() => {
    updateDefaultConversationTargets(fallbackTarget.id)
  }, [fallbackTarget.id, updateDefaultConversationTargets])

  return {
    activeConversation,
    activeId,
    addDefaultConversation,
    archiveConversationSafely,
    canArchiveConversation,
    closeConversationSafely: closeConversation,
    conversations,
    fallbackTarget,
    forkConversationUntilMessage,
    groups,
    modelCatalog,
    modelCatalogReady,
    handleStatusChange,
    renameConversation: trackedRenameConversation,
    reorderConversation,
    restoreConversation,
    sidebarCollapsed,
    setActiveId,
    setConversationModel,
    setConversationTarget: selectConversationTarget,
    setShowArchived,
    showArchived,
    statuses,
    markConversationActivity,
    titleConversationFromAnswer: trackedTitleConversationFromAnswer,
    toggleSidebarCollapsed,
    updateDefaultConversationTargets,
  }
}

function AiWorkspaceLayout({ model, workspace }: { model: AiWorkspaceModel; workspace: ResolvedAiWorkspaceProps }) {
  const sizing = useAiWorkspaceSizing(workspace.mode)
  if (workspace.mode === 'side') {
    return <SideAiWorkspaceLayout model={model} sizing={sizing} workspace={workspace} />
  }

  return (
    <section
      className={workspaceClassName(workspace.mode)}
      style={workspaceStyle(workspace.mode, sizing.workspaceSize)}
      data-testid="ai-workspace"
      data-ai-workspace-mode={workspace.mode}
      role="dialog"
      aria-label={translate(workspace.locale, 'ai.workspace.title')}
    >
      <WorkspaceResizeHandles mode={workspace.mode} onResize={sizing.onWorkspaceResize} />
      <ConversationSidebar
        activeId={model.activeId}
        collapsed={model.sidebarCollapsed}
        conversations={model.conversations}
        locale={workspace.locale}
        onCanArchive={model.canArchiveConversation}
        onArchive={model.archiveConversationSafely}
        onNewChat={model.addDefaultConversation}
        onRename={model.renameConversation}
        onRestore={model.restoreConversation}
        onSelect={model.setActiveId}
        onToggleCollapsed={model.toggleSidebarCollapsed}
        setShowArchived={model.setShowArchived}
        showArchived={model.showArchived}
        sidebarWidth={sizing.sidebarWidth}
        statuses={model.statuses}
      />
      {!model.sidebarCollapsed && <ResizeHandle onResize={sizing.onSidebarResize} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <ConversationSessions model={model} workspace={workspace} />
      </div>
    </section>
  )
}

function ConversationSessions({
  model,
  onMessageHistoryScrollStateChange,
  workspace,
}: {
  model: AiWorkspaceModel
  onMessageHistoryScrollStateChange?: (scrolled: boolean) => void
  workspace: ResolvedAiWorkspaceProps
}) {
  return (
    <div className="flex min-h-0 flex-1">
      {model.conversations.map((conversation) => {
        const target = resolveTarget(conversation, model.groups, model.fallbackTarget)

        return (
          <ConversationSession
            key={conversation.id}
            active={conversation.id === model.activeConversation?.id}
            activeEntry={workspace.activeEntry}
            activeNoteContent={workspace.activeNoteContent}
            aiAgentsStatus={workspace.aiAgentsStatus}
            conversation={conversation}
            defaultAiAgentReady={workspace.defaultAiAgentReady}
            entries={workspace.entries}
            groups={model.groups}
            locale={workspace.locale}
            modelCatalog={model.modelCatalog}
            modelCatalogReady={model.modelCatalogReady}
            mode={workspace.mode}
            noteList={workspace.noteList}
            noteListFilter={workspace.noteListFilter}
            onArchive={() => model.archiveConversationSafely(conversation.id)}
            onClose={workspace.onClose}
            onDock={workspace.onDock}
            onFileCreated={workspace.onFileCreated}
            onFileModified={workspace.onFileModified}
            onForkMessage={(messageId) => model.forkConversationUntilMessage(conversation.id, messageId)}
            onMessageHistoryScrollStateChange={onMessageHistoryScrollStateChange}
            onOpenAiSettings={workspace.onOpenAiSettings}
            onOpenNote={workspace.onOpenNote}
            onPopOut={workspace.onPopOut}
            onRestoreVaultAiGuidance={workspace.onRestoreVaultAiGuidance}
            onSelectModel={(modelId) => model.setConversationModel(conversation.id, modelId)}
            onSelectTarget={(targetId) => model.setConversationTarget(conversation.id, targetId)}
            onStatusChange={model.handleStatusChange}
            onPromptSubmitted={model.markConversationActivity}
            onTitleFromAnswer={model.titleConversationFromAnswer}
            onUnsupportedAiPaste={workspace.onUnsupportedAiPaste}
            onVaultChanged={workspace.onVaultChanged}
            openTabs={workspace.openTabs}
            readyFallbackTargetId={model.fallbackTarget.id}
            target={target}
            vaultAiGuidanceStatus={workspace.vaultAiGuidanceStatus}
            vaultPath={workspace.vaultPath}
            vaultPaths={workspace.vaultPaths}
          />
        )
      })}
    </div>
  )
}

export function AiWorkspace(props: AiWorkspaceProps) {
  const workspace = resolveAiWorkspaceProps(props)
  const model = useAiWorkspaceModel(workspace)
  const { onActiveConversationChange } = workspace

  useEffect(() => {
    if (!workspace.open || !model.activeId) return
    onActiveConversationChange?.(model.activeId)
  }, [model.activeId, onActiveConversationChange, workspace.open])
  useActiveTargetChange({
    fallbackTarget: model.fallbackTarget,
    groups: model.groups,
    onActiveTargetChange: workspace.onActiveTargetChange,
    open: workspace.open,
    conversation: model.activeConversation,
  })

  if (!workspace.open || !model.activeConversation) return null

  return <AiWorkspaceLayout model={model} workspace={workspace} />
}
