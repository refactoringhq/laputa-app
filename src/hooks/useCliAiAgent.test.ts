import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCliAiAgent } from './useCliAiAgent'
import { streamAiAgent } from '../utils/streamAiAgent'

vi.mock('../utils/streamAiAgent', () => ({
  streamAiAgent: vi.fn(),
}))

vi.mock('../utils/ai-agent', () => ({
  buildAgentSystemPrompt: vi.fn(() => 'default-system-prompt'),
}))

const mockStreamAiAgent = vi.mocked(streamAiAgent)
const VAULT = '/Users/luca/Laputa'

function renderAgent(
  contextPrompt: string | undefined = undefined,
  permissionMode: 'safe' | 'power_user' = 'safe',
) {
  return renderHook(
    ({ context }) => useCliAiAgent(VAULT, context, undefined, {
      agent: 'codex',
      agentReady: true,
      permissionMode,
    }),
    { initialProps: { context: contextPrompt } },
  )
}

describe('useCliAiAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    expect(mockStreamAiAgent).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: 'You are viewing note with body: Hello world',
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

  it('adds a local response instead of streaming when the selected agent is unavailable', async () => {
    const { result } = renderHook(() => useCliAiAgent(VAULT, undefined, undefined, {
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
