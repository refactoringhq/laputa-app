import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AiWorkspace } from './AiWorkspace'
import { buildAiWorkspaceTargetGroups } from './aiWorkspaceTargetGroups'
import {
  createAiAgentAvailability,
  createMissingAiAgentsStatus,
  type AiAgentsStatus,
} from '../lib/aiAgents'
import type { AiModelProvider } from '../lib/aiTargets'
import type { AgentStatus } from '../hooks/useCliAiAgent'
import { resetVaultConfigStore } from '../utils/vaultConfigStore'

let mockedAgentStatus: AgentStatus = 'idle'

vi.mock('./useAiPanelController', () => ({
  useAiPanelController: () => ({
    agent: {
      messages: [],
      status: mockedAgentStatus,
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
  AiPanelView: ({
    composerControls,
    onSendPrompt,
    showHeader,
  }: {
    composerControls?: ReactNode
    onSendPrompt?: (prompt: string) => void
    showHeader?: boolean
  }) => (
    <div data-testid="ai-panel-view" data-show-header={String(showHeader)}>
      <button type="button" onClick={() => onSendPrompt?.('summarize quarterly sponsor outreach')}>
        Send mocked prompt
      </button>
      {composerControls}
    </div>
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
    mockedAgentStatus = 'idle'
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

    const workspace = screen.getByTestId('ai-workspace')
    expect(workspace).toHaveAttribute('data-ai-workspace-mode', 'docked')
    expect(workspace).toHaveStyle({ width: '560px' })
    expect(screen.getByTestId('ai-panel-view')).toHaveAttribute('data-show-header', 'false')
    expect(screen.queryByText('AI Agent')).toBeNull()
    expect(screen.queryByText('Idle')).toBeNull()

    fireEvent.click(screen.getByTestId('ai-workspace-sidebar-new-chat'))

    expect(screen.getAllByText('Chat 1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Chat 2').length).toBeGreaterThan(0)
  })

  it('resizes the docked workspace from the left edge and the sidebar split', () => {
    render(<AiWorkspace open mode="docked" aiAgentsStatus={installedStatuses()} aiModelProviders={providers} vaultPath="/tmp/vault" onClose={vi.fn()} />)

    const workspace = screen.getByTestId('ai-workspace')
    fireEvent.mouseDown(screen.getByTestId('ai-workspace-left-resize'), { clientX: 100, clientY: 20 })
    fireEvent.mouseMove(window, { clientX: 60, clientY: 20 })
    fireEvent.mouseUp(window)
    expect(workspace).toHaveStyle({ width: '600px' })

    const sidebar = screen.getByTestId('ai-workspace-sidebar-header').parentElement
    const sidebarHandle = workspace.querySelector('.cursor-col-resize:not([data-testid])')
    expect(sidebar).toHaveStyle({ width: '168px' })
    fireEvent.mouseDown(sidebarHandle as Element, { clientX: 100, clientY: 20 })
    fireEvent.mouseMove(document, { clientX: 120, clientY: 20 })
    fireEvent.mouseUp(document)
    expect(sidebar).toHaveStyle({ width: '188px' })
  })

  it('does not archive an empty chat', () => {
    render(<AiWorkspace open mode="docked" aiAgentsStatus={installedStatuses()} aiModelProviders={providers} vaultPath="/tmp/vault" onClose={vi.fn()} />)

    const archiveButtons = screen.getAllByRole('button', { name: 'Archive chat' })
    expect(archiveButtons.every((button) => button.hasAttribute('disabled'))).toBe(true)
    fireEvent.click(archiveButtons[0])

    expect(screen.getAllByText('Chat 1').length).toBeGreaterThan(0)
    expect(screen.queryByText('Chat 2')).toBeNull()
  })

  it('activates a visible chat when persisted settings start with an archived chat', () => {
    render(
      <AiWorkspace
        open
        mode="docked"
        aiAgentsStatus={installedStatuses()}
        aiModelProviders={providers}
        conversationSettings={[
          { id: 'archived-chat', title: 'Old Chat', target_id: null, archived: true },
          { id: 'visible-chat', title: 'Live Chat', target_id: null, archived: false },
        ]}
        vaultPath="/tmp/vault"
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByTestId('ai-workspace-session-visible-chat')).toHaveClass('flex')
    expect(screen.getByTestId('ai-workspace-session-archived-chat')).toHaveClass('hidden')
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

  it('renames the first chat from the first prompt and stores conversation settings', () => {
    const onConversationSettingsChange = vi.fn()
    render(<AiWorkspace open mode="docked" aiAgentsStatus={installedStatuses()} aiModelProviders={providers} vaultPath="/tmp/vault" onClose={vi.fn()} onConversationSettingsChange={onConversationSettingsChange} />)

    fireEvent.click(screen.getByText('Send mocked prompt'))

    expect(screen.getAllByText('Summarize Quarterly Sponsor Outreach').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Archive chat' }).some((button) => !button.hasAttribute('disabled'))).toBe(true)
    expect(onConversationSettingsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ title: 'Summarize Quarterly Sponsor Outreach' }),
    ])
  })

  it('renames a persisted default chat title from the first prompt', () => {
    const onConversationSettingsChange = vi.fn()
    render(
      <AiWorkspace
        open
        mode="docked"
        aiAgentsStatus={installedStatuses()}
        aiModelProviders={providers}
        conversationSettings={[{ id: 'stored-chat', title: 'Chat 1', target_id: null, archived: false }]}
        vaultPath="/tmp/vault"
        onClose={vi.fn()}
        onConversationSettingsChange={onConversationSettingsChange}
      />,
    )

    fireEvent.click(screen.getByText('Send mocked prompt'))

    expect(screen.getAllByText('Summarize Quarterly Sponsor Outreach').length).toBeGreaterThan(0)
    expect(onConversationSettingsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'stored-chat', title: 'Summarize Quarterly Sponsor Outreach' }),
    ])
  })

  it('allows a chat title to be renamed from the sidebar', () => {
    const onConversationSettingsChange = vi.fn()
    render(<AiWorkspace open mode="docked" aiAgentsStatus={installedStatuses()} aiModelProviders={providers} vaultPath="/tmp/vault" onClose={vi.fn()} onConversationSettingsChange={onConversationSettingsChange} />)

    fireEvent.doubleClick(screen.getByRole('button', { name: /chat 1/i }))
    const input = screen.getByLabelText('Rename chat')
    fireEvent.change(input, { target: { value: 'Sponsor Plan' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getAllByText('Sponsor Plan').length).toBeGreaterThan(0)
    expect(onConversationSettingsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ title: 'Sponsor Plan' }),
    ])
  })

  it('collapses the workspace sidebar from the sidebar header', () => {
    render(<AiWorkspace open mode="docked" aiAgentsStatus={installedStatuses()} aiModelProviders={providers} vaultPath="/tmp/vault" onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse AI chat list' }))

    expect(screen.queryByText('AI workspace')).toBeNull()
    expect(screen.getByRole('button', { name: 'Expand AI chat list' })).toBeTruthy()
  })
})
