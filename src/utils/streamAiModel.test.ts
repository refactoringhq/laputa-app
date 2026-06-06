import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiModelDefinition, AiModelProvider } from '../lib/aiTargets'

const {
  invokeMock,
  isTauriState,
  listenMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriState: { value: false },
  listenMock: vi.fn(),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => isTauriState.value,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}))

import { streamAiModel } from './streamAiModel'

function createCallbacks() {
  return {
    onText: vi.fn(),
    onThinking: vi.fn(),
    onToolStart: vi.fn(),
    onToolDone: vi.fn(),
    onError: vi.fn(),
    onDone: vi.fn(),
  }
}

const provider: AiModelProvider = {
  id: 'provider',
  name: 'Provider',
  kind: 'openai_compatible',
  base_url: 'https://example.com/v1',
  api_key_storage: 'local_file',
  models: [],
}

const model: AiModelDefinition = {
  id: 'model',
  display_name: 'Model',
  capabilities: { streaming: true, tools: false, vision: false, json_mode: false, reasoning: false },
}

describe('streamAiModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isTauriState.value = false
  })

  it('uses a request-scoped event channel for native model streams', async () => {
    isTauriState.value = true
    const unlisten = vi.fn()
    let listenedEventName = ''
    let handler: ((event: { payload: unknown }) => void) | undefined

    listenMock.mockImplementation(async (eventName: string, nextHandler: typeof handler) => {
      listenedEventName = eventName
      handler = nextHandler
      return unlisten
    })
    invokeMock.mockImplementation(async (_command: string, args: { request: { event_name: string } }) => {
      handler?.({ payload: { kind: 'TextDelta', text: args.request.event_name } })
      handler?.({ payload: { kind: 'Done' } })
      return 'session'
    })

    const callbacks = createCallbacks()

    await streamAiModel({ provider, model, message: 'hello', callbacks })

    expect(listenMock).toHaveBeenCalledWith(expect.stringMatching(/^ai-model-stream-/), expect.any(Function))
    expect(invokeMock).toHaveBeenCalledWith('stream_ai_model', {
      request: expect.objectContaining({ event_name: listenedEventName }),
    })
    expect(callbacks.onText).toHaveBeenCalledWith(listenedEventName)
    expect(callbacks.onDone).toHaveBeenCalledTimes(1)
    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it('passes active vault roots to native model streams for note tools', async () => {
    isTauriState.value = true
    const unlisten = vi.fn()
    listenMock.mockResolvedValue(unlisten)
    invokeMock.mockResolvedValue('session')

    const callbacks = createCallbacks()

    await streamAiModel({
      provider,
      model,
      message: 'create a note',
      vaultPath: '/vault',
      vaultPaths: ['/vault', '/team-vault'],
      callbacks,
    })

    expect(invokeMock).toHaveBeenCalledWith('stream_ai_model', {
      request: expect.objectContaining({
        vault_path: '/vault',
        vault_paths: ['/vault', '/team-vault'],
      }),
    })
  })
})
