import { useEffect, useRef } from 'react'
import { Robot, X, PaperPlaneRight, Plus, Link } from '@phosphor-icons/react'
import { Copy } from 'lucide-react'
import { AiMessage } from './AiMessage'
import { Button } from '@/components/ui/button'
import { WikilinkChatInput } from './WikilinkChatInput'
import { extractInlineWikilinkReferences } from './inlineWikilinkText'
import {
  AI_AGENT_PERMISSION_MODE_LABELS,
  type AiAgentPermissionMode,
} from '../lib/aiAgentPermissionMode'
import type { AiAgentMessage } from '../hooks/useCliAiAgent'
import type { AiAgentReadiness } from '../lib/aiAgents'
import type { NoteReference } from '../utils/ai-context'
import type { VaultEntry } from '../types'

interface AiPanelHeaderProps {
  agentLabel: string
  agentReadiness: AiAgentReadiness
  permissionMode: AiAgentPermissionMode
  permissionModeDisabled: boolean
  onPermissionModeChange: (mode: AiAgentPermissionMode) => void
  onClose: () => void
  onCopyMcpConfig?: () => void
  onNewChat: () => void
}

interface AiPanelContextBarProps {
  activeEntry: VaultEntry
  linkedCount: number
}

interface AiPanelMessageHistoryProps {
  agentLabel: string
  agentReadiness: AiAgentReadiness
  messages: AiAgentMessage[]
  isActive: boolean
  onOpenNote?: (path: string) => void
  onNavigateWikilink?: (target: string) => void
  hasContext: boolean
}

interface AiPanelComposerProps {
  entries: VaultEntry[]
  agentLabel: string
  agentReadiness: AiAgentReadiness
  input: string
  inputRef: React.RefObject<HTMLDivElement | null>
  isActive: boolean
  onChange: (value: string) => void
  onSend: (text: string, references: NoteReference[]) => void
  onUnsupportedAiPaste?: (message: string) => void
}

function getComposerPlaceholder(
  agentLabel: string,
  agentReadiness: AiAgentReadiness,
): string {
  if (agentReadiness === 'checking') {
    return 'Checking AI agent availability...'
  }

  if (agentReadiness === 'missing') {
    return `${agentLabel} is not installed. Open AI Agents in Settings.`
  }

  return `Ask ${agentLabel}`
}

function AiPanelEmptyState({
  agentLabel,
  agentReadiness,
  hasContext,
}: Pick<AiPanelMessageHistoryProps, 'agentLabel' | 'agentReadiness' | 'hasContext'>) {
  if (agentReadiness === 'checking') {
    return (
      <div
        className="flex flex-col items-center justify-center text-center text-muted-foreground"
        style={{ paddingTop: 40 }}
      >
        <Robot size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
        <p style={{ fontSize: 13, margin: '0 0 4px' }}>
          Checking AI agent availability
        </p>
        <p style={{ fontSize: 11, margin: 0, opacity: 0.6 }}>
          Messages can be sent when the selected agent is ready
        </p>
      </div>
    )
  }

  if (agentReadiness === 'missing') {
    return (
      <div
        className="flex flex-col items-center justify-center text-center text-muted-foreground"
        style={{ paddingTop: 40 }}
      >
        <Robot size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
        <p style={{ fontSize: 13, margin: '0 0 4px' }}>
          {agentLabel} is not available on this machine
        </p>
        <p style={{ fontSize: 11, margin: 0, opacity: 0.6 }}>
          Install it or switch the default AI agent in Settings
        </p>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col items-center justify-center text-center text-muted-foreground"
      style={{ paddingTop: 40 }}
    >
      <Robot size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
      <p style={{ fontSize: 13, margin: '0 0 4px' }}>
        {hasContext
          ? `Ask ${agentLabel} about this note and its linked context`
          : `Open a note, then ask ${agentLabel} about it`
        }
      </p>
      <p style={{ fontSize: 11, margin: 0, opacity: 0.6 }}>
        {hasContext
          ? 'Summarize, find connections, expand ideas'
          : 'The AI will use the active note as context'
        }
      </p>
    </div>
  )
}

export function AiPanelHeader({
  agentLabel,
  agentReadiness,
  permissionMode,
  permissionModeDisabled,
  onPermissionModeChange,
  onClose,
  onCopyMcpConfig,
  onNewChat,
}: AiPanelHeaderProps) {
  const modeLabel = AI_AGENT_PERMISSION_MODE_LABELS[permissionMode].short

  return (
    <div
      className="flex shrink-0 flex-col border-b border-border"
      style={{ padding: '8px 12px', gap: 8 }}
    >
      <div className="flex items-center" style={{ gap: 8 }}>
        <Robot size={16} className="shrink-0 text-muted-foreground" />
        <div className="flex flex-1 flex-col overflow-hidden">
          <span className="text-muted-foreground" style={{ fontSize: 13, fontWeight: 600 }}>
            AI Agent
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {agentReadiness === 'checking'
              ? 'Checking availability'
              : `${agentLabel}${agentReadiness === 'missing' ? ' · not installed' : ` · ${modeLabel}`}`}
          </span>
        </div>
        {onCopyMcpConfig ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onCopyMcpConfig}
            aria-label="Copy MCP config"
            title="Copy MCP config"
            data-testid="ai-copy-mcp-config"
          >
            <Copy size={15} />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onNewChat}
          aria-label="New AI chat"
          title="New AI chat"
        >
          <Plus size={16} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label="Close AI panel"
          title="Close AI panel"
        >
          <X size={16} />
        </Button>
      </div>
      <AiPermissionModeToggle
        value={permissionMode}
        disabled={permissionModeDisabled}
        onChange={onPermissionModeChange}
      />
    </div>
  )
}

