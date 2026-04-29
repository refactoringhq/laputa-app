import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AiAgentsBadge } from './AiAgentsBadge'

vi.mock('../../utils/url', async () => {
  const actual = await vi.importActual('../../utils/url')
  return { ...actual, openExternalUrl: vi.fn().mockResolvedValue(undefined) }
})

const installedStatuses = {
  claude_code: { status: 'installed' as const, version: '1.0.20' },
  codex: { status: 'installed' as const, version: '0.37.0' },
  opencode: { status: 'installed' as const, version: '0.3.1' },
  pi: { status: 'installed' as const, version: '0.70.2' },
  gemini: { status: 'installed' as const, version: '0.5.1' },
}

function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: TooltipProvider })
}

describe('AiAgentsBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the dropdown trigger off the Radix tooltip popper path', () => {
    render(
      <AiAgentsBadge
        statuses={installedStatuses}
        defaultAgent="claude_code"
        onSetDefaultAgent={vi.fn()}
      />,
    )

    const trigger = screen.getByTestId('status-ai-agents')
    expect(trigger).toHaveAttribute('data-tooltip-mode', 'native-title')
    expect(trigger.getAttribute('title')).toContain('Claude Code')

    act(() => {
      trigger.focus()
    })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    act(() => {
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    })
    expect(screen.getByTestId('status-ai-agents-menu')).toBeInTheDocument()
  })

  it('shows the vault guidance summary and restore action', async () => {
    const onRestoreGuidance = vi.fn()

    render(
      <AiAgentsBadge
        statuses={installedStatuses}
        guidanceStatus={{
          agentsState: 'missing',
          claudeState: 'managed',
          geminiState: 'managed',
          canRestore: true,
        }}
        defaultAgent="claude_code"
        onSetDefaultAgent={vi.fn()}
        onRestoreGuidance={onRestoreGuidance}
      />,
    )

    act(() => {
      const trigger = screen.getByTestId('status-ai-agents')
      trigger.focus()
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    })

    expect(screen.getByTestId('status-ai-guidance-summary')).toHaveTextContent('Tolaria guidance missing or broken')
    act(() => {
      fireEvent.click(screen.getByTestId('status-ai-guidance-restore'))
    })
    expect(onRestoreGuidance).toHaveBeenCalledOnce()
  })

  it('supports opening the menu and restoring guidance from the keyboard', () => {
    const onRestoreGuidance = vi.fn()

    render(
      <AiAgentsBadge
        statuses={installedStatuses}
        guidanceStatus={{
          agentsState: 'managed',
          claudeState: 'broken',
          geminiState: 'managed',
          canRestore: true,
        }}
        defaultAgent="claude_code"
        onSetDefaultAgent={vi.fn()}
        onRestoreGuidance={onRestoreGuidance}
      />,
    )

    act(() => {
      const trigger = screen.getByTestId('status-ai-agents')
      trigger.focus()
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    })

    const restoreItem = screen.getByTestId('status-ai-guidance-restore')
    act(() => {
      restoreItem.focus()
      fireEvent.keyDown(restoreItem, { key: 'Enter' })
    })

    expect(onRestoreGuidance).toHaveBeenCalledOnce()
  })
})
