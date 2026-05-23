import { BookOpen, GearSix as Settings, Megaphone, Moon, Package, Sun, type IconProps } from '@phosphor-icons/react'
import type { ComponentType, MouseEventHandler } from 'react'
import type { AiAgentId, AiAgentsStatus } from '../../lib/aiAgents'
import type { AiModelProvider } from '../../lib/aiTargets'
import type { VaultAiGuidanceStatus } from '../../lib/vaultAiGuidance'
import type { ClaudeCodeStatus } from '../../hooks/useClaudeCodeStatus'
import type { McpStatus } from '../../hooks/useMcpStatus'
import type { ThemeMode } from '../../lib/themeMode'
import { translate, type AppLocale, type TranslationKey } from '../../lib/i18n'
import { useStatusBarAddRemote } from '../../hooks/useStatusBarAddRemote'
import type { GitRemoteStatus, SyncStatus } from '../../types'
import { rememberFeedbackDialogOpener } from '../../lib/feedbackDialogOpener'
import { ActionTooltip } from '@/components/ui/action-tooltip'
import { AiAgentsBadge } from './AiAgentsBadge'
import { AddRemoteModal } from '../AddRemoteModal'
import { Button } from '@/components/ui/button'
import {
  ClaudeCodeBadge,
  CommitButton,
  ConflictBadge,
  ChangesBadge,
  McpBadge,
  MissingGitBadge,
  NoRemoteBadge,
  OfflineBadge,
  PulseBadge,
  SyncBadge,
  VaultReloadingBadge,
} from './StatusBarBadges'
import { ICON_STYLE, SEP_STYLE } from './styles'
import type { VaultOption } from './types'
import { VaultMenu } from './VaultMenu'
import { formatShortcutDisplay } from '../../hooks/appCommandCatalog'
import type { GitRepositoryOption } from '../../utils/gitRepositories'

const SETTINGS_SHORTCUT = {
  shortcut: formatShortcutDisplay({ display: '⌘,' }),
} as const
const ZOOM_RESET_SHORTCUT = {
  shortcut: formatShortcutDisplay({ display: '⌘0' }),
} as const

interface StatusBarPrimarySectionProps {
  modifiedCount: number
  vaultPath: string
  defaultWorkspacePath?: string | null
  vaults: VaultOption[]
  multiWorkspaceEnabled?: boolean
  onSwitchVault: (path: string) => void
  onSetDefaultWorkspace?: (path: string) => void
  onOpenVaultSettings?: () => void
  onOpenLocalFolder?: () => void
  onCreateEmptyVault?: () => void
  onCloneVault?: () => void
  onCloneGettingStarted?: () => void
  onAddRemote?: () => void
  onClickPending?: () => void
  onClickPulse?: () => void
  onCommitPush?: () => void
  commitActionPending?: boolean
  gitFeaturesEnabled?: boolean
  onInitializeGit?: () => void
  isOffline?: boolean
  isVaultReloading?: boolean
  isGitVault?: boolean
  syncStatus: SyncStatus
  lastSyncTime: number | null
  conflictCount: number
  remoteStatus?: GitRemoteStatus | null
  repositories?: GitRepositoryOption[]
  selectedRepositoryPath?: string
  onRepositoryChange?: (path: string) => void
  onTriggerSync?: () => void
  onPullAndPush?: () => void
  onOpenConflictResolver?: () => void
  buildNumber?: string
  onCheckForUpdates?: () => void
  onRemoveVault?: (path: string) => void
  onReorderVaults?: (orderedPaths: string[]) => void
  onUpdateWorkspaceIdentity?: (path: string, patch: Partial<VaultOption>) => void
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
  stacked?: boolean
  compact?: boolean
  locale?: AppLocale
}

interface StatusBarSecondarySectionProps {
  noteCount: number
  zoomLevel: number
  themeMode?: ThemeMode
  onZoomReset?: () => void
  onToggleThemeMode?: () => void
  onOpenFeedback?: () => void
  onOpenDocs?: () => void
  onOpenSettings?: () => void
  stacked?: boolean
  compact?: boolean
  locale?: AppLocale
}

