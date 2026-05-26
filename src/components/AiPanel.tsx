import { useCallback, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react'
import {
  AiPanelComposer,
  AiPanelContextBar,
  AiPanelHeader,
  AiPanelMessageHistory,
} from './AiPanelChrome'
import {
  DEFAULT_AI_AGENT,
  getAiAgentDefinition,
  type AiAgentId,
  type AiAgentReadiness,
} from '../lib/aiAgents'
import type { AiTarget } from '../lib/aiTargets'
import type { AppLocale } from '../lib/i18n'
import { type NoteListItem } from '../utils/ai-context'
import type { VaultEntry } from '../types'
import { useAiPanelController, type AiPanelController } from './useAiPanelController'
import { useAiPanelPromptQueue } from './useAiPanelPromptQueue'
import { useAiPanelFocus } from './useAiPanelFocus'

export type { AiAgentMessage } from '../hooks/useCliAiAgent'

interface AiPanelProps {
  onClose: () => void
  onOpenNote?: (path: string) => void
  onUnsupportedAiPaste?: (message: string) => void
  defaultAiAgent?: AiAgentId
  defaultAiTarget?: AiTarget
  defaultAiAgentReadiness?: AiAgentReadiness
  defaultAiAgentReady?: boolean
  locale?: AppLocale
  onFileCreated?: (relativePath: string) => void
  onFileModified?: (relativePath: string) => void
  onVaultChanged?: () => void
  vaultPath: string
  vaultPaths?: string[]
  activeEntry?: VaultEntry | null
  /** Direct content of the active note from the editor tab. */
  activeNoteContent?: string | null
  entries?: VaultEntry[]
  openTabs?: VaultEntry[]
  noteList?: NoteListItem[]
  noteListFilter?: { type: string | null; query: string }
}

interface AiPanelViewProps {
  controller: AiPanelController
  onClose: () => void
  onOpenNote?: (path: string) => void
  onUnsupportedAiPaste?: (message: string) => void
  defaultAiAgent?: AiAgentId
  defaultAiTarget?: AiTarget
  defaultAiAgentReadiness?: AiAgentReadiness
  defaultAiAgentReady?: boolean
  locale?: AppLocale
  activeEntry?: VaultEntry | null
  entries?: VaultEntry[]
  interactive?: boolean
  showHeader?: boolean
  composerControls?: ReactNode
  onSendPrompt?: (text: string) => void
}

function readinessFromReadyFlag(ready: boolean | undefined): AiAgentReadiness {
  return (ready ?? true) ? 'ready' : 'missing'
}

interface AiPanelViewModel {
  agentLabel: string
  defaultAiAgent: AiAgentId
  defaultAiAgentReadiness: AiAgentReadiness
  targetKind: AiTarget['kind']
}

function resolveAiPanelViewModel({
  defaultAiAgent,
  defaultAiAgentReadiness,
  defaultAiAgentReady,
  defaultAiTarget,
}: {
  defaultAiAgent?: AiAgentId
  defaultAiAgentReadiness?: AiAgentReadiness
  defaultAiAgentReady?: boolean
  defaultAiTarget?: AiTarget
}): AiPanelViewModel {
  const resolvedAgent = defaultAiAgent ?? DEFAULT_AI_AGENT
  const resolvedReadiness = defaultAiAgentReadiness ?? readinessFromReadyFlag(defaultAiAgentReady)

  return {
    agentLabel: defaultAiTarget?.label ?? getAiAgentDefinition(resolvedAgent).label,
    defaultAiAgent: resolvedAgent,
    defaultAiAgentReadiness: resolvedReadiness,
    targetKind: defaultAiTarget?.kind ?? 'agent',
  }
}

function aiPanelFrameStyle(isActive: boolean): CSSProperties {
  return {
    outline: 'none',
    borderLeft: isActive
      ? '2px solid var(--accent-blue)'
      : '1px solid var(--border)',
    animation: isActive ? 'ai-border-pulse 2s ease-in-out infinite' : undefined,
    transition: 'border-color 0.3s ease',
  }
}

function AiPanelFrame({
  children,
  isActive,
  panelRef,
}: {
  children: ReactNode
  isActive: boolean
  panelRef: RefObject<HTMLElement | null>
}) {
  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className="flex flex-1 flex-col overflow-hidden bg-background text-foreground"
      style={aiPanelFrameStyle(isActive)}
      data-testid="ai-panel"
      data-ai-active={isActive || undefined}
    >
      {children}
    </aside>
  )
}

