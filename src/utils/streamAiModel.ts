import { isTauri } from '../mock-tauri'
import type { AiModelDefinition, AiModelProvider } from '../lib/aiTargets'
import type { AgentStreamCallbacks } from './streamAiAgent'

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
  callbacks: AgentStreamCallbacks
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

export async function streamAiModel({
  provider,
  model,
  message,
  systemPrompt,
  callbacks,
}: StreamAiModelRequest): Promise<void> {
  if (!isTauri()) {
    setTimeout(() => {
      callbacks.onText(mockModelResponse(provider, model, message))
      callbacks.onDone()
    }, 300)
    return
  }

  const { invoke } = await import('@tauri-apps/api/core')
  const { listen } = await import('@tauri-apps/api/event')
  let closed = false
  const closeStream = (): void => {
    if (closed) return
    closed = true
    callbacks.onDone()
  }

  const unlisten = await listen<AiModelStreamEvent>('ai-model-stream', (event) => {
    if (event.payload.kind === 'Done') {
      closeStream()
      return
    }
    handleStreamEvent(event.payload, callbacks)
  })

  try {
    await invoke<string>('stream_ai_model', {
      request: {
        provider,
        model_id: model.id,
        message,
        system_prompt: systemPrompt || null,
        api_key_override: null,
      },
    })
    closeStream()
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : String(err))
    closeStream()
  } finally {
    unlisten()
  }
}
