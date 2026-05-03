import { ArrowUpRight, Bot, CheckCircle2, Cloud, HardDrive, Loader2, Terminal } from 'lucide-react'
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
      description: 'Checking coding agents. You can also use a local model or API provider.',
      icon: <Loader2 className="size-7 animate-spin" />,
      title: 'Checking AI agents',
    }
  }

  if (!hasAnyInstalledAiAgent(statuses)) {
    return {
      accentClassName: 'bg-[var(--feedback-warning-bg)] text-[var(--feedback-warning-text)]',
      description: 'Connect a local model, an API provider, or a desktop coding agent.',
      icon: <Bot className="size-7" />,
      title: 'Choose how Tolaria should use AI',
    }
  }

  return {
    accentClassName: 'bg-[var(--feedback-success-bg)] text-[var(--feedback-success-text)]',
    description: 'You can use the detected coding agents, or add local/API models in Settings.',
    icon: <CheckCircle2 className="size-7" />,
    title: 'AI is ready',
  }
}

function AiModeChoices() {
  const choices = [
    {
      icon: <HardDrive className="size-4" />,
      title: 'Local model',
      description: 'Use Ollama, LM Studio, or another local OpenAI-compatible endpoint. API keys are usually not needed.',
    },
    {
      icon: <Cloud className="size-4" />,
      title: 'API provider',
      description: 'Use OpenAI, Anthropic, OpenRouter, or a gateway. API keys are read from environment variables, not saved in settings.',
    },
    {
      icon: <Terminal className="size-4" />,
      title: 'Coding agent',
      description: 'Use Claude Code, Codex, OpenCode, Gemini CLI, or Pi for tool-capable vault editing on desktop.',
    },
  ]

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {choices.map((choice) => (
        <div key={choice.title} className="rounded-lg border border-border bg-muted/20 p-3 text-left">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
            {choice.icon}
            {choice.title}
          </div>
          <div className="text-xs leading-5 text-muted-foreground">{choice.description}</div>
        </div>
      ))}
    </div>
  )
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
  const showLegacyClaudeCompatibility = statuses.claude_code.status !== 'installed'
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

        <CardContent className="space-y-4">
          <AiModeChoices />
          {showLegacyClaudeCompatibility ? (
            <div
              className="rounded-lg border border-[var(--feedback-warning-border)] bg-[var(--feedback-warning-bg)] px-4 py-3 text-left"
              data-testid="claude-onboarding-screen"
            >
              <div className="text-sm font-medium text-[var(--feedback-warning-text)]">Claude Code not detected</div>
              <p className="mt-1 text-xs leading-5 text-[var(--feedback-warning-text)]">
                Install Claude Code or continue without it.
              </p>
            </div>
          ) : null}
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
              data-testid={showLegacyClaudeCompatibility ? 'claude-onboarding-continue' : undefined}
            >
              {hasAnyInstalledAiAgent(statuses) ? 'Continue' : 'Set up later'}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </OnboardingShell>
  )
}
