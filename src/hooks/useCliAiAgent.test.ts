import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCliAiAgent } from './useCliAiAgent'
import { streamAiAgent } from '../utils/streamAiAgent'
import { buildAgentSystemPrompt } from '../utils/ai-agent'
import { getAgentDocsPath } from '../lib/agentDocsPath'
import {
  cloneAiWorkspaceSessionUntilMessage,
  resetAiWorkspaceSessionStoreForTests,
} from '../lib/aiWorkspaceSessionStore'

vi.mock('../utils/streamAiAgent', () => ({
  streamAiAgent: vi.fn(),
}))

vi.mock('../utils/ai-agent', () => ({
  buildAgentSystemPrompt: vi.fn(() => 'default-system-prompt'),
}))

vi.mock('../lib/agentDocsPath', () => ({
  getAgentDocsPath: vi.fn(),
}))

const mockStreamAiAgent = vi.mocked(streamAiAgent)
const mockBuildAgentSystemPrompt = vi.mocked(buildAgentSystemPrompt)
const mockGetAgentDocsPath = vi.mocked(getAgentDocsPath)
const VAULT = '/Users/luca/Laputa'

function renderAgent(
  contextPrompt: string | undefined = undefined,
  permissionMode: 'safe' | 'power_user' = 'safe',
  sessionId?: string,
) {
  return renderHook(
    ({ context }) => useCliAiAgent(VAULT, [VAULT, '/Users/luca/Brian'], context, undefined, {
      agent: 'codex',
      agentReady: true,
      permissionMode,
      sessionId,
    }),
    { initialProps: { context: contextPrompt } },
  )
}

