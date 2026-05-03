import { useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  Cpu,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  RefreshCw,
  Terminal,
} from 'lucide-react'
import { GitDiff, Pulse } from '@phosphor-icons/react'
import { ActionTooltip, type ActionTooltipCopy } from '@/components/ui/action-tooltip'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ClaudeCodeStatus } from '../../hooks/useClaudeCodeStatus'
import type { McpStatus } from '../../hooks/useMcpStatus'
import { translate, type AppLocale, type TranslationKey } from '../../lib/i18n'
import type { GitRemoteStatus, LastCommitInfo, SyncStatus } from '../../types'
import { openExternalUrl } from '../../utils/url'
import { useDismissibleLayer } from './useDismissibleLayer'
import { ICON_STYLE, SEP_STYLE } from './styles'

const SYNC_ICON_MAP: Record<string, typeof RefreshCw> = {
  syncing: Loader2,
  conflict: AlertTriangle,
  pull_required: ArrowDown,
}

const SYNC_LABEL_KEYS: Partial<Record<SyncStatus, TranslationKey>> = {
  syncing: 'status.sync.syncing',
  conflict: 'status.sync.conflict',
  error: 'status.sync.failed',
  pull_required: 'status.sync.pullRequired',
}

const SYNC_COLORS: Record<string, string> = {
  conflict: 'var(--accent-orange)',
  error: 'var(--muted-foreground)',
  pull_required: 'var(--accent-orange)',
}

const MCP_TOOLTIP_KEYS: Partial<Record<McpStatus, TranslationKey>> = {
  not_installed: 'status.mcp.notConnected',
}

const CLAUDE_INSTALL_URL = 'https://docs.anthropic.com/en/docs/claude-code'

function formatElapsedSync(locale: AppLocale, lastSyncTime: number | null): string {
  if (!lastSyncTime) return translate(locale, 'status.sync.notSynced')
  const secs = Math.round((Date.now() - lastSyncTime) / 1000)
  return secs < 60
    ? translate(locale, 'status.sync.justNow')
    : translate(locale, 'status.sync.minutesAgo', { minutes: Math.floor(secs / 60) })
}

function formatSyncLabel(locale: AppLocale, status: SyncStatus, lastSyncTime: number | null): string {
  const labelKey = SYNC_LABEL_KEYS[status]
  return labelKey ? translate(locale, labelKey) : formatElapsedSync(locale, lastSyncTime)
}

function syncIconColor(status: SyncStatus): string {
  return SYNC_COLORS[status] ?? 'var(--accent-green)'
}

function syncBadgeTooltipCopy(locale: AppLocale, status: SyncStatus): ActionTooltipCopy {
  if (status === 'conflict') return { label: translate(locale, 'status.sync.resolveConflicts') }
  if (status === 'syncing') return { label: translate(locale, 'status.sync.inProgress') }
  if (status === 'pull_required') return { label: translate(locale, 'status.sync.pullAndPush') }
  if (status === 'error') return { label: translate(locale, 'status.sync.retry') }
  return { label: translate(locale, 'status.sync.now') }
}

function syncStatusText(locale: AppLocale, status: SyncStatus): string {
  if (status === 'idle') return translate(locale, 'status.sync.synced')
  if (status === 'pull_required') return translate(locale, 'status.sync.pullRequired')
  if (status === 'conflict') return translate(locale, 'status.sync.conflicts')
  if (status === 'error') return translate(locale, 'status.sync.error')
  if (status === 'syncing') return translate(locale, 'status.sync.syncing')
  return status
}

function hasRemote(remoteStatus: GitRemoteStatus | null): boolean {
  return remoteStatus?.hasRemote ?? false
}

function isRemoteMissing(remoteStatus: GitRemoteStatus | null | undefined): boolean {
  return remoteStatus?.hasRemote === false
}

function commitButtonTooltipCopy(locale: AppLocale, remoteStatus: GitRemoteStatus | null | undefined): ActionTooltipCopy {
  return {
    label: isRemoteMissing(remoteStatus)
      ? translate(locale, 'status.commit.local')
      : translate(locale, 'status.commit.push'),
  }
}

