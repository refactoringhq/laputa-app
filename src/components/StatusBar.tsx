import type { AiAgentId, AiAgentsStatus } from '../lib/aiAgents'
import type { AiModelProvider } from '../lib/aiTargets'
import type { VaultAiGuidanceStatus } from '../lib/vaultAiGuidance'
import { useEffect, useState } from 'react'
import type { ClaudeCodeStatus } from '../hooks/useClaudeCodeStatus'
import type { McpStatus } from '../hooks/useMcpStatus'
import type { ThemeMode } from '../lib/themeMode'
import type { AppLocale } from '../lib/i18n'
import type { GitRemoteStatus, SyncStatus } from '../types'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  StatusBarPrimarySection,
  StatusBarSecondarySection,
} from './status-bar/StatusBarSections'
import type { VaultOption } from './status-bar/types'

export type { VaultOption } from './status-bar/types'

const COMPACT_STATUS_BAR_MAX_WIDTH = 1000

function getWindowWidth() {
  return typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth
}

function getStatusBarLayout(windowWidth: number) {
  const compact = windowWidth <= COMPACT_STATUS_BAR_MAX_WIDTH

  return {
    compact,
    stacked: false,
  }
}

function useStatusBarTicker() {
  const [, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick((tick) => tick + 1), 30_000)
    return () => clearInterval(id)
  }, [])
}

function useStatusBarLayout() {
  const [windowWidth, setWindowWidth] = useState(() => getWindowWidth())

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleResize = () => setWindowWidth(getWindowWidth())

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return getStatusBarLayout(windowWidth)
}

interface StatusBarProps {
  noteCount: number
  modifiedCount?: number
  vaultPath: string
  vaults: VaultOption[]
  onSwitchVault: (path: string) => void
  onOpenSettings?: () => void
  onOpenLocalFolder?: () => void
  onCreateEmptyVault?: () => void
  onCloneVault?: () => void
  onCloneGettingStarted?: () => void
  onClickPending?: () => void
  onClickPulse?: () => void
  onCommitPush?: () => void
  onInitializeGit?: () => void
  isOffline?: boolean
  isVaultReloading?: boolean
  isGitVault?: boolean
  syncStatus?: SyncStatus
  lastSyncTime?: number | null
  conflictCount?: number
  remoteStatus?: GitRemoteStatus | null
  onTriggerSync?: () => void
  onPullAndPush?: () => void
  onOpenConflictResolver?: () => void
  zoomLevel?: number
  themeMode?: ThemeMode
  onZoomReset?: () => void
  onToggleThemeMode?: () => void
  onOpenFeedback?: () => void
  buildNumber?: string
  onCheckForUpdates?: () => void
  onRemoveVault?: (path: string) => void
  mcpStatus?: McpStatus
  onInstallMcp?: () => void
  aiAgentsStatus?: AiAgentsStatus
  vaultAiGuidanceStatus?: VaultAiGuidanceStatus
  defaultAiAgent?: AiAgentId
  defaultAiTarget?: string
  aiModelProviders?: AiModelProvider[]
  onSetDefaultAiAgent?: (agent: AiAgentId) => void
  onSetDefaultAiTarget?: (target: string) => void
  onRestoreVaultAiGuidance?: () => void
  claudeCodeStatus?: ClaudeCodeStatus
  claudeCodeVersion?: string | null
  locale?: AppLocale
}

interface StatusBarFooterProps extends StatusBarProps {
  compact: boolean
  stacked: boolean
}