describe('useCliAiAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAgentDocsPath.mockResolvedValue('/app/agent-docs')
    resetAiWorkspaceSessionStoreForTests()
    mockStreamAiAgent.mockImplementation(async ({ callbacks }) => {
      callbacks.onText('reply')
      callbacks.onDone()
    })
  })

  it('uses the latest context prompt when sending a message', async () => {
    const { result, rerender } = renderAgent()
    const firstSendMessage = result.current.sendMessage

    rerender({ context: 'You are viewing note with body: Hello world' })

    await act(async () => {
      await result.current.sendMessage('What does this note contain?')
    })

    expect(result.current.sendMessage).not.toBe(firstSendMessage)
    expect(mockBuildAgentSystemPrompt).toHaveBeenCalledWith({
      agent: 'codex',
      agentDocsPath: '/app/agent-docs',
      permissionMode: 'safe',
      vaultPaths: [VAULT, '/Users/luca/Brian'],
      vaultContext: 'You are viewing note with body: Hello world',
    })
    expect(mockStreamAiAgent).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: 'default-system-prompt',
    }))
  })

  it('forwards the current permission mode to the stream request', async () => {
    const { result } = renderAgent(undefined, 'power_user')

    await act(async () => {
      await result.current.sendMessage('Use the local tools')
    })

    expect(mockStreamAiAgent).toHaveBeenCalledWith(expect.objectContaining({
      permissionMode: 'power_user',
    }))
  })

  it('forwards active vault roots to the stream request', async () => {
    const { result } = renderAgent()

    await act(async () => {
      await result.current.sendMessage('Search all active vaults')
    })

    expect(mockStreamAiAgent).toHaveBeenCalledWith(expect.objectContaining({
      vaultPath: VAULT,
      vaultPaths: [VAULT, '/Users/luca/Brian'],
    }))
  })

  it('adds local transcript markers without sending them as chat history', async () => {
    const { result } = renderAgent()

    act(() => {
      result.current.addLocalMarker('AI permission mode changed to Power User. It will apply to the next message.')
    })

    await act(async () => {
      await result.current.sendMessage('Continue')
    })

    expect(result.current.messages[0]).toEqual(expect.objectContaining({
      localMarker: 'AI permission mode changed to Power User. It will apply to the next message.',
    }))
    expect(mockStreamAiAgent).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Continue',
    }))
  })

  it('embeds completed conversation history and clears it for a fresh chat', async () => {
    let responseNumber = 0
    mockStreamAiAgent.mockImplementation(async ({ callbacks }) => {
      responseNumber += 1
      callbacks.onText(`Response ${responseNumber}`)
      callbacks.onDone()
    })

    const { result } = renderAgent()

    await act(async () => { await result.current.sendMessage('Q1') })
    await act(async () => { await result.current.sendMessage('Q2') })

    const secondMessage = mockStreamAiAgent.mock.calls[1][0].message
    expect(secondMessage).toContain('<conversation_history>')
    expect(secondMessage).toContain('Q1')
    expect(secondMessage).toContain('Response 1')
    expect(secondMessage).toContain('Q2')

    act(() => { result.current.clearConversation() })
    await act(async () => { await result.current.sendMessage('fresh start') })

    const freshMessage = mockStreamAiAgent.mock.calls[2][0].message
    expect(freshMessage).toBe('fresh start')
    expect(freshMessage).not.toContain('<conversation_history>')
  })

  it('restores workspace session messages after remounting the same chat', async () => {
    const firstSession = renderAgent(undefined, 'safe', 'chat-1')

    await act(async () => { await firstSession.result.current.sendMessage('Remember this') })
    expect(firstSession.result.current.messages).toEqual([expect.objectContaining({
      userMessage: 'Remember this',
      response: 'reply',
    })])

    firstSession.unmount()
    const secondSession = renderAgent(undefined, 'safe', 'chat-1')

    expect(secondSession.result.current.messages).toEqual([expect.objectContaining({
      userMessage: 'Remember this',
      response: 'reply',
    })])
  })

  it('regenerates a selected message without duplicating the old response', async () => {
    let responseNumber = 0
    mockStreamAiAgent.mockImplementation(async ({ callbacks }) => {
      responseNumber += 1
      callbacks.onText(`Response ${responseNumber}`)
      callbacks.onDone()
    })
    const { result } = renderAgent()

    await act(async () => { await result.current.sendMessage('Q1') })
    await act(async () => { await result.current.sendMessage('Q2') })
    const messageId = result.current.messages[1]?.id ?? ''

    await act(async () => { await result.current.regenerateMessage(messageId) })

    expect(result.current.messages).toEqual([
      expect.objectContaining({ userMessage: 'Q1', response: 'Response 1' }),
      expect.objectContaining({ userMessage: 'Q2', response: 'Response 3' }),
    ])
    expect(result.current.messages).toHaveLength(2)
  })

  it('clones a workspace session through a selected message', async () => {
    const sourceSession = renderAgent(undefined, 'safe', 'chat-source')

    await act(async () => { await sourceSession.result.current.sendMessage('First') })
    await act(async () => { await sourceSession.result.current.sendMessage('Second') })
    const firstMessageId = sourceSession.result.current.messages[0]?.id ?? ''
    expect(firstMessageId).not.toBe('')

    cloneAiWorkspaceSessionUntilMessage('chat-source', 'chat-fork', firstMessageId)
    const forkSession = renderAgent(undefined, 'safe', 'chat-fork')

    expect(forkSession.result.current.messages).toEqual([
      expect.objectContaining({ userMessage: 'First', response: 'reply' }),
    ])
  })

  it('adds a local response instead of streaming when the selected agent is unavailable', async () => {
    const { result } = renderHook(() => useCliAiAgent(VAULT, undefined, undefined, undefined, {
      agent: 'codex',
      agentReady: false,
      permissionMode: 'safe',
    }))

    await act(async () => {
      await result.current.sendMessage('Help')
    })

    expect(mockStreamAiAgent).not.toHaveBeenCalled()
    expect(result.current.messages).toEqual([expect.objectContaining({
      userMessage: 'Help',
      response: 'Codex is not available on this machine. Install it or switch the default AI agent in Settings.',
    })])
  })
})
