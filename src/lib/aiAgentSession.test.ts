import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatus, AiAgentMessage } from './aiAgentConversation'

const {
  buildAgentSystemPromptMock,
  createStreamCallbacksMock,
  formatMessageWithHistoryMock,
  nextMessageIdMock,
  streamAiAgentMock,
  trackEventMock,
  trimHistoryMock,
} = vi.hoisted(() => ({
  buildAgentSystemPromptMock: vi.fn(() => 'SYSTEM'),
  createStreamCallbacksMock: vi.fn(() => ({ stream: 'callbacks' })),
  formatMessageWithHistoryMock: vi.fn((_history: unknown, prompt: string) => `formatted:${prompt}`),
  nextMessageIdMock: vi.fn(),
  streamAiAgentMock: vi.fn(async () => {}),
  trackEventMock: vi.fn(),
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

vi.mock('./telemetry', () => ({
  trackEvent: trackEventMock,
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

type RuntimeFixture = ReturnType<typeof createRuntime>

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
const expectedChatHistory = [
  { role: 'user', content: 'Previous question', id: 'msg-1' },
  { role: 'assistant', content: 'Previous answer', id: 'msg-1-resp' },
]

function expectStreamingRuntimeState(session: RuntimeFixture): void {
  expect(session.runtime.abortRef.current).toEqual({ aborted: false })
  expect(session.runtime.responseAccRef.current).toBe('')
  expect(session.runtime.toolInputMapRef.current.size).toBe(0)
  expect(session.getStatus()).toBe('thinking')
  expect(session.getMessages().at(-1)).toEqual({
    userMessage: 'Latest question',
    references: [{ path: '/vault/ref.md', title: 'Ref' }],
    actions: [],
    isStreaming: true,
    id: 'msg-stream',
  })
}

function expectFormattedHistoryUsed(): void {
  expect(trimHistoryMock).toHaveBeenCalledWith(expectedChatHistory, 100_000)
  expect(formatMessageWithHistoryMock).toHaveBeenCalledWith(expectedChatHistory, 'Latest question')
}

function expectStreamingRequest(runtime: RuntimeFixture['runtime']): void {
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
    permissionMode: 'power_user',
    callbacks: { stream: 'callbacks' },
  })
}

describe('aiAgentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    buildAgentSystemPromptMock.mockReturnValue('SYSTEM')
    createStreamCallbacksMock.mockReturnValue({ stream: 'callbacks' })
    formatMessageWithHistoryMock.mockImplementation((_history: unknown, prompt: string) => `formatted:${prompt}`)
    trimHistoryMock.mockImplementation((history: unknown) => history)
    streamAiAgentMock.mockResolvedValue(undefined)
    trackEventMock.mockClear()
  })

  async function expectLocalResponse(options: {
    messageId: string
    context: {
      agent: 'claude_code' | 'codex' | 'opencode' | 'pi' | 'gemini'
      ready: boolean
      vaultPath: string
      permissionMode: 'safe' | 'power_user'
    }
    prompt: { text: string; references?: [] }
    reason: 'agent_unavailable' | 'missing_vault'
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
    expect(trackEventMock).toHaveBeenCalledWith('ai_agent_message_blocked', {
      agent: options.context.agent,
      reason: options.reason,
    })
  }

  it('ignores blank prompts and busy runtimes', async () => {
    const idleRuntime = createRuntime()
    await sendAgentMessage({
      runtime: idleRuntime.runtime,
      context: { agent: 'codex', ready: true, vaultPath: '/vault', permissionMode: 'safe' },
      prompt: { text: '   ' },
    })

    const busyRuntime = createRuntime([], 'thinking')
    await sendAgentMessage({
      runtime: busyRuntime.runtime,
      context: { agent: 'codex', ready: true, vaultPath: '/vault', permissionMode: 'safe' },
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
        context: { agent: 'codex', ready: true, vaultPath: '', permissionMode: 'safe' },
        prompt: { text: 'Open a note' },
        reason: 'missing_vault',
        response: 'No vault loaded. Open a vault first.',
      },
      {
        messageId: 'msg-missing',
        context: { agent: 'codex', ready: false, vaultPath: '/vault', permissionMode: 'safe' },
        prompt: { text: 'Open a note', references: [] },
        reason: 'agent_unavailable',
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
    const session = createRuntime([
      completedHistory,
      streamingHistory,
    ])

    await sendAgentMessage({
      runtime: session.runtime,
      context: {
        agent: 'codex',
        ready: true,
        vaultPath: '/vault',
        permissionMode: 'power_user',
        systemPromptOverride: 'OVERRIDE',
      },
      prompt: {
        text: '  Latest question  ',
        references: [{ path: '/vault/ref.md', title: 'Ref' }],
      },
    })

    expectStreamingRuntimeState(session)
    expectFormattedHistoryUsed()
    expectStreamingRequest(session.runtime)
    expect(trackEventMock).toHaveBeenCalledWith('ai_agent_message_sent', {
      agent: 'codex',
      permission_mode: 'power_user',
      has_context: 1,
      reference_count: 1,
      history_message_count: 1,
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
