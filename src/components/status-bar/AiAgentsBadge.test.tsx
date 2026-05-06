import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react'
import type { ComponentProps, ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AiAgentsBadge } from './AiAgentsBadge'
import type { AiModelProvider } from '../../lib/aiTargets'

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

const openAiProvider: AiModelProvider = {
  id: 'openai',
  name: 'OpenAI',
  kind: 'open_ai',
  base_url: null,
  api_key_storage: 'local_file',
  api_key_env_var: 'OPENAI_API_KEY',
  headers: null,
  models: [{
    id: 'gpt-5.5',
    display_name: null,
    context_window: null,
    max_output_tokens: null,
    capabilities: {
      streaming: true,
      tools: false,
      vision: true,
      json_mode: true,
      reasoning: true,
    },
  }],
}

function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: TooltipProvider })
}

type AiAgentsBadgeTestProps = ComponentProps<typeof AiAgentsBadge>

function renderBadge(props: Partial<AiAgentsBadgeTestProps> = {}) {
  return render(
    <AiAgentsBadge
      statuses={installedStatuses}
      defaultAgent="claude_code"
      onSetDefaultAgent={vi.fn()}
      {...props}
    />,
  )
}

function focusAiAgentsTrigger() {
  const trigger = screen.getByTestId('status-ai-agents')
  act(() => {
    trigger.focus()
  })
  return trigger
}

function openAiAgentsMenu() {
  const trigger = screen.getByTestId('status-ai-agents')
  act(() => {
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  })
}

describe('AiAgentsBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the dropdown trigger off the Radix tooltip popper path', () => {
    renderBadge()

    const trigger = focusAiAgentsTrigger()
    expect(trigger).toHaveAttribute('data-tooltip-mode', 'native-title')
    expect(trigger.getAttribute('title')).toContain('Claude Code')

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    openAiAgentsMenu()
    expect(screen.getByTestId('status-ai-agents-menu')).toBeInTheDocument()
  })

  it('selects only the active model target when an API model is the default target', () => {
    renderBadge({
      defaultTarget: 'model:openai/gpt-5.5',
      providers: [openAiProvider],
      onSetDefaultTarget: vi.fn(),
    })
    openAiAgentsMenu()

    expect(screen.getByText(/Default AI target: OpenAI.*gpt-5\.5/)).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /Claude Code/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemradio', { name: /OpenAI.*gpt-5\.5/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('shows the vault guidance summary and restore action', async () => {
    const onRestoreGuidance = vi.fn()

    renderBadge({
      guidanceStatus: {
        agentsState: 'missing',
        claudeState: 'managed',
        geminiState: 'managed',
        canRestore: true,
      },
      onRestoreGuidance,
    })
    openAiAgentsMenu()

    expect(screen.getByTestId('status-ai-guidance-summary')).toHaveTextContent('Tolaria guidance missing or broken')
    act(() => {
      fireEvent.click(screen.getByTestId('status-ai-guidance-restore'))
    })
    expect(onRestoreGuidance).toHaveBeenCalledOnce()
  })

  it('supports opening the menu and restoring guidance from the keyboard', () => {
    const onRestoreGuidance = vi.fn()

    renderBadge({
      guidanceStatus: {
        agentsState: 'managed',
        claudeState: 'broken',
        geminiState: 'managed',
        canRestore: true,
      },
      onRestoreGuidance,
    })
    openAiAgentsMenu()

    const restoreItem = screen.getByTestId('status-ai-guidance-restore')
    act(() => {
      restoreItem.focus()
      fireEvent.keyDown(restoreItem, { key: 'Enter' })
    })

    expect(onRestoreGuidance).toHaveBeenCalledOnce()
  })
})