function BuildNumberButton({
  buildNumber,
  onCheckForUpdates,
  compact,
  locale,
}: {
  buildNumber?: string
  onCheckForUpdates?: () => void
  compact: boolean
  locale: AppLocale
}) {
  const className = compact
    ? 'h-6 min-w-0 gap-1 rounded-sm px-1 py-0.5 text-[12px] font-medium text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground'
    : 'h-auto gap-1 rounded-sm px-1 py-0.5 text-[12px] font-medium text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground'

  return (
    <ActionTooltip copy={{ label: translate(locale, 'status.update.check') }} side="top">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={className}
        onClick={onCheckForUpdates}
        aria-label={translate(locale, 'status.update.check')}
        aria-disabled={onCheckForUpdates ? undefined : true}
        data-testid="status-build-number"
      >
        <span style={ICON_STYLE}>
          <Package size={13} weight="regular" />
          {compact ? null : buildNumber ?? translate(locale, 'status.build.unknown')}
        </span>
      </Button>
    </ActionTooltip>
  )
}

function StatusBarAiBadge({
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
  compact,
  locale,
}: Pick<
  StatusBarPrimarySectionProps,
  | 'aiAgentsStatus'
  | 'vaultAiGuidanceStatus'
  | 'defaultAiAgent'
  | 'defaultAiTarget'
  | 'aiModelProviders'
  | 'onSetDefaultAiAgent'
  | 'onSetDefaultAiTarget'
  | 'onRestoreVaultAiGuidance'
  | 'claudeCodeStatus'
  | 'claudeCodeVersion'
  | 'compact'
  | 'locale'
>) {
  if (aiAgentsStatus && defaultAiAgent) {
    return (
      <AiAgentsBadge
        statuses={aiAgentsStatus}
        guidanceStatus={vaultAiGuidanceStatus}
        defaultAgent={defaultAiAgent}
        defaultTarget={defaultAiTarget}
        providers={aiModelProviders}
        onSetDefaultAgent={onSetDefaultAiAgent}
        onSetDefaultTarget={onSetDefaultAiTarget}
        onRestoreGuidance={onRestoreVaultAiGuidance}
        compact={compact}
        locale={locale}
      />
    )
  }

  if (!claudeCodeStatus) return null

  return <ClaudeCodeBadge status={claudeCodeStatus} version={claudeCodeVersion} showSeparator={!compact} compact={compact} locale={locale} />
}