function getMcpBadgeConfig(locale: AppLocale, status: McpStatus, onInstall?: () => void) {
  if (status === 'installed' || status === 'checking') return null
  const clickable = status === 'not_installed' && Boolean(onInstall)
  return {
    clickable,
    tooltip: translate(locale, MCP_TOOLTIP_KEYS[status] ?? 'status.mcp.unknown'),
    onClick: clickable ? onInstall : undefined,
  }
}

function getClaudeCodeBadgeConfig(locale: AppLocale, status: ClaudeCodeStatus, version?: string | null) {
  if (status === 'checking') return null
  const missing = status === 'missing'
  const label = translate(locale, missing ? 'status.claude.missing' : 'status.claude.label')
  return {
    missing,
    label,
    tooltip: missing ? translate(locale, 'status.claude.install') : `${label}${version ? ` ${version}` : ''}`,
    onActivate: missing ? () => openExternalUrl(CLAUDE_INSTALL_URL) : undefined,
  }
}

function handleStatusBarActionKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  onClick?: () => void,
) {
  if (!onClick) return
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  onClick()
}

function StatusBarAction({
  copy,
  children,
  onClick,
  testId,
  ariaLabel,
  className,
  style,
  disabled = false,
  compact = false,
}: {
  copy: ActionTooltipCopy
  children: ReactNode
  onClick?: () => void
  testId?: string
  ariaLabel?: string
  className?: string
  style?: CSSProperties
  disabled?: boolean
  compact?: boolean
}) {
  return (
    <ActionTooltip copy={copy} side="top">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          'h-auto gap-1 rounded-sm px-1 py-0.5 text-[12px] font-medium text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground',
          compact && 'h-6 gap-0.5 px-0.5',
          disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground',
          className,
        )}
        style={style}
        onClick={disabled ? undefined : onClick}
        onKeyDown={(event) => handleStatusBarActionKeyDown(event, disabled ? undefined : onClick)}
        aria-label={ariaLabel ?? copy.label}
        aria-disabled={disabled || undefined}
        data-testid={testId}
      >
        {children}
      </Button>
    </ActionTooltip>
  )
}

function StatusBarSeparator({ show = true }: { show?: boolean }) {
  if (!show) return null
  return <span style={SEP_STYLE}>|</span>
}

function CompactStatusActionBadge({
  showSeparator,
  copyLabel,
  onClick,
  testId,
  className,
  compact,
  icon,
  label,
  trailingWarning = false,
}: {
  showSeparator: boolean
  copyLabel: string
  onClick?: () => void
  testId: string
  className?: string
  compact: boolean
  icon: ReactNode
  label: ReactNode
  trailingWarning?: boolean
}) {
  return (
    <>
      <StatusBarSeparator show={showSeparator} />
      <StatusBarAction
        copy={{ label: copyLabel }}
        onClick={onClick}
        testId={testId}
        className={className}
        compact={compact}
      >
        <span style={ICON_STYLE}>
          {icon}
          {compact ? null : label}
          {trailingWarning && <AlertTriangle size={10} style={{ marginLeft: 2 }} />}
        </span>
      </StatusBarAction>
    </>
  )
}

type RemoteSummaryState =
  | { kind: 'missing' }
  | { kind: 'inSync' }
  | { kind: 'diverged'; ahead: number; behind: number }

function getRemoteSummaryState(remoteStatus: GitRemoteStatus | null): RemoteSummaryState {
  if (!hasRemote(remoteStatus)) return { kind: 'missing' }

  const ahead = remoteStatus?.ahead ?? 0
  const behind = remoteStatus?.behind ?? 0
  return ahead === 0 && behind === 0
    ? { kind: 'inSync' }
    : { kind: 'diverged', ahead, behind }
}

function RemoteSummaryLine({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 6, color: 'var(--muted-foreground)' }}>
      {children}
    </div>
  )
}

