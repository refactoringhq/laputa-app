import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatus } from '../hooks/useAiAgent'
import type { AiAgentMessage } from './aiAgentConversation'

const { detectFileOperationMock } = vi.hoisted(() => ({
  detectFileOperationMock: vi.fn(),
}))

vi.mock('../hooks/useAiAgent', () => ({
  detectFileOperation: detectFileOperationMock,
}))

import { createStreamCallbacks } from './aiAgentStreamCallbacks'

function createMessageStore(initialMessages: AiAgentMessage[]) {
  let messages = initialMessages

  return {
    getMessages: () => messages,
    setMessages: (next: AiAgentMessage[] | ((current: AiAgentMessage[]) => AiAgentMessage[])) => {
      messages = typeof next === 'function' ? next(messages) : next
    },
  }
}

function createStatusStore(initialStatus: AgentStatus = 'idle') {
  let status = initialStatus

  return {
    getStatus: () => status,
    setStatus: (next: AgentStatus | ((current: AgentStatus) => AgentStatus)) => {
      status = typeof next === 'function' ? next(status) : next
    },
  }
}

describe('aiAgentStreamCallbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles the happy-path lifecycle and refreshes the vault at the end', () => {
    const messages = createMessageStore([
      {
        id: 'msg-1',
        userMessage: 'Question',
        actions: [],
        isStreaming: true,
      },
    ])
    const status = createStatusStore()
    const fileCallbacks = { onVaultChanged: vi.fn() }
    const responseAccRef = { current: '' }
    const toolInputMapRef = { current: new Map<string, { tool: string; input?: string }>() }

    const callbacks = createStreamCallbacks({
      agent: 'claude_code',
      messageId: 'msg-1',
      vaultPath: '/vault',
      setMessages: messages.setMessages,
      setStatus: status.setStatus,
      abortRef: { current: { aborted: false } },
      responseAccRef,
      toolInputMapRef,
      fileCallbacksRef: { current: fileCallbacks },
    })

    callbacks.onThinking('step 1')
    callbacks.onText('Hello')
    callbacks.onToolStart('Write', 'tool-1', '{"path":"/vault/note.md"}')
    callbacks.onToolStart('Write', 'tool-1')
    callbacks.onToolDone('tool-1', 'saved')
    callbacks.onDone()

    expect(status.getStatus()).toBe('done')
    expect(responseAccRef.current).toBe('Hello')
    expect(toolInputMapRef.current.get('tool-1')).toEqual({
      tool: 'Write',
      input: '{"path":"/vault/note.md"}',
    })
    expect(detectFileOperationMock).toHaveBeenCalledWith(
      'Write',
      '{"path":"/vault/note.md"}',
      '/vault',
      fileCallbacks,
    )
    expect(fileCallbacks.onVaultChanged).toHaveBeenCalledTimes(1)
    expect(messages.getMessages()).toEqual([
      {
        id: 'msg-1',
        userMessage: 'Question',
        actions: [{
          tool: 'Write',
          toolId: 'tool-1',
          label: 'Wrote file',
          status: 'done',
          input: '{"path":"/vault/note.md"}',
          output: 'saved',
        }],
        isStreaming: false,
        reasoning: 'step 1',
        reasoningDone: true,
        response: 'Hello',
      },
    ])
  })

  it('marks pending actions as failed when the stream errors', () => {
    const messages = createMessageStore([
      {
        id: 'msg-1',
        userMessage: 'Question',
        actions: [{
          tool: 'Bash',
          toolId: 'tool-1',
          label: 'Ran shell command',
          status: 'pending',
        }],
        isStreaming: true,
      },
    ])
    const status = createStatusStore('thinking')
    const responseAccRef = { current: 'Partial reply' }

    const callbacks = createStreamCallbacks({
      agent: 'claude_code',
      messageId: 'msg-1',
      vaultPath: '/vault',
      setMessages: messages.setMessages,
      setStatus: status.setStatus,
      abortRef: { current: { aborted: false } },
      responseAccRef,
      toolInputMapRef: { current: new Map() },
      fileCallbacksRef: { current: undefined },
    })

    callbacks.onError('boom')

    expect(status.getStatus()).toBe('error')
    expect(messages.getMessages()).toEqual([
      {
        id: 'msg-1',
        userMessage: 'Question',
        actions: [{
          tool: 'Bash',
          toolId: 'tool-1',
          label: 'Ran shell command',
          status: 'error',
        }],
        isStreaming: false,
        reasoningDone: true,
        response: 'Partial reply\n\nError: boom',
      },
    ])
  })

  it.each([
    ['claude_code', 'Claude Code finished without returning a reply.'],
    ['pi', 'Pi finished without returning a reply.'],
  ] as const)('uses the %s label for empty stream responses', (agent, response) => {
    const messages = createMessageStore([
      {
        id: 'msg-1',
        userMessage: '/exit',
        actions: [],
        isStreaming: true,
      },
    ])
    const status = createStatusStore('thinking')

    const callbacks = createStreamCallbacks({
      agent,
      messageId: 'msg-1',
      vaultPath: '/vault',
      setMessages: messages.setMessages,
      setStatus: status.setStatus,
      abortRef: { current: { aborted: false } },
      responseAccRef: { current: '' },
      toolInputMapRef: { current: new Map() },
      fileCallbacksRef: { current: undefined },
    })

    callbacks.onDone()

    expect(status.getStatus()).toBe('done')
    expect(messages.getMessages()).toEqual([
      {
        id: 'msg-1',
        userMessage: '/exit',
        actions: [],
        isStreaming: false,
        reasoningDone: true,
        response,
      },
    ])
  })

  it('ignores stream events after the request has been aborted', () => {
    const messages = createMessageStore([
      {
        id: 'msg-1',
        userMessage: 'Question',
        actions: [],
        isStreaming: true,
      },
    ])
    const status = createStatusStore('thinking')
    const fileCallbacks = { onVaultChanged: vi.fn() }

    const callbacks = createStreamCallbacks({
      agent: 'claude_code',
      messageId: 'msg-1',
      vaultPath: '/vault',
      setMessages: messages.setMessages,
      setStatus: status.setStatus,
      abortRef: { current: { aborted: true } },
      responseAccRef: { current: '' },
      toolInputMapRef: { current: new Map() },
      fileCallbacksRef: { current: fileCallbacks },
    })

    callbacks.onThinking('ignored')
    callbacks.onText('ignored')
    callbacks.onToolStart('Write', 'tool-1', '{"path":"/vault/note.md"}')
    callbacks.onToolDone('tool-1', 'saved')
    callbacks.onError('boom')
    callbacks.onDone()

    expect(status.getStatus()).toBe('thinking')
    expect(messages.getMessages()[0]).toEqual({
      id: 'msg-1',
      userMessage: 'Question',
      actions: [],
      isStreaming: true,
    })
    expect(fileCallbacks.onVaultChanged).not.toHaveBeenCalled()
    expect(detectFileOperationMock).not.toHaveBeenCalled()
  })
})
