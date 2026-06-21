import { ArrowUpRight, CaretDown, CheckCircle as CheckCircle2, CircleNotch as Loader2, Robot as Bot } from '@phosphor-icons/react'
import {
  AI_AGENT_DEFINITIONS,
  getAiAgentAvailability,
  getAiAgentDefinition,
  hasAnyInstalledAiAgent,
  isAiAgentsStatusChecking,
  type AiAgentDefinition,
  type AiAgentsStatus,
} from '../lib/aiAgents'
import { translate, type AppLocale } from '../lib/i18n'
import { openExternalUrl } from '../utils/url'
import { AiAgentIcon } from './AiAgentIcon'
import { OnboardingShell } from './OnboardingShell'
import { Button } from './ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

interface AiAgentsOnboardingPromptProps {
  statuses: AiAgentsStatus
  onContinue: () => void
  locale?: AppLocale
}

interface InfoPanelProps {
  description: string
  testId?: string
  textAlign?: 'left' | 'center'
  title: string
}

function getPromptCopy(statuses: AiAgentsStatus, locale: AppLocale) {
  if (isAiAgentsStatusChecking(statuses)) {
    return {
      accentClassName: 'bg-muted text-muted-foreground',
      description: translate(locale, 'onboarding.ai.checkingDescription'),
      icon: <Loader2 className="size-7 animate-spin" />,
      title: translate(locale, 'onboarding.ai.checkingTitle'),
    }
  }

  if (!hasAnyInstalledAiAgent(statuses)) {
    return {
      accentClassName: 'bg-[var(--feedback-warning-bg)] text-[var(--feedback-warning-text)]',
      description: translate(locale, 'onboarding.ai.missingDescription'),
      icon: <Bot className="size-7" />,
      title: translate(locale, 'onboarding.ai.missingTitle'),
    }
  }

  return {
    accentClassName: 'bg-[var(--feedback-success-bg)] text-[var(--feedback-success-text)]',
    description: translate(locale, 'onboarding.ai.readyDescription'),
    icon: <CheckCircle2 className="size-7" />,
    title: translate(locale, 'onboarding.ai.readyTitle'),
  }
}

function installedAgentDefinitions(statuses: AiAgentsStatus): AiAgentDefinition[] {
  return AI_AGENT_DEFINITIONS.filter((definition) => {
    return getAiAgentAvailability(statuses, definition.id).status === 'installed'
  })
}

function InfoPanel({
  description,
  testId,
  textAlign = 'left',
  title,
}: InfoPanelProps) {
  const textAlignClass = textAlign === 'center' ? 'text-center' : 'text-left'
  return (
    <div className={`rounded-lg border border-border bg-muted/20 px-4 py-4 ${textAlignClass}`} data-testid={testId}>
      <div className="text-sm font-medium text-foreground">
        {title}
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {description}
      </p>
    </div>
  )
}

function DetectedAgentsList({
  agents,
  locale,
  statuses,
}: {
  agents: AiAgentDefinition[]
  locale: AppLocale
  statuses: AiAgentsStatus
}) {
  return (
    <div className="space-y-2" data-testid="ai-agents-onboarding-detected-list">
      <div className="text-xs font-semibold uppercase text-muted-foreground">
        {translate(locale, 'onboarding.ai.detectedHeader')}
      </div>
      {agents.map((definition) => {
        const status = getAiAgentAvailability(statuses, definition.id)
        return (
          <div
            key={definition.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm"
          >
            <div className="flex min-w-0 items-center gap-3 text-left">
              <AiAgentIcon agent={definition.id} size={18} />
              <div className="min-w-0">
                <div className="font-medium text-foreground">{definition.label}</div>
                <div className="text-xs text-muted-foreground">
                  {status.version
                    ? translate(locale, 'onboarding.ai.installedVersion', { version: status.version })
                    : translate(locale, 'onboarding.ai.installed')}
                </div>
              </div>
            </div>
            <span className="rounded-full bg-[var(--feedback-success-bg)] px-2 py-1 text-[11px] font-medium text-[var(--feedback-success-text)]">
              {translate(locale, 'onboarding.ai.installedBadge')}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function SupportedAgentsMenu({ locale }: { locale: AppLocale }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" data-testid="ai-agents-onboarding-supported-menu">
          {translate(locale, 'onboarding.ai.supportedAgents')}
          <CaretDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-[240px]">
        {AI_AGENT_DEFINITIONS.map((definition) => (
          <DropdownMenuItem
            key={definition.id}
            className="gap-2"
            onSelect={() => void openExternalUrl(getAiAgentDefinition(definition.id).installUrl)}
            data-testid={`ai-agents-onboarding-install-${definition.id}`}
          >
            <AiAgentIcon agent={definition.id} size={16} />
            <span className="min-w-0 flex-1">{definition.label}</span>
            <ArrowUpRight className="size-4" />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AiSetupSummary({ locale }: { locale: AppLocale }) {
  return (
    <InfoPanel
      title={translate(locale, 'onboarding.ai.otherOptionsTitle')}
      description={translate(locale, 'onboarding.ai.otherOptionsDescription')}
    />
  )
}

function CheckingAgents({ locale }: { locale: AppLocale }) {
  return (
    <InfoPanel
      title={translate(locale, 'onboarding.ai.checkingLocalTitle')}
      description={translate(locale, 'onboarding.ai.checkingLocalDescription')}
      textAlign="center"
      testId="ai-agents-onboarding-checking"
    />
  )
}

export function AiAgentsOnboardingPrompt({
  statuses,
  onContinue,
  locale = 'en',
}: AiAgentsOnboardingPromptProps) {
  const copy = getPromptCopy(statuses, locale)
  const checking = isAiAgentsStatusChecking(statuses)
  const installedAgents = installedAgentDefinitions(statuses)
  const showDetectedAgents = !checking && installedAgents.length > 0

  return (
    <OnboardingShell
      className="bg-sidebar px-6 py-10"
      contentClassName="w-full max-w-2xl"
      testId="ai-agents-onboarding-screen"
    >
      <Card
        className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden border-border bg-background shadow-sm"
        data-testid="ai-agents-onboarding-card"
      >
        <CardHeader className="shrink-0 items-center gap-5 text-center">
          <div className={`flex size-16 items-center justify-center rounded-2xl ${copy.accentClassName}`}>
            {copy.icon}
          </div>
          <div className="space-y-2">
            <CardTitle className="text-3xl">
              {copy.title}
            </CardTitle>
            <p className="text-sm leading-6 text-muted-foreground" data-testid="ai-agents-onboarding-description">
              {copy.description}
            </p>
          </div>
        </CardHeader>

        <CardContent
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain"
          data-testid="ai-agents-onboarding-scroll"
        >
          {checking ? <CheckingAgents locale={locale} /> : null}
          {showDetectedAgents ? (
            <DetectedAgentsList agents={installedAgents} statuses={statuses} locale={locale} />
          ) : null}
          <AiSetupSummary locale={locale} />
        </CardContent>

        <CardFooter className="shrink-0 flex-wrap justify-center gap-3">
          <SupportedAgentsMenu locale={locale} />
          <div data-testid="ai-agents-onboarding-continue">
            <Button
              type="button"
              onClick={onContinue}
              disabled={checking}
            >
              {hasAnyInstalledAiAgent(statuses)
                ? translate(locale, 'onboarding.ai.continue')
                : translate(locale, 'onboarding.ai.setUpLater')}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </OnboardingShell>
  )
}