function RemoteDivergenceItem({
  count,
  direction,
  locale,
}: {
  count: number
  direction: 'ahead' | 'behind'
  locale: AppLocale
}) {
  if (count <= 0) return null

  const arrow = direction === 'ahead' ? '↑' : '↓'
  const titleKey = direction === 'ahead' ? 'status.remote.aheadTitle' : 'status.remote.behindTitle'
  const labelKey = direction === 'ahead' ? 'status.remote.ahead' : 'status.remote.behind'
  const style = direction === 'behind' ? { color: 'var(--accent-orange)' } : undefined

  return (
    <span title={translate(locale, titleKey, { count, plural: count > 1 ? 's' : '' })} style={style}>
      {arrow} {translate(locale, labelKey, { count })}
    </span>
  )
}

interface StatusWarningRenderConfig {
  copyLabel: string
  onClick?: () => void
  testId: string
  className?: string
  icon: ReactNode
  label: ReactNode
  trailingWarning?: boolean
}

type StatusWarningBadgeProps = {
  showSeparator: boolean
  compact: boolean
  locale: AppLocale
} & (
  | { kind: 'conflict'; count: number; onClick?: () => void }
  | { kind: 'missingGit'; onClick?: () => void }
  | { kind: 'mcp'; status: McpStatus; onInstall?: () => void }
  | { kind: 'claude'; status: ClaudeCodeStatus; version?: string | null }
)

interface StatusBadgeDisplayOptions {
  showSeparator?: boolean
  compact?: boolean
  locale?: AppLocale
}

type ConflictBadgeProps = StatusBadgeDisplayOptions & {
  count: number
  onClick?: () => void
}

type MissingGitBadgeProps = StatusBadgeDisplayOptions & {
  onClick?: () => void
}

type McpBadgeProps = StatusBadgeDisplayOptions & {
  status: McpStatus
  onInstall?: () => void
}

type ClaudeCodeBadgeProps = StatusBadgeDisplayOptions & {
  status: ClaudeCodeStatus
  version?: string | null
}

function withStatusBadgeDefaults({
  showSeparator = true,
  compact = false,
  locale = 'en',
}: StatusBadgeDisplayOptions) {
  return { showSeparator, compact, locale }
}

function getStatusWarningBadgeConfig(props: StatusWarningBadgeProps): StatusWarningRenderConfig | null {
  switch (props.kind) {
    case 'conflict':
      return {
        copyLabel: translate(props.locale, 'status.sync.resolveConflicts'),
        onClick: props.onClick,
        testId: 'status-conflict-count',
        className: 'text-[var(--destructive)]',
        icon: <AlertTriangle size={13} />,
        label: translate(props.locale, 'status.conflict.count', { count: props.count, plural: props.count > 1 ? 's' : '' }),
      }
    case 'missingGit':
      return {
        copyLabel: translate(props.locale, 'status.git.disabledTooltip'),
        onClick: props.onClick,
        testId: 'status-missing-git',
        className: 'text-[var(--accent-orange)]',
        icon: <GitBranch size={13} />,
        label: translate(props.locale, 'status.git.disabled'),
        trailingWarning: true,
      }
    case 'mcp': {
      const config = getMcpBadgeConfig(props.locale, props.status, props.onInstall)
      return config && {
        copyLabel: config.tooltip,
        onClick: config.onClick,
        testId: 'status-mcp',
        className: 'text-[var(--accent-orange)]',
        icon: <Cpu size={13} />,
        label: 'MCP',
        trailingWarning: true,
      }
    }
    case 'claude': {
      const config = getClaudeCodeBadgeConfig(props.locale, props.status, props.version)
      return config && {
        copyLabel: config.tooltip,
        onClick: config.onActivate,
        testId: 'status-claude-code',
        className: config.missing ? 'text-[var(--accent-orange)]' : undefined,
        icon: <Terminal size={13} />,
        label: config.label,
        trailingWarning: config.missing,
      }
    }
  }
}

function StatusWarningBadge(props: StatusWarningBadgeProps) {
  const config = getStatusWarningBadgeConfig(props)
  if (!config) return null

  return (
    <CompactStatusActionBadge
      showSeparator={props.showSeparator}
      compact={props.compact}
      {...config}
    />
  )
}

