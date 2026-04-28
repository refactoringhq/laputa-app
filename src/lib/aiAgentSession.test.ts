import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatus, AiAgentMessage } from './aiAgentConversation'

const {
  buildAgentSystemPromptMock,
  createStreamCallbacksMock,
  formatMessageWithHistoryMock,
  nextMessageIdMock,
  streamAiAgentMock,
  trimHistoryMock,
} = vi.hoisted(() => ({
  buildAgentSystemPromptMock: vi.fn(() => 'SYSTEM'),
  createStreamCallbacksMock: vi.fn(() => ({ stream: 'callbacks' })),
  formatMessageWithHistoryMock: vi.fn((_history: unknown, prompt: string) => `formatted:${prompt}`),
  nextMessageIdMock: vi.fn(),
  streamAiAgentMock: vi.fn(async () => {}),
  trimHistoryMock: vi.fn((history: unknown) => history),
}))

vi.mock('../utils/ai-agent', () => ({
  buildAgentSystemPrompt: buildAgentSystemPromptMock,
}))

vi.mock('../utils/ai-chat', () => ({
  MAX_HISTORY_TOKENS: 100_000,
  formatMessageWithHistory: formatMessageWithHistoryMock,
  nextMessageId: nextMessageIdMock,
  trimHistory: trimHistoryMock,
}))

vi.mock('./aiAgentStreamCallbacks', () => ({
  createStreamCallbacks: createStreamCallbacksMock,
}))

vi.mock('../utils/streamAiAgent', () => ({
  streamAiAgent: streamAiAgentMock,
}))

import {
  clearAgentConversation,
  sendAgentMessage,
  type AiAgentSessionRuntime,
} from './aiAgentSession'

function createRuntime(
  initialMessages: AiAgentMessage[] = [],
  initialStatus: AgentStatus = 'idle',
) {
  let messages = initialMessages
  let status = initialStatus

  const messagesRef = { current: messages }
  const statusRef = { current: status }

  const setMessages = vi.fn((next: AiAgentMessage[] | ((current: AiAgentMessage[]) => AiAgentMessage[])) => {
    messages = typeof next === 'function' ? next(messages) : next
    messagesRef.current = messages
  })
  const setStatus = vi.fn((next: AgentStatus | ((current: AgentStatus) => AgentStatus)) => {
    status = typeof next === 'function' ? next(status) : next
    statusRef.current = status
  })

  const runtime: AiAgentSessionRuntime = {
    setMessages,
    setStatus,
    abortRef: { current: { aborted: true } },
    responseAccRef: { current: 'stale response' },
    fileCallbacksRef: { current: { onVaultChanged: vi.fn() } },
    toolInputMapRef: { current: new Map([['stale-tool', { tool: 'Write', input: '{"path":"/stale.md"}' }]]) },
    messagesRef,
    statusRef,
  }

  return {
    runtime,
    getMessages: () => messages,
    getStatus: () => status,
  }
}

