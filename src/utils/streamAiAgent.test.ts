import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getAiAgentDefinitionMock,
  invokeMock,
  isTauriState,
  listenMock,
} = vi.hoisted(() => ({
  getAiAgentDefinitionMock: vi.fn((agent: string) => ({
    label: agent === 'codex' ? 'Codex' : agent === 'pi' ? 'Pi' : 'Claude Code',
  })),
  invokeMock: vi.fn(),
  isTauriState: { value: false },
  listenMock: vi.fn(),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => isTauriState.value,
}))

vi.mock('../lib/aiAgents', () => ({
  getAiAgentDefinition: getAiAgentDefinitionMock,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}))

import { streamAiAgent } from './streamAiAgent'

describe('streamAiAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isTauriState.value = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the mock response when Tauri is unavailable', async () => {
    vi.useFakeTimers()
    const callbacks = {
      onText: vi.fn(),
      onThinking: vi.fn(),
      onToolStart: vi.fn(),
      onToolDone: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    }

    const promise = streamAiAgent({
      agent: 'codex',
      message: '<conversation_history>\n[user]: first\n\n[user]: latest\n</conversation_history>',
      vaultPath: '/vault',
      callbacks,
    })

    await vi.advanceTimersByTimeAsync(300)
    await promise

    expect(callbacks.onText).toHaveBeenCalledWith(
      '[mock-codex turns=2] You asked: "latest" — This note is related to [[Build Laputa App]] and [[Matteo Cellini]].',
    )
    expect(callbacks.onDone).toHaveBeenCalledTimes(1)
    expect(listenMock).not.toHaveBeenCalled()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('forwards streamed Tauri events and invokes the backend request', async () => {
    isTauriState.value = true
    const unlistenMock = vi.fn()
    let eventHandler: ((event: { payload: unknown }) => void) | undefined

    listenMock.mockImplementation(async (_eventName: string, handler: typeof eventHandler) => {
      eventHandler = handler
      return unlistenMock
    })
    invokeMock.mockImplementation(async () => {
      eventHandler?.({ payload: { kind: 'Init', session_id: 'session-1' } })
      eventHandler?.({ payload: { kind: 'ThinkingDelta', text: 'thinking...' } })
      eventHandler?.({ payload: { kind: 'TextDelta', text: 'answer' } })
      eventHandler?.({ payload: { kind: 'ToolStart', tool_name: 'Write', tool_id: 'tool-1', input: '{"path":"/vault/note.md"}' } })
      eventHandler?.({ payload: { kind: 'ToolDone', tool_id: 'tool-1', output: 'saved' } })
      eventHandler?.({ payload: { kind: 'Done' } })
      return 'session-1'
    })

    const callbacks = {
      onText: vi.fn(),
      onThinking: vi.fn(),
      onToolStart: vi.fn(),
      onToolDone: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    }

    const promise = streamAiAgent({
      agent: 'claude_code',
      message: 'Explain this',
      systemPrompt: 'SYSTEM',
      vaultPath: '/vault',
      callbacks,
    })

    await promise

    expect(listenMock).toHaveBeenCalledWith('ai-agent-stream', expect.any(Function))
    expect(invokeMock).toHaveBeenCalledWith('stream_ai_agent', {
      request: {
        agent: 'claude_code',
        message: 'Explain this',
        system_prompt: 'SYSTEM',
        vault_path: '/vault',
      },
    })
    expect(callbacks.onThinking).toHaveBeenCalledWith('thinking...')
    expect(callbacks.onText).toHaveBeenCalledWith('answer')
    expect(callbacks.onToolStart).toHaveBeenCalledWith('Write', 'tool-1', '{"path":"/vault/note.md"}')
    expect(callbacks.onToolDone).toHaveBeenCalledWith('tool-1', 'saved')
    expect(callbacks.onDone).toHaveBeenCalledTimes(1)
    expect(unlistenMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces backend invocation failures and still closes the stream', async () => {
    isTauriState.value = true
    const unlistenMock = vi.fn()

    listenMock.mockResolvedValue(unlistenMock)
    invokeMock.mockRejectedValue(new Error('backend boom'))

    const callbacks = {
      onText: vi.fn(),
      onThinking: vi.fn(),
      onToolStart: vi.fn(),
      onToolDone: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    }

    await streamAiAgent({
      agent: 'codex',
      message: 'Explain this',
      vaultPath: '/vault',
      callbacks,
    })

    expect(callbacks.onError).toHaveBeenCalledWith('backend boom')
    expect(callbacks.onDone).toHaveBeenCalledTimes(1)
    expect(unlistenMock).toHaveBeenCalledTimes(1)
  })

  it('closes the stream when the backend returns before a done event is observed', async () => {
    isTauriState.value = true
    const unlistenMock = vi.fn()
    let eventHandler: ((event: { payload: unknown }) => void) | undefined

    listenMock.mockImplementation(async (_eventName: string, handler: typeof eventHandler) => {
      eventHandler = handler
      return unlistenMock
    })
    invokeMock.mockImplementation(async () => {
      eventHandler?.({ payload: { kind: 'TextDelta', text: 'done' } })
      return 'session-2'
    })

    const callbacks = {
      onText: vi.fn(),
      onThinking: vi.fn(),
      onToolStart: vi.fn(),
      onToolDone: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    }

    await streamAiAgent({
      agent: 'claude_code',
      message: 'Reply with done',
      vaultPath: '/vault',
      callbacks,
    })

    expect(callbacks.onText).toHaveBeenCalledWith('done')
    expect(callbacks.onDone).toHaveBeenCalledTimes(1)
    expect(unlistenMock).toHaveBeenCalledTimes(1)
  })
})
