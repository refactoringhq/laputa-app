import { ArrowUpRight, Bot, CheckCircle2, Loader2 } from 'lucide-react'
import {
  AI_AGENT_DEFINITIONS,
  getAiAgentDefinition,
  hasAnyInstalledAiAgent,
  isAiAgentsStatusChecking,
  type AiAgentsStatus,
} from '../lib/aiAgents'
import { openExternalUrl } from '../utils/url'
import { OnboardingShell } from './OnboardingShell'
import { Button } from './ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card'

interface AiAgentsOnboardingPromptProps {
  statuses: AiAgentsStatus
  onContinue: () => void
}

function getPromptCopy(statuses: AiAgentsStatus) {
  if (isAiAgentsStatusChecking(statuses)) {
    return {
      accentClassName: 'bg-muted text-muted-foreground',
      description: 'Checking which AI agents are available on this machine.',
      icon: <Loader2 className="size-7 animate-spin" />,
      title: 'Checking AI agents',
    }
  }

  if (!hasAnyInstalledAiAgent(statuses)) {
    return {
      accentClassName: 'bg-[var(--feedback-warning-bg)] text-[var(--feedback-warning-text)]',
      description: 'Tolaria works best with a local CLI AI agent installed.',
      icon: <Bot className="size-7" />,
      title: 'No AI agents detected',
    }
  }

  return {
    accentClassName: 'bg-[var(--feedback-success-bg)] text-[var(--feedback-success-text)]',
    description: 'Your AI agents are ready to use in Tolaria.',
    icon: <CheckCircle2 className="size-7" />,
    title: 'AI agents ready',
  }
}

function AgentStatusList({ statuses }: { statuses: AiAgentsStatus }) {
  return (
    <div className="space-y-3">
      {AI_AGENT_DEFINITIONS.map((definition) => {
        const status = statuses[definition.id]
        const ready = status.status === 'installed'
        return (
          <div
            key={definition.id}
            className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm"
          >
            <div className="space-y-1 text-left">
              <div className="font-medium text-foreground">{definition.label}</div>
              <div className="text-xs text-muted-foreground">
                {ready
                  ? `${definition.label}${status.version ? ` ${status.version}` : ''} is ready.`
                  : `${definition.label} is not installed yet.`}
              </div>
            </div>
            <span
              className={`rounded-full px-2 py-1 text-[11px] font-medium ${ready ? 'bg-[var(--feedback-success-bg)] text-[var(--feedback-success-text)]' : 'bg-[var(--feedback-warning-bg)] text-[var(--feedback-warning-text)]'}`}
            >
              {ready ? 'Installed' : 'Missing'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function AiAgentsOnboardingPrompt({
  statuses,
  onContinue,
}: AiAgentsOnboardingPromptProps) {
  const copy = getPromptCopy(statuses)
  const missingAgents = AI_AGENT_DEFINITIONS.filter((definition) => statuses[definition.id].status === 'missing')

  return (
    <OnboardingShell
      className="bg-sidebar px-6 py-10"
      contentClassName="w-full max-w-2xl"
      testId="ai-agents-onboarding-screen"
    >
      <Card className="border-border bg-background shadow-sm">
        <CardHeader className="items-center gap-5 text-center">
          <div className={`flex size-16 items-center justify-center rounded-2xl ${copy.accentClassName}`}>
            {copy.icon}
          </div>
          <div className="space-y-2">
            <CardTitle className="text-3xl tracking-tight">
              {copy.title}
            </CardTitle>
            <p className="text-sm leading-6 text-muted-foreground" data-testid="ai-agents-onboarding-description">
              {copy.description}
            </p>
          </div>
        </CardHeader>

        <CardContent>
          <AgentStatusList statuses={statuses} />
        </CardContent>

        <CardFooter className="flex-wrap justify-center gap-3">
          {missingAgents.map((definition) => (
            <Button
              key={definition.id}
              type="button"
              variant="outline"
              onClick={() => void openExternalUrl(getAiAgentDefinition(definition.id).installUrl)}
              data-testid={`ai-agents-onboarding-install-${definition.id}`}
            >
              Install {definition.label}
              <ArrowUpRight className="size-4" />
            </Button>
          ))}
          <div data-testid="ai-agents-onboarding-continue">
            <Button
              type="button"
              onClick={onContinue}
              disabled={isAiAgentsStatusChecking(statuses)}
            >
              {hasAnyInstalledAiAgent(statuses) ? 'Continue' : 'Continue without it'}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </OnboardingShell>
  )
}