describe('aiAgentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    buildAgentSystemPromptMock.mockReturnValue('SYSTEM')
    createStreamCallbacksMock.mockReturnValue({ stream: 'callbacks' })
    formatMessageWithHistoryMock.mockImplementation((_history: unknown, prompt: string) => `formatted:${prompt}`)
    trimHistoryMock.mockImplementation((history: unknown) => history)
    streamAiAgentMock.mockResolvedValue(undefined)
  })

  async function expectLocalResponse(options: {
    messageId: string
    context: { agent: string; ready: boolean; vaultPath: string }
    prompt: { text: string; references?: [] }
    response: string
  }) {
    nextMessageIdMock.mockReturnValue(options.messageId)
    const { runtime, getMessages } = createRuntime()

    await sendAgentMessage({
      runtime,
      context: options.context,
      prompt: options.prompt,
    })

    expect(getMessages()).toEqual([
      {
        userMessage: options.prompt.text,
        references: undefined,
        actions: [],
        response: options.response,
        id: options.messageId,
      },
    ])
    expect(streamAiAgentMock).not.toHaveBeenCalled()
  }

  it('ignores blank prompts and busy runtimes', async () => {
    const idleRuntime = createRuntime()
    await sendAgentMessage({
      runtime: idleRuntime.runtime,
      context: { agent: 'codex', ready: true, vaultPath: '/vault' },
      prompt: { text: '   ' },
    })

    const busyRuntime = createRuntime([], 'thinking')
    await sendAgentMessage({
      runtime: busyRuntime.runtime,
      context: { agent: 'codex', ready: true, vaultPath: '/vault' },
      prompt: { text: 'Question' },
    })

    expect(idleRuntime.getMessages()).toEqual([])
    expect(busyRuntime.getMessages()).toEqual([])
    expect(streamAiAgentMock).not.toHaveBeenCalled()
  })

  it('appends local fallback responses when the session cannot stream', async () => {
    const fallbackCases = [
      {
        messageId: 'msg-local',
        context: { agent: 'codex', ready: true, vaultPath: '' },
        prompt: { text: 'Open a note' },
        response: 'No vault loaded. Open a vault first.',
      },
      {
        messageId: 'msg-missing',
        context: { agent: 'codex', ready: false, vaultPath: '/vault' },
        prompt: { text: 'Open a note', references: [] },
        response:
          'Codex is not available on this machine. Install it or switch the default AI agent in Settings.',
      },
    ] as const

    for (const fallbackCase of fallbackCases) {
      await expectLocalResponse(fallbackCase)
    }
  })

  it('starts a streaming session with formatted history and fresh refs', async () => {
    nextMessageIdMock.mockReturnValue('msg-stream')
    const completedHistory: AiAgentMessage = {
      id: 'msg-1',
      userMessage: 'Previous question',
      actions: [],
      response: 'Previous answer',
    }
    const streamingHistory: AiAgentMessage = {
      id: 'msg-2',
      userMessage: 'Ignored streaming question',
      actions: [],
      isStreaming: true,
    }
    const { runtime, getMessages, getStatus } = createRuntime([
      completedHistory,
      streamingHistory,
    ])

    await sendAgentMessage({
      runtime,
      context: {
        agent: 'codex',
        ready: true,
        vaultPath: '/vault',
        systemPromptOverride: 'OVERRIDE',
      },
      prompt: {
        text: '  Latest question  ',
        references: [{ path: '/vault/ref.md', title: 'Ref' }],
      },
    })

    expect(runtime.abortRef.current).toEqual({ aborted: false })
    expect(runtime.responseAccRef.current).toBe('')
    expect(runtime.toolInputMapRef.current.size).toBe(0)
    expect(getStatus()).toBe('thinking')
    expect(getMessages().at(-1)).toEqual({
      userMessage: 'Latest question',
      references: [{ path: '/vault/ref.md', title: 'Ref' }],
      actions: [],
      isStreaming: true,
      id: 'msg-stream',
    })
    expect(trimHistoryMock).toHaveBeenCalledWith([
      { role: 'user', content: 'Previous question', id: 'msg-1' },
      { role: 'assistant', content: 'Previous answer', id: 'msg-1-resp' },
    ], 100_000)
    expect(formatMessageWithHistoryMock).toHaveBeenCalledWith([
      { role: 'user', content: 'Previous question', id: 'msg-1' },
      { role: 'assistant', content: 'Previous answer', id: 'msg-1-resp' },
    ], 'Latest question')
    expect(createStreamCallbacksMock).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'msg-stream',
      vaultPath: '/vault',
      setMessages: runtime.setMessages,
      setStatus: runtime.setStatus,
    }))
    expect(streamAiAgentMock).toHaveBeenCalledWith({
      agent: 'codex',
      message: 'formatted:Latest question',
      systemPrompt: 'OVERRIDE',
      vaultPath: '/vault',
      callbacks: { stream: 'callbacks' },
    })
  })

  it('clears the conversation and resets runtime refs', () => {
    const { runtime } = createRuntime([
      { id: 'msg-1', userMessage: 'Question', actions: [] },
    ], 'done')

    clearAgentConversation(runtime)

    expect(runtime.abortRef.current.aborted).toBe(true)
    expect(runtime.responseAccRef.current).toBe('')
    expect(runtime.toolInputMapRef.current.size).toBe(0)
    expect(runtime.setMessages).toHaveBeenCalledWith([])
    expect(runtime.setStatus).toHaveBeenCalledWith('idle')
  })
})
