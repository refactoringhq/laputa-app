import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { AiPanel } from './AiPanel'
import { UNSUPPORTED_INLINE_PASTE_MESSAGE } from './InlineWikilinkInput'
import type { VaultEntry } from '../types'
import { queueAiPrompt } from '../utils/aiPromptBridge'
import { bindVaultConfigStore, getVaultConfig, resetVaultConfigStore } from '../utils/vaultConfigStore'

// Mock the hooks and utils to isolate component tests
let mockMessages: ReturnType<typeof import('../hooks/useCliAiAgent').useCliAiAgent>['messages'] = []
let mockStatus: ReturnType<typeof import('../hooks/useCliAiAgent').useCliAiAgent>['status'] = 'idle'
const mockSendMessage = vi.fn()
const mockClearConversation = vi.fn()
const mockAddLocalMarker = vi.fn()
const mockUseCliAiAgent = vi.fn()

vi.mock('../hooks/useCliAiAgent', () => ({
  useCliAiAgent: (...args: unknown[]) => {
    mockUseCliAiAgent(...args)
    return {
      messages: mockMessages,
      status: mockStatus,
      sendMessage: mockSendMessage,
      clearConversation: mockClearConversation,
      addLocalMarker: mockAddLocalMarker,
    }
  },
}))

vi.mock('../utils/ai-chat', () => ({
  nextMessageId: () => `msg-${Date.now()}`,
}))

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/vault/note/test.md',
  filename: 'test.md',
  title: 'Test Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  owner: null,
  cadence: null,
  archived: false,
  modifiedAt: 1700000000,
  createdAt: 1700000000,
  fileSize: 100,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  sidebarLabel: null,
  template: null,
  sort: null,
  view: null,
  visible: null,
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  outgoingLinks: [],
  properties: {},
  hasH1: false,
  ...overrides,
})

