import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, GearSix } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  DEFAULT_AI_AGENT,
  getAiAgentAvailability,
  type AiAgentId,
  type AiAgentReadiness,
  type AiAgentsStatus,
} from '../lib/aiAgents'
import {
  aiTargetReady,
  targetAgent,
  type AiModelProvider,
  type AiTarget,
} from '../lib/aiTargets'
import {
  aiAgentPermissionModeLabels,
  type AiAgentPermissionMode,
} from '../lib/aiAgentPermissionMode'
import {
  type VaultAiGuidanceStatus,
} from '../lib/vaultAiGuidance'
import { translate, type AppLocale } from '../lib/i18n'
import { trackAiWorkspaceChatTitled, trackAiWorkspaceSidebarToggled } from '../lib/productAnalytics'
import type { AgentStatus, AiAgentMessage } from '../hooks/useCliAiAgent'
import type { AiWorkspaceConversationSetting } from '../types'
import type { NoteListItem } from '../utils/ai-context'
import type { VaultEntry } from '../types'
import { NEW_AI_CHAT_EVENT } from '../utils/aiPromptBridge'
import { type GenerateAiConversationTitleRequest } from '../utils/aiConversationTitle'
import { cloneAiWorkspaceSessionUntilMessage } from '../lib/aiWorkspaceSessionStore'
import { AiPanelView } from './AiPanel'
import { GuidanceWarning, WorkspaceHeader } from './AiWorkspaceChrome'
import { WorkspaceResizeHandles } from './AiWorkspaceResizeHandles'
import { AiAgentIcon } from './AiAgentIcon'
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

function agentReadinessForTarget(target: AiTarget, statuses: AiAgentsStatus): AiAgentReadiness {
  if (target.kind === 'api_model') return 'ready'
  const status = getAiAgentAvailability(statuses, target.agent).status
  if (status === 'checking') return 'checking'
  return status === 'installed' ? 'ready' : 'missing'
}

function TargetGroup({ label, targets }: { label: string; targets: AiTarget[] }) {
  if (targets.length === 0) return null

  return (
    <>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      {targets.map((target) => (
        <DropdownMenuRadioItem key={target.id} value={target.id} className="gap-2">
          {target.kind === 'agent' ? <AiAgentIcon agent={target.agent} size={16} /> : null}
          <span className="truncate">{target.label}</span>
        </DropdownMenuRadioItem>
      ))}
    </>
  )
}

function TargetPickerTrigger({
  compact,
  disabled,
  hasTargets,
  locale,
  selectedTarget,
}: {
  compact: boolean
  disabled: boolean
  hasTargets: boolean
  locale: AppLocale
  selectedTarget: AiTarget
}) {
  return (
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant={compact ? 'ghost' : 'outline'}
        size={compact ? 'xs' : 'sm'}
        className={cn(
          'justify-between gap-1.5 text-muted-foreground hover:text-foreground',
          compact ? 'max-w-[150px] rounded-full px-2 text-[12px]' : 'max-w-[240px] gap-2',
        )}
        disabled={disabled || !hasTargets}
        aria-label={translate(locale, 'ai.workspace.targetLabel')}
        data-testid="ai-workspace-target-trigger"
      >
        {selectedTarget.kind === 'agent' ? <AiAgentIcon agent={selectedTarget.agent} size={compact ? 14 : 16} /> : null}
        <span className="truncate">{selectedTarget.shortLabel}</span>
        <CaretDown size={compact ? 12 : 13} />
      </Button>
    </DropdownMenuTrigger>
  )
}

function TargetPickerContent({
  groups,
  hasTargets,
  locale,
  onSelectTarget,
  selectedTarget,
  side,
}: {
  groups: AiWorkspaceTargetGroups
  hasTargets: boolean
  locale: AppLocale
  selectedTarget: AiTarget
  onSelectTarget: (targetId: string) => void
  side: 'bottom' | 'top'
}) {
  const hasLocalAgentsSeparator = groups.localAgents.length > 0
    && (groups.localModels.length > 0 || groups.apiModels.length > 0)
  const hasLocalModelsSeparator = groups.localModels.length > 0 && groups.apiModels.length > 0

  return (
    <DropdownMenuContent align="start" side={side} className="min-w-[280px]">
      {hasTargets ? (
        <DropdownMenuRadioGroup value={selectedTarget.id} onValueChange={onSelectTarget}>
          <TargetGroup label={translate(locale, 'ai.workspace.targetLocalAgents')} targets={groups.localAgents} />
          {hasLocalAgentsSeparator && <DropdownMenuSeparator />}
          <TargetGroup label={translate(locale, 'ai.workspace.targetLocalModels')} targets={groups.localModels} />
          {hasLocalModelsSeparator && <DropdownMenuSeparator />}
          <TargetGroup label={translate(locale, 'ai.workspace.targetApiModels')} targets={groups.apiModels} />
        </DropdownMenuRadioGroup>
      ) : (
        <DropdownMenuItem disabled>{translate(locale, 'ai.workspace.noTargets')}</DropdownMenuItem>
      )}
    </DropdownMenuContent>
  )
}

