import { useEffect, useRef } from 'react'
import { Robot, X, PaperPlaneRight, Plus, Link } from '@phosphor-icons/react'
import { AiMessage } from './AiMessage'
import { Button } from '@/components/ui/button'
import { ActionTooltip } from '@/components/ui/action-tooltip'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WikilinkChatInput } from './WikilinkChatInput'
import { extractInlineWikilinkReferences } from './inlineWikilinkText'
import {
  aiAgentPermissionModeLabels,
  type AiAgentPermissionMode,
} from '../lib/aiAgentPermissionMode'
import { createTranslator, type AppLocale } from '../lib/i18n'
import type { AiAgentMessage } from '../hooks/useCliAiAgent'
import type { AiAgentReadiness } from '../lib/aiAgents'
import type { NoteReference } from '../utils/ai-context'
import type { VaultEntry } from '../types'

interface AiPanelHeaderProps {
  agentLabel: string
  agentReadiness: AiAgentReadiness
  locale?: AppLocale
  permissionMode: AiAgentPermissionMode
  permissionModeDisabled: boolean
  onPermissionModeChange: (mode: AiAgentPermissionMode) => void
  onClose: () => void
  onNewChat: () => void
}

interface AiPanelContextBarProps {
  activeEntry: VaultEntry
  locale?: AppLocale
  linkedCount: number
}

interface AiPanelMessageHistoryProps {
  agentLabel: string
  agentReadiness: AiAgentReadiness
  locale?: AppLocale
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
  locale?: AppLocale
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
  t: ReturnType<typeof createTranslator>,
): string {
  if (agentReadiness === 'checking') {
    return t('ai.panel.placeholder.checking')
  }

  if (agentReadiness === 'missing') {
    return t('ai.panel.placeholder.missing', { agent: agentLabel })
  }

  return t('ai.panel.placeholder.ready', { agent: agentLabel })
}

function permissionModeTooltip(
  mode: AiAgentPermissionMode,
  t: ReturnType<typeof createTranslator>,
): { label: string } {
  return {
    label: t(mode === 'power_user'
      ? 'ai.permission.powerUser.tooltip'
      : 'ai.permission.safe.tooltip'),
  }
}

function headerStatusText({
  agentLabel,
  agentReadiness,
  modeLabel,
  t,
}: {
  agentLabel: string
  agentReadiness: AiAgentReadiness
  modeLabel: string
  t: ReturnType<typeof createTranslator>
}): string {
  if (agentReadiness === 'checking') return t('ai.panel.status.checking')
  if (agentReadiness === 'missing') return t('ai.panel.status.missing', { agent: agentLabel })
  return t('ai.panel.status.ready', { agent: agentLabel, mode: modeLabel })
}

function AiPanelEmptyState({
  agentLabel,
  agentReadiness,
  hasContext,
  locale = 'en',
}: Pick<AiPanelMessageHistoryProps, 'agentLabel' | 'agentReadiness' | 'hasContext' | 'locale'>) {
  const t = createTranslator(locale)

  if (agentReadiness === 'checking') {
    return (
      <div
        className="flex flex-col items-center justify-center text-center text-muted-foreground"
        style={{ paddingTop: 40 }}
      >
        <Robot size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
        <p style={{ fontSize: 13, margin: '0 0 4px' }}>
          {t('ai.panel.empty.checkingTitle')}
        </p>
        <p style={{ fontSize: 11, margin: 0, opacity: 0.6 }}>
          {t('ai.panel.empty.checkingDescription')}
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
          {t('ai.panel.empty.missingTitle', { agent: agentLabel })}
        </p>
        <p style={{ fontSize: 11, margin: 0, opacity: 0.6 }}>
          {t('ai.panel.empty.missingDescription')}
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
          ? t('ai.panel.empty.withContextTitle', { agent: agentLabel })
          : t('ai.panel.empty.noContextTitle', { agent: agentLabel })
        }
      </p>
      <p style={{ fontSize: 11, margin: 0, opacity: 0.6 }}>
        {hasContext
          ? t('ai.panel.empty.withContextDescription')
          : t('ai.panel.empty.noContextDescription')
        }
      </p>
    </div>
  )
}

