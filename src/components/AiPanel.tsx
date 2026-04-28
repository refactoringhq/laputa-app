import { useRef } from 'react'
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
import { type NoteListItem } from '../utils/ai-context'
import type { VaultEntry } from '../types'
import { useAiPanelController, type AiPanelController } from './useAiPanelController'
import { useAiPanelPromptQueue } from './useAiPanelPromptQueue'
import { useAiPanelFocus } from './useAiPanelFocus'

export type { AiAgentMessage } from '../hooks/useCliAiAgent'

interface AiPanelProps {
  onClose: () => void
  onCopyMcpConfig?: () => void
  onOpenNote?: (path: string) => void
  onUnsupportedAiPaste?: (message: string) => void
  defaultAiAgent?: AiAgentId
  defaultAiAgentReadiness?: AiAgentReadiness
  defaultAiAgentReady?: boolean
  onFileCreated?: (relativePath: string) => void
  onFileModified?: (relativePath: string) => void
  onVaultChanged?: () => void
  vaultPath: string
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
  onCopyMcpConfig?: () => void
  onOpenNote?: (path: string) => void
  onUnsupportedAiPaste?: (message: string) => void
  defaultAiAgent?: AiAgentId
  defaultAiAgentReadiness?: AiAgentReadiness
  defaultAiAgentReady?: boolean
  activeEntry?: VaultEntry | null
  entries?: VaultEntry[]
}

function readinessFromReadyFlag(ready: boolean | undefined): AiAgentReadiness {
  return (ready ?? true) ? 'ready' : 'missing'
}

export function AiPanelView({
  controller,
  onClose,
  onCopyMcpConfig,
  onOpenNote,
  onUnsupportedAiPaste,
  defaultAiAgent: providedDefaultAiAgent,
  defaultAiAgentReadiness: providedDefaultAiAgentReadiness,
  defaultAiAgentReady: providedDefaultAiAgentReady,
  activeEntry,
  entries,
}: AiPanelViewProps) {
  const defaultAiAgent = providedDefaultAiAgent ?? DEFAULT_AI_AGENT
  const defaultAiAgentReadiness = providedDefaultAiAgentReadiness
    ?? readinessFromReadyFlag(providedDefaultAiAgentReady)
  const inputRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const agentLabel = getAiAgentDefinition(defaultAiAgent).label
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

  useAiPanelPromptQueue({ agent, input, isActive, setInput })
  useAiPanelFocus({
    inputRef,
    panelRef,
    hasMessages: agent.messages.length > 0,
    isActive,
    onClose,
  })

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className="flex flex-1 flex-col overflow-hidden bg-background text-foreground"
      style={{
        outline: 'none',
        borderLeft: isActive
          ? '2px solid var(--accent-blue)'
          : '1px solid var(--border)',
        animation: isActive ? 'ai-border-pulse 2s ease-in-out infinite' : undefined,
        transition: 'border-color 0.3s ease',
      }}
      data-testid="ai-panel"
      data-ai-active={isActive || undefined}
    >
      <AiPanelHeader
        agentLabel={agentLabel}
        agentReadiness={defaultAiAgentReadiness}
        permissionMode={permissionMode}
        permissionModeDisabled={isActive}
        onPermissionModeChange={handlePermissionModeChange}
        onClose={onClose}
        onCopyMcpConfig={onCopyMcpConfig}
        onNewChat={handleNewChat}
      />
      {activeEntry && (
        <AiPanelContextBar activeEntry={activeEntry} linkedCount={linkedEntries.length} />
      )}
      <AiPanelMessageHistory
        agentLabel={agentLabel}
        agentReadiness={defaultAiAgentReadiness}
        messages={agent.messages}
        isActive={isActive}
        onOpenNote={onOpenNote}
        onNavigateWikilink={handleNavigateWikilink}
        hasContext={hasContext}
      />
      <AiPanelComposer
        entries={entries ?? []}
        agentLabel={agentLabel}
        agentReadiness={defaultAiAgentReadiness}
        input={input}
        inputRef={inputRef}
        isActive={isActive}
        onChange={setInput}
        onSend={handleSend}
        onUnsupportedAiPaste={onUnsupportedAiPaste}
      />
    </aside>
  )
}

export function AiPanel({
  onClose,
  onCopyMcpConfig,
  onOpenNote,
  onUnsupportedAiPaste,
  defaultAiAgent: providedDefaultAiAgent,
  defaultAiAgentReadiness: providedDefaultAiAgentReadiness,
  defaultAiAgentReady: providedDefaultAiAgentReady,
  onFileCreated,
  onFileModified,
  onVaultChanged,
  vaultPath,
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
    defaultAiAgent: providedDefaultAiAgent ?? DEFAULT_AI_AGENT,
    defaultAiAgentReady: providedDefaultAiAgentReady ?? true,
    defaultAiAgentReadiness,
    activeEntry,
    activeNoteContent,
    entries,
    openTabs,
    noteList,
    noteListFilter,
    onOpenNote,
    onFileCreated,
    onFileModified,
    onVaultChanged,
  })

  return (
    <AiPanelView
      controller={controller}
      onClose={onClose}
      onCopyMcpConfig={onCopyMcpConfig}
      onOpenNote={onOpenNote}
      onUnsupportedAiPaste={onUnsupportedAiPaste}
      defaultAiAgent={providedDefaultAiAgent}
      defaultAiAgentReadiness={defaultAiAgentReadiness}
      defaultAiAgentReady={providedDefaultAiAgentReady}
      activeEntry={activeEntry}
      entries={entries}
    />
  )
}
