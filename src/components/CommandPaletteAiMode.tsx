import { Sparkle } from '@phosphor-icons/react'
import type { VaultEntry } from '../types'
import type { NoteReference } from '../utils/ai-context'
import { InlineWikilinkInput } from './InlineWikilinkInput'

interface CommandPaletteAiModeProps {
  entries: VaultEntry[]
  value: string
  claudeCodeReady: boolean
  aiAgentReady?: boolean
  aiAgentLabel?: string
  inputRef?: React.RefObject<HTMLDivElement | null>
  onChange: (value: string) => void
  onSubmit: (text: string, references: NoteReference[]) => void
}

const stripLeadingSpace = (value: string): string => (
  value.startsWith(' ') ? value.slice(1) : value
)

function aiPaletteHeader(aiAgentLabel: string) {
  return (
    <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
      <Sparkle size={12} weight="fill" />
      <span>Ask {aiAgentLabel}</span>
    </div>
  )
}

function aiPaletteEmptyState(aiAgentLabel: string, ready: boolean, value: string) {
  if (!ready) {
    return <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">{aiAgentLabel} is not available on this machine.</div>
  }
  return (
    <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
      <div className="mb-1 font-medium text-foreground">Ask {aiAgentLabel}</div>
      <div>{value.trim() ? 'Type [[ to insert a note reference inline.' : 'Type your prompt after the leading space.'}</div>
    </div>
  )
}

function aiPaletteFooter(aiAgentLabel: string) {
  return (
    <div className="flex items-center gap-4 border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground">
      <span>{aiAgentLabel} mode</span><span>↵ send</span><span>esc close</span>
    </div>
  )
}

export function CommandPaletteAiMode(options: CommandPaletteAiModeProps) {
  const {
    entries,
    value,
    claudeCodeReady,
    aiAgentReady,
    aiAgentLabel = 'Claude Code',
    inputRef,
    onChange,
    onSubmit,
  } = options
  const resolvedAiAgentReady = aiAgentReady ?? claudeCodeReady

  return (
    <InlineWikilinkInput
      entries={entries}
      value={value}
      inputRef={inputRef}
      onChange={onChange}
      onSubmit={(text, references) => onSubmit(stripLeadingSpace(text), references)}
      submitOnEmpty={true}
      placeholder={`Ask ${aiAgentLabel}...`}
      dataTestId="command-palette-ai-input"
      editorClassName="border-none px-0 py-0 text-[15px]"
      suggestionListVariant="palette"
      paletteHeader={aiPaletteHeader(aiAgentLabel)}
      paletteEmptyState={aiPaletteEmptyState(aiAgentLabel, resolvedAiAgentReady, value)}
      paletteFooter={aiPaletteFooter(aiAgentLabel)}
    />
  )
}