function RemoteStatusSummary({ remoteStatus, locale = 'en' }: { remoteStatus: GitRemoteStatus | null; locale?: AppLocale }) {
  const state = getRemoteSummaryState(remoteStatus)

  if (state.kind === 'missing') {
    return <div style={{ color: 'var(--muted-foreground)', marginBottom: 6 }}>{translate(locale, 'status.remote.noneConfigured')}</div>
  }

  if (state.kind === 'inSync') {
    return <RemoteSummaryLine>{translate(locale, 'status.remote.inSync')}</RemoteSummaryLine>
  }

  return (
    <RemoteSummaryLine>
      <RemoteDivergenceItem count={state.ahead} direction="ahead" locale={locale} />
      <RemoteDivergenceItem count={state.behind} direction="behind" locale={locale} />
    </RemoteSummaryLine>
  )
}

function PullAction({
  remoteStatus,
  locale = 'en',
  onPull,
  onClose,
}: {
  remoteStatus: GitRemoteStatus | null
  locale?: AppLocale
  onPull?: () => void
  onClose: () => void
}) {
  if (!hasRemote(remoteStatus)) return null

  return (
    <div style={{ display: 'flex', gap: 4, marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
      <button
        onClick={() => {
          onPull?.()
          onClose()
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 8px',
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 4,
          fontSize: 11,
          color: 'var(--foreground)',
          cursor: 'pointer',
        }}
        onMouseEnter={(event) => { event.currentTarget.style.background = 'var(--hover)' }}
        onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent' }}
        data-testid="git-status-pull-btn"
      >
        <ArrowDown size={11} />{translate(locale, 'status.sync.pull')}
      </button>
    </div>
  )
}

function GitStatusPopup({
  status,
  remoteStatus,
  locale = 'en',
  onPull,
  onClose,
}: {
  status: SyncStatus
  remoteStatus: GitRemoteStatus | null
  locale?: AppLocale
  onPull?: () => void
  onClose: () => void
}) {
  return (
    <div
      data-testid="git-status-popup"
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        marginBottom: 4,
        background: 'var(--sidebar)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: 8,
        minWidth: 220,
        boxShadow: '0 4px 12px var(--shadow-dialog)',
        zIndex: 1000,
        fontSize: 12,
        color: 'var(--foreground)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <GitBranch size={13} style={{ color: 'var(--muted-foreground)' }} />
        <span style={{ fontWeight: 500 }}>{remoteStatus?.branch || '—'}</span>
      </div>
      <RemoteStatusSummary remoteStatus={remoteStatus} locale={locale} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, color: 'var(--muted-foreground)' }}>
        {translate(locale, 'status.sync.status', { status: syncStatusText(locale, status) })}
      </div>
      <PullAction remoteStatus={remoteStatus} locale={locale} onPull={onPull} onClose={onClose} />
    </div>
  )
}

export function CommitBadge({ info, locale = 'en' }: { info: LastCommitInfo; locale?: AppLocale }) {
  const commitUrl = info.commitUrl

  if (commitUrl) {
    return (
      <span
        role="button"
        onClick={() => openExternalUrl(commitUrl)}
        style={{ ...ICON_STYLE, color: 'var(--muted-foreground)', textDecoration: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 3 }}
        title={translate(locale, 'status.commit.openOnGitHub', { hash: info.shortHash })}
        data-testid="status-commit-link"
        onMouseEnter={(event) => { event.currentTarget.style.color = 'var(--foreground)' }}
        onMouseLeave={(event) => { event.currentTarget.style.color = 'var(--muted-foreground)' }}
      >
        <GitCommitHorizontal size={13} />
        {info.shortHash}
      </span>
    )
  }

  return (
    <span style={ICON_STYLE} data-testid="status-commit-hash">
      <GitCommitHorizontal size={13} />
      {info.shortHash}
    </span>
  )
}

