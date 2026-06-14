import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatus, AiAgentMessage } from './aiAgentConversation'

const { detectFileOperationMock, trackEventMock } = vi.hoisted(() => ({
  detectFileOperationMock: vi.fn(),
  trackEventMock: vi.fn(),
}))

vi.mock('./aiAgentFileOperations', async (importOriginal) => ({
  ...await importOriginal<typeof import('./aiAgentFileOperations')>(),
  detectFileOperation: detectFileOperationMock,
}))

vi.mock('./telemetry', () => ({
  trackEvent: trackEventMock,
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
    trackEventMock.mockClear()
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
    expect(detectFileOperationMock).toHaveBeenCalledWith({
      toolName: 'Write',
      input: '{"path":"/vault/note.md"}',
      vaultPath: '/vault',
      callbacks: fileCallbacks,
    })
    expect(fileCallbacks.onVaultChanged).toHaveBeenCalledTimes(1)
    expect(trackEventMock).toHaveBeenCalledWith('ai_agent_response_completed', {
      agent: 'claude_code',
      had_text: 1,
      tool_count: 1,
    })
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

  it('truncates large tool output retained in message history', () => {
    const messages = createMessageStore([
      {
        id: 'msg-1',
        userMessage: 'Question',
        actions: [],
        isStreaming: true,
      },
    ])
    const callbacks = createStreamCallbacks({
      agent: 'claude_code',
      messageId: 'msg-1',
      vaultPath: '/vault',
      setMessages: messages.setMessages,
      setStatus: createStatusStore().setStatus,
      abortRef: { current: { aborted: false } },
      responseAccRef: { current: '' },
      toolInputMapRef: { current: new Map() },
      fileCallbacksRef: { current: undefined },
    })

    callbacks.onToolStart('Bash', 'tool-1')
    callbacks.onToolDone('tool-1', 'x'.repeat(20_050))

    const output = messages.getMessages()[0].actions[0].output
    expect(output?.length).toBeLessThan(20_050)
    expect(output).toContain('[Tool output truncated: 50 chars omitted]')
  })

  it('keeps failed MCP create_note results from reporting a created file', () => {
    const messages = createMessageStore([
      {
        id: 'msg-1',
        userMessage: 'Create a verification note',
        actions: [],
        isStreaming: true,
      },
    ])
    const fileCallbacks = {
      onFileCreated: vi.fn(),
      onVaultChanged: vi.fn(),
    }
    const callbacks = createStreamCallbacks({
      agent: 'pi',
      messageId: 'msg-1',
      vaultPath: String.raw`H:\Notes`,
      setMessages: messages.setMessages,
      setStatus: createStatusStore().setStatus,
      abortRef: { current: { aborted: false } },
      responseAccRef: { current: '' },
      toolInputMapRef: { current: new Map() },
      fileCallbacksRef: { current: fileCallbacks },
    })
    const output = JSON.stringify({
      content: [{
        type: 'text',
        text: 'Error: Failed to create H:/Notes/test-tool-verification.md: Access is denied',
      }],
      isError: true,
    })

    callbacks.onToolStart(
      'create_note',
      'tool-1',
      JSON.stringify({ path: 'H:/Notes/test-tool-verification.md' }),
    )
    callbacks.onToolDone('tool-1', output)

    expect(detectFileOperationMock).not.toHaveBeenCalled()
    expect(fileCallbacks.onFileCreated).not.toHaveBeenCalled()
    expect(fileCallbacks.onVaultChanged).not.toHaveBeenCalled()
    expect(messages.getMessages()[0].actions[0]).toMatchObject({
      tool: 'create_note',
      toolId: 'tool-1',
      status: 'error',
      output,
    })
  })

  it('repairs missing sentence boundaries between streamed text chunks', () => {
    const messages = createMessageStore([
      {
        id: 'msg-1',
        userMessage: 'Question',
        actions: [],
        isStreaming: true,
      },
    ])
    const responseAccRef = { current: '' }

    const callbacks = createStreamCallbacks({
      agent: 'claude_code',
      messageId: 'msg-1',
      vaultPath: '/vault',
      setMessages: messages.setMessages,
      setStatus: createStatusStore().setStatus,
      abortRef: { current: { aborted: false } },
      responseAccRef,
      toolInputMapRef: { current: new Map() },
      fileCallbacksRef: { current: undefined },
    })

    callbacks.onText("I'll create the Project note now.")
    callbacks.onText('Created [[Tolaria Mobile]] as a Project note with a relation to [[frontend]].')
    callbacks.onText('It covers three tech stack paths.')
    callbacks.onDone()

    expect(messages.getMessages()[0].response).toBe(
      "I'll create the Project note now. Created [[Tolaria Mobile]] as a Project note with a relation to [[frontend]]. It covers three tech stack paths.",
    )
  })

  it('keeps response normalization compatible with WebKit regex syntax support', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/aiAgentStreamCallbacks.ts'), 'utf8')

    expect(source).not.toMatch(/\(\?<[!=]/u)
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
    callbacks.onDone()

    expect(status.getStatus()).toBe('error')
    expect(trackEventMock).toHaveBeenCalledWith('ai_agent_response_failed', {
      agent: 'claude_code',
      error_kind: 'stream_error',
      had_partial_response: 1,
      tool_count: 0,
    })
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
    expect(trackEventMock).not.toHaveBeenCalledWith('ai_agent_response_completed', expect.anything())
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
    expect(trackEventMock).toHaveBeenCalledWith('ai_agent_response_completed', {
      agent,
      had_text: 0,
      tool_count: 0,
    })
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

  it('gives OpenCode an actionable empty-response message', () => {
    const messages = createMessageStore([
      {
        id: 'msg-1',
        userMessage: 'Summarize the current note',
        actions: [],
        isStreaming: true,
      },
    ])
    const status = createStatusStore('thinking')

    const callbacks = createStreamCallbacks({
      agent: 'opencode',
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
    expect(messages.getMessages()[0].response).toContain('OpenCode returned no assistant text')
    expect(messages.getMessages()[0].response).toContain('provider/model context limit')
    expect(messages.getMessages()[0].response).not.toContain('finished without returning a reply')
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
