import { useState, useCallback, useEffect, useRef } from 'react'
import { CaretRight, CaretDown, Brain, ArrowsClockwise, Copy, GitBranch, Terminal } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { AiActionCard, type AiActionStatus } from './AiActionCard'
import { MarkdownContent } from './MarkdownContent'
import { translate, type AppLocale } from '../lib/i18n'
import type { NoteReference } from '../utils/ai-context'
import { writeClipboardText } from '../utils/clipboardText'
import { getTypeColor, getTypeLightColor } from '../utils/typeColors'

export interface AiAction {
  tool: string
  toolId: string
  label: string
  path?: string
  status: AiActionStatus
  input?: string
  output?: string
}

export interface AiMessageProps {
  userMessage: string
  references?: NoteReference[]
  localMarker?: string
  locale?: AppLocale
  messageId?: string
  reasoning?: string
  reasoningDone?: boolean
  actions: AiAction[]
  response?: string
  isStreaming?: boolean
  onFork?: (messageId: string) => void
  onOpenNote?: (path: string) => void
  onNavigateWikilink?: (target: string) => void
  onRegenerate?: (messageId: string) => void
}

function LocalMarker({ text }: { text: string }) {
  return (
    <div
      className="mx-auto text-center text-muted-foreground"
      style={{ fontSize: 11, margin: '8px 0 16px', maxWidth: '85%' }}
      data-testid="ai-local-marker"
    >
      {text}
    </div>
  )
}

function ReferencePill({ reference, onClick }: {
  reference: NoteReference
  onClick?: (path: string) => void
}) {
  const type = reference.type ?? null
  const color = getTypeColor(type)
  const lightColor = getTypeLightColor(type)
  return (
    <button type="button"
      className="inline-flex items-center border-none cursor-pointer transition-opacity hover:opacity-80"
      style={{
        background: lightColor,
        color,
        borderRadius: 9999,
        padding: '1px 8px',
        fontSize: 11,
        fontWeight: 500,
        fontFamily: 'inherit',
        lineHeight: 1.4,
      }}
      onClick={() => onClick?.(reference.path)}
      data-testid="message-reference-pill"
    >
      {reference.title}
    </button>
  )
}

function UserBubble({ content, references, onOpenNote }: {
  content: string
  references?: NoteReference[]
  onOpenNote?: (path: string) => void
}) {
  return (
    <div className="flex justify-end" style={{ marginBottom: 8 }}>
      <div
        className="min-w-0 max-w-[85%] overflow-hidden"
        style={{
          background: 'var(--state-hover)',
          color: 'var(--foreground)',
          borderRadius: '12px 12px 2px 12px',
          maxWidth: '85%',
          padding: '8px 12px',
          fontSize: 13,
          lineHeight: 1.5,
          overflowWrap: 'anywhere',
        }}
      >
        {references && references.length > 0 && (
          <div className="flex flex-wrap gap-1" style={{ marginBottom: 4 }}>
            {references.map(ref => (
              <ReferencePill key={ref.path} reference={ref} onClick={onOpenNote} />
            ))}
          </div>
        )}
        {content}
      </div>
    </div>
  )
}

