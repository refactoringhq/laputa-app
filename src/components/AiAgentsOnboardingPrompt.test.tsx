import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiAgentsStatus } from '../lib/aiAgents'
import { AiAgentsOnboardingPrompt } from './AiAgentsOnboardingPrompt'

const openExternalUrl = vi.fn()
const dragRegionMouseDown = vi.fn()
const missingStatuses: AiAgentsStatus = {
  claude_code: { status: 'missing', version: null },
  codex: { status: 'missing', version: null },
  opencode: { status: 'missing', version: null },
  pi: { status: 'missing', version: null },
  gemini: { status: 'missing', version: null },
  kiro: { status: 'missing', version: null },
  hermes: { status: 'missing', version: null },
}
const installLinkTargets = [
  ['ai-agents-onboarding-install-claude_code', 'https://docs.anthropic.com/en/docs/claude-code'],
  ['ai-agents-onboarding-install-codex', 'https://developers.openai.com/codex/cli'],
  ['ai-agents-onboarding-install-opencode', 'https://opencode.ai/docs/'],
  ['ai-agents-onboarding-install-pi', 'https://pi.dev'],
  ['ai-agents-onboarding-install-gemini', 'https://google-gemini.github.io/gemini-cli/'],
  ['ai-agents-onboarding-install-kiro', 'https://kiro.dev/docs/cli'],
  ['ai-agents-onboarding-install-hermes', 'https://hermes-agent.nousresearch.com/docs/getting-started/quickstart'],
] as const

vi.mock('../utils/url', () => ({
  openExternalUrl: (...args: unknown[]) => openExternalUrl(...args),
}))
vi.mock('../hooks/useDragRegion', () => ({
  useDragRegion: () => ({ onMouseDown: dragRegionMouseDown }),
}))

function renderPrompt(statuses: Partial<AiAgentsStatus> = {}) {
  return render(
    <AiAgentsOnboardingPrompt
      statuses={{ ...missingStatuses, ...statuses }}
      onContinue={vi.fn()}
    />,
  )
}

function openSupportedAgentsMenu() {
  fireEvent.pointerDown(screen.getByTestId('ai-agents-onboarding-supported-menu'))
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
    expect(screen.getByText('Detected on this machine')).toBeInTheDocument()
    expect(screen.getByText('Claude Code')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-agents-onboarding-install-codex')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-agents-onboarding-continue')).toHaveTextContent('Continue')
  })

  it('shows the missing state when no agents are installed', () => {
    renderPrompt()

    expect(screen.getByText('AI setup is optional')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-agents-onboarding-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-agents-onboarding-detected-list')).not.toBeInTheDocument()
    expect(screen.getByText('More AI options')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-agents-onboarding-install-claude_code')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-agents-onboarding-continue')).toHaveTextContent('Set up later')
  })

  it('opens the supported agent install links from the menu', () => {
    renderPrompt()

    installLinkTargets.forEach(([testId]) => {
      openSupportedAgentsMenu()
      fireEvent.click(screen.getByTestId(testId))
    })

    installLinkTargets.forEach(([, url]) => {
      expect(openExternalUrl).toHaveBeenCalledWith(url)
    })
  })

  it('keeps the long setup card bounded with a scrollable content area', () => {
    renderPrompt()

    expect(screen.getByTestId('ai-agents-onboarding-card')).toHaveClass(
      'max-h-[calc(100dvh-2rem)]',
      'overflow-hidden',
    )
    expect(screen.getByTestId('ai-agents-onboarding-scroll')).toHaveClass(
      'min-h-0',
      'overflow-y-auto',
      'overscroll-contain',
    )
    expect(screen.getByTestId('ai-agents-onboarding-continue')).toHaveTextContent('Set up later')
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
