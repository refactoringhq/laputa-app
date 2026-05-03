import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiAgentStatuses } from '../lib/aiAgents'
import { AiAgentsOnboardingPrompt } from './AiAgentsOnboardingPrompt'

const openExternalUrl = vi.fn()
const dragRegionMouseDown = vi.fn()
const missingStatuses: AiAgentStatuses = {
  claude_code: { status: 'missing', version: null },
  codex: { status: 'missing', version: null },
  opencode: { status: 'missing', version: null },
  pi: { status: 'missing', version: null },
  gemini: { status: 'missing', version: null },
}
const missingAgentInstallTestIds = [
  'ai-agents-onboarding-install-codex',
  'ai-agents-onboarding-install-opencode',
  'ai-agents-onboarding-install-pi',
  'ai-agents-onboarding-install-gemini',
] as const
const installLinkTargets = [
  ['ai-agents-onboarding-install-claude_code', 'https://docs.anthropic.com/en/docs/claude-code'],
  ['ai-agents-onboarding-install-codex', 'https://developers.openai.com/codex/cli'],
  ['ai-agents-onboarding-install-opencode', 'https://opencode.ai/docs/'],
  ['ai-agents-onboarding-install-pi', 'https://pi.dev'],
  ['ai-agents-onboarding-install-gemini', 'https://google-gemini.github.io/gemini-cli/'],
] as const

vi.mock('../utils/url', () => ({
  openExternalUrl: (...args: unknown[]) => openExternalUrl(...args),
}))
vi.mock('../hooks/useDragRegion', () => ({
  useDragRegion: () => ({ onMouseDown: dragRegionMouseDown }),
}))

function renderPrompt(statuses: Partial<AiAgentStatuses> = {}) {
  return render(
    <AiAgentsOnboardingPrompt
      statuses={{ ...missingStatuses, ...statuses }}
      onContinue={vi.fn()}
    />,
  )
}

function expectMissingAgentInstallLinks() {
  missingAgentInstallTestIds.forEach(testId => {
    expect(screen.getByTestId(testId)).toBeInTheDocument()
  })
}

describe('AiAgentsOnboardingPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the ready state when at least one agent is installed', () => {
    renderPrompt({
      claude_code: { status: 'installed', version: '1.0.20' },
    })

    expect(screen.getByText('AI is ready')).toBeInTheDocument()
    expectMissingAgentInstallLinks()
    expect(screen.getByTestId('ai-agents-onboarding-continue')).toHaveTextContent('Continue')
  })

  it('shows the missing state when no agents are installed', () => {
    renderPrompt()

    expect(screen.getByText('Choose how Tolaria should use AI')).toBeInTheDocument()
    expect(screen.getByTestId('claude-onboarding-screen')).toBeInTheDocument()
    expect(screen.getByText('Claude Code not detected')).toBeInTheDocument()
    expect(screen.getByTestId('ai-agents-onboarding-install-claude_code')).toBeInTheDocument()
    expectMissingAgentInstallLinks()
    expect(screen.getByTestId('ai-agents-onboarding-continue')).toHaveTextContent('Set up later')
  })

  it('opens the agent install links', () => {
    renderPrompt()

    installLinkTargets.forEach(([testId]) => {
      fireEvent.click(screen.getByTestId(testId))
    })

    installLinkTargets.forEach(([, url]) => {
      expect(openExternalUrl).toHaveBeenCalledWith(url)
    })
  })

  it('uses the surrounding surface as a drag region and excludes the card', () => {
    renderPrompt({
      claude_code: { status: 'installed', version: '1.0.20' },
    })

    const screenContainer = screen.getByTestId('ai-agents-onboarding-screen')
    fireEvent.mouseDown(screenContainer)

    expect(dragRegionMouseDown).toHaveBeenCalledOnce()
    expect(screenContainer.querySelector('[data-no-drag]')).not.toBeNull()
  })
})
