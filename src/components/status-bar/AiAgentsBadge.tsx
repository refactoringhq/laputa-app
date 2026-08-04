import { CaretUpDown as ChevronsUpDown, Sparkle, Warning as AlertTriangle } from '@phosphor-icons/react'
import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { Button } from '@/components/ui/button'
import { AiAgentIcon } from '@/components/AiAgentIcon'
import {
  AI_AGENT_DEFINITIONS,
  getAiAgentAvailability,
  getAiAgentDefinition,
  hasAnyInstalledAiAgent,
  isAiAgentInstalled,
  isAiAgentsStatusChecking,
  type AiAgentId,
  type AiAgentDefinition,
  type AiAgentsStatus,
} from '../../lib/aiAgents'
import { configuredModelTargets, resolveAiTarget, type AiTarget, type AiModelProvider } from '../../lib/aiTargets'
import type { Settings } from '../../types'
import {
  getVaultAiGuidanceSummary,
  isVaultAiGuidanceStatusChecking,
  vaultAiGuidanceNeedsRestore,
  vaultAiGuidanceUsesCustomFiles,
  type VaultAiGuidanceStatus,
} from '../../lib/vaultAiGuidance'
import { translate, type AppLocale } from '../../lib/i18n'
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
  defaultTarget?: string
  providers?: AiModelProvider[]
  onSetDefaultAgent?: (agent: AiAgentId) => void
  onSetDefaultTarget?: (target: string) => void
  onRestoreGuidance?: () => void
  onOpenWorkspace?: () => void
  compact?: boolean
  locale?: AppLocale
}

function resolvedGuidance(status?: VaultAiGuidanceStatus) {
  if (!status || isVaultAiGuidanceStatusChecking(status)) return null
  return { status, summary: getVaultAiGuidanceSummary(status) }
}

function agentVersionSuffix(version: string | null | undefined): string {
  return version ? ` ${version}` : ''
}

function badgeTooltip(
  locale: AppLocale,
  statuses: AiAgentsStatus,
  defaultAgent: AiAgentId,
  guidanceStatus?: VaultAiGuidanceStatus,
): string {
  const guidance = resolvedGuidance(guidanceStatus)
  if (!hasAnyInstalledAiAgent(statuses)) return translate(locale, 'status.ai.noAgentsTooltip')
  const definition = getAiAgentDefinition(defaultAgent)
  if (!isAiAgentInstalled(statuses, defaultAgent)) {
    return translate(locale, 'status.ai.selectedMissing', {
      agent: definition.label,
    })
  }
  const version = getAiAgentAvailability(statuses, defaultAgent).version
  const base = translate(locale, 'status.ai.defaultAgent', {
    agent: definition.label,
    version: agentVersionSuffix(version),
  })
  return guidanceTooltip(locale, base, guidance)
}

function guidanceTooltip(
  locale: AppLocale,
  base: string,
  guidance: ReturnType<typeof resolvedGuidance>,
): string {
  if (!guidance?.summary) return base
  if (vaultAiGuidanceNeedsRestore(guidance.status)) {
    return translate(locale, 'status.ai.restoreDetails', {
      base,
      summary: guidance.summary,
    })
  }
  if (vaultAiGuidanceUsesCustomFiles(guidance.status)) {
    return translate(locale, 'status.ai.withGuidance', {
      base,
      summary: guidance.summary,
    })
  }
  return base
}

function installedAgentDefinitions(statuses: AiAgentsStatus): AiAgentDefinition[] {
  return AI_AGENT_DEFINITIONS.filter((definition) => isAiAgentInstalled(statuses, definition.id))
}

function triggerLabel(defaultAgent: AiAgentId): string {
  return getAiAgentDefinition(defaultAgent).shortLabel
}

function menuHeading(locale: AppLocale, selectedTarget: AiTarget, selectedAgentReady: boolean): string {
  if (selectedTarget.kind === 'api_model') {
    return translate(locale, 'status.ai.defaultTarget', {
      target: selectedTarget.label,
    })
  }

  const agent = selectedTarget.label
  return selectedAgentReady
    ? translate(locale, 'status.ai.active', { agent })
    : translate(locale, 'status.ai.unavailable', { agent })
}

function statusText(statuses: AiAgentsStatus, definition: AiAgentDefinition): string {
  const version = getAiAgentAvailability(statuses, definition.id).version
  return version ? `${definition.label} ${version}` : definition.label
}

function canSwitchAgents(installedAgents: AiAgentDefinition[], defaultAgent: AiAgentId): boolean {
  return installedAgents.some((definition) => definition.id !== defaultAgent)
}

function hasAiAgentWarning(
  statuses: AiAgentsStatus,
  defaultAgent: AiAgentId,
  guidanceStatus?: VaultAiGuidanceStatus,
): boolean {
  return (
    !hasAnyInstalledAiAgent(statuses) ||
    !isAiAgentInstalled(statuses, defaultAgent) ||
    !!(guidanceStatus && vaultAiGuidanceNeedsRestore(guidanceStatus))
  )
}