function TargetPicker({
  compact = false,
  disabled,
  groups,
  locale,
  selectedTarget,
  side = 'bottom',
  onSelectTarget,
}: {
  compact?: boolean
  disabled: boolean
  groups: AiWorkspaceTargetGroups
  locale: AppLocale
  selectedTarget: AiTarget
  side?: 'bottom' | 'top'
  onSelectTarget: (targetId: string) => void
}) {
  const hasTargets = flatTargets(groups).length > 0

  return (
    <DropdownMenu>
      <TargetPickerTrigger
        compact={compact}
        disabled={disabled}
        hasTargets={hasTargets}
        locale={locale}
        selectedTarget={selectedTarget}
      />
      <TargetPickerContent
        groups={groups}
        hasTargets={hasTargets}
        locale={locale}
        selectedTarget={selectedTarget}
        side={side}
        onSelectTarget={onSelectTarget}
      />
    </DropdownMenu>
  )
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
      <Button type="button" variant={compact ? 'ghost' : 'outline'} size={compact ? 'xs' : 'sm'} disabled className="rounded-full px-2 text-[12px] text-muted-foreground">
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
  onSelectTarget: (targetId: string) => void
  onStatusChange: (id: string, status: AgentStatus) => void
  onPromptSubmitted: (id: string) => void
  onTitleFromAnswer: (request: GenerateAiConversationTitleRequest & { id: string }) => void
  onUnsupportedAiPaste?: (message: string) => void
  onVaultChanged?: () => void
  openTabs?: VaultEntry[]
  target: AiTarget
  vaultAiGuidanceStatus?: VaultAiGuidanceStatus
  vaultPath: string
  vaultPaths?: string[]
}

function firstCompletedAssistantMessage(messages: AiAgentMessage[]): AiAgentMessage | undefined {
  return messages.find((message) => (
    !message.localMarker
    && !message.isStreaming
    && !!message.userMessage.trim()
    && !!message.response?.trim()
  ))
}