export function AiPanelView({
  controller,
  onClose,
  onOpenNote,
  onUnsupportedAiPaste,
  defaultAiAgent: providedDefaultAiAgent,
  defaultAiTarget,
  defaultAiAgentReadiness: providedDefaultAiAgentReadiness,
  defaultAiAgentReady: providedDefaultAiAgentReady,
  locale = 'en',
  activeEntry,
  entries,
  interactive = true,
  showHeader = true,
  composerControls,
  onSendPrompt,
}: AiPanelViewProps) {
  const view = resolveAiPanelViewModel({
    defaultAiAgent: providedDefaultAiAgent,
    defaultAiAgentReadiness: providedDefaultAiAgentReadiness,
    defaultAiAgentReady: providedDefaultAiAgentReady,
    defaultAiTarget,
  })
  const inputRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const {
    agent,
    input,
    setInput,
    linkedEntries,
    hasContext,
    isActive,
    permissionMode,
    handleSend,
    handleNavigateWikilink,
    handlePermissionModeChange,
    handleNewChat,
  } = controller

  useAiPanelPromptQueue({ agent, input, isActive, setInput, enabled: interactive })
  useAiPanelFocus({
    inputRef,
    panelRef,
    hasMessages: agent.messages.length > 0,
    isActive,
    onClose,
    enabled: interactive,
  })
  const handleComposerSend = useCallback((text: string, references: Parameters<typeof handleSend>[1]) => {
    if (!text.trim() || isActive) return
    onSendPrompt?.(text)
    handleSend(text, references)
  }, [handleSend, isActive, onSendPrompt])

  return (
    <AiPanelFrame panelRef={panelRef} isActive={isActive}>
      {showHeader && (
        <AiPanelHeader
          agentLabel={view.agentLabel}
          agentReadiness={view.defaultAiAgentReadiness}
          targetKind={view.targetKind}
          locale={locale}
          permissionMode={permissionMode}
          permissionModeDisabled={isActive}
          onPermissionModeChange={handlePermissionModeChange}
          onClose={onClose}
          onNewChat={handleNewChat}
        />
      )}
      {activeEntry && (
        <AiPanelContextBar activeEntry={activeEntry} linkedCount={linkedEntries.length} locale={locale} />
      )}
      <AiPanelMessageHistory
        agentLabel={view.agentLabel}
        agentReadiness={view.defaultAiAgentReadiness}
        locale={locale}
        messages={agent.messages}
        isActive={isActive}
        onOpenNote={onOpenNote}
        onNavigateWikilink={handleNavigateWikilink}
        hasContext={hasContext}
      />
      <AiPanelComposer
        entries={entries ?? []}
        agentLabel={view.agentLabel}
        agentReadiness={view.defaultAiAgentReadiness}
        locale={locale}
        input={input}
        inputRef={inputRef}
        isActive={isActive}
        controls={composerControls}
        onChange={setInput}
        onSend={handleComposerSend}
        onUnsupportedAiPaste={onUnsupportedAiPaste}
      />
    </AiPanelFrame>
  )
}

export function AiPanel({
  onClose,
  onOpenNote,
  onUnsupportedAiPaste,
  defaultAiAgent: providedDefaultAiAgent,
  defaultAiTarget,
  defaultAiAgentReadiness: providedDefaultAiAgentReadiness,
  defaultAiAgentReady: providedDefaultAiAgentReady,
  locale = 'en',
  onFileCreated,
  onFileModified,
  onVaultChanged,
  vaultPath,
  vaultPaths,
  activeEntry,
  activeNoteContent,
  entries,
  openTabs,
  noteList,
  noteListFilter,
}: AiPanelProps) {
  const defaultAiAgentReadiness = providedDefaultAiAgentReadiness
    ?? readinessFromReadyFlag(providedDefaultAiAgentReady)
  const controller = useAiPanelController({
    vaultPath,
    vaultPaths,
    defaultAiAgent: providedDefaultAiAgent ?? DEFAULT_AI_AGENT,
    defaultAiTarget,
    defaultAiAgentReady: providedDefaultAiAgentReady ?? true,
    defaultAiAgentReadiness,
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

  return (
    <AiPanelView
      controller={controller}
      onClose={onClose}
      onOpenNote={onOpenNote}
      onUnsupportedAiPaste={onUnsupportedAiPaste}
      defaultAiAgent={providedDefaultAiAgent}
      defaultAiTarget={defaultAiTarget}
      defaultAiAgentReadiness={defaultAiAgentReadiness}
      defaultAiAgentReady={providedDefaultAiAgentReady}
      locale={locale}
      activeEntry={activeEntry}
      entries={entries}
    />
  )
}