function canShowSwitcherCue(statuses: AiAgentsStatus, defaultAgent: AiAgentId): boolean {
  return canSwitchAgents(installedAgentDefinitions(statuses), defaultAgent)
}

function triggerButtonClassName(compact: boolean): string {
  return compact ? 'h-6 w-6 rounded-sm p-0 text-[12px] font-medium' : 'h-6 px-2 text-[12px] font-medium'
}

function CompactSeparator({ compact }: { compact: boolean }) {
  if (compact) return null
  return <span style={SEP_STYLE}>|</span>
}

function TriggerStateIcon({ showWarning, showSwitcherCue }: { showWarning: boolean; showSwitcherCue: boolean }) {
  if (showWarning) return <AlertTriangle size={10} style={{ marginLeft: 2 }} />
  if (showSwitcherCue) return <ChevronsUpDown size={10} style={{ marginLeft: 2 }} />
  return null
}

function TriggerLeadingIcon({ selectedTarget, showWarning }: { selectedTarget: AiTarget; showWarning: boolean }) {
  if (showWarning) return <AlertTriangle size={13} weight="regular" />
  if (selectedTarget.kind === 'agent') return <AiAgentIcon agent={selectedTarget.agent} size={13} />
  return <Sparkle size={13} weight="regular" />
}

function targetTriggerText(selectedTarget: AiTarget, defaultAgent: AiAgentId): string {
  return selectedTarget.kind === 'api_model' ? selectedTarget.shortLabel : triggerLabel(defaultAgent)
}

function triggerIconColor(showWarning: boolean): string {
  return showWarning ? 'var(--accent-orange)' : 'var(--muted-foreground)'
}

type AiAgentsBadgeButtonProps = ComponentPropsWithoutRef<typeof Button> & {
  ariaLabel: string
  compact: boolean
  defaultAgent: AiAgentId
  selectedTarget: AiTarget
  showSwitcherCue: boolean
  showWarning: boolean
  title: string
}

const AiAgentsBadgeButton = forwardRef<HTMLButtonElement, AiAgentsBadgeButtonProps>(
  function AiAgentsBadgeButton(options, ref) {
    const { ariaLabel, compact, defaultAgent, selectedTarget, showSwitcherCue, showWarning, title, ...buttonProps } =
      options
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="xs"
      className={triggerButtonClassName(compact)}
      aria-label={ariaLabel}
      title={title}
      data-tooltip-mode="native-title"
      data-testid="status-ai-agents"
      {...buttonProps}
    >
      <span style={{ ...ICON_STYLE, color: triggerIconColor(showWarning) }}>
        <TriggerLeadingIcon selectedTarget={selectedTarget} showWarning={showWarning} />
        {!compact && targetTriggerText(selectedTarget, defaultAgent)}
        <TriggerStateIcon showWarning={showWarning} showSwitcherCue={showSwitcherCue} />
      </span>
    </Button>
  )
  },
)

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
        <DropdownMenuItem onSelect={() => onRestoreGuidance?.()} data-testid="status-ai-guidance-restore">
          {translate(locale, 'status.ai.restoreGuidance')}
        </DropdownMenuItem>
      )}
    </>
  )
}