function StatusBarPrimaryBadges({
  modifiedCount,
  visibleRemoteStatus,
  repositories,
  selectedRepositoryPath,
  onRepositoryChange,
  onAddRemote,
  onClickPending,
  onCommitPush,
  commitActionPending,
  gitFeaturesEnabled,
  onInitializeGit,
  syncStatus,
  lastSyncTime,
  onTriggerSync,
  onPullAndPush,
  onOpenConflictResolver,
  conflictCount,
  onClickPulse,
  isGitVault,
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
  isOffline,
  isVaultReloading,
  compact,
  locale,
}: {
  modifiedCount: number
  visibleRemoteStatus: GitRemoteStatus | null
  repositories?: GitRepositoryOption[]
  selectedRepositoryPath?: string
  onRepositoryChange?: (path: string) => void
  onAddRemote: () => void
  onClickPending?: () => void
  onCommitPush?: () => void
  commitActionPending?: boolean
  gitFeaturesEnabled: boolean
  onInitializeGit?: () => void
  syncStatus: SyncStatus
  lastSyncTime: number | null
  onTriggerSync?: () => void
  onPullAndPush?: () => void
  onOpenConflictResolver?: () => void
  conflictCount: number
  onClickPulse?: () => void
  isGitVault: boolean
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
  isOffline: boolean
  isVaultReloading: boolean
  compact: boolean
  locale: AppLocale
}) {
  return (
    <>
      <OfflineBadge isOffline={isOffline} showSeparator={!compact} compact={compact} locale={locale} />
      <VaultReloadingBadge isReloading={isVaultReloading} showSeparator={!compact} compact={compact} locale={locale} />
      {gitFeaturesEnabled && isGitVault ? (
        <>
          <NoRemoteBadge remoteStatus={visibleRemoteStatus} onAddRemote={onAddRemote} showSeparator={!compact} compact={compact} locale={locale} />
          <ChangesBadge count={modifiedCount} onClick={onClickPending} showSeparator={!compact} compact={compact} locale={locale} />
          <CommitButton onClick={onCommitPush} remoteStatus={visibleRemoteStatus} pending={commitActionPending} showSeparator={!compact} compact={compact} locale={locale} />
          <SyncBadge
            status={syncStatus}
            lastSyncTime={lastSyncTime}
            remoteStatus={visibleRemoteStatus}
            repositories={repositories}
            selectedRepositoryPath={selectedRepositoryPath}
            onRepositoryChange={onRepositoryChange}
            onTriggerSync={onTriggerSync}
            onPullAndPush={onPullAndPush}
            onOpenConflictResolver={onOpenConflictResolver}
            compact={compact}
            locale={locale}
          />
          <ConflictBadge count={conflictCount} onClick={onOpenConflictResolver} showSeparator={!compact} compact={compact} locale={locale} />
          <PulseBadge onClick={onClickPulse} showSeparator={!compact} compact={compact} locale={locale} />
        </>
      ) : gitFeaturesEnabled ? (
        <MissingGitBadge onClick={onInitializeGit} showSeparator={!compact} compact={compact} locale={locale} />
      ) : null}
      {mcpStatus && <McpBadge status={mcpStatus} onInstall={onInstallMcp} showSeparator={!compact} compact={compact} locale={locale} />}
      <StatusBarAiBadge
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
        compact={compact}
        locale={locale}
      />
    </>
  )
}

type StatusLinkButtonProps = {
  compact: boolean
  icon: ComponentType<IconProps>
  labelKey: TranslationKey
  locale: AppLocale
  onClick: MouseEventHandler<HTMLButtonElement>
  testId: string
  tooltipKey: TranslationKey
}

function StatusLinkButton({
  compact,
  icon: Icon,
  labelKey,
  locale,
  onClick,
  testId,
  tooltipKey,
}: StatusLinkButtonProps) {
  const className = compact
    ? 'h-6 w-6 rounded-sm p-0 text-muted-foreground hover:text-foreground'
    : 'h-6 px-2 text-[12px] font-medium text-muted-foreground hover:text-foreground'

  return (
    <ActionTooltip copy={{ label: translate(locale, tooltipKey) }} side="top">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={className}
        onClick={onClick}
        aria-label={translate(locale, tooltipKey)}
        data-testid={testId}
      >
        <Icon size={14} weight="regular" />
        {compact ? null : translate(locale, labelKey)}
      </Button>
    </ActionTooltip>
  )
}

function FeedbackButton({
  compact,
  locale,
  onOpenFeedback,
}: {
  compact: boolean
  locale: AppLocale
  onOpenFeedback: () => void
}) {
  return (
    <StatusLinkButton
      compact={compact}
      icon={Megaphone}
      labelKey="status.feedback.label"
      locale={locale}
      onClick={(event) => {
        rememberFeedbackDialogOpener(event.currentTarget)
        onOpenFeedback()
      }}
      testId="status-feedback"
      tooltipKey="status.feedback.contribute"
    />
  )
}

function DocsButton({
  compact,
  locale,
  onOpenDocs,
}: {
  compact: boolean
  locale: AppLocale
  onOpenDocs: () => void
}) {
  return (
    <StatusLinkButton
      compact={compact}
      icon={BookOpen}
      labelKey="status.docs.label"
      locale={locale}
      onClick={onOpenDocs}
      testId="status-docs"
      tooltipKey="status.docs.open"
    />
  )
}

function primarySectionStyle(stacked: boolean, compact: boolean) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: compact ? 8 : 12,
    rowGap: stacked ? 4 : 0,
    flex: 1,
    minWidth: 0,
    width: stacked ? '100%' : 'auto',
    flexBasis: stacked ? '100%' : 'auto',
    flexWrap: stacked ? 'wrap' : 'nowrap',
  } as const
}

