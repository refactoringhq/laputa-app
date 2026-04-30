import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  buildAgentSystemPromptMock,
  formatMessageWithHistoryMock,
  nextMessageIdMock,
  trimHistoryMock,
} = vi.hoisted(() => ({
  buildAgentSystemPromptMock: vi.fn(() => 'SYSTEM'),
  formatMessageWithHistoryMock: vi.fn((_history: unknown, prompt: string) => `formatted:${prompt}`),
  nextMessageIdMock: vi.fn(),
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

import {
  appendLocalResponse,
  appendStreamingMessage,
  buildFormattedMessage,
  createMissingAgentResponse,
  type AiAgentMessage,
} from './aiAgentConversation'
import {
  markReasoningDone,
  updateMessage,
  updateToolAction,
} from './aiAgentMessageState'

function createMessageStore(initial: AiAgentMessage[] = []) {
  let messages = initial

  return {
    getMessages: () => messages,
    setMessages: (next: AiAgentMessage[] | ((current: AiAgentMessage[]) => AiAgentMessage[])) => {
      messages = typeof next === 'function' ? next(messages) : next
    },
  }
}

describe('aiAgentConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    buildAgentSystemPromptMock.mockReturnValue('SYSTEM')
    formatMessageWithHistoryMock.mockImplementation((_history: unknown, prompt: string) => `formatted:${prompt}`)
    trimHistoryMock.mockImplementation((history: unknown) => history)
  })

  it('creates a missing-agent response using the agent label', () => {
    expect(createMissingAgentResponse('codex')).toContain('Codex is not available on this machine')
  })

  it('appends local responses with the normalized message shape', () => {
    nextMessageIdMock.mockReturnValue('msg-local')
    const store = createMessageStore()

    appendLocalResponse(
      store.setMessages,
      { text: 'Explain this', references: [{ path: '/vault/note.md', title: 'Note' }] },
      'Sure',
    )

    expect(store.getMessages()).toEqual([
      {
        userMessage: 'Explain this',
        references: [{ path: '/vault/note.md', title: 'Note' }],
        actions: [],
        response: 'Sure',
        id: 'msg-local',
      },
    ])
  })

  it('appends streaming messages and returns the generated message id', () => {
    nextMessageIdMock.mockReturnValue('msg-stream')
    const store = createMessageStore()

    const messageId = appendStreamingMessage(store.setMessages, { text: 'Draft reply' })

    expect(messageId).toBe('msg-stream')
    expect(store.getMessages()).toEqual([
      {
        userMessage: 'Draft reply',
        references: undefined,
        actions: [],
        isStreaming: true,
        id: 'msg-stream',
      },
    ])
  })

  it('builds a formatted message from completed history only', () => {
    const messages: AiAgentMessage[] = [
      {
        id: 'msg-1',
        userMessage: 'First question',
        actions: [],
        response: 'First answer',
      },
      {
        id: 'msg-2',
        userMessage: 'Still streaming',
        actions: [],
        isStreaming: true,
      },
    ]

    const result = buildFormattedMessage(
      { agent: 'codex', ready: true, vaultPath: '/vault', permissionMode: 'safe' },
      messages,
      { text: 'Latest question' },
    )

    expect(buildAgentSystemPromptMock).toHaveBeenCalledWith({
      agent: 'codex',
      permissionMode: 'safe',
      vaultContext: undefined,
    })
    expect(trimHistoryMock).toHaveBeenCalledWith([
      { role: 'user', content: 'First question', id: 'msg-1' },
      { role: 'assistant', content: 'First answer', id: 'msg-1-resp' },
    ], 100_000)
    expect(formatMessageWithHistoryMock).toHaveBeenCalledWith([
      { role: 'user', content: 'First question', id: 'msg-1' },
      { role: 'assistant', content: 'First answer', id: 'msg-1-resp' },
    ], 'Latest question')
    expect(result).toEqual({
      formattedMessage: 'formatted:Latest question',
      systemPrompt: 'SYSTEM',
    })
  })

  it('appends context snapshots to the mode-aware system prompt', () => {
    const result = buildFormattedMessage(
      {
        agent: 'codex',
        ready: true,
        vaultPath: '/vault',
        permissionMode: 'power_user',
        systemPromptOverride: 'CONTEXT',
      },
      [],
      { text: 'Prompt' },
    )

    expect(buildAgentSystemPromptMock).toHaveBeenCalledWith({
      agent: 'codex',
      permissionMode: 'power_user',
      vaultContext: 'CONTEXT',
    })
    expect(result.systemPrompt).toBe('SYSTEM')
  })
})

describe('aiAgentMessageState', () => {
  it('updates only the targeted message', () => {
    const store = createMessageStore([
      { id: 'keep', userMessage: 'Keep', actions: [] },
      { id: 'edit', userMessage: 'Edit', actions: [] },
    ])

    updateMessage(store.setMessages, 'edit', (message) => ({
      ...message,
      response: 'Updated',
    }))

    expect(store.getMessages()).toEqual([
      { id: 'keep', userMessage: 'Keep', actions: [] },
      { id: 'edit', userMessage: 'Edit', actions: [], response: 'Updated' },
    ])
  })

  it('marks reasoning as done only once', () => {
    const store = createMessageStore([
      { id: 'done', userMessage: 'Question', actions: [], reasoningDone: true },
      { id: 'pending', userMessage: 'Another', actions: [] },
    ])

    markReasoningDone(store.setMessages, 'done')
    markReasoningDone(store.setMessages, 'pending')

    expect(store.getMessages()).toEqual([
      { id: 'done', userMessage: 'Question', actions: [], reasoningDone: true },
      { id: 'pending', userMessage: 'Another', actions: [], reasoningDone: true },
    ])
  })

  it('adds new tool actions with the expected labels', () => {
    const baseMessage: AiAgentMessage = {
      id: 'msg',
      userMessage: 'Question',
      actions: [],
    }

    expect(updateToolAction(baseMessage, 'Bash', 'tool-1', 'ls')).toMatchObject({
      actions: [{
        tool: 'Bash',
        toolId: 'tool-1',
        label: 'Ran shell command',
        status: 'pending',
        input: 'ls',
      }],
    })

    expect(updateToolAction(baseMessage, 'Write', 'tool-2', '{"path":"/tmp/a.md"}')).toMatchObject({
      actions: [{
        tool: 'Write',
        toolId: 'tool-2',
        label: 'Wrote file',
        status: 'pending',
      }],
    })

    expect(updateToolAction(baseMessage, 'Edit', 'tool-3', '{"path":"/tmp/a.md"}')).toMatchObject({
      actions: [{
        tool: 'Edit',
        toolId: 'tool-3',
        label: 'Edited file',
        status: 'pending',
      }],
    })
  })

  it('updates an existing tool action without dropping the prior input', () => {
    const message: AiAgentMessage = {
      id: 'msg',
      userMessage: 'Question',
      actions: [{
        tool: 'Write',
        toolId: 'tool-1',
        label: 'Wrote file',
        status: 'pending',
        input: '{"path":"/tmp/original.md"}',
      }],
    }

    expect(updateToolAction(message, 'Write', 'tool-1')).toEqual({
      ...message,
      actions: [{
        tool: 'Write',
        toolId: 'tool-1',
        label: 'Wrote file',
        status: 'pending',
        input: '{"path":"/tmp/original.md"}',
      }],
    })
  })
})