function InstalledAgentsMenu({
  agents,
  locale,
  selectedValue,
  statuses,
  onSetDefaultAgent,
  onSetDefaultTarget,
}: {
  agents: AiAgentDefinition[]
  locale: AppLocale
  selectedValue?: AiAgentId
  statuses: AiAgentsStatus
  onSetDefaultAgent?: (agent: AiAgentId) => void
  onSetDefaultTarget?: (target: string) => void
}) {
  if (agents.length === 0) {
    return <DropdownMenuItem disabled>{translate(locale, 'status.ai.noAgents')}</DropdownMenuItem>
  }

  return (
    <DropdownMenuRadioGroup
      value={selectedValue}
      onValueChange={(value) => {
        onSetDefaultAgent?.(value as AiAgentId)
        onSetDefaultTarget?.(`agent:${value}`)
      }}
    >
      {agents.map((definition) => (
        <DropdownMenuRadioItem key={definition.id} value={definition.id} className="gap-2">
          <AiAgentIcon agent={definition.id} size={16} />
          <span>{definition.label}</span>
          <span className="ml-auto text-xs text-muted-foreground">{statusText(statuses, definition)}</span>
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

function AgentMenuContent(
  options: AiAgentsBadgeProps & {
    selectedTarget: AiTarget
    selectedAgentReady: boolean
  },
) {
  const {
    statuses,
    guidanceStatus,
    providers = [],
    selectedTarget,
    selectedAgentReady,
    onSetDefaultAgent,
    onSetDefaultTarget,
    onRestoreGuidance,
    locale = 'en',
  } = options
  const installedAgents = installedAgentDefinitions(statuses)
  const modelTargets = configuredModelTargets(providers)
  const selectedAgentValue = selectedTarget.kind === 'agent' && selectedAgentReady ? selectedTarget.agent : undefined

  return (
    <DropdownMenuContent align="start" side="top" className="min-w-[18rem]" data-testid="status-ai-agents-menu">
      <DropdownMenuLabel>{menuHeading(locale, selectedTarget, selectedAgentReady)}</DropdownMenuLabel>
      <InstalledAgentsMenu
        agents={installedAgents}
        locale={locale}
        selectedValue={selectedAgentValue}
        statuses={statuses}
        onSetDefaultAgent={onSetDefaultAgent}
        onSetDefaultTarget={onSetDefaultTarget}
      />
      <ModelTargetMenuSection
        targets={modelTargets}
        selectedTarget={selectedTarget}
        locale={locale}
        onSetDefaultTarget={onSetDefaultTarget}
      />
      <GuidanceMenuSection guidanceStatus={guidanceStatus} locale={locale} onRestoreGuidance={onRestoreGuidance} />
    </DropdownMenuContent>
  )
}

function ModelTargetMenuSection({
  targets,
  selectedTarget,
  locale,
  onSetDefaultTarget,
}: {
  targets: ReturnType<typeof configuredModelTargets>
  selectedTarget: AiTarget
  locale: AppLocale
  onSetDefaultTarget?: (target: string) => void
}) {
  if (targets.length === 0) return null

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{translate(locale, 'status.ai.modelTargets')}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={selectedTarget.kind === 'api_model' ? selectedTarget.id : undefined}
        onValueChange={(value) => onSetDefaultTarget?.(value)}
      >
        {targets.map((target) => (
          <DropdownMenuRadioItem key={target.id} value={target.id}>
            <span>{target.label}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {target.provider.kind === 'ollama' || target.provider.kind === 'lm_studio'
                ? translate(locale, 'status.ai.localChat')
                : translate(locale, 'status.ai.apiChat')}
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  )
}

interface AiAgentsBadgeMenuProps {
  compact: boolean
  locale: AppLocale
  options: AiAgentsBadgeProps
  selectedAgentReady: boolean
  selectedTarget: AiTarget
  showSwitcherCue: boolean
  showWarning: boolean
  tooltip: string
}

function AiAgentsBadgeMenu(menuOptions: AiAgentsBadgeMenuProps) {
  const { compact, locale, options, selectedAgentReady, selectedTarget, showSwitcherCue, showWarning, tooltip } = menuOptions
  return (
    <>
      <CompactSeparator compact={compact} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild={true}>
          <AiAgentsBadgeButton ariaLabel={translate(locale, 'status.ai.openOptions')} compact={compact} defaultAgent={options.defaultAgent} selectedTarget={selectedTarget} showSwitcherCue={showSwitcherCue} showWarning={showWarning} title={tooltip} />
        </DropdownMenuTrigger>
        <AgentMenuContent statuses={options.statuses} guidanceStatus={options.guidanceStatus} defaultAgent={options.defaultAgent} defaultTarget={options.defaultTarget} providers={options.providers ?? []} onSetDefaultAgent={options.onSetDefaultAgent} onSetDefaultTarget={options.onSetDefaultTarget} onRestoreGuidance={options.onRestoreGuidance} selectedTarget={selectedTarget} selectedAgentReady={selectedAgentReady} locale={locale} />
      </DropdownMenu>
    </>
  )
}

export function AiAgentsBadge(options: AiAgentsBadgeProps) {
  const {
    statuses,
    guidanceStatus,
    defaultAgent,
    defaultTarget,
    providers = [],
    onOpenWorkspace,
    compact = false,
    locale = 'en',
  } = options
  const selectedTarget = resolveAiTarget({
    default_ai_agent: defaultAgent,
    default_ai_target: defaultTarget,
    ai_model_providers: providers,
  } as Settings)
  const selectedAgentReady = selectedTarget.kind === 'api_model' || isAiAgentInstalled(statuses, defaultAgent)
  const showWarning = selectedTarget.kind === 'agent' && hasAiAgentWarning(statuses, defaultAgent, guidanceStatus)
  const showSwitcherCue = !showWarning && canShowSwitcherCue(statuses, defaultAgent)
  const tooltip =
    selectedTarget.kind === 'api_model'
      ? translate(locale, 'status.ai.defaultTarget', {
          target: selectedTarget.label,
        })
    : badgeTooltip(locale, statuses, defaultAgent, guidanceStatus)

  if (isAiAgentsStatusChecking(statuses)) return null

  if (onOpenWorkspace) {
    const label = translate(locale, 'status.ai.openWorkspace')

    return (
      <>
        <CompactSeparator compact={compact} />
        <AiAgentsBadgeButton
          ariaLabel={label}
          compact={compact}
          defaultAgent={defaultAgent}
          onClick={onOpenWorkspace}
          selectedTarget={selectedTarget}
          showSwitcherCue={showSwitcherCue}
          showWarning={showWarning}
          title={label}
        />
      </>
    )
  }

  return <AiAgentsBadgeMenu compact={compact} locale={locale} options={options} selectedAgentReady={selectedAgentReady} selectedTarget={selectedTarget} showSwitcherCue={showSwitcherCue} showWarning={showWarning} tooltip={tooltip} />
}
