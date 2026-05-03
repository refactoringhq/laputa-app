import { useState, useCallback, useEffect, useRef } from 'react'
import { CaretRight, CaretDown, Brain, ArrowCounterClockwise } from '@phosphor-icons/react'
import { AiActionCard, type AiActionStatus } from './AiActionCard'
import { MarkdownContent } from './MarkdownContent'
import type { NoteReference } from '../utils/ai-context'
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
  reasoning?: string
  reasoningDone?: boolean
  actions: AiAction[]
  response?: string
  isStreaming?: boolean
  onOpenNote?: (path: string) => void
  onNavigateWikilink?: (target: string) => void
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
  const color = getTypeColor(reference.type)
  const lightColor = getTypeLightColor(reference.type)
  return (
    <button
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
        style={{
          background: 'var(--muted)',
          color: 'var(--foreground)',
          borderRadius: '12px 12px 2px 12px',
          maxWidth: '85%',
          padding: '8px 12px',
          fontSize: 13,
          lineHeight: 1.5,
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

function ReasoningBlock({ text, expanded, onToggle }: {
  text: string; expanded: boolean; onToggle: () => void
}) {
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (expanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [expanded, text])

  return (
    <div style={{ marginBottom: 8 }}>
      <button
        className="flex items-center gap-1.5 w-full border-none bg-transparent cursor-pointer p-0 text-muted-foreground hover:text-foreground transition-colors"
        style={{ fontSize: 12, padding: '4px 0' }}
        onClick={onToggle}
        data-testid="reasoning-toggle"
      >
        <Brain size={14} />
        <span>Reasoning</span>
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

function ResponseBlock({ text, onNavigateWikilink }: { text: string; onNavigateWikilink?: (target: string) => void }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <MarkdownContent content={text} onWikilinkClick={onNavigateWikilink} />
      <button
        className="flex items-center gap-1 border-none bg-transparent p-0 text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
        style={{ fontSize: 11, marginTop: 4 }}
        data-testid="undo-button"
      >
        <ArrowCounterClockwise size={12} />
        <span>Undo</span>
      </button>
    </div>
  )
}

function StreamingIndicator() {
  return (
    <div className="flex items-center gap-2 text-muted-foreground" style={{ fontSize: 12, padding: '4px 0' }}>
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

function ConversationMessage({ userMessage, references, reasoning, reasoningDone, actions, response, isStreaming, onOpenNote, onNavigateWikilink }: AiMessageProps) {
  // Manual override: null = follow auto behavior, true/false = user forced
  const [userOverride, setUserOverride] = useState(false)
  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set())

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
    <div data-testid="ai-message" style={{ marginBottom: 16 }}>
      <UserBubble content={userMessage} references={references} onOpenNote={onOpenNote} />
      {reasoning && (
        <ReasoningBlock
          text={reasoning}
          expanded={reasoningExpanded}
          onToggle={() => setUserOverride(prev => !prev)}
        />
      )}
      {actions.length > 0 && (
        <ActionCardsList
          actions={actions}
          onOpenNote={onOpenNote}
          expandedIds={expandedActions}
          onToggleExpand={toggleAction}
        />
      )}
      {response && <ResponseBlock text={response} onNavigateWikilink={onNavigateWikilink} />}
      {isStreaming && !response && <StreamingIndicator />}
    </div>
  )
}