export function AiPanelHeader({
  agentLabel,
  agentReadiness,
  locale = 'en',
  permissionMode,
  permissionModeDisabled,
  onPermissionModeChange,
  onClose,
  onNewChat,
}: AiPanelHeaderProps) {
  const t = createTranslator(locale)
  const modeLabel = aiAgentPermissionModeLabels(permissionMode, locale).short

  return (
    <div
      className="flex shrink-0 flex-col border-b border-border"
      style={{ padding: '8px 12px', gap: 8 }}
    >
      <div className="flex items-center" style={{ gap: 8 }}>
        <Robot size={16} className="shrink-0 text-muted-foreground" />
        <div className="flex flex-1 flex-col overflow-hidden">
          <span className="text-muted-foreground" style={{ fontSize: 13, fontWeight: 600 }}>
            {t('ai.panel.title')}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {headerStatusText({ agentLabel, agentReadiness, modeLabel, t })}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onNewChat}
          aria-label={t('ai.panel.newChat')}
          title={t('ai.panel.newChat')}
        >
          <Plus size={16} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label={t('ai.panel.close')}
          title={t('ai.panel.close')}
        >
          <X size={16} />
        </Button>
      </div>
      <AiPermissionModeToggle
        value={permissionMode}
        locale={locale}
        disabled={permissionModeDisabled}
        onChange={onPermissionModeChange}
      />
    </div>
  )
}

function AiPermissionModeToggle({
  value,
  locale = 'en',
  disabled,
  onChange,
}: {
  value: AiAgentPermissionMode
  locale?: AppLocale
  disabled: boolean
  onChange: (mode: AiAgentPermissionMode) => void
}) {
  const t = createTranslator(locale)

  return (
    <TooltipProvider>
      <div
        className="inline-flex w-full rounded-md border border-border bg-muted p-1"
        role="radiogroup"
        aria-label={t('ai.permission.modeAria')}
        data-testid="ai-permission-mode-toggle"
      >
        {(['safe', 'power_user'] as const).map((mode) => {
          const selected = value === mode
          return (
            <ActionTooltip
              key={mode}
              copy={permissionModeTooltip(mode, t)}
              side="bottom"
              contentTestId="ai-permission-mode-tooltip"
            >
              <Button
                type="button"
                size="sm"
                variant="ghost"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                className={
                  selected
                    ? 'h-7 flex-1 border border-border bg-background text-foreground shadow-xs hover:bg-background'
                    : 'h-7 flex-1 text-muted-foreground hover:text-foreground'
                }
                onClick={() => onChange(mode)}
              >
                {aiAgentPermissionModeLabels(mode, locale).control}
              </Button>
            </ActionTooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

export function AiPanelContextBar({ activeEntry, linkedCount, locale = 'en' }: AiPanelContextBarProps) {
  const t = createTranslator(locale)

  return (
    <div
      className="flex shrink-0 items-center border-b border-border text-muted-foreground"
      style={{ padding: '6px 12px', gap: 6, fontSize: 11 }}
      data-testid="context-bar"
    >
      <Link size={12} className="shrink-0" />
      <span className="truncate" style={{ fontWeight: 500 }}>{activeEntry.title}</span>
      {linkedCount > 0 && (
        <span style={{ opacity: 0.6 }}>{t('ai.panel.linkedCount', { count: linkedCount })}</span>
      )}
    </div>
  )
}

export function AiPanelMessageHistory({
  agentLabel,
  agentReadiness,
  locale = 'en',
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
          locale={locale}
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
  locale = 'en',
  input,
  inputRef,
  isActive,
  onChange,
  onSend,
  onUnsupportedAiPaste,
}: AiPanelComposerProps) {
  const t = createTranslator(locale)
  const composerDisabled = isActive || agentReadiness !== 'ready'
  const canSend = !composerDisabled && input.trim().length > 0
  const placeholder = getComposerPlaceholder(agentLabel, agentReadiness, t)
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
          aria-label={t('ai.panel.send')}
          title={t('ai.panel.send')}
          data-testid="agent-send"
        >
          <PaperPlaneRight size={16} />
        </Button>
      </div>
    </div>
  )
}