function ReasoningBlock({ locale, text, expanded, onToggle }: {
  locale: AppLocale; text: string; expanded: boolean; onToggle: () => void
}) {
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void text
    if (expanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [expanded, text])

  return (
    <div style={{ marginBottom: 8 }}>
      <button type="button"
        className="flex items-center gap-1.5 w-full border-none bg-transparent cursor-pointer p-0 text-muted-foreground hover:text-foreground transition-colors"
        style={{ fontSize: 12, padding: '4px 0' }}
        onClick={onToggle}
        data-testid="reasoning-toggle"
      >
        <Brain size={14} />
        <span>{translate(locale, 'ai.message.reasoning')}</span>
        {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
      </button>
      {expanded && (
        <div
          ref={contentRef}
          className="text-muted-foreground"
          style={{ fontSize: 12, lineHeight: 1.5, padding: '4px 0 4px 20px', maxHeight: 200, overflowY: 'auto' }}
          data-testid="reasoning-content"
        >
          {text}
        </div>
      )}
    </div>
  )
}

function ActionCardsList({ actions, onOpenNote, expandedIds, onToggleExpand }: {
  actions: AiAction[]
  onOpenNote?: (path: string) => void
  expandedIds: Set<string>
  onToggleExpand: (toolId: string) => void
}) {
  return (
    <div className="flex flex-col gap-1" style={{ marginBottom: 8 }}>
      {actions.map((action) => (
        <AiActionCard
          key={action.toolId}
          tool={action.tool}
          label={action.label}
          path={action.path}
          status={action.status}
          input={action.input}
          output={action.output}
          expanded={expandedIds.has(action.toolId)}
          onToggle={() => onToggleExpand(action.toolId)}
          onOpenNote={onOpenNote}
        />
      ))}
    </div>
  )
}

function ToolUseBlock({
  actions,
  expanded,
  expandedActionIds,
  locale,
  onOpenNote,
  onToggle,
  onToggleAction,
}: {
  actions: AiAction[]
  expanded: boolean
  expandedActionIds: Set<string>
  locale: AppLocale
  onOpenNote?: (path: string) => void
  onToggle: () => void
  onToggleAction: (toolId: string) => void
}) {
  const pending = actions.some((action) => action.status === 'pending')

  return (
    <div style={{ marginBottom: 8 }}>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-muted-foreground transition-colors hover:text-foreground"
        style={{ fontSize: 12, padding: '4px 0' }}
        aria-expanded={expanded}
        onClick={onToggle}
        data-testid="tool-use-toggle"
      >
        <Terminal size={14} />
        <span>{translate(locale, 'ai.message.toolUse')}</span>
        <span
          className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full ${pending ? 'animate-pulse' : ''}`}
          style={{
            background: 'var(--state-hover)',
            color: 'var(--muted-foreground)',
            fontSize: 10,
            fontWeight: 600,
            padding: '0 5px',
          }}
          data-pending={pending || undefined}
          data-testid="tool-use-count"
        >
          {actions.length}
        </span>
        {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
      </button>
      {expanded && (
        <div data-testid="tool-use-content" style={{ marginTop: 4 }}>
          <ActionCardsList
            actions={actions}
            onOpenNote={onOpenNote}
            expandedIds={expandedActionIds}
            onToggleExpand={onToggleAction}
          />
        </div>
      )}
    </div>
  )
}

function ResponseActions({
  locale,
  messageId,
  onCopy,
  onFork,
  onRegenerate,
}: {
  locale: AppLocale
  messageId?: string
  onCopy: () => void
  onFork?: (messageId: string) => void
  onRegenerate?: (messageId: string) => void
}) {
  const regenerateDisabled = !messageId || !onRegenerate
  const forkDisabled = !messageId || !onFork

  return (
    <div
      className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/ai-response:opacity-100 group-focus-within/ai-response:opacity-100"
      data-testid="ai-message-actions"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="h-6 w-6 rounded-md p-0 text-muted-foreground hover:text-foreground"
        disabled={regenerateDisabled}
        aria-label={translate(locale, 'ai.message.regenerate')}
        title={translate(locale, 'ai.message.regenerate')}
        onClick={() => messageId && onRegenerate?.(messageId)}
        data-testid="ai-message-regenerate"
      >
        <ArrowsClockwise size={14} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="h-6 w-6 rounded-md p-0 text-muted-foreground hover:text-foreground"
        aria-label={translate(locale, 'ai.message.copy')}
        title={translate(locale, 'ai.message.copy')}
        onClick={onCopy}
        data-testid="ai-message-copy"
      >
        <Copy size={14} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="h-6 w-6 rounded-md p-0 text-muted-foreground hover:text-foreground"
        disabled={forkDisabled}
        aria-label={translate(locale, 'ai.message.fork')}
        title={translate(locale, 'ai.message.fork')}
        onClick={() => messageId && onFork?.(messageId)}
        data-testid="ai-message-fork"
      >
        <GitBranch size={14} />
      </Button>
    </div>
  )
}

function ResponseBlock({
  locale,
  messageId,
  onFork,
  onNavigateWikilink,
  onRegenerate,
  text,
}: {
  locale: AppLocale
  messageId?: string
  onFork?: (messageId: string) => void
  onNavigateWikilink?: (target: string) => void
  onRegenerate?: (messageId: string) => void
  text: string
}) {
  const handleCopy = useCallback(() => {
    void writeClipboardText(text).catch((error) => {
      console.warn('[ai] Failed to copy assistant message:', error)
    })
  }, [text])

  return (
    <div
      className="group/ai-response min-w-0 max-w-full overflow-hidden"
      style={{ marginBottom: 4 }}
      data-testid="ai-response-block"
    >
      <MarkdownContent content={text} onWikilinkClick={onNavigateWikilink} />
      <ResponseActions
        locale={locale}
        messageId={messageId}
        onCopy={handleCopy}
        onFork={onFork}
        onRegenerate={onRegenerate}
      />
    </div>
  )
}

function StreamingIndicator() {
  return (
    <div className="flex items-center gap-2 text-muted-foreground" style={{ fontSize: 12, marginTop: 8, padding: 0 }}>
      <div className="flex gap-1">
        <span className="typing-dot" />
        <span className="typing-dot" style={{ animationDelay: '0.2s' }} />
        <span className="typing-dot" style={{ animationDelay: '0.4s' }} />
      </div>
    </div>
  )
}

export function AiMessage(props: AiMessageProps) {
  if (props.localMarker) {
    return <LocalMarker text={props.localMarker} />
  }

  return <ConversationMessage {...props} />
}

function ConversationMessage({ userMessage, references, locale = 'en', messageId, reasoning, reasoningDone, actions, response, isStreaming, onFork, onOpenNote, onNavigateWikilink, onRegenerate }: AiMessageProps) {
  // Manual override: null = follow auto behavior, true/false = user forced
  const [userOverride, setUserOverride] = useState(false)
  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set())
  const [toolUseExpanded, setToolUseExpanded] = useState(false)

  // Auto: expanded while reasoning streams, collapsed once done
  // User can manually toggle to override the auto state
  const autoExpanded = !reasoningDone
  const reasoningExpanded = userOverride ? !autoExpanded : autoExpanded

  const toggleAction = useCallback((toolId: string) => {
    setExpandedActions(prev => {
      const next = new Set(prev)
      if (next.has(toolId)) next.delete(toolId)
      else next.add(toolId)
      return next
    })
  }, [])

  return (
    <div className="min-w-0 max-w-full" data-testid="ai-message" style={{ marginBottom: 16 }}>
      <UserBubble content={userMessage} references={references} onOpenNote={onOpenNote} />
      {reasoning && (
        <ReasoningBlock
          locale={locale}
          text={reasoning}
          expanded={reasoningExpanded}
          onToggle={() => setUserOverride(prev => !prev)}
        />
      )}
      {actions.length > 0 && (
        <ToolUseBlock
          actions={actions}
          expanded={toolUseExpanded}
          expandedActionIds={expandedActions}
          locale={locale}
          onOpenNote={onOpenNote}
          onToggle={() => setToolUseExpanded((current) => !current)}
          onToggleAction={toggleAction}
        />
      )}
      {response && (
        <ResponseBlock
          locale={locale}
          messageId={messageId}
          text={response}
          onFork={onFork}
          onNavigateWikilink={onNavigateWikilink}
          onRegenerate={onRegenerate}
        />
      )}
      {isStreaming && !response && <StreamingIndicator />}
    </div>
  )
}
