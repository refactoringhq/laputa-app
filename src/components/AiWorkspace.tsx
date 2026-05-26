import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Archive,
  ArrowSquareIn,
  ArrowSquareOut,
  CaretDown,
  GearSix,
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
import { translate, type AppLocale } from '../lib/i18n'
import { trackAiWorkspaceChatTitled, trackAiWorkspaceSidebarToggled } from '../lib/productAnalytics'
import type { AgentStatus } from '../hooks/useCliAiAgent'
import type { AiWorkspaceConversationSetting } from '../types'
import type { NoteListItem } from '../utils/ai-context'
import type { VaultEntry } from '../types'
import { NEW_AI_CHAT_EVENT } from '../utils/aiPromptBridge'
import { generateAiConversationTitle } from '../utils/aiConversationTitle'
import { AiPanelView } from './AiPanel'
import { ConversationSidebar } from './AiWorkspaceSidebar'
import { ResizeHandle } from './ResizeHandle'
import { useAiPanelController } from './useAiPanelController'
import { buildAiWorkspaceTargetGroups, type AiWorkspaceTargetGroups } from './aiWorkspaceTargetGroups'

export interface AiConversation {
  archived: boolean
  hasActivity: boolean
  id: string
  targetId: string
  title: string
  usesDefaultTitle: boolean
  usesDefaultTarget: boolean
}

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
  locale?: AppLocale
  mode?: 'docked' | 'window'
  noteList?: NoteListItem[]
  noteListFilter?: { type: string | null; query: string }
  onClose: () => void
  onConversationSettingsChange?: (conversations: AiWorkspaceConversationSetting[]) => void
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

let fallbackConversationIdCounter = 0

const DEFAULT_DOCKED_WORKSPACE_SIZE = { height: 540, width: 560 }
const MIN_DOCKED_WORKSPACE_SIZE = { height: 360, width: 460 }
const DEFAULT_SIDEBAR_WIDTH = 168
const MIN_SIDEBAR_WIDTH = 132
const MAX_SIDEBAR_WIDTH = 240

function randomConversationIdPart(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID().slice(0, 8)

  if (typeof cryptoApi?.getRandomValues === 'function') {
    const values = new Uint32Array(2)
    cryptoApi.getRandomValues(values)
    return Array.from(values, (value) => value.toString(36)).join('').slice(0, 8)
  }

  fallbackConversationIdCounter += 1
  return fallbackConversationIdCounter.toString(36).padStart(4, '0')
}

function nextConversationId(): string {
  return `ai-chat-${Date.now()}-${randomConversationIdPart()}`
}

function isRunningStatus(status: AgentStatus | undefined): boolean {
  return status === 'thinking' || status === 'tool-executing'
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function maxDockedWorkspaceSize(): { height: number; width: number } {
  if (typeof window === 'undefined') return { height: 680, width: 880 }

  return {
    height: Math.max(MIN_DOCKED_WORKSPACE_SIZE.height, window.innerHeight - 88),
    width: Math.max(MIN_DOCKED_WORKSPACE_SIZE.width, window.innerWidth - 32),
  }
}

function canArchiveConversation(conversation: AiConversation): boolean {
  return conversation.archived || conversation.hasActivity
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
    hasActivity: false,
    id: nextConversationId(),
    targetId: target.id,
    title: translate(locale, 'ai.workspace.chatTitle', { index }),
    usesDefaultTitle: true,
    usesDefaultTarget: true,
  }
}

function isDefaultConversationTitle(title: string): boolean {
  return /^Chat\s+\d+$/i.test(title.trim())
}

function conversationFromSetting(setting: AiWorkspaceConversationSetting, fallbackTarget: AiTarget): AiConversation | null {
  const id = setting.id.trim()
  const title = setting.title.trim()
  if (!id || !title) return null

  return {
    archived: setting.archived === true,
    hasActivity: !isDefaultConversationTitle(title),
    id,
    targetId: setting.target_id?.trim() || fallbackTarget.id,
    title,
    usesDefaultTitle: isDefaultConversationTitle(title),
    usesDefaultTarget: !setting.target_id,
  }
}

function conversationsFromSettings(
  settings: AiWorkspaceConversationSetting[] | null | undefined,
  fallbackTarget: AiTarget,
  locale: AppLocale,
): AiConversation[] {
  const stored = (settings ?? [])
    .map((setting) => conversationFromSetting(setting, fallbackTarget))
    .filter((conversation): conversation is AiConversation => conversation !== null)
  return stored.length > 0 ? stored : [createConversation(locale, fallbackTarget, 1)]
}

