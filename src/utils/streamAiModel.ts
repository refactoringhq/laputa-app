import { isTauri } from '../mock-tauri'
import type { AiModelDefinition, AiModelProvider } from '../lib/aiTargets'
import type { AgentStreamCallbacks } from './streamAiAgent'
import { createScopedStreamEventName } from './aiStreamEvents'
import { cleanupTauriEventListener } from './tauriEventCleanup'

type AiModelStreamEvent =
  | { kind: 'Init'; session_id: string }
  | { kind: 'TextDelta'; text: string }
  | { kind: 'ThinkingDelta'; text: string }
  | { kind: 'ToolStart'; tool_name: string; tool_id: string; input?: string }
  | { kind: 'ToolDone'; tool_id: string; output?: string }
  | { kind: 'Error'; message: string }
  | { kind: 'Done' }

interface StreamAiModelRequest {
  provider: AiModelProvider
  model: AiModelDefinition
  message: string
  systemPrompt?: string
  vaultPath?: string
  vaultPaths?: string[]
  callbacks: AgentStreamCallbacks
}

interface NativeAiModelStreamRequest {
  provider: AiModelProvider
  model_id: string
  message: string
  system_prompt: string | null
  vault_path: string | null
  vault_paths: string[] | null
  api_key_override: null
  event_name: string
}

function mockModelResponse(provider: AiModelProvider, model: AiModelDefinition, message: string): string {
  const displayName = model.display_name || model.id
  return `[mock-${provider.name} ${displayName}] You asked: "${message.slice(0, 160)}"`
}

function handleStreamEvent(data: AiModelStreamEvent, callbacks: AgentStreamCallbacks): void {
  switch (data.kind) {
    case 'TextDelta':
      callbacks.onText(data.text)
      return
    case 'ThinkingDelta':
      callbacks.onThinking(data.text)
      return
    case 'ToolStart':
      callbacks.onToolStart(data.tool_name, data.tool_id, data.input)
      return
    case 'ToolDone':
      callbacks.onToolDone(data.tool_id, data.output)
      return
    case 'Error':
      callbacks.onError(data.message)
      return
    case 'Done':
      callbacks.onDone()
      return
  }
}

function streamMockAiModel({ provider, model, message, callbacks }: StreamAiModelRequest): void {
  setTimeout(() => {
    callbacks.onText(mockModelResponse(provider, model, message))
    callbacks.onDone()
  }, 300)
}

function nativeVaultPaths(vaultPaths: string[] | undefined): string[] | null {
  return vaultPaths && vaultPaths.length > 0 ? vaultPaths : null
}

function nativeAiModelRequest(request: StreamAiModelRequest, eventName: string): NativeAiModelStreamRequest {
  return {
    provider: request.provider,
    model_id: request.model.id,
    message: request.message,
    system_prompt: request.systemPrompt || null,
    vault_path: request.vaultPath || null,
    vault_paths: nativeVaultPaths(request.vaultPaths),
    api_key_override: null,
    event_name: eventName,
  }
}

function createStreamCloser(callbacks: AgentStreamCallbacks) {
  let closed = false
  return (): void => {
    if (closed) return
    closed = true
    callbacks.onDone()
  }
}

function handleNativeStreamEvent(
  data: AiModelStreamEvent,
  callbacks: AgentStreamCallbacks,
  closeStream: () => void,
): void {
  if (data.kind === 'Done') {
    closeStream()
    return
  }
  handleStreamEvent(data, callbacks)
}

async function streamNativeAiModel(request: StreamAiModelRequest): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  const { listen } = await import('@tauri-apps/api/event')
  const eventName = createScopedStreamEventName('ai-model-stream')
  const closeStream = createStreamCloser(request.callbacks)

  const unlisten = await listen<AiModelStreamEvent>(eventName, (event) => {
    handleNativeStreamEvent(event.payload, request.callbacks, closeStream)
  })

  try {
    await invoke<string>('stream_ai_model', {
      request: nativeAiModelRequest(request, eventName),
    })
    closeStream()
  } catch (err) {
    request.callbacks.onError(err instanceof Error ? err.message : String(err))
    closeStream()
  } finally {
    cleanupTauriEventListener(unlisten)
  }
}

export async function streamAiModel(request: StreamAiModelRequest): Promise<void> {
  if (!isTauri()) {
    streamMockAiModel(request)
    return
  }

  await streamNativeAiModel(request)
}