export function OfflineBadge({
  isOffline,
  showSeparator = true,
  compact = false,
  locale = 'en',
}: {
  isOffline?: boolean
  showSeparator?: boolean
  compact?: boolean
  locale?: AppLocale
}) {
  if (!isOffline) return null

  return (
    <>
      <StatusBarSeparator show={showSeparator} />
      <span
        style={{
          ...ICON_STYLE,
          color: 'var(--destructive)',
          background: 'var(--feedback-error-bg)',
          borderRadius: 999,
          padding: '2px 6px',
          fontWeight: 600,
        }}
        title={translate(locale, 'status.offline.title')}
        data-testid="status-offline"
      >
        <span aria-hidden="true" style={{ fontSize: 10, lineHeight: 1 }}>
          ●
        </span>
        {compact ? null : translate(locale, 'status.offline.label')}
      </span>
    </>
  )
}

export function VaultReloadingBadge({
  isReloading,
  showSeparator = true,
  compact = false,
  locale = 'en',
}: {
  isReloading?: boolean
  showSeparator?: boolean
  compact?: boolean
  locale?: AppLocale
}) {
  if (!isReloading) return null

  return (
    <>
      <StatusBarSeparator show={showSeparator} />
      <StatusBarAction copy={{ label: translate(locale, 'status.vault.reloadingTooltip') }} testId="status-vault-reloading" compact={compact}>
        <span style={ICON_STYLE}>
          <Loader2 size={13} className="animate-spin" />
          {compact ? null : translate(locale, 'status.vault.reloading')}
        </span>
      </StatusBarAction>
    </>
  )
}

export function NoRemoteBadge({
  remoteStatus,
  onAddRemote,
  showSeparator = true,
  compact = false,
  locale = 'en',
}: {
  remoteStatus?: GitRemoteStatus | null
  onAddRemote?: () => void
  showSeparator?: boolean
  compact?: boolean
  locale?: AppLocale
}) {
  if (!isRemoteMissing(remoteStatus)) return null

  if (onAddRemote) {
    return (
      <>
        <StatusBarSeparator show={showSeparator} />
        <StatusBarAction
          copy={{ label: translate(locale, 'status.remote.add') }}
          onClick={onAddRemote}
          testId="status-no-remote"
          compact={compact}
        >
          <span style={ICON_STYLE}>
            <GitBranch size={12} />
            {compact ? null : translate(locale, 'status.remote.none')}
          </span>
        </StatusBarAction>
      </>
    )
  }

  return (
    <>
      <StatusBarSeparator show={showSeparator} />
      <span
        style={{
          ...ICON_STYLE,
          color: 'var(--muted-foreground)',
          background: 'var(--hover)',
          borderRadius: 999,
          padding: '2px 6px',
          fontWeight: 600,
        }}
        title={translate(locale, 'status.remote.noneDescription')}
        data-testid="status-no-remote"
      >
        <GitBranch size={12} />
        {compact ? null : translate(locale, 'status.remote.none')}
      </span>
    </>
  )
}

export function SyncBadge({
  status,
  lastSyncTime,
  remoteStatus,
  onTriggerSync,
  onPullAndPush,
  onOpenConflictResolver,
  compact = false,
  locale = 'en',
}: {
  status: SyncStatus
  lastSyncTime: number | null
  remoteStatus?: GitRemoteStatus | null
  onTriggerSync?: () => void
  onPullAndPush?: () => void
  onOpenConflictResolver?: () => void
  compact?: boolean
  locale?: AppLocale
}) {
  const [showPopup, setShowPopup] = useState(false)
  const popupRef = useRef<HTMLDivElement>(null)
  const SyncIcon = SYNC_ICON_MAP[status] ?? RefreshCw
  const isSyncing = status === 'syncing'

  useDismissibleLayer(showPopup, popupRef, () => setShowPopup(false))

  const handleClick = () => {
    if (status === 'conflict') {
      onOpenConflictResolver?.()
      return
    }

    if (status === 'pull_required') {
      onPullAndPush?.()
      return
    }

    setShowPopup((value) => !value)
  }

  return (
    <div ref={popupRef} style={{ position: 'relative' }}>
      <StatusBarAction copy={syncBadgeTooltipCopy(locale, status)} onClick={handleClick} testId="status-sync" compact={compact}>
        <span style={ICON_STYLE}>
          <SyncIcon size={13} style={{ color: syncIconColor(status) }} className={isSyncing ? 'animate-spin' : ''} />
          {compact ? null : formatSyncLabel(locale, status, lastSyncTime)}
        </span>
      </StatusBarAction>
      {showPopup && (
        <GitStatusPopup
          status={status}
          remoteStatus={remoteStatus ?? null}
          locale={locale}
          onPull={onTriggerSync}
          onClose={() => setShowPopup(false)}
        />
      )}
    </div>
  )
}