function AiPermissionModeToggle({
  value,
  disabled,
  onChange,
}: {
  value: AiAgentPermissionMode
  disabled: boolean
  onChange: (mode: AiAgentPermissionMode) => void
}) {
  return (
    <div
      className="grid rounded-md bg-muted"
      style={{ gridTemplateColumns: '1fr 1fr', gap: 2, padding: 2 }}
      role="group"
      aria-label="AI agent permission mode"
      data-testid="ai-permission-mode-toggle"
    >
      {(['safe', 'power_user'] as const).map((mode) => {
        const selected = value === mode
        return (
          <Button
            key={mode}
            type="button"
            size="xs"
            variant={selected ? 'secondary' : 'ghost'}
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(mode)}
          >
            {AI_AGENT_PERMISSION_MODE_LABELS[mode].control}
          </Button>
        )
      })}
    </div>
  )
}

export function AiPanelContextBar({ activeEntry, linkedCount }: AiPanelContextBarProps) {
  return (
    <div
      className="flex shrink-0 items-center border-b border-border text-muted-foreground"
      style={{ padding: '6px 12px', gap: 6, fontSize: 11 }}
      data-testid="context-bar"
    >
      <Link size={12} className="shrink-0" />
      <span className="truncate" style={{ fontWeight: 500 }}>{activeEntry.title}</span>
      {linkedCount > 0 && (
        <span style={{ opacity: 0.6 }}>+ {linkedCount} linked</span>
      )}
    </div>
  )
}

export function AiPanelMessageHistory({
  agentLabel,
  agentReadiness,
  messages,
  isActive,
  onOpenNote,
  onNavigateWikilink,
  hasContext,
}: AiPanelMessageHistoryProps) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isActive])

  return (
    <div className="flex-1 overflow-y-auto" style={{ padding: 12 }}>
      {messages.length === 0 && !isActive && (
        <AiPanelEmptyState
          agentLabel={agentLabel}
          agentReadiness={agentReadiness}
          hasContext={hasContext}
        />
      )}
      {messages.map((message, index) => (
        <AiMessage
          key={message.id ?? index}
          {...message}
          onOpenNote={onOpenNote}
          onNavigateWikilink={onNavigateWikilink}
        />
      ))}
      <div ref={endRef} />
    </div>
  )
}

export function AiPanelComposer({
  entries,
  agentLabel,
  agentReadiness,
  input,
  inputRef,
  isActive,
  onChange,
  onSend,
  onUnsupportedAiPaste,
}: AiPanelComposerProps) {
  const composerDisabled = isActive || agentReadiness !== 'ready'
  const canSend = !composerDisabled && input.trim().length > 0
  const placeholder = getComposerPlaceholder(agentLabel, agentReadiness)
  const sendButtonStyle = {
    background: canSend ? 'var(--primary)' : 'var(--muted)',
    color: canSend ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
    borderRadius: 8,
    width: 32,
    height: 34,
    cursor: canSend ? 'pointer' : 'not-allowed',
  } as const

  return (
    <div
      className="flex shrink-0 flex-col border-t border-border"
      style={{ padding: '8px 12px' }}
    >
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <WikilinkChatInput
            entries={entries}
            value={input}
            onChange={onChange}
            onSend={onSend}
            onUnsupportedPaste={onUnsupportedAiPaste}
            disabled={composerDisabled}
            placeholder={placeholder}
            inputRef={inputRef}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 flex items-center justify-center border-none cursor-pointer transition-colors"
          style={sendButtonStyle}
          onClick={() => onSend(input, extractInlineWikilinkReferences(input, entries))}
          disabled={!canSend}
          aria-label="Send message"
          title="Send message"
          data-testid="agent-send"
        >
          <PaperPlaneRight size={16} />
        </Button>
      </div>
    </div>
  )
}
