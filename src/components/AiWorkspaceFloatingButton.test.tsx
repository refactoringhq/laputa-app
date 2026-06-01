import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { APP_COMMAND_IDS, getAppCommandShortcutDisplay } from '../hooks/appCommandCatalog'
import {
  createAiAgentAvailability,
  createMissingAiAgentsStatus,
  type AiAgentsStatus,
} from '../lib/aiAgents'
import { AiWorkspaceFloatingButton } from './AiWorkspaceFloatingButton'

function createCodexReadyStatus(): AiAgentsStatus {
  return {
    ...createMissingAiAgentsStatus(),
    codex: createAiAgentAvailability('installed', '0.12.0'),
  }
}

function renderButton({
  statuses = createCodexReadyStatus(),
  updateBannerVisible = false,
}: {
  statuses?: AiAgentsStatus
  updateBannerVisible?: boolean
} = {}) {
  return render(
    <TooltipProvider>
      <AiWorkspaceFloatingButton
        defaultAgent="codex"
        statuses={statuses}
        updateBannerVisible={updateBannerVisible}
        onOpen={vi.fn()}
      />
    </TooltipProvider>,
  )
}

describe('AiWorkspaceFloatingButton', () => {
  it('uses the normal bottom offset when no update banner is visible', () => {
    renderButton()

    expect(screen.getByTestId('ai-workspace-floating-button')).toHaveClass('bottom-11')
  })

  it('moves above the update banner when one is visible', () => {
    renderButton({ updateBannerVisible: true })

    expect(screen.getByTestId('ai-workspace-floating-button')).toHaveClass('bottom-[80px]')
  })

  it('uses the selected agent icon when that agent is installed', () => {
    renderButton()

    const iconImage = screen.getByTestId('ai-workspace-floating-button').querySelector('img')
    expect(iconImage).toHaveAttribute('src', '/ai-agent-icons/codex.svg')
  })

  it('falls back to sparkles when no selected agent is available', () => {
    renderButton({ statuses: createMissingAiAgentsStatus() })

    expect(screen.getByTestId('ai-workspace-floating-button').querySelector('img')).toBeNull()
  })

  it('shows the AI panel shortcut in the tooltip', async () => {
    renderButton()

    act(() => {
      fireEvent.focus(screen.getByTestId('ai-workspace-floating-button'))
    })

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('Open the AI panel')
    expect(tooltip).toHaveTextContent(getAppCommandShortcutDisplay(APP_COMMAND_IDS.viewToggleAiChat) ?? '')
  })
})