function PrimarySeparator({ compact }: { compact: boolean }) {
  return compact ? null : <span style={SEP_STYLE}>|</span>
}

function StatusBarGitControls({
  modifiedCount,
  vaultPath,
  onAddRemote,
  onClickPending,
  onCommitPush,
  commitActionPending,
  gitFeaturesEnabled,
  onInitializeGit,
  isOffline,
  isVaultReloading,
  isGitVault,
  syncStatus,
  lastSyncTime,
  conflictCount,
  remoteStatus,
  repositories,
  selectedRepositoryPath,
  onRepositoryChange,
  onTriggerSync,
  onPullAndPush,
  onOpenConflictResolver,
  onClickPulse,
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
  compact,
  locale,
}: StatusBarPrimarySectionProps & { compact: boolean; locale: AppLocale }) {
  const gitVaultPath = selectedRepositoryPath || vaultPath
  const { openAddRemote, closeAddRemote, showAddRemote, visibleRemoteStatus, handleRemoteConnected } = useStatusBarAddRemote({
    vaultPath: gitVaultPath,
    isGitVault: gitFeaturesEnabled !== false && isGitVault !== false,
    remoteStatus,
    onAddRemote,
  })

  return (
    <>
      <StatusBarPrimaryBadges
        modifiedCount={modifiedCount}
        visibleRemoteStatus={visibleRemoteStatus}
        repositories={repositories}
        selectedRepositoryPath={gitVaultPath}
        onRepositoryChange={onRepositoryChange}
        onAddRemote={() => {
          void openAddRemote()
        }}
        onClickPending={onClickPending}
        onCommitPush={onCommitPush}
        commitActionPending={commitActionPending}
        gitFeaturesEnabled={gitFeaturesEnabled !== false}
        onInitializeGit={onInitializeGit}
        syncStatus={syncStatus}
        lastSyncTime={lastSyncTime}
        onTriggerSync={onTriggerSync}
        onPullAndPush={onPullAndPush}
        onOpenConflictResolver={onOpenConflictResolver}
        conflictCount={conflictCount}
        onClickPulse={onClickPulse}
        isGitVault={isGitVault !== false}
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
        isOffline={isOffline === true}
        isVaultReloading={isVaultReloading === true}
        compact={compact}
        locale={locale}
      />
      <AddRemoteModal
        open={showAddRemote}
        vaultPath={gitVaultPath}
        onClose={closeAddRemote}
        onRemoteConnected={handleRemoteConnected}
      />
    </>
  )
}

