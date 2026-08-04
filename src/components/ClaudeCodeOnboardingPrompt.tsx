import { ArrowUpRight, CheckCircle as CheckCircle2, CircleNotch as Loader2, Robot as Bot } from '@phosphor-icons/react'
import type { ClaudeCodeStatus } from '../hooks/useClaudeCodeStatus'
import { openExternalUrl } from '../utils/url'
import { Button } from './ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card'

const CLAUDE_CODE_INSTALL_URL = 'https://docs.anthropic.com/en/docs/claude-code'

interface ClaudeCodeOnboardingPromptProps {
  status: ClaudeCodeStatus
  onContinue: () => void
}

function getPromptCopy(status: ClaudeCodeStatus) {
  if (status === 'installed') {
    return {
      accentClassName: 'bg-[var(--feedback-success-bg)] text-[var(--feedback-success-text)]',
      description: "Tolaria's AI features are ready to use.",
      icon: <CheckCircle2 className="size-7" />,
      title: 'Claude Code detected',
    }
  }

  if (status === 'missing') {
    return {
      accentClassName: 'bg-[var(--feedback-warning-bg)] text-[var(--feedback-warning-text)]',
      description: 'Tolaria works best with an AI coding agent installed.',
      icon: <Bot className="size-7" />,
      title: 'Claude Code not detected',
    }
  }

  return {
    accentClassName: 'bg-muted text-muted-foreground',
    description: 'Checking whether Claude Code is available on this machine.',
    icon: <Loader2 className="size-7 animate-spin" />,
    title: 'Checking for Claude Code',
  }
}

export function ClaudeCodeOnboardingPrompt({ status, onContinue }: ClaudeCodeOnboardingPromptProps) {
  const copy = getPromptCopy(status)

  return (
    <div className="flex h-full w-full items-center justify-center bg-sidebar px-6 py-10" data-testid="claude-onboarding-screen">
      <Card className="w-full max-w-2xl border-border bg-background shadow-sm">
        <CardHeader className="items-center gap-5 text-center">
          <div className={`flex size-16 items-center justify-center rounded-2xl ${copy.accentClassName}`}>
            {copy.icon}
          </div>
          <div className="space-y-2">
            <CardTitle className="text-3xl tracking-tight">
              {copy.title}
            </CardTitle>
            <p className="text-sm leading-6 text-muted-foreground" data-testid="claude-onboarding-description">
              {status === 'installed' && '✅ '}
              {status === 'missing' && '🤖 '}
              {copy.description}
            </p>
          </div>
        </CardHeader>

        <CardContent className="space-y-3 text-center">
          {status === 'missing' && (
            <p className="text-sm leading-6 text-muted-foreground">
              Install Claude Code to enable AI-powered note management.
            </p>
          )}
        </CardContent>

        <CardFooter className="justify-center gap-3">
          {status === 'missing' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void openExternalUrl(CLAUDE_CODE_INSTALL_URL)}
              data-testid="claude-onboarding-install"
            >
              Install Claude Code
              <ArrowUpRight className="size-4" />
            </Button>
          )}
          <Button
            type="button"
            onClick={onContinue}
            disabled={status === 'checking'}
            data-testid="claude-onboarding-continue"
          >
            {status === 'missing' ? 'Continue without it' : status === 'installed' ? 'Continue' : 'Checking…'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