function StatusBarPrimaryFromFooter({
  modifiedCount = 0,
  vaultPath,
  vaults,
  onSwitchVault,
  onOpenLocalFolder,
  onCreateEmptyVault,
  onCloneVault,
  onCloneGettingStarted,
  onClickPending,
  onClickPulse,
  onCommitPush,
  onInitializeGit,
  isOffline = false,
  isVaultReloading = false,
  isGitVault = true,
  syncStatus = 'idle',
  lastSyncTime = null,
  conflictCount = 0,
  remoteStatus,
  onTriggerSync,
  onPullAndPush,
  onOpenConflictResolver,
  buildNumber,
  onCheckForUpdates,
  onRemoveVault,
  mcpStatus,
  onInstallMcp,
  aiAgentsStatus,
  vaultAiGuidanceStatus,
  defaultAiAgent,
  defaultAiTarget,
  aiModelProviders,
  onSetDefaultAiAgent,
  onSetDefaultAiTarget,
  onRestoreVaultAiGuidance,
  claudeCodeStatus,
  claudeCodeVersion,
  locale = 'en',
  compact,
  stacked,
}: StatusBarFooterProps) {
  return (
    <StatusBarPrimarySection
      modifiedCount={modifiedCount}
      vaultPath={vaultPath}
      vaults={vaults}
      onSwitchVault={onSwitchVault}
      onOpenLocalFolder={onOpenLocalFolder}
      onCreateEmptyVault={onCreateEmptyVault}
      onCloneVault={onCloneVault}
      onCloneGettingStarted={onCloneGettingStarted}
      onClickPending={onClickPending}
      onClickPulse={onClickPulse}
      onCommitPush={onCommitPush}
      onInitializeGit={onInitializeGit}
      isOffline={isOffline}
      isVaultReloading={isVaultReloading}
      isGitVault={isGitVault}
      syncStatus={syncStatus}
      lastSyncTime={lastSyncTime}
      conflictCount={conflictCount}
      remoteStatus={remoteStatus}
      onTriggerSync={onTriggerSync}
      onPullAndPush={onPullAndPush}
      onOpenConflictResolver={onOpenConflictResolver}
      buildNumber={buildNumber}
      onCheckForUpdates={onCheckForUpdates}
      onRemoveVault={onRemoveVault}
      mcpStatus={mcpStatus}
      onInstallMcp={onInstallMcp}
      aiAgentsStatus={aiAgentsStatus}
      vaultAiGuidanceStatus={vaultAiGuidanceStatus}
      defaultAiAgent={defaultAiAgent}
      defaultAiTarget={defaultAiTarget}
      aiModelProviders={aiModelProviders}
      onSetDefaultAiAgent={onSetDefaultAiAgent}
      onSetDefaultAiTarget={onSetDefaultAiTarget}
      onRestoreVaultAiGuidance={onRestoreVaultAiGuidance}
      claudeCodeStatus={claudeCodeStatus}
      claudeCodeVersion={claudeCodeVersion}
      locale={locale}
      stacked={stacked}
      compact={compact}
    />
  )
}

function StatusBarSecondaryFromFooter({
  noteCount,
  zoomLevel = 100,
  themeMode = 'light',
  onZoomReset,
  onToggleThemeMode,
  onOpenFeedback,
  onOpenSettings,
  locale = 'en',
  compact,
  stacked,
}: StatusBarFooterProps) {
  return (
      <StatusBarSecondarySection
        noteCount={noteCount}
        zoomLevel={zoomLevel}
        themeMode={themeMode}
        onZoomReset={onZoomReset}
        onToggleThemeMode={onToggleThemeMode}
        onOpenFeedback={onOpenFeedback}
        onOpenSettings={onOpenSettings}
        locale={locale}
        stacked={stacked}
        compact={compact}
      />
  )
}

function StatusBarFooter(props: StatusBarFooterProps) {
  const { compact, stacked } = props

  return (
    <footer
      data-testid="status-bar"
      style={{
        minHeight: 30,
        height: stacked ? 'auto' : 30,
        flexShrink: 0,
        display: 'flex',
        flexWrap: stacked ? 'wrap' : 'nowrap',
        alignItems: stacked ? 'flex-start' : 'center',
        justifyContent: stacked ? 'flex-start' : 'space-between',
        rowGap: stacked ? 4 : 0,
        columnGap: compact ? 8 : 12,
        background: 'var(--sidebar)',
        borderTop: '1px solid var(--border)',
        padding: stacked ? '4px 8px' : '0 8px',
        fontSize: 12,
        color: 'var(--muted-foreground)',
        position: 'relative',
        zIndex: 10,
      }}
    >
      <StatusBarPrimaryFromFooter {...props} />
      <StatusBarSecondaryFromFooter {...props} />
    </footer>
  )
}

export function StatusBar(props: StatusBarProps) {
  useStatusBarTicker()
  const { compact, stacked } = useStatusBarLayout()

  return (
    <TooltipProvider>
      <StatusBarFooter {...props} compact={compact} stacked={stacked} />
    </TooltipProvider>
  )
}