export function StatusBarPrimarySection({
  modifiedCount,
  vaultPath,
  defaultWorkspacePath,
  vaults, multiWorkspaceEnabled,
  onSwitchVault,
  onSetDefaultWorkspace,
  onOpenVaultSettings,
  onOpenLocalFolder,
  onCreateEmptyVault,
  onCloneVault,
  onCloneGettingStarted,
  onAddRemote,
  onClickPending, onClickPulse,
  onCommitPush, commitActionPending = false,
  gitFeaturesEnabled = true,
  onInitializeGit,
  isOffline = false, isVaultReloading = false, isGitVault = true,
  syncStatus,
  lastSyncTime,
  conflictCount,
  remoteStatus,
  repositories,
  selectedRepositoryPath,
  onRepositoryChange,
  onTriggerSync,
  onPullAndPush,
  onOpenConflictResolver,
  buildNumber,
  onCheckForUpdates,
  onRemoveVault,
  onReorderVaults,
  onUpdateWorkspaceIdentity,
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
  stacked = false,
  compact = false,
}: StatusBarPrimarySectionProps) {
  return (
    <div style={primarySectionStyle(stacked, compact)}>
      <VaultMenu
        vaults={vaults}
        vaultPath={vaultPath}
        defaultWorkspacePath={defaultWorkspacePath}
        multiWorkspaceEnabled={multiWorkspaceEnabled}
        onSwitchVault={onSwitchVault}
        onSetDefaultWorkspace={onSetDefaultWorkspace}
        onOpenVaultSettings={onOpenVaultSettings}
        onOpenLocalFolder={onOpenLocalFolder}
        onCreateEmptyVault={onCreateEmptyVault}
        onCloneVault={onCloneVault}
        onCloneGettingStarted={onCloneGettingStarted}
        {...{ onRemoveVault, onReorderVaults, onUpdateWorkspaceIdentity }}
        compact={compact}
        locale={locale}
      />
      <PrimarySeparator compact={compact} />
      <BuildNumberButton buildNumber={buildNumber} onCheckForUpdates={onCheckForUpdates} compact={compact} locale={locale} />
      <StatusBarGitControls
        modifiedCount={modifiedCount}
        vaultPath={vaultPath}
        vaults={vaults}
        onSwitchVault={onSwitchVault}
        remoteStatus={remoteStatus}
        repositories={repositories}
        selectedRepositoryPath={selectedRepositoryPath}
        onRepositoryChange={onRepositoryChange}
        onAddRemote={onAddRemote}
        onClickPending={onClickPending}
        onCommitPush={onCommitPush}
        commitActionPending={commitActionPending}
        gitFeaturesEnabled={gitFeaturesEnabled}
        onInitializeGit={onInitializeGit}
        syncStatus={syncStatus}
        lastSyncTime={lastSyncTime}
        onTriggerSync={onTriggerSync}
        onPullAndPush={onPullAndPush}
        onOpenConflictResolver={onOpenConflictResolver}
        conflictCount={conflictCount}
        onClickPulse={onClickPulse}
        isGitVault={isGitVault}
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
        isOffline={isOffline} isVaultReloading={isVaultReloading}
        compact={compact}
        locale={locale}
      />
    </div>
  )
}

export function StatusBarSecondarySection({
  noteCount,
  zoomLevel,
  themeMode = 'light',
  onZoomReset,
  onToggleThemeMode,
  onOpenFeedback,
  onOpenDocs,
  onOpenSettings,
  locale = 'en',
  stacked = false,
  compact = false,
}: StatusBarSecondarySectionProps) {
  void noteCount
  const ThemeIcon = themeMode === 'dark' ? Sun : Moon
  const themeTooltip = {
    label: translate(locale, themeMode === 'dark' ? 'status.theme.light' : 'status.theme.dark'),
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: stacked ? 'flex-end' : 'flex-start',
        gap: compact ? 8 : 12,
        flexShrink: 0,
        width: stacked ? '100%' : 'auto',
      }}
    >
      {zoomLevel === 100 ? null : (
        <ActionTooltip copy={{ label: translate(locale, 'status.zoom.reset'), ...ZOOM_RESET_SHORTCUT }} side="top">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-auto rounded-sm px-1 py-0.5 text-[12px] font-medium text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground"
            onClick={onZoomReset}
            aria-label={translate(locale, 'status.zoom.reset')}
            data-testid="status-zoom"
          >
            <span style={ICON_STYLE}>{zoomLevel}%</span>
          </Button>
        </ActionTooltip>
      )}
      {onOpenFeedback && <FeedbackButton compact={compact} locale={locale} onOpenFeedback={onOpenFeedback} />}
      {onOpenDocs && <DocsButton compact={compact} locale={locale} onOpenDocs={onOpenDocs} />}
      <ActionTooltip copy={themeTooltip} side="top" align="end" contentTestId="status-theme-mode-tooltip">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground"
          onClick={onToggleThemeMode}
          disabled={!onToggleThemeMode}
          aria-label={themeTooltip.label}
          data-testid="status-theme-mode"
        >
          <ThemeIcon size={14} weight="regular" />
        </Button>
      </ActionTooltip>
      <ActionTooltip copy={{ label: translate(locale, 'status.settings.open'), ...SETTINGS_SHORTCUT }} side="top" align="end">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground"
          onClick={onOpenSettings}
          aria-label={translate(locale, 'status.settings.open')}
          data-testid="status-settings"
        >
          <Settings size={14} weight="regular" />
        </Button>
      </ActionTooltip>
    </div>
  )
}