function conversationsToSettings(conversations: AiConversation[]): AiWorkspaceConversationSetting[] {
  return conversations.map((conversation) => ({
    archived: conversation.archived,
    id: conversation.id,
    target_id: conversation.usesDefaultTarget ? null : conversation.targetId,
    title: conversation.title,
  }))
}

function activeConversationForState(
  conversations: AiConversation[],
  activeId: string,
  showArchived: boolean,
): AiConversation | undefined {
  const selected = conversations.find((conversation) => conversation.id === activeId)
  if (selected && selected.archived === showArchived) return selected

  return conversations.find((conversation) => conversation.archived === showArchived)
    ?? conversations.find((conversation) => !conversation.archived)
    ?? conversations[0]
}

interface UseConversationsOptions {
  fallbackTarget: AiTarget
  locale: AppLocale
  onSettingsChange?: (conversations: AiWorkspaceConversationSetting[]) => void
  settings?: AiWorkspaceConversationSetting[] | null
  settingsReady: boolean
}

function appendConversationState(
  current: AiConversation[],
  locale: AppLocale,
  target: AiTarget,
): { activeId: string; conversations: AiConversation[] } {
  const next = createConversation(locale, target, current.length + 1)
  return {
    activeId: next.id,
    conversations: [...current, next],
  }
}

function archiveConversationState(
  current: AiConversation[],
  id: string,
): { activeId?: string; conversations: AiConversation[] } {
  const conversations = current.map((conversation) => (
    conversation.id === id ? { ...conversation, archived: true } : conversation
  ))
  const fallback = conversations.find((conversation) => !conversation.archived && conversation.id !== id)
  return { activeId: fallback?.id, conversations }
}

function restoreConversationState(current: AiConversation[], id: string): AiConversation[] {
  return current.map((conversation) => (
    conversation.id === id ? { ...conversation, archived: false } : conversation
  ))
}

function retargetConversationState(current: AiConversation[], id: string, targetId: string): AiConversation[] {
  return current.map((conversation) => (
    conversation.id === id ? { ...conversation, targetId, usesDefaultTarget: false } : conversation
  ))
}

function renameConversationState(current: AiConversation[], id: string, title: string): AiConversation[] {
  const nextTitle = title.trim()
  if (!nextTitle) return current

  return current.map((conversation) => (
    conversation.id === id ? { ...conversation, title: nextTitle, usesDefaultTitle: false } : conversation
  ))
}

function titleConversationFromPromptState(current: AiConversation[], id: string, prompt: string): AiConversation[] {
  const generatedTitle = generateAiConversationTitle(prompt)

  return current.map((conversation) => (
    conversation.id === id
      ? {
          ...conversation,
          hasActivity: true,
          title: generatedTitle && conversation.usesDefaultTitle ? generatedTitle : conversation.title,
          usesDefaultTitle: generatedTitle ? false : conversation.usesDefaultTitle,
        }
      : conversation
  ))
}

function updateDefaultConversationTargetState(current: AiConversation[], targetId: string): AiConversation[] {
  return current.map((conversation) => (
    conversation.usesDefaultTarget && conversation.targetId !== targetId
      ? { ...conversation, targetId }
      : conversation
  ))
}