describe('AiPanel', () => {
  beforeEach(() => {
    mockMessages = []
    mockStatus = 'idle'
    mockSendMessage.mockReset()
    mockClearConversation.mockReset()
    mockAddLocalMarker.mockReset()
    mockUseCliAiAgent.mockReset()
    resetVaultConfigStore()
    bindVaultConfigStore({
      zoom: null,
      view_mode: null,
      editor_mode: null,
      note_layout: null,
      tag_colors: null,
      status_colors: null,
      property_display_modes: null,
      inbox: null,
      allNotes: null,
      ai_agent_permission_mode: 'safe',
    }, vi.fn())
  })

  it('renders panel with the default CLI agent header', () => {
    render(<AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" />)
    expect(screen.getByText('AI Agent')).toBeTruthy()
    expect(screen.getByText('Claude Code · Safe')).toBeTruthy()
  })

  it('passes the vault permission mode to the AI agent session', () => {
    bindVaultConfigStore({
      ...getVaultConfig(),
      ai_agent_permission_mode: 'power_user',
    }, vi.fn())

    render(<AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" />)

    expect(screen.getByText('Claude Code · Power User')).toBeTruthy()
    expect(mockUseCliAiAgent).toHaveBeenCalledWith(
      '/tmp/vault',
      undefined,
      expect.any(Object),
      expect.objectContaining({ permissionMode: 'power_user' }),
    )
  })

  it('persists permission mode changes and records a local transcript marker', () => {
    const save = vi.fn()
    bindVaultConfigStore({
      ...getVaultConfig(),
      ai_agent_permission_mode: 'safe',
    }, save)
    mockMessages = [{
      userMessage: 'Existing question',
      actions: [],
      response: 'Existing answer.',
      id: 'msg-existing',
    }]

    render(<AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" />)
    fireEvent.click(screen.getByRole('button', { name: 'Power User' }))

    expect(getVaultConfig().ai_agent_permission_mode).toBe('power_user')
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({
      ai_agent_permission_mode: 'power_user',
    }))
    expect(mockAddLocalMarker).toHaveBeenCalledWith(
      'AI permission mode changed to Power User. It will apply to the next message.',
    )
  })

  it('disables permission mode changes while the AI agent is running', () => {
    mockStatus = 'thinking'

    render(<AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" />)

    expect(screen.getByRole('button', { name: 'Vault Safe' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Power User' })).toBeDisabled()
  })

  it('renders data-testid ai-panel', () => {
    render(<AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" />)
    expect(screen.getByTestId('ai-panel')).toBeTruthy()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<AiPanel onClose={onClose} vaultPath="/tmp/vault" />)
    const panel = screen.getByTestId('ai-panel')
    const buttons = panel.querySelectorAll('button')
    const closeBtn = Array.from(buttons).find(b => b.title?.includes('Close'))
    expect(closeBtn).toBeTruthy()
    fireEvent.click(closeBtn!)
    expect(onClose).toHaveBeenCalled()
  })

  it('starts a new AI chat when the header action is clicked', () => {
    render(<AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" />)
    fireEvent.click(screen.getByTitle('New AI chat'))
    expect(mockClearConversation).toHaveBeenCalledOnce()
  })

  it('copies the MCP config from the AI panel header action', () => {
    const onCopyMcpConfig = vi.fn()
    render(<AiPanel onClose={vi.fn()} onCopyMcpConfig={onCopyMcpConfig} vaultPath="/tmp/vault" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy MCP config' }))

    expect(onCopyMcpConfig).toHaveBeenCalledOnce()
  })

  it('renders empty state without context', () => {
    render(<AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" />)
    expect(screen.getByText('Open a note, then ask Claude Code about it')).toBeTruthy()
  })

  it('renders contextual empty state when active entry is provided', () => {
    const entry = makeEntry({ title: 'My Note' })
    render(
      <AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" activeEntry={entry} entries={[entry]} />
    )
    expect(screen.getByText('Ask Claude Code about this note and its linked context')).toBeTruthy()
  })

  it('shows context bar with active entry title', () => {
    const entry = makeEntry({ title: 'My Note' })
    render(
      <AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" activeEntry={entry} entries={[entry]} />
    )
    expect(screen.getByTestId('context-bar')).toBeTruthy()
    expect(screen.getByText('My Note')).toBeTruthy()
  })

  it('shows linked count in context bar when entry has outgoing links', () => {
    const linked = makeEntry({ path: '/vault/linked.md', title: 'Linked Note' })
    const entry = makeEntry({ title: 'My Note', outgoingLinks: ['Linked Note'] })
    render(
      <AiPanel
        onClose={vi.fn()} vaultPath="/tmp/vault"
        activeEntry={entry} entries={[entry, linked]}
             />
    )
    expect(screen.getByText('+ 1 linked')).toBeTruthy()
  })

  it('does not show context bar when no active entry', () => {
    render(<AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" />)
    expect(screen.queryByTestId('context-bar')).toBeNull()
  })

  it('renders input field enabled', () => {
    render(<AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" />)
    const input = screen.getByTestId('agent-input')
    expect(input).toBeTruthy()
    expect(input).toHaveAttribute('contenteditable', 'true')
  })

  it('has send button disabled when input is empty', () => {
    render(<AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" />)
    const sendBtn = screen.getByTestId('agent-send')
    expect((sendBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows active agent placeholder when active entry exists', () => {
    const entry = makeEntry({ title: 'My Note' })
    render(
      <AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" activeEntry={entry} entries={[entry]} />
    )
    const input = screen.getByTestId('agent-input')
    expect(input).toHaveAttribute('aria-placeholder', 'Ask Claude Code')
  })

  it('shows active agent placeholder when no active entry', () => {
    render(<AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" />)
    const input = screen.getByTestId('agent-input')
    expect(input).toHaveAttribute('aria-placeholder', 'Ask Claude Code')
  })

  it('uses the selected AI agent in the placeholder', () => {
    render(
      <AiPanel
        onClose={vi.fn()}
        vaultPath="/tmp/vault"
        defaultAiAgent="codex"
        defaultAiAgentReady
      />,
    )
    expect(screen.getByTestId('agent-input')).toHaveAttribute('aria-placeholder', 'Ask Codex')
  })

  it('disables sending while the selected AI agent is still loading', () => {
    render(
      <AiPanel
        onClose={vi.fn()}
        vaultPath="/tmp/vault"
        defaultAiAgent="codex"
        defaultAiAgentReadiness="checking"
      />,
    )

    expect(screen.getByText('Checking availability')).toBeTruthy()
    expect(screen.getByTestId('agent-input')).toHaveAttribute('aria-placeholder', 'Checking AI agent availability...')
    expect(screen.getByTestId('agent-send')).toBeDisabled()
  })

  it('auto-focuses input on mount', async () => {
    vi.useFakeTimers()
    render(<AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" />)
    await act(() => { vi.advanceTimersByTime(1) })
    const input = screen.getByTestId('agent-input')
    expect(document.activeElement).toBe(input)
    vi.useRealTimers()
  })

  it('focuses the panel shell when reopening with existing messages', async () => {
    vi.useFakeTimers()
    mockMessages = [{
      userMessage: 'Remember this',
      actions: [],
      response: 'Still here.',
      id: 'msg-3',
    }]
    render(<AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" />)
    await act(() => { vi.advanceTimersByTime(1) })
    expect(document.activeElement).toBe(screen.getByTestId('ai-panel'))
    vi.useRealTimers()
  })

  it('calls onClose when Escape is pressed while panel has focus', async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    render(<AiPanel onClose={onClose} vaultPath="/tmp/vault" />)
    await act(() => { vi.advanceTimersByTime(1) })
    // Input is focused inside the panel, so Escape should trigger onClose
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('calls onClose when Escape is pressed on panel element', () => {
    const onClose = vi.fn()
    render(<AiPanel onClose={onClose} vaultPath="/tmp/vault" />)
    const panel = screen.getByTestId('ai-panel')
    panel.focus()
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('clicking a wikilink in AI response calls onOpenNote with the target', () => {
    mockMessages = [{
      userMessage: 'Tell me about notes',
      actions: [],
      response: 'Check out [[Build Laputa App]] for details.',
      id: 'msg-1',
    }]
    const onOpenNote = vi.fn()
    const { container } = render(
      <AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" onOpenNote={onOpenNote} />,
    )
    const wikilink = container.querySelector('.chat-wikilink')
    expect(wikilink).toBeTruthy()
    expect(wikilink!.textContent).toBe('Build Laputa App')
    fireEvent.click(wikilink!)
    expect(onOpenNote).toHaveBeenCalledWith('Build Laputa App')
  })

  it('renders wikilinks with special characters and clicking works', () => {
    mockMessages = [{
      userMessage: 'Tell me about meetings',
      actions: [],
      response: 'See [[Meeting — 2024/01/15]] and [[Pasta Carbonara]].',
      id: 'msg-2',
    }]
    const onOpenNote = vi.fn()
    const { container } = render(
      <AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" onOpenNote={onOpenNote} />,
    )
    const wikilinks = container.querySelectorAll('.chat-wikilink')
    expect(wikilinks).toHaveLength(2)
    fireEvent.click(wikilinks[0])
    expect(onOpenNote).toHaveBeenCalledWith('Meeting — 2024/01/15')
    fireEvent.click(wikilinks[1])
    expect(onOpenNote).toHaveBeenCalledWith('Pasta Carbonara')
  })

  it('auto-sends a queued prompt from the command palette bridge', async () => {
    render(<AiPanel onClose={vi.fn()} vaultPath="/tmp/vault" entries={[makeEntry({ path: '/vault/alpha.md', filename: 'alpha.md', title: 'Alpha', isA: 'Project' })]} />)

    await act(async () => {
      queueAiPrompt('summarize [[alpha]]', [
        { title: 'Alpha', path: '/vault/alpha.md', type: 'Project' },
      ])
    })

    expect(mockClearConversation).toHaveBeenCalledOnce()
    expect(mockSendMessage).toHaveBeenCalledWith('summarize [[alpha]]', [
      { title: 'Alpha', path: '/vault/alpha.md', type: 'Project' },
    ])
    expect(screen.getByTestId('agent-send')).toBeDisabled()
  })

  it('surfaces an unsupported image paste notice without locking the composer', () => {
    const onUnsupportedAiPaste = vi.fn()
    const entry = makeEntry({ title: 'My Note' })

    render(
      <AiPanel
        onClose={vi.fn()}
        vaultPath="/tmp/vault"
        activeEntry={entry}
        entries={[entry]}
        onUnsupportedAiPaste={onUnsupportedAiPaste}
      />,
    )

    fireEvent.paste(screen.getByTestId('agent-input'), {
      clipboardData: {
        getData: vi.fn(() => ''),
        files: [new File(['image'], 'paste.png', { type: 'image/png' })],
        items: [{ kind: 'file', type: 'image/png' }],
      },
    })

    expect(onUnsupportedAiPaste).toHaveBeenCalledWith(UNSUPPORTED_INLINE_PASTE_MESSAGE)
    expect(screen.getByTestId('agent-input').textContent).not.toContain('paste.png')
  })
})
