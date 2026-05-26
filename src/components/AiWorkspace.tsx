import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  ArrowSquareIn,
  ArrowSquareOut,
  CaretDown,
  GearSix,
  Plus,
  Robot,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
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
import { useDragRegion } from '../hooks/useDragRegion'
import {
  DEFAULT_AI_AGENT,
  getAiAgentAvailability,
  type AiAgentId,
  type AiAgentReadiness,
  type AiAgentsStatus,
} from '../lib/aiAgents'
import {
  agentTargets,
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
  getVaultAiGuidanceSummary,
  vaultAiGuidanceNeedsRestore,
  type VaultAiGuidanceStatus,
} from '../lib/vaultAiGuidance'
import { translate, type AppLocale, type TranslationKey } from '../lib/i18n'
import type { AgentStatus } from '../hooks/useCliAiAgent'
import type { NoteListItem } from '../utils/ai-context'
import type { VaultEntry } from '../types'
import { NEW_AI_CHAT_EVENT } from '../utils/aiPromptBridge'
import { AiPanelView } from './AiPanel'
import { useAiPanelController } from './useAiPanelController'
import { buildAiWorkspaceTargetGroups, type AiWorkspaceTargetGroups } from './aiWorkspaceTargetGroups'

interface AiConversation {
  archived: boolean
  id: string
  targetId: string
  title: string
  usesDefaultTarget: boolean
}

interface AiWorkspaceProps {
  activeEntry?: VaultEntry | null
  activeNoteContent?: string | null
  aiAgentsStatus: AiAgentsStatus
  aiModelProviders?: AiModelProvider[]
  defaultAiAgent?: AiAgentId
  defaultAiAgentReadiness?: AiAgentReadiness
  defaultAiAgentReady?: boolean
  defaultAiTarget?: AiTarget
  entries?: VaultEntry[]
  locale?: AppLocale
  mode?: 'docked' | 'window'
  noteList?: NoteListItem[]
  noteListFilter?: { type: string | null; query: string }
  onClose: () => void
  onDock?: () => void
  onFileCreated?: (relativePath: string) => void
  onFileModified?: (relativePath: string) => void
  onOpenAiSettings?: () => void
  onOpenNote?: (path: string) => void
  onPopOut?: () => void
  onRestoreVaultAiGuidance?: () => void
  onUnsupportedAiPaste?: (message: string) => void
  onVaultChanged?: () => void
  open: boolean
  openTabs?: VaultEntry[]
  vaultAiGuidanceStatus?: VaultAiGuidanceStatus
  vaultPath: string
  vaultPaths?: string[]
}