function useGeneratedConversationTitle({
  aiAgentsStatus,
  conversation,
  messages,
  onTitleFromAnswer,
  permissionMode,
  target,
  vaultPath,
  vaultPaths,
}: {
  aiAgentsStatus: AiAgentsStatus
  conversation: AiConversation
  messages: AiAgentMessage[]
  onTitleFromAnswer: (request: GenerateAiConversationTitleRequest & { id: string }) => void
  permissionMode: AiAgentPermissionMode
  target: AiTarget
  vaultPath: string
  vaultPaths?: string[]
}) {
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
      targetReady: aiTargetReady(target, aiAgentsStatus),
      vaultPath,
      vaultPaths,
    })
  }, [
    aiAgentsStatus,
    conversation.id,
    conversation.usesDefaultTitle,
    messages,
    onTitleFromAnswer,
    permissionMode,
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
}: Pick<ConversationSessionProps, 'active' | 'activeEntry' | 'activeNoteContent' | 'entries' | 'noteList' | 'noteListFilter' | 'openTabs'>): ConversationSessionContext {
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

function ConversationComposerControls({
  disabled,
  groups,
  locale,
  onOpenAiSettings,
  onPermissionModeChange,
  onSelectTarget,
  permissionMode,
  side,
  target,
}: {
  disabled: boolean
  groups: AiWorkspaceTargetGroups
  locale: AppLocale
  onOpenAiSettings?: () => void
  onPermissionModeChange: (mode: AiAgentPermissionMode) => void
  onSelectTarget: (targetId: string) => void
  permissionMode: AiAgentPermissionMode
  side: 'bottom' | 'top'
  target: AiTarget
}) {
  return (
    <>
      <TargetPicker
        compact
        disabled={disabled}
        groups={groups}
        locale={locale}
        selectedTarget={target}
        side={side}
        onSelectTarget={onSelectTarget}
      />
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
    </>
  )
}

function ConversationWorkspaceHeader({
  conversation,
  locale,
  mode,
  onArchive,
  onClose,
  onDock,
  onOpenAiSettings,
  onPopOut,
}: Pick<
  ConversationSessionProps,
  'conversation' | 'locale' | 'mode' | 'onArchive' | 'onClose' | 'onDock' | 'onOpenAiSettings' | 'onPopOut'
>) {
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

function ConversationSession({
  active,
  activeEntry,
  activeNoteContent,
  aiAgentsStatus,
  conversation,
  defaultAiAgentReady,
  entries,
  groups,
  locale,
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
  onStatusChange,
  onPromptSubmitted,
  onTitleFromAnswer,
  onUnsupportedAiPaste,
  onVaultChanged,
  openTabs,
  target,
  vaultAiGuidanceStatus,
  vaultPath,
  vaultPaths,
}: ConversationSessionProps) {
  const context = activeContextForSession({
    active,
    activeEntry,
    activeNoteContent,
    entries,
    noteList,
    noteListFilter,
    openTabs,
  })
  const readiness = agentReadinessForTarget(target, aiAgentsStatus)
  const controller = useAiPanelController({
    vaultPath,
    vaultPaths,
    defaultAiAgent: targetAgent(target),
    defaultAiTarget: target,
    defaultAiAgentReady: target.kind === 'api_model' || defaultAiAgentReady,
    defaultAiAgentReadiness: readiness,
    activeEntry: context.activeEntry,
    activeNoteContent: context.activeNoteContent,
    entries: context.entries,
    openTabs: context.openTabs,
    noteList: context.noteList,
    noteListFilter: context.noteListFilter,
    locale,
    onOpenNote,
    onFileCreated,
    onFileModified,
    onVaultChanged,
    sessionId: conversation.id,
  })
  const running = controller.agent.status === 'thinking' || controller.agent.status === 'tool-executing'
  const composerMenuSide = mode === 'window' ? 'bottom' : 'top'
  const composerControls = (
    <ConversationComposerControls
      disabled={running}
      groups={groups}
      locale={locale}
      onOpenAiSettings={onOpenAiSettings}
      onPermissionModeChange={controller.handlePermissionModeChange}
      onSelectTarget={onSelectTarget}
      permissionMode={controller.permissionMode}
      side={composerMenuSide}
      target={target}
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
    target,
    vaultPath,
    vaultPaths,
  })

  return (
    <div className={active ? 'flex min-h-0 flex-1 flex-col' : 'hidden'} data-testid={`ai-workspace-session-${conversation.id}`}>
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
          defaultAiAgentReadiness={readiness}
          defaultAiAgentReady={aiTargetReady(target, aiAgentsStatus)}
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
  handleStatusChange: (id: string, status: AgentStatus) => void
  renameConversation: (id: string, title: string) => void
  reorderConversation: (activeId: string, overId: string) => void
  restoreConversation: (id: string) => void
  sidebarCollapsed: boolean
  setActiveId: (id: string) => void
  setConversationTarget: (id: string, targetId: string) => void
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
    <section
      className={workspaceClassName('side', expanded)}
      style={workspaceStyle('side', sizing.workspaceSize, expanded)}
      data-testid="ai-workspace"
      data-ai-workspace-mode="side"
      data-ai-workspace-expanded={expanded ? 'true' : 'false'}
      role="complementary"
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
        <ConversationSessions model={model} workspace={workspace} onMessageHistoryScrollStateChange={setHeaderSeparated} />
      </div>
    </section>
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
  return useCallback((id: string) => {
    const conversation = conversations.find((candidate) => candidate.id === id)
    if (!conversation || !canArchiveConversation(conversation)) return

    const activeCount = conversations.filter((conversation) => !conversation.archived).length
    archiveConversation(id)
    if (activeCount <= 1) addConversation(fallbackTarget)
  }, [addConversation, archiveConversation, conversations, fallbackTarget])
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
  const trackedRenameConversation = useCallback((id: string, title: string) => {
    if (!title.trim()) return
    renameConversation(id, title)
    trackAiWorkspaceChatTitled('manual')
  }, [renameConversation])
  const trackedTitleConversationFromAnswer = useCallback((request: GenerateAiConversationTitleRequest & { id: string }) => {
    const conversation = conversations.find((candidate) => candidate.id === request.id)
    titleConversationFromAnswer(request)
    if (conversation?.usesDefaultTitle) trackAiWorkspaceChatTitled('generated')
  }, [conversations, titleConversationFromAnswer])

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

  useEffect(() => {
    if (!open || !activeTarget) return
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
    setConversationTarget,
    setShowArchived,
    showArchived,
    markConversationActivity,
    titleConversationFromAnswer,
    updateDefaultConversationTargets,
  } = useConversations({
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
    addConversation(fallbackTarget)
  }, [addConversation, fallbackTarget])
  const archiveConversationSafely = useArchiveConversationSafely({
    addConversation,
    archiveConversation,
    conversations,
    fallbackTarget,
  })
  useActiveConversationSync(activeConversation, activeId, setActiveId)
  const handleStatusChange = useCallback((id: string, status: AgentStatus) => {
    setStatuses((current) => current[id] === status ? current : { ...current, [id]: status })
  }, [])
  const forkConversationUntilMessage = useCallback((sourceId: string, messageId: string) => {
    const targetId = forkConversation(sourceId)
    if (!targetId) return

    cloneAiWorkspaceSessionUntilMessage(sourceId, targetId, messageId)
  }, [forkConversation])
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
    handleStatusChange,
    renameConversation: trackedRenameConversation,
    reorderConversation,
    restoreConversation,
    sidebarCollapsed,
    setActiveId,
    setConversationTarget,
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
      {!model.sidebarCollapsed && (
        <ResizeHandle onResize={sizing.onSidebarResize} />
      )}
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
            onSelectTarget={(targetId) => model.setConversationTarget(conversation.id, targetId)}
            onStatusChange={model.handleStatusChange}
            onPromptSubmitted={model.markConversationActivity}
            onTitleFromAnswer={model.titleConversationFromAnswer}
            onUnsupportedAiPaste={workspace.onUnsupportedAiPaste}
            onVaultChanged={workspace.onVaultChanged}
            openTabs={workspace.openTabs}
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