function useConversations({
  fallbackTarget,
  locale,
  onSettingsChange,
  settings,
  settingsReady,
}: UseConversationsOptions) {
  const [conversations, setConversations] = useState<AiConversation[]>(() => (
    conversationsFromSettings(settings, fallbackTarget, locale)
  ))
  const [activeId, setActiveId] = useState(() => conversations[0]?.id ?? '')
  const [showArchived, setShowArchived] = useState(false)
  const onSettingsChangeRef = useRef(onSettingsChange)

  const addConversation = useCallback((target: AiTarget) => {
    const next = appendConversationState(conversations, locale, target)
    setConversations(next.conversations)
    setActiveId(next.activeId)
  }, [conversations, locale])

  const archiveConversation = useCallback((id: string) => {
    const next = archiveConversationState(conversations, id)
    setConversations(next.conversations)
    if (next.activeId) setActiveId(next.activeId)
  }, [conversations])

  const restoreConversation = useCallback((id: string) => {
    setConversations((current) => restoreConversationState(current, id))
    setActiveId(id)
    setShowArchived(false)
  }, [])

  const setConversationTarget = useCallback((id: string, targetId: string) => {
    setConversations((current) => retargetConversationState(current, id, targetId))
  }, [])

  const renameConversation = useCallback((id: string, title: string) => {
    setConversations((current) => renameConversationState(current, id, title))
  }, [])

  const titleConversationFromPrompt = useCallback((id: string, prompt: string) => {
    setConversations((current) => titleConversationFromPromptState(current, id, prompt))
  }, [])

  const updateDefaultConversationTargets = useCallback((targetId: string) => {
    setConversations((current) => updateDefaultConversationTargetState(current, targetId))
  }, [])

  useEffect(() => {
    onSettingsChangeRef.current = onSettingsChange
  }, [onSettingsChange])

  useEffect(() => {
    if (!settingsReady) return
    onSettingsChangeRef.current?.(conversationsToSettings(conversations))
  }, [conversations, settingsReady])

  return {
    activeId,
    addConversation,
    archiveConversation,
    conversations,
    renameConversation,
    restoreConversation,
    setActiveId,
    setConversationTarget,
    setShowArchived,
    showArchived,
    titleConversationFromPrompt,
    updateDefaultConversationTargets,
  }
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
          'justify-between gap-1.5',
          compact ? 'max-w-[150px] rounded-full px-2 text-[12px]' : 'max-w-[240px] gap-2',
        )}
        disabled={disabled || !hasTargets}
        aria-label={translate(locale, 'ai.workspace.targetLabel')}
        data-testid="ai-workspace-target-trigger"
      >
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
}: {
  groups: AiWorkspaceTargetGroups
  hasTargets: boolean
  locale: AppLocale
  selectedTarget: AiTarget
  onSelectTarget: (targetId: string) => void
}) {
  const hasLocalAgentsSeparator = groups.localAgents.length > 0
    && (groups.localModels.length > 0 || groups.apiModels.length > 0)
  const hasLocalModelsSeparator = groups.localModels.length > 0 && groups.apiModels.length > 0

  return (
    <DropdownMenuContent align="start" className="z-[12000] min-w-[280px]">
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
  onSelectTarget,
}: {
  compact?: boolean
  disabled: boolean
  groups: AiWorkspaceTargetGroups
  locale: AppLocale
  selectedTarget: AiTarget
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
  targetKind,
  onChange,
}: {
  compact?: boolean
  disabled: boolean
  locale: AppLocale
  permissionMode: AiAgentPermissionMode
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
          className={cn('justify-between', compact ? 'rounded-full px-2 text-[12px]' : 'gap-2')}
          disabled={disabled}
          aria-label={translate(locale, 'ai.workspace.permissionMode')}
          data-testid="ai-workspace-permission-trigger"
        >
          {aiAgentPermissionModeLabels(permissionMode, locale).control}
          <CaretDown size={compact ? 12 : 13} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="z-[12000] min-w-[180px]">
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
  archiveDisabled,
  locale,
  mode,
  onArchive,
  onClose,
  onDock,
  onOpenAiSettings,
  onPopOut,
}: {
  conversation: AiConversation
  archiveDisabled: boolean
  locale: AppLocale
  mode: 'docked' | 'window'
  onArchive: () => void
  onClose: () => void
  onDock?: () => void
  onOpenAiSettings?: () => void
  onPopOut?: () => void
}) {
  const { dragRegionRef } = useDragRegion<HTMLDivElement>()

  return (
    <div
      ref={dragRegionRef}
      className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3"
      data-testid="ai-workspace-chat-header"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="min-w-0 max-w-[260px]">
          <div className="truncate text-[13px] font-semibold text-foreground">{conversation.title}</div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {onOpenAiSettings && (
          <Button type="button" variant="ghost" size="icon-xs" aria-label={translate(locale, 'ai.workspace.settings')} title={translate(locale, 'ai.workspace.settings')} onClick={onOpenAiSettings}>
            <GearSix size={16} />
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon-xs" aria-label={translate(locale, 'ai.workspace.archive')} title={translate(locale, 'ai.workspace.archive')} disabled={archiveDisabled} onClick={onArchive}>
          <Archive size={16} />
        </Button>
        {mode === 'docked' ? (
          <Button type="button" variant="ghost" size="icon-xs" aria-label={translate(locale, 'ai.workspace.popOut')} title={translate(locale, 'ai.workspace.popOut')} onClick={onPopOut}>
            <ArrowSquareOut size={16} />
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="icon-xs" aria-label={translate(locale, 'ai.workspace.dock')} title={translate(locale, 'ai.workspace.dock')} onClick={onDock}>
            <ArrowSquareIn size={16} />
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon-xs" aria-label={translate(locale, 'ai.workspace.close')} title={translate(locale, 'ai.workspace.close')} onClick={onClose}>
          <X size={16} />
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
  onTitleFromPrompt,
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
  onTitleFromPrompt: (id: string, prompt: string) => void
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
  const running = isRunningStatus(controller.agent.status)
  const composerControls = (
    <>
      <TargetPicker
        compact
        disabled={running}
        groups={groups}
        locale={locale}
        selectedTarget={target}
        onSelectTarget={onSelectTarget}
      />
      <PermissionPicker
        compact
        disabled={running}
        locale={locale}
        permissionMode={controller.permissionMode}
        targetKind={target.kind}
        onChange={controller.handlePermissionModeChange}
      />
    </>
  )

  useEffect(() => {
    onStatusChange(conversation.id, controller.agent.status)
  }, [conversation.id, controller.agent.status, onStatusChange])

  return (
    <div className={active ? 'flex min-h-0 flex-1 flex-col' : 'hidden'} data-testid={`ai-workspace-session-${conversation.id}`}>
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
          composerControls={composerControls}
          interactive={active}
          locale={locale}
          onClose={onClose}
          onOpenNote={onOpenNote}
          onSendPrompt={(prompt) => onTitleFromPrompt(conversation.id, prompt)}
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
  canArchiveConversation: (conversation: AiConversation) => boolean
  conversations: AiConversation[]
  fallbackTarget: AiTarget
  groups: AiWorkspaceTargetGroups
  handleStatusChange: (id: string, status: AgentStatus) => void
  renameConversation: (id: string, title: string) => void
  restoreConversation: (id: string) => void
  sidebarCollapsed: boolean
  setActiveId: (id: string) => void
  setConversationTarget: (id: string, targetId: string) => void
  setShowArchived: (show: boolean) => void
  showArchived: boolean
  statuses: Record<string, AgentStatus>
  titleConversationFromPrompt: (id: string, prompt: string) => void
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

interface AiWorkspaceSizing {
  onSidebarResize: (delta: number) => void
  onWorkspaceResize: (deltaWidth: number, deltaHeight: number) => void
  sidebarWidth: number
  workspaceSize: { height: number; width: number }
}

function workspaceClassName(mode: 'docked' | 'window'): string {
  if (mode === 'window') {
    return 'fixed inset-0 z-[120] flex overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-2xl'
  }

  return 'fixed bottom-20 right-4 z-[120] flex overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-2xl'
}

function workspaceStyle(mode: 'docked' | 'window', size: AiWorkspaceSizing['workspaceSize']): CSSProperties | undefined {
  if (mode === 'window') return undefined

  return {
    height: size.height,
    maxHeight: 'calc(100vh - 112px)',
    maxWidth: 'calc(100vw - 32px)',
    minHeight: MIN_DOCKED_WORKSPACE_SIZE.height,
    minWidth: MIN_DOCKED_WORKSPACE_SIZE.width,
    width: size.width,
  }
}

function startResizeDrag(
  event: ReactMouseEvent,
  cursor: string,
  onDrag: (deltaX: number, deltaY: number) => void,
) {
  event.preventDefault()
  event.stopPropagation()

  let lastX = event.clientX
  let lastY = event.clientY
  const previousCursor = document.body.style.cursor
  const previousUserSelect = document.body.style.userSelect
  document.body.style.cursor = cursor
  document.body.style.userSelect = 'none'

  const handleMouseMove = (moveEvent: MouseEvent) => {
    const deltaX = moveEvent.clientX - lastX
    const deltaY = moveEvent.clientY - lastY
    lastX = moveEvent.clientX
    lastY = moveEvent.clientY
    onDrag(deltaX, deltaY)
  }
  const handleMouseUp = () => {
    document.body.style.cursor = previousCursor
    document.body.style.userSelect = previousUserSelect
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('mouseup', handleMouseUp)
  }

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
}

function WorkspaceResizeHandles({
  mode,
  onResize,
}: {
  mode: 'docked' | 'window'
  onResize: (deltaWidth: number, deltaHeight: number) => void
}) {
  if (mode === 'window') return null

  return (
    <>
      <div
        className="absolute inset-y-0 left-0 z-30 w-1 cursor-col-resize bg-transparent transition-colors hover:bg-border"
        data-testid="ai-workspace-left-resize"
        onMouseDown={(event) => startResizeDrag(event, 'col-resize', (deltaX) => onResize(-deltaX, 0))}
      />
      <div
        className="absolute top-0 right-0 left-0 z-30 h-1 cursor-row-resize bg-transparent transition-colors hover:bg-border"
        data-testid="ai-workspace-top-resize"
        onMouseDown={(event) => startResizeDrag(event, 'row-resize', (_deltaX, deltaY) => onResize(0, -deltaY))}
      />
    </>
  )
}

function useAiWorkspaceSizing(mode: 'docked' | 'window'): AiWorkspaceSizing {
  const [workspaceSize, setWorkspaceSize] = useState(DEFAULT_DOCKED_WORKSPACE_SIZE)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)

  const onWorkspaceResize = useCallback((deltaWidth: number, deltaHeight: number) => {
    if (mode === 'window') return
    setWorkspaceSize((current) => {
      const max = maxDockedWorkspaceSize()
      return {
        height: clampNumber(current.height + deltaHeight, MIN_DOCKED_WORKSPACE_SIZE.height, max.height),
        width: clampNumber(current.width + deltaWidth, MIN_DOCKED_WORKSPACE_SIZE.width, max.width),
      }
    })
  }, [mode])
  const onSidebarResize = useCallback((delta: number) => {
    setSidebarWidth((current) => clampNumber(current + delta, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH))
  }, [])

  return { onSidebarResize, onWorkspaceResize, sidebarWidth, workspaceSize }
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
  titleConversationFromPrompt,
}: {
  conversations: AiConversation[]
  renameConversation: (id: string, title: string) => void
  titleConversationFromPrompt: (id: string, prompt: string) => void
}) {
  const trackedRenameConversation = useCallback((id: string, title: string) => {
    if (!title.trim()) return
    renameConversation(id, title)
    trackAiWorkspaceChatTitled('manual')
  }, [renameConversation])
  const trackedTitleConversationFromPrompt = useCallback((id: string, prompt: string) => {
    const conversation = conversations.find((candidate) => candidate.id === id)
    titleConversationFromPrompt(id, prompt)
    if (conversation?.usesDefaultTitle) trackAiWorkspaceChatTitled('generated')
  }, [conversations, titleConversationFromPrompt])

  return { trackedRenameConversation, trackedTitleConversationFromPrompt }
}

function useAiWorkspaceNewChatEvent(open: boolean, addDefaultConversation: () => void) {
  useEffect(() => {
    if (!open) return
    const handleNewChat = () => addDefaultConversation()
    window.addEventListener(NEW_AI_CHAT_EVENT, handleNewChat)
    return () => window.removeEventListener(NEW_AI_CHAT_EVENT, handleNewChat)
  }, [addDefaultConversation, open])
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
    renameConversation,
    restoreConversation,
    setActiveId,
    setConversationTarget,
    setShowArchived,
    showArchived,
    titleConversationFromPrompt,
    updateDefaultConversationTargets,
  } = useConversations({
    fallbackTarget,
    locale: workspace.locale,
    onSettingsChange: workspace.onConversationSettingsChange,
    settings: workspace.conversationSettings,
    settingsReady: workspace.conversationSettingsReady ?? true,
  })
  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>({})
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
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
  const { trackedRenameConversation, trackedTitleConversationFromPrompt } = useTrackedConversationActions({
    conversations,
    renameConversation,
    titleConversationFromPrompt,
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
    conversations,
    fallbackTarget,
    groups,
    handleStatusChange,
    renameConversation: trackedRenameConversation,
    restoreConversation,
    sidebarCollapsed,
    setActiveId,
    setConversationTarget,
    setShowArchived,
    showArchived,
    statuses,
    titleConversationFromPrompt: trackedTitleConversationFromPrompt,
    toggleSidebarCollapsed,
    updateDefaultConversationTargets,
  }
}

function AiWorkspaceLayout({ model, workspace }: { model: AiWorkspaceModel; workspace: ResolvedAiWorkspaceProps }) {
  const sizing = useAiWorkspaceSizing(workspace.mode)

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

function ConversationSessions({ model, workspace }: { model: AiWorkspaceModel; workspace: ResolvedAiWorkspaceProps }) {
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
            onOpenAiSettings={workspace.onOpenAiSettings}
            onOpenNote={workspace.onOpenNote}
            onPopOut={workspace.onPopOut}
            onRestoreVaultAiGuidance={workspace.onRestoreVaultAiGuidance}
            onSelectTarget={(targetId) => model.setConversationTarget(conversation.id, targetId)}
            onStatusChange={model.handleStatusChange}
            onTitleFromPrompt={model.titleConversationFromPrompt}
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
