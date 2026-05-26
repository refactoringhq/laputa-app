import { type KeyboardEvent, type ReactNode, useCallback } from 'react'
import {
  PencilSimple, MagnifyingGlass, Trash, ChartBar, Eye,
  CircleNotch, CheckCircle, XCircle, CaretRight, CaretDown,
  Terminal, File, FolderOpen, NotePencil,
} from '@phosphor-icons/react'

export type AiActionStatus = 'pending' | 'done' | 'error'

export interface AiActionCardProps {
  tool: string
  label: string
  path?: string
  status: AiActionStatus
  input?: string
  output?: string
  expanded: boolean
  onToggle: () => void
  onOpenNote?: (path: string) => void
}

const MAX_DETAIL_LENGTH = 800
const DEFAULT_ACTION_CARD_BACKGROUND = 'var(--accent-blue-bg)'
const TOOL_BACKGROUND_MAP: Record<string, string> = {
  open_note: 'var(--accent-blue-light)',
}
const TOOL_BACKGROUND_BY_NAME = new Map(Object.entries(TOOL_BACKGROUND_MAP))

type IconRenderer = (size: number) => ReactNode

const TOOL_ICON_MAP: Record<string, IconRenderer> = {
  // Native Claude Code tools
  Bash: (s) => <Terminal size={s} />,
  Write: (s) => <PencilSimple size={s} />,
  Edit: (s) => <NotePencil size={s} />,
  Read: (s) => <File size={s} />,
  Glob: (s) => <FolderOpen size={s} />,
  Grep: (s) => <MagnifyingGlass size={s} />,
  // Tolaria MCP tools
  search_notes: (s) => <MagnifyingGlass size={s} />,
  get_vault_context: (s) => <ChartBar size={s} />,
  get_note: (s) => <File size={s} />,
  open_note: (s) => <Eye size={s} />,
  // Legacy tools (for backward compatibility with existing messages)
  create_note: (s) => <PencilSimple size={s} />,
  delete_note: (s) => <Trash size={s} />,
}
const TOOL_ICON_BY_NAME = new Map(Object.entries(TOOL_ICON_MAP))

const DEFAULT_ICON: IconRenderer = (s) => <PencilSimple size={s} />

function StatusIndicator({ status }: { status: AiActionStatus }) {
  if (status === 'pending') {
    return <CircleNotch size={14} className="ai-spin text-muted-foreground" data-testid="status-pending" />
  }
  if (status === 'done') {
    return <CheckCircle size={14} weight="fill" style={{ color: 'var(--accent-green)' }} data-testid="status-done" />
  }
  return <XCircle size={14} weight="fill" style={{ color: 'var(--destructive)' }} data-testid="status-error" />
}

function truncateText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_DETAIL_LENGTH) return { text, truncated: false }
  return { text: text.slice(0, MAX_DETAIL_LENGTH), truncated: true }
}

