import { AlertTriangle, ChevronsUpDown } from 'lucide-react'
import { Sparkle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import {
  AI_AGENT_DEFINITIONS,
  getAiAgentDefinition,
  hasAnyInstalledAiAgent,
  isAiAgentInstalled,
  isAiAgentsStatusChecking,
  type AiAgentId,
  type AiAgentDefinition,
  type AiAgentsStatus,
} from '../../lib/aiAgents'
import {
  getVaultAiGuidanceSummary,
  isVaultAiGuidanceStatusChecking,
  vaultAiGuidanceNeedsRestore,
  vaultAiGuidanceUsesCustomFiles,
  type VaultAiGuidanceStatus,
} from '../../lib/vaultAiGuidance'
import { translate, type AppLocale } from '../../lib/i18n'
import { openExternalUrl } from '../../utils/url'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ICON_STYLE, SEP_STYLE } from './styles'

interface AiAgentsBadgeProps {
  statuses: AiAgentsStatus
  guidanceStatus?: VaultAiGuidanceStatus
  defaultAgent: AiAgentId
  onSetDefaultAgent?: (agent: AiAgentId) => void
  onRestoreGuidance?: () => void
  compact?: boolean
  locale?: AppLocale
}

function badgeTooltip(
  locale: AppLocale,
  statuses: AiAgentsStatus,
  defaultAgent: AiAgentId,
  guidanceStatus?: VaultAiGuidanceStatus,
): string {
  const guidanceSummary = guidanceStatus && !isVaultAiGuidanceStatusChecking(guidanceStatus)
    ? getVaultAiGuidanceSummary(guidanceStatus)
    : null
  if (!hasAnyInstalledAiAgent(statuses)) return translate(locale, 'status.ai.noAgentsTooltip')
  const definition = getAiAgentDefinition(defaultAgent)
  if (!isAiAgentInstalled(statuses, defaultAgent)) {
    return translate(locale, 'status.ai.selectedMissing', { agent: definition.label })
  }
  const version = statuses[defaultAgent].version
  const base = translate(locale, 'status.ai.defaultAgent', { agent: definition.label, version: version ? ` ${version}` : '' })
  if (!guidanceSummary) return base
  if (vaultAiGuidanceNeedsRestore(guidanceStatus!)) {
    return translate(locale, 'status.ai.restoreDetails', { base, summary: guidanceSummary })
  }
  if (vaultAiGuidanceUsesCustomFiles(guidanceStatus!)) {
    return translate(locale, 'status.ai.withGuidance', { base, summary: guidanceSummary })
  }
  return base
}

function installedAgentDefinitions(statuses: AiAgentsStatus): AiAgentDefinition[] {
  return AI_AGENT_DEFINITIONS.filter((definition) => isAiAgentInstalled(statuses, definition.id))
}

function missingAgentDefinitions(statuses: AiAgentsStatus): AiAgentDefinition[] {
  return AI_AGENT_DEFINITIONS.filter((definition) => !isAiAgentInstalled(statuses, definition.id))
}

function triggerLabel(defaultAgent: AiAgentId): string {
  return getAiAgentDefinition(defaultAgent).shortLabel
}

function menuHeading(locale: AppLocale, defaultAgent: AiAgentId, selectedAgentReady: boolean): string {
  const agent = getAiAgentDefinition(defaultAgent).label
  return selectedAgentReady
    ? translate(locale, 'status.ai.active', { agent })
    : translate(locale, 'status.ai.unavailable', { agent })
}

function statusText(statuses: AiAgentsStatus, definition: AiAgentDefinition): string {
  const version = statuses[definition.id].version
  return version ? `${definition.label} ${version}` : definition.label
}

function canSwitchAgents(
  installedAgents: AiAgentDefinition[],
  defaultAgent: AiAgentId,
): boolean {
  return installedAgents.some((definition) => definition.id !== defaultAgent)
}

function hasAiAgentWarning(
  statuses: AiAgentsStatus,
  defaultAgent: AiAgentId,
  guidanceStatus?: VaultAiGuidanceStatus,
): boolean {
  return !hasAnyInstalledAiAgent(statuses)
    || !isAiAgentInstalled(statuses, defaultAgent)
    || !!(guidanceStatus && vaultAiGuidanceNeedsRestore(guidanceStatus))
}

function canShowSwitcherCue(statuses: AiAgentsStatus, defaultAgent: AiAgentId): boolean {
  return canSwitchAgents(installedAgentDefinitions(statuses), defaultAgent)
}

function triggerButtonClassName(compact: boolean): string {
  return compact
    ? 'h-6 w-6 rounded-sm p-0 text-[11px] font-medium'
    : 'h-6 px-2 text-[11px] font-medium'
}

function CompactSeparator({ compact }: { compact: boolean }) {
  if (compact) return null
  return <span style={SEP_STYLE}>|</span>
}

function TriggerLabel({ compact, defaultAgent }: { compact: boolean; defaultAgent: AiAgentId }) {
  if (compact) return null
  return triggerLabel(defaultAgent)
}

