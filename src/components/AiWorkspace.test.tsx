import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { AiWorkspace } from './AiWorkspace'
import { buildAiWorkspaceTargetGroups } from './aiWorkspaceTargetGroups'
import {
  createAiAgentAvailability,
  createMissingAiAgentsStatus,
  type AiAgentsStatus,
} from '../lib/aiAgents'
import type { AiModelProvider } from '../lib/aiTargets'
import { resetVaultConfigStore } from '../utils/vaultConfigStore'

vi.mock('./useAiPanelController', () => ({
  useAiPanelController: () => ({
    agent: {
      messages: [],
      status: 'idle',
      sendMessage: vi.fn(),
      clearConversation: vi.fn(),
      addLocalMarker: vi.fn(),
    },
    input: '',
    setInput: vi.fn(),
    linkedEntries: [],
    hasContext: false,
    isActive: false,
    permissionMode: 'safe',
    handleSend: vi.fn(),
    handleNavigateWikilink: vi.fn(),
    handlePermissionModeChange: vi.fn(),
    handleNewChat: vi.fn(),
  }),
}))

vi.mock('./AiPanel', () => ({
  AiPanelView: ({ showHeader }: { showHeader?: boolean }) => (
    <div data-testid="ai-panel-view" data-show-header={String(showHeader)}>Chat surface</div>
  ),
}))

function installedStatuses(): AiAgentsStatus {
  return {
    ...createMissingAiAgentsStatus(),
    claude_code: createAiAgentAvailability('installed', '1.0.0'),
    codex: createAiAgentAvailability('installed', '0.9.0'),
    gemini: createAiAgentAvailability('missing', null),
  }
}

const providers: AiModelProvider[] = [
  {
    id: 'ollama-local',
    name: 'Ollama',
    kind: 'ollama',
    api_key_storage: 'none',
    models: [{
      id: 'llama3.2',
      display_name: 'Llama 3.2',
      capabilities: { streaming: true, tools: false, vision: false, json_mode: false, reasoning: false },
    }],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'open_ai',
    api_key_storage: 'env',
    api_key_env_var: 'OPENAI_API_KEY',
    models: [{
      id: 'gpt-4.1',
      display_name: 'GPT-4.1',
      capabilities: { streaming: true, tools: true, vision: true, json_mode: true, reasoning: true },
    }],
  },
]

describe('AiWorkspace', () => {
  beforeEach(() => {
    resetVaultConfigStore()
  })

  it('groups installed agents and configured local/API models', () => {
    const groups = buildAiWorkspaceTargetGroups(installedStatuses(), providers)

    expect(groups.localAgents.map((target) => target.agent)).toEqual(['claude_code', 'codex'])
    expect(groups.localAgents.some((target) => target.agent === 'gemini')).toBe(false)
    expect(groups.localModels.map((target) => target.shortLabel)).toEqual(['Llama 3.2'])
    expect(groups.apiModels.map((target) => target.shortLabel)).toEqual(['GPT-4.1'])
  })

  it('creates chats from the sidebar and hides the legacy AI panel header', () => {
    render(<AiWorkspace open mode="docked" aiAgentsStatus={installedStatuses()} aiModelProviders={providers} vaultPath="/tmp/vault" onClose={vi.fn()} />)

    expect(screen.getByTestId('ai-workspace')).toHaveAttribute('data-ai-workspace-mode', 'docked')
    expect(screen.getByTestId('ai-panel-view')).toHaveAttribute('data-show-header', 'false')
    expect(screen.queryByText('AI Agent')).toBeNull()

    fireEvent.click(screen.getByTestId('ai-workspace-sidebar-new-chat'))

    expect(screen.getAllByText('Chat 1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Chat 2').length).toBeGreaterThan(0)
  })

  it('shows grouped target choices without missing agents', async () => {
    render(<AiWorkspace open mode="docked" aiAgentsStatus={installedStatuses()} aiModelProviders={providers} vaultPath="/tmp/vault" onClose={vi.fn()} />)

    const trigger = screen.getByTestId('ai-workspace-target-trigger')
    act(() => {
      trigger.focus()
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    })
    const menu = await screen.findByRole('menu')

    expect(within(menu).getByText('Local agents')).toBeTruthy()
    expect(within(menu).getByText('Local models')).toBeTruthy()
    expect(within(menu).getByText('API models')).toBeTruthy()
    expect(within(menu).getByText('Claude Code')).toBeTruthy()
    expect(within(menu).getByText('Codex')).toBeTruthy()
    expect(within(menu).queryByText('Gemini CLI')).toBeNull()
    expect(within(menu).getByText('Ollama · Llama 3.2')).toBeTruthy()
    expect(within(menu).getByText('OpenAI · GPT-4.1')).toBeTruthy()
  })
})