function formatInputForDisplay(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function hasActionDetails(input?: string, output?: string): boolean {
  return Boolean(input || output)
}

function resolveDirectOpenPath({
  hasDetails,
  onOpenNote,
  path,
}: Pick<AiActionCardProps, 'onOpenNote' | 'path'> & {
  hasDetails: boolean
}): string | null {
  if (hasDetails || !path || !onOpenNote) return null
  return path
}

function ActionCardHeader({
  expanded,
  hasDetails,
  label,
  onClick,
  onKeyDown,
  renderIcon,
  status,
}: {
  expanded: boolean
  hasDetails: boolean
  label: string
  onClick: () => void
  onKeyDown: (event: KeyboardEvent) => void
  renderIcon: IconRenderer
  status: AiActionStatus
}) {
  const setHeaderRef = useCallback((node: HTMLButtonElement | null) => {
    if (!node) return
    node.setAttribute('role', 'button')
    node.setAttribute('tabindex', '0')
  }, [])

  return (
    <button
      ref={setHeaderRef}
      type="button"
      className="flex w-full items-center gap-2 border-0 bg-transparent text-left"
      style={{ padding: '6px 10px', cursor: 'pointer' }}
      aria-expanded={expanded}
      onClick={onClick}
      onKeyDown={onKeyDown}
      data-testid="action-card-header"
    >
      <span className="shrink-0 text-muted-foreground" style={{ width: 14, display: 'flex' }}>
        <ActionIcon expanded={expanded} hasDetails={hasDetails} renderIcon={renderIcon} />
      </span>
      <span className="flex-1 truncate">{label}</span>
      <StatusIndicator status={status} />
    </button>
  )
}

function ActionIcon({
  expanded,
  hasDetails,
  renderIcon,
}: {
  expanded: boolean
  hasDetails: boolean
  renderIcon: IconRenderer
}) {
  if (!hasDetails) return <>{renderIcon(14)}</>
  return expanded ? <CaretDown size={12} /> : <CaretRight size={12} />
}

function DetailBlock({ label, content, isError }: {
  label: string; content: string; isError?: boolean
}) {
  const { text, truncated } = truncateText(content)
  return (
    <div style={{ marginTop: 6 }}>
      <div
        className="text-muted-foreground"
        style={{ fontSize: 10, fontWeight: 600, marginBottom: 2 }}
      >
        {label}
      </div>
      <pre
        data-testid={`detail-${label.toLowerCase()}`}
        style={{
          fontSize: 11,
          lineHeight: 1.4,
          margin: 0,
          padding: '4px 6px',
          borderRadius: 4,
          background: 'var(--muted)',
          color: isError ? 'var(--destructive)' : 'var(--foreground)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 200,
          overflow: 'auto',
        }}
      >
        {text}{truncated && <span className="text-muted-foreground">{'…'}</span>}
      </pre>
    </div>
  )
}

function ActionCardDetails({
  expanded,
  hasDetails,
  input,
  output,
  status,
}: {
  expanded: boolean
  hasDetails: boolean
  input?: string
  output?: string
  status: AiActionStatus
}) {
  if (!expanded || !hasDetails) return null

  const formattedInput = input ? formatInputForDisplay(input) : undefined
  return (
    <div
      data-testid="action-card-details"
      style={{ padding: '0 10px 8px 10px' }}
    >
      {formattedInput && <DetailBlock label="Input" content={formattedInput} />}
      {output && (
        <DetailBlock label="Output" content={output} isError={status === 'error'} />
      )}
    </div>
  )
}

export function AiActionCard({
  tool, label, path, status, input, output, expanded, onToggle, onOpenNote,
}: AiActionCardProps) {
  const renderIcon = TOOL_ICON_BY_NAME.get(tool) ?? DEFAULT_ICON
  const hasDetails = hasActionDetails(input, output)
  const directOpenPath = resolveDirectOpenPath({ path, onOpenNote, hasDetails })

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onToggle()
    } else if (e.key === 'Escape' && expanded) {
      e.preventDefault()
      onToggle()
    }
  }, [onToggle, expanded])

  const handleClick = useCallback(() => {
    if (directOpenPath && onOpenNote) {
      onOpenNote(directOpenPath)
      return
    }

    onToggle()
  }, [directOpenPath, onOpenNote, onToggle])

  return (
    <div
      data-testid="ai-action-card"
      className="rounded"
      style={{
        fontSize: 12,
        background: TOOL_BACKGROUND_BY_NAME.get(tool) ?? DEFAULT_ACTION_CARD_BACKGROUND,
      }}
    >
      <ActionCardHeader
        expanded={expanded}
        hasDetails={hasDetails}
        label={label}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        renderIcon={renderIcon}
        status={status}
      />
      <ActionCardDetails
        expanded={expanded}
        hasDetails={hasDetails}
        input={input}
        output={output}
        status={status}
      />
    </div>
  )
}