function nextConversationId(): string {
  return `ai-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function statusLabelKey(status: AgentStatus): TranslationKey {
  if (status === 'thinking' || status === 'tool-executing') return 'ai.workspace.status.running'
  if (status === 'error') return 'ai.workspace.status.error'
  if (status === 'done') return 'ai.workspace.status.done'
  return 'ai.workspace.status.idle'
}

function statusDotClassName(status: AgentStatus | undefined): string {
  if (status === 'thinking' || status === 'tool-executing') return 'bg-blue-500'
  if (status === 'error') return 'bg-destructive'
  if (status === 'done') return 'bg-green-600'
  return 'bg-muted-foreground'
}

function agentReadinessForTarget(target: AiTarget, statuses: AiAgentsStatus): AiAgentReadiness {
  if (target.kind === 'api_model') return 'ready'
  const status = getAiAgentAvailability(statuses, target.agent).status
  if (status === 'checking') return 'checking'
  return status === 'installed' ? 'ready' : 'missing'
}

function flatTargets(groups: AiWorkspaceTargetGroups): AiTarget[] {
  return [...groups.localAgents, ...groups.localModels, ...groups.apiModels]
}

function firstTarget(groups: AiWorkspaceTargetGroups, defaultTarget: AiTarget | undefined, defaultAgent: AiAgentId): AiTarget {
  const targets = flatTargets(groups)
  const selectedDefault = defaultTarget ? targets.find((target) => target.id === defaultTarget.id) : undefined
  if (selectedDefault) return selectedDefault

  const selectedAgent = targets.find((target) => target.kind === 'agent' && target.agent === defaultAgent)
  return selectedAgent ?? targets[0] ?? defaultTarget ?? agentTargets()[0]
}

function resolveTarget(conversation: AiConversation, groups: AiWorkspaceTargetGroups, fallback: AiTarget): AiTarget {
  return flatTargets(groups).find((target) => target.id === conversation.targetId) ?? fallback
}

function createConversation(locale: AppLocale, target: AiTarget, index: number): AiConversation {
  return {
    archived: false,
    id: nextConversationId(),
    targetId: target.id,
    title: translate(locale, 'ai.workspace.chatTitle', { index }),
    usesDefaultTarget: true,
  }
}

function useConversations(locale: AppLocale, fallbackTarget: AiTarget) {
  const [conversations, setConversations] = useState<AiConversation[]>(() => [
    createConversation(locale, fallbackTarget, 1),
  ])
  const [activeId, setActiveId] = useState(() => conversations[0]?.id ?? '')
  const [showArchived, setShowArchived] = useState(false)

  const addConversation = useCallback((target: AiTarget) => {
    setConversations((current) => {
      const next = createConversation(locale, target, current.length + 1)
      setActiveId(next.id)
      return [...current, next]
    })
  }, [locale])

  const archiveConversation = useCallback((id: string) => {
    setConversations((current) => {
      const next = current.map((conversation) => (
        conversation.id === id ? { ...conversation, archived: true } : conversation
      ))
      const fallback = next.find((conversation) => !conversation.archived && conversation.id !== id)
      if (fallback) setActiveId(fallback.id)
      return next
    })
  }, [])

  const restoreConversation = useCallback((id: string) => {
    setConversations((current) => current.map((conversation) => (
      conversation.id === id ? { ...conversation, archived: false } : conversation
    )))
    setActiveId(id)
    setShowArchived(false)
  }, [])

  const setConversationTarget = useCallback((id: string, targetId: string) => {
    setConversations((current) => current.map((conversation) => (
      conversation.id === id ? { ...conversation, targetId, usesDefaultTarget: false } : conversation
    )))
  }, [])

  const updateDefaultConversationTargets = useCallback((targetId: string) => {
    setConversations((current) => current.map((conversation) => (
      conversation.usesDefaultTarget && conversation.targetId !== targetId
        ? { ...conversation, targetId }
        : conversation
    )))
  }, [])

  return {
    activeId,
    addConversation,
    archiveConversation,
    conversations,
    restoreConversation,
    setActiveId,
    setConversationTarget,
    setShowArchived,
    showArchived,
    updateDefaultConversationTargets,
  }
}

function SidebarHeader({ locale, onNewChat }: { locale: AppLocale; onNewChat: () => void }) {
  const { dragRegionRef } = useDragRegion<HTMLDivElement>()

  return (
    <div
      ref={dragRegionRef}
      className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3"
      data-tauri-drag-region
      data-testid="ai-workspace-sidebar-header"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Robot size={16} className="shrink-0 text-muted-foreground" />
        <span className="truncate text-[13px] font-semibold text-foreground">
          {translate(locale, 'ai.workspace.title')}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={translate(locale, 'ai.workspace.newChat')}
        title={translate(locale, 'ai.workspace.newChat')}
        data-testid="ai-workspace-sidebar-new-chat"
        onClick={onNewChat}
      >
        <Plus size={15} />
      </Button>
    </div>
  )
}

function ConversationSidebar({
  activeId,
  conversations,
  locale,
  onArchive,
  onNewChat,
  onRestore,
  onSelect,
  setShowArchived,
  showArchived,
  statuses,
}: {
  activeId: string
  conversations: AiConversation[]
  locale: AppLocale
  onArchive: (id: string) => void
  onNewChat: () => void
  onRestore: (id: string) => void
  onSelect: (id: string) => void
  setShowArchived: (show: boolean) => void
  showArchived: boolean
  statuses: Record<string, AgentStatus>
}) {
  const visibleConversations = conversations.filter((conversation) => conversation.archived === showArchived)
  const emptyLabel = showArchived
    ? translate(locale, 'ai.workspace.noArchivedChats')
    : translate(locale, 'ai.workspace.noActiveChats')

  return (
    <div className="flex w-[220px] shrink-0 flex-col border-r border-border bg-sidebar">
      <SidebarHeader locale={locale} onNewChat={onNewChat} />
      <div className="flex-1 overflow-y-auto p-2">
        {visibleConversations.length === 0 ? (
          <div className="px-2 py-4 text-[12px] text-muted-foreground">{emptyLabel}</div>
        ) : visibleConversations.map((conversation) => {
          const status = statuses[conversation.id] ?? 'idle'
          const active = conversation.id === activeId
          return (
            <div key={conversation.id} className="group flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'min-w-0 flex-1 justify-start rounded-md px-2 text-left text-[12px]',
                  active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
                aria-pressed={active}
                onClick={() => onSelect(conversation.id)}
              >
                <span className={cn('h-2 w-2 rounded-full', statusDotClassName(status))} />
                <span className="truncate">{conversation.title}</span>
                <span className="ml-auto truncate text-[10px] opacity-70">
                  {translate(locale, statusLabelKey(status))}
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={translate(locale, showArchived ? 'ai.workspace.restore' : 'ai.workspace.archive')}
                title={translate(locale, showArchived ? 'ai.workspace.restore' : 'ai.workspace.archive')}
                onClick={() => showArchived ? onRestore(conversation.id) : onArchive(conversation.id)}
              >
                {showArchived ? <ArrowSquareIn size={14} /> : <Archive size={14} />}
              </Button>
            </div>
          )
        })}
      </div>
      <div className="border-t border-border p-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start text-[12px] text-muted-foreground"
          onClick={() => setShowArchived(!showArchived)}
        >
          <Archive size={14} />
          {translate(locale, showArchived ? 'ai.workspace.hideArchived' : 'ai.workspace.showArchived')}
        </Button>
      </div>
    </div>
  )
}

function TargetGroup({ label, targets }: { label: string; targets: AiTarget[] }) {
  if (targets.length === 0) return null

  return (
    <>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      {targets.map((target) => (
        <DropdownMenuRadioItem key={target.id} value={target.id}>
          <span className="truncate">{target.label}</span>
        </DropdownMenuRadioItem>
      ))}
    </>
  )
}

function TargetPicker({
  disabled,
  groups,
  locale,
  selectedTarget,
  onSelectTarget,
}: {
  disabled: boolean
  groups: AiWorkspaceTargetGroups
  locale: AppLocale
  selectedTarget: AiTarget
  onSelectTarget: (targetId: string) => void
}) {
  const hasTargets = flatTargets(groups).length > 0

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-w-[240px] justify-between gap-2"
          disabled={disabled || !hasTargets}
          aria-label={translate(locale, 'ai.workspace.targetLabel')}
          data-testid="ai-workspace-target-trigger"
        >
          <span className="truncate">{selectedTarget.shortLabel}</span>
          <CaretDown size={13} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[280px]">
        {hasTargets ? (
          <DropdownMenuRadioGroup value={selectedTarget.id} onValueChange={onSelectTarget}>
            <TargetGroup label={translate(locale, 'ai.workspace.targetLocalAgents')} targets={groups.localAgents} />
            {groups.localAgents.length > 0 && (groups.localModels.length > 0 || groups.apiModels.length > 0) && <DropdownMenuSeparator />}
            <TargetGroup label={translate(locale, 'ai.workspace.targetLocalModels')} targets={groups.localModels} />
            {groups.localModels.length > 0 && groups.apiModels.length > 0 && <DropdownMenuSeparator />}
            <TargetGroup label={translate(locale, 'ai.workspace.targetApiModels')} targets={groups.apiModels} />
          </DropdownMenuRadioGroup>
        ) : (
          <DropdownMenuItem disabled>{translate(locale, 'ai.workspace.noTargets')}</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PermissionPicker({
  disabled,
  locale,
  permissionMode,
  targetKind,
  onChange,
}: {
  disabled: boolean
  locale: AppLocale
  permissionMode: AiAgentPermissionMode
  targetKind: AiTarget['kind']
  onChange: (mode: AiAgentPermissionMode) => void
}) {
  if (targetKind === 'api_model') {
    return (
      <Button type="button" variant="outline" size="sm" disabled className="text-muted-foreground">
        {translate(locale, 'ai.panel.mode.chat')}
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-between gap-2"
          disabled={disabled}
          aria-label={translate(locale, 'ai.workspace.permissionMode')}
          data-testid="ai-workspace-permission-trigger"
        >
          {aiAgentPermissionModeLabels(permissionMode, locale).control}
          <CaretDown size={13} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {(['safe', 'power_user'] as const).map((mode) => (
          <DropdownMenuItem key={mode} onSelect={() => onChange(mode)}>
            {aiAgentPermissionModeLabels(mode, locale).control}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function GuidanceWarning({
  locale,
  onRestore,
  status,
}: {
  locale: AppLocale
  onRestore?: () => void
  status?: VaultAiGuidanceStatus
}) {
  if (!status || !vaultAiGuidanceNeedsRestore(status)) return null

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground">
      <WarningCircle size={15} className="shrink-0 text-amber-600" />
      <span className="min-w-0 flex-1">
        {translate(locale, 'ai.workspace.guidanceWarning', { summary: getVaultAiGuidanceSummary(status) })}
      </span>
      {status.canRestore && onRestore && (
        <Button type="button" variant="outline" size="xs" onClick={onRestore}>
          {translate(locale, 'status.ai.restoreGuidance')}
        </Button>
      )}
    </div>
  )
}

function WorkspaceHeader({
  conversation,
  groups,
  locale,
  mode,
  permissionMode,
  selectedTarget,
  status,
  onArchive,
  onClose,
  onDock,
  onOpenAiSettings,
  onPermissionModeChange,
  onPopOut,
  onSelectTarget,
}: {
  conversation: AiConversation
  groups: AiWorkspaceTargetGroups
  locale: AppLocale
  mode: 'docked' | 'window'
  permissionMode: AiAgentPermissionMode
  selectedTarget: AiTarget
  status: AgentStatus
  onArchive: () => void
  onClose: () => void
  onDock?: () => void
  onOpenAiSettings?: () => void
  onPermissionModeChange: (mode: AiAgentPermissionMode) => void
  onPopOut?: () => void
  onSelectTarget: (targetId: string) => void
}) {
  const { dragRegionRef } = useDragRegion<HTMLDivElement>()
  const running = status === 'thinking' || status === 'tool-executing'

  return (
    <div
      ref={dragRegionRef}
      className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3"
      data-tauri-drag-region
      data-testid="ai-workspace-chat-header"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="min-w-[92px] max-w-[160px]">
          <div className="truncate text-[13px] font-semibold text-foreground">{conversation.title}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {translate(locale, statusLabelKey(status))}
          </div>
        </div>
        <TargetPicker
          disabled={running}
          groups={groups}
          locale={locale}
          selectedTarget={selectedTarget}
          onSelectTarget={onSelectTarget}
        />
        <PermissionPicker
          disabled={running}
          locale={locale}
          permissionMode={permissionMode}
          targetKind={selectedTarget.kind}
          onChange={onPermissionModeChange}
        />
      </div>
      <div className="flex items-center gap-1">
        {onOpenAiSettings && (
          <Button type="button" variant="ghost" size="icon-xs" aria-label={translate(locale, 'ai.workspace.settings')} title={translate(locale, 'ai.workspace.settings')} onClick={onOpenAiSettings}>
            <GearSix size={15} />
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon-xs" aria-label={translate(locale, 'ai.workspace.archive')} title={translate(locale, 'ai.workspace.archive')} onClick={onArchive}>
          <Archive size={15} />
        </Button>
        {mode === 'docked' ? (
          <Button type="button" variant="ghost" size="icon-xs" aria-label={translate(locale, 'ai.workspace.popOut')} title={translate(locale, 'ai.workspace.popOut')} onClick={onPopOut}>
            <ArrowSquareOut size={15} />
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="icon-xs" aria-label={translate(locale, 'ai.workspace.dock')} title={translate(locale, 'ai.workspace.dock')} onClick={onDock}>
            <ArrowSquareIn size={15} />
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon-xs" aria-label={translate(locale, 'ai.workspace.close')} title={translate(locale, 'ai.workspace.close')} onClick={onClose}>
          <X size={15} />
        </Button>
      </div>
    </div>
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
  onOpenAiSettings,
  onOpenNote,
  onPopOut,
  onRestoreVaultAiGuidance,
  onSelectTarget,
  onStatusChange,
  onUnsupportedAiPaste,
  onVaultChanged,
  openTabs,
  target,
  vaultAiGuidanceStatus,
  vaultPath,
  vaultPaths,
}: {
  active: boolean
  activeEntry?: VaultEntry | null
  activeNoteContent?: string | null
  aiAgentsStatus: AiAgentsStatus
  conversation: AiConversation
  defaultAiAgentReady: boolean
  entries?: VaultEntry[]
  groups: AiWorkspaceTargetGroups
  locale: AppLocale
  mode: 'docked' | 'window'
  noteList?: NoteListItem[]
  noteListFilter?: { type: string | null; query: string }
  onArchive: () => void
  onClose: () => void
  onDock?: () => void
  onFileCreated?: (relativePath: string) => void
  onFileModified?: (relativePath: string) => void
  onOpenAiSettings?: () => void
  onOpenNote?: (path: string) => void
  onPopOut?: () => void
  onRestoreVaultAiGuidance?: () => void
  onSelectTarget: (targetId: string) => void
  onStatusChange: (id: string, status: AgentStatus) => void
  onUnsupportedAiPaste?: (message: string) => void
  onVaultChanged?: () => void
  openTabs?: VaultEntry[]
  target: AiTarget
  vaultAiGuidanceStatus?: VaultAiGuidanceStatus
  vaultPath: string
  vaultPaths?: string[]
}) {
  const readiness = agentReadinessForTarget(target, aiAgentsStatus)
  const controller = useAiPanelController({
    vaultPath,
    vaultPaths,
    defaultAiAgent: targetAgent(target),
    defaultAiTarget: target,
    defaultAiAgentReady: target.kind === 'api_model' || defaultAiAgentReady,
    defaultAiAgentReadiness: readiness,
    activeEntry,
    activeNoteContent,
    entries,
    openTabs,
    noteList,
    noteListFilter,
    locale,
    onOpenNote,
    onFileCreated,
    onFileModified,
    onVaultChanged,
  })

  useEffect(() => {
    onStatusChange(conversation.id, controller.agent.status)
  }, [conversation.id, controller.agent.status, onStatusChange])

  return (
    <div className={active ? 'flex min-h-0 flex-1 flex-col' : 'hidden'} data-testid={`ai-workspace-session-${conversation.id}`}>
      <WorkspaceHeader
        conversation={conversation}
        groups={groups}
        locale={locale}
        mode={mode}
        permissionMode={controller.permissionMode}
        selectedTarget={target}
        status={controller.agent.status}
        onArchive={onArchive}
        onClose={onClose}
        onDock={onDock}
        onOpenAiSettings={onOpenAiSettings}
        onPermissionModeChange={controller.handlePermissionModeChange}
        onPopOut={onPopOut}
        onSelectTarget={onSelectTarget}
      />
      <GuidanceWarning locale={locale} onRestore={onRestoreVaultAiGuidance} status={vaultAiGuidanceStatus} />
      <div className="flex min-h-0 flex-1">
        <AiPanelView
          controller={controller}
          defaultAiAgent={targetAgent(target)}
          defaultAiAgentReadiness={readiness}
          defaultAiAgentReady={aiTargetReady(target, aiAgentsStatus)}
          defaultAiTarget={target}
          entries={entries}
          activeEntry={activeEntry}
          interactive={active}
          locale={locale}
          onClose={onClose}
          onOpenNote={onOpenNote}
          onUnsupportedAiPaste={onUnsupportedAiPaste}
          showHeader={false}
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
  mode: 'docked' | 'window'
}

interface AiWorkspaceModel {
  activeConversation: AiConversation | undefined
  activeId: string
  addDefaultConversation: () => void
  archiveConversationSafely: (id: string) => void
  conversations: AiConversation[]
  fallbackTarget: AiTarget
  groups: AiWorkspaceTargetGroups
  handleStatusChange: (id: string, status: AgentStatus) => void
  restoreConversation: (id: string) => void
  setActiveId: (id: string) => void
  setConversationTarget: (id: string, targetId: string) => void
  setShowArchived: (show: boolean) => void
  showArchived: boolean
  statuses: Record<string, AgentStatus>
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

function workspaceClassName(mode: 'docked' | 'window'): string {
  if (mode === 'window') return 'fixed inset-0 z-[90] flex bg-background text-foreground'

  return 'fixed bottom-10 right-4 z-[90] flex h-[min(680px,calc(100vh-88px))] w-[min(880px,calc(100vw-32px))] overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-2xl'
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
    conversations,
    restoreConversation,
    setActiveId,
    setConversationTarget,
    setShowArchived,
    showArchived,
    updateDefaultConversationTargets,
  } = useConversations(workspace.locale, fallbackTarget)
  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>({})
  const activeConversation = conversations.find((conversation) => conversation.id === activeId)
    ?? conversations.find((conversation) => !conversation.archived)
    ?? conversations[0]

  const addDefaultConversation = useCallback(() => {
    addConversation(fallbackTarget)
  }, [addConversation, fallbackTarget])

  const archiveConversationSafely = useCallback((id: string) => {
    const activeCount = conversations.filter((conversation) => !conversation.archived).length
    archiveConversation(id)
    if (activeCount <= 1) addConversation(fallbackTarget)
  }, [addConversation, archiveConversation, conversations, fallbackTarget])

  const handleStatusChange = useCallback((id: string, status: AgentStatus) => {
    setStatuses((current) => current[id] === status ? current : { ...current, [id]: status })
  }, [])

  useEffect(() => {
    if (!workspace.open) return
    const handleNewChat = () => addDefaultConversation()
    window.addEventListener(NEW_AI_CHAT_EVENT, handleNewChat)
    return () => window.removeEventListener(NEW_AI_CHAT_EVENT, handleNewChat)
  }, [addDefaultConversation, workspace.open])

  useEffect(() => {
    updateDefaultConversationTargets(fallbackTarget.id)
  }, [fallbackTarget.id, updateDefaultConversationTargets])

  return {
    activeConversation,
    activeId,
    addDefaultConversation,
    archiveConversationSafely,
    conversations,
    fallbackTarget,
    groups,
    handleStatusChange,
    restoreConversation,
    setActiveId,
    setConversationTarget,
    setShowArchived,
    showArchived,
    statuses,
    updateDefaultConversationTargets,
  }
}

function AiWorkspaceLayout({ model, workspace }: { model: AiWorkspaceModel; workspace: ResolvedAiWorkspaceProps }) {
  return (
    <section
      className={workspaceClassName(workspace.mode)}
      data-testid="ai-workspace"
      data-ai-workspace-mode={workspace.mode}
      role="dialog"
      aria-label={translate(workspace.locale, 'ai.workspace.title')}
    >
      <ConversationSidebar
        activeId={model.activeId}
        conversations={model.conversations}
        locale={workspace.locale}
        onArchive={model.archiveConversationSafely}
        onNewChat={model.addDefaultConversation}
        onRestore={model.restoreConversation}
        onSelect={model.setActiveId}
        setShowArchived={model.setShowArchived}
        showArchived={model.showArchived}
        statuses={model.statuses}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <ConversationSessions model={model} workspace={workspace} />
      </div>
    </section>
  )
}

function ConversationSessions({ model, workspace }: { model: AiWorkspaceModel; workspace: ResolvedAiWorkspaceProps }) {
  return (
    <div className="flex min-h-0 flex-1">
      {model.conversations.map((conversation) => {
        const target = resolveTarget(conversation, model.groups, model.fallbackTarget)

        return (
          <ConversationSession
            key={conversation.id}
            active={conversation.id === model.activeConversation?.id && !conversation.archived}
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
            onOpenAiSettings={workspace.onOpenAiSettings}
            onOpenNote={workspace.onOpenNote}
            onPopOut={workspace.onPopOut}
            onRestoreVaultAiGuidance={workspace.onRestoreVaultAiGuidance}
            onSelectTarget={(targetId) => model.setConversationTarget(conversation.id, targetId)}
            onStatusChange={model.handleStatusChange}
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

  if (!workspace.open || !model.activeConversation) return null

  return <AiWorkspaceLayout model={model} workspace={workspace} />
}