function TriggerStateIcon({
  showWarning,
  showSwitcherCue,
}: {
  showWarning: boolean
  showSwitcherCue: boolean
}) {
  if (showWarning) return <AlertTriangle size={10} style={{ marginLeft: 2 }} />
  if (showSwitcherCue) return <ChevronsUpDown size={10} style={{ marginLeft: 2 }} />
  return null
}

function GuidanceMenuSection({
  guidanceStatus,
  locale = 'en',
  onRestoreGuidance,
}: Pick<AiAgentsBadgeProps, 'guidanceStatus' | 'locale' | 'onRestoreGuidance'>) {
  if (!guidanceStatus || isVaultAiGuidanceStatusChecking(guidanceStatus)) return null

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{translate(locale, 'status.ai.vaultGuidance')}</DropdownMenuLabel>
      <DropdownMenuItem disabled data-testid="status-ai-guidance-summary">
        {getVaultAiGuidanceSummary(guidanceStatus)}
      </DropdownMenuItem>
      {vaultAiGuidanceNeedsRestore(guidanceStatus) && guidanceStatus.canRestore && (
        <DropdownMenuItem
          onSelect={() => onRestoreGuidance?.()}
          data-testid="status-ai-guidance-restore"
        >
          {translate(locale, 'status.ai.restoreGuidance')}
        </DropdownMenuItem>
      )}
    </>
  )
}

function AgentMenuContent({
  statuses,
  guidanceStatus,
  defaultAgent,
  selectedAgentReady,
  onSetDefaultAgent,
  onRestoreGuidance,
  locale = 'en',
}: AiAgentsBadgeProps & { selectedAgentReady: boolean }) {
  const installedAgents = installedAgentDefinitions(statuses)
  const missingAgents = missingAgentDefinitions(statuses)

  return (
    <DropdownMenuContent
      align="start"
      side="top"
      className="min-w-[18rem]"
      data-testid="status-ai-agents-menu"
    >
      <DropdownMenuLabel>{menuHeading(locale, defaultAgent, selectedAgentReady)}</DropdownMenuLabel>
      {installedAgents.length === 0 ? (
        <DropdownMenuItem disabled>{translate(locale, 'status.ai.noAgents')}</DropdownMenuItem>
      ) : (
        <DropdownMenuRadioGroup
          value={selectedAgentReady ? defaultAgent : undefined}
          onValueChange={(value) => onSetDefaultAgent?.(value as AiAgentId)}
        >
          {installedAgents.map((definition) => (
            <DropdownMenuRadioItem key={definition.id} value={definition.id}>
              <span>{definition.label}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {statusText(statuses, definition)}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      )}
      {missingAgents.length > 0 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{translate(locale, 'status.ai.install')}</DropdownMenuLabel>
          {missingAgents.map((definition) => (
            <DropdownMenuItem
              key={definition.id}
              onSelect={() => void openExternalUrl(definition.installUrl)}
            >
              {translate(locale, 'status.ai.installAgent', { agent: definition.label })}
            </DropdownMenuItem>
          ))}
        </>
      )}
      <GuidanceMenuSection
        guidanceStatus={guidanceStatus}
        locale={locale}
        onRestoreGuidance={onRestoreGuidance}
      />
    </DropdownMenuContent>
  )
}

export function AiAgentsBadge({
  statuses,
  guidanceStatus,
  defaultAgent,
  onSetDefaultAgent,
  onRestoreGuidance,
  compact = false,
  locale = 'en',
}: AiAgentsBadgeProps) {
  const selectedAgentReady = isAiAgentInstalled(statuses, defaultAgent)
  const showWarning = hasAiAgentWarning(statuses, defaultAgent, guidanceStatus)
  const showSwitcherCue = !showWarning && canShowSwitcherCue(statuses, defaultAgent)
  const tooltip = badgeTooltip(locale, statuses, defaultAgent, guidanceStatus)

  if (isAiAgentsStatusChecking(statuses)) return null

  return (
    <>
      <CompactSeparator compact={compact} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild={true}>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={triggerButtonClassName(compact)}
            aria-label={translate(locale, 'status.ai.openOptions')}
            title={tooltip}
            data-tooltip-mode="native-title"
            data-testid="status-ai-agents"
          >
            <span style={{ ...ICON_STYLE, color: showWarning ? 'var(--accent-orange)' : 'var(--muted-foreground)' }}>
              <Sparkle size={13} weight="fill" />
              <TriggerLabel compact={compact} defaultAgent={defaultAgent} />
              <TriggerStateIcon showWarning={showWarning} showSwitcherCue={showSwitcherCue} />
            </span>
          </Button>
        </DropdownMenuTrigger>
        <AgentMenuContent
          statuses={statuses}
          guidanceStatus={guidanceStatus}
          defaultAgent={defaultAgent}
          onSetDefaultAgent={onSetDefaultAgent}
          onRestoreGuidance={onRestoreGuidance}
          selectedAgentReady={selectedAgentReady}
          locale={locale}
        />
      </DropdownMenu>
    </>
  )
}
