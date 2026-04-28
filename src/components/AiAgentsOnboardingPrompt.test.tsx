import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiAgentsOnboardingPrompt } from './AiAgentsOnboardingPrompt'

const openExternalUrl = vi.fn()
const dragRegionMouseDown = vi.fn()

vi.mock('../utils/url', () => ({
  openExternalUrl: (...args: unknown[]) => openExternalUrl(...args),
}))
vi.mock('../hooks/useDragRegion', () => ({
  useDragRegion: () => ({ onMouseDown: dragRegionMouseDown }),
}))

describe('AiAgentsOnboardingPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the ready state when at least one agent is installed', () => {
    render(
      <AiAgentsOnboardingPrompt
        statuses={{
          claude_code: { status: 'installed', version: '1.0.20' },
          codex: { status: 'missing', version: null },
          opencode: { status: 'missing', version: null },
          pi: { status: 'missing', version: null },
        }}
        onContinue={vi.fn()}
      />,
    )

    expect(screen.getByText('AI agents ready')).toBeInTheDocument()
    expect(screen.getByTestId('ai-agents-onboarding-install-codex')).toBeInTheDocument()
    expect(screen.getByTestId('ai-agents-onboarding-install-opencode')).toBeInTheDocument()
    expect(screen.getByTestId('ai-agents-onboarding-install-pi')).toBeInTheDocument()
    expect(screen.getByTestId('ai-agents-onboarding-continue')).toHaveTextContent('Continue')
  })

  it('shows the missing state when no agents are installed', () => {
    render(
      <AiAgentsOnboardingPrompt
        statuses={{
          claude_code: { status: 'missing', version: null },
          codex: { status: 'missing', version: null },
          opencode: { status: 'missing', version: null },
          pi: { status: 'missing', version: null },
        }}
        onContinue={vi.fn()}
      />,
    )

    expect(screen.getByText('No AI agents detected')).toBeInTheDocument()
    expect(screen.getByTestId('claude-onboarding-screen')).toBeInTheDocument()
    expect(screen.getByText('Claude Code not detected')).toBeInTheDocument()
    expect(screen.getByTestId('ai-agents-onboarding-install-claude_code')).toBeInTheDocument()
    expect(screen.getByTestId('ai-agents-onboarding-install-codex')).toBeInTheDocument()
    expect(screen.getByTestId('ai-agents-onboarding-install-opencode')).toBeInTheDocument()
    expect(screen.getByTestId('ai-agents-onboarding-install-pi')).toBeInTheDocument()
    expect(screen.getByTestId('ai-agents-onboarding-continue')).toHaveTextContent('Continue without it')
  })

  it('opens the agent install links', () => {
    render(
      <AiAgentsOnboardingPrompt
        statuses={{
          claude_code: { status: 'missing', version: null },
          codex: { status: 'missing', version: null },
          opencode: { status: 'missing', version: null },
          pi: { status: 'missing', version: null },
        }}
        onContinue={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('ai-agents-onboarding-install-claude_code'))
    fireEvent.click(screen.getByTestId('ai-agents-onboarding-install-codex'))
    fireEvent.click(screen.getByTestId('ai-agents-onboarding-install-opencode'))
    fireEvent.click(screen.getByTestId('ai-agents-onboarding-install-pi'))

    expect(openExternalUrl).toHaveBeenCalledWith('https://docs.anthropic.com/en/docs/claude-code')
    expect(openExternalUrl).toHaveBeenCalledWith('https://developers.openai.com/codex/cli')
    expect(openExternalUrl).toHaveBeenCalledWith('https://opencode.ai/docs/')
    expect(openExternalUrl).toHaveBeenCalledWith('https://pi.dev')
  })

  it('uses the surrounding surface as a drag region and excludes the card', () => {
    render(
      <AiAgentsOnboardingPrompt
        statuses={{
          claude_code: { status: 'installed', version: '1.0.20' },
          codex: { status: 'missing', version: null },
          opencode: { status: 'missing', version: null },
          pi: { status: 'missing', version: null },
        }}
        onContinue={vi.fn()}
      />,
    )

    const screenContainer = screen.getByTestId('ai-agents-onboarding-screen')
    fireEvent.mouseDown(screenContainer)

    expect(dragRegionMouseDown).toHaveBeenCalledOnce()
    expect(screenContainer.querySelector('[data-no-drag]')).not.toBeNull()
  })
})