export function ConflictBadge({
  count,
  onClick,
  ...displayOptions
}: ConflictBadgeProps) {
  if (count <= 0) return null

  return (
    <StatusWarningBadge
      kind="conflict"
      count={count}
      onClick={onClick}
      {...withStatusBadgeDefaults(displayOptions)}
    />
  )
}

export function ChangesBadge({
  count,
  onClick,
  showSeparator = true,
  compact = false,
  locale = 'en',
}: {
  count: number
  onClick?: () => void
  showSeparator?: boolean
  compact?: boolean
  locale?: AppLocale
}) {
  if (count <= 0) return null

  return (
    <>
      <StatusBarSeparator show={showSeparator} />
      <StatusBarAction copy={{ label: translate(locale, 'status.changes.view') }} onClick={onClick} testId="status-modified-count" compact={compact}>
        <span style={ICON_STYLE}>
          <GitDiff size={13} style={{ color: 'var(--accent-orange)' }} />
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--accent-orange)',
              color: 'var(--text-inverse)',
              borderRadius: 9,
              padding: '0 5px',
              fontSize: 11,
              fontWeight: 600,
              minWidth: 16,
              lineHeight: '16px',
            }}
          >
            {count}
          </span>
          {compact ? null : translate(locale, 'status.changes.label')}
        </span>
      </StatusBarAction>
    </>
  )
}

export function CommitButton({
  onClick,
  remoteStatus,
  showSeparator = true,
  compact = false,
  locale = 'en',
}: {
  onClick?: () => void
  remoteStatus?: GitRemoteStatus | null
  showSeparator?: boolean
  compact?: boolean
  locale?: AppLocale
}) {
  if (!onClick) return null

  return (
    <>
      <StatusBarSeparator show={showSeparator} />
      <StatusBarAction copy={commitButtonTooltipCopy(locale, remoteStatus)} onClick={onClick} testId="status-commit-push" compact={compact}>
        <span style={ICON_STYLE}>
          <GitCommitHorizontal size={13} />
          {compact ? null : translate(locale, 'status.commit.label')}
        </span>
      </StatusBarAction>
    </>
  )
}

export function MissingGitBadge({
  onClick,
  ...displayOptions
}: MissingGitBadgeProps) {
  return (
    <StatusWarningBadge
      kind="missingGit"
      onClick={onClick}
      {...withStatusBadgeDefaults(displayOptions)}
    />
  )
}

export function PulseBadge({
  onClick,
  disabled,
  showSeparator = true,
  compact = false,
  locale = 'en',
}: {
  onClick?: () => void
  disabled?: boolean
  showSeparator?: boolean
  compact?: boolean
  locale?: AppLocale
}) {
  return (
    <>
      <StatusBarSeparator show={showSeparator} />
      <StatusBarAction
        copy={{ label: translate(locale, disabled ? 'status.history.onlyGit' : 'status.history.open') }}
        onClick={disabled ? undefined : onClick}
        testId="status-pulse"
        disabled={Boolean(disabled)}
        compact={compact}
      >
        <span style={ICON_STYLE}>
          <Pulse size={13} />
          {compact ? null : translate(locale, 'status.history.label')}
        </span>
      </StatusBarAction>
    </>
  )
}

export function McpBadge({
  status,
  onInstall,
  ...displayOptions
}: McpBadgeProps) {
  return (
    <StatusWarningBadge
      kind="mcp"
      status={status}
      onInstall={onInstall}
      {...withStatusBadgeDefaults(displayOptions)}
    />
  )
}

export function ClaudeCodeBadge({
  status,
  version,
  ...displayOptions
}: ClaudeCodeBadgeProps) {
  return (
    <StatusWarningBadge
      kind="claude"
      status={status}
      version={version}
      {...withStatusBadgeDefaults(displayOptions)}
    />
  )
}
