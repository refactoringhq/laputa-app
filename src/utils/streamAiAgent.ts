import { isTauri } from '../mock-tauri'
import { getAiAgentDefinition, type AiAgentId } from '../lib/aiAgents'
import {
  normalizeAiAgentPermissionMode,
  type AiAgentPermissionMode,
} from '../lib/aiAgentPermissionMode'

type AiAgentStreamEvent =
  | { kind: 'Init'; session_id: string }
  | { kind: 'TextDelta'; text: string }
  | { kind: 'ThinkingDelta'; text: string }
  | { kind: 'ToolStart'; tool_name: string; tool_id: string; input?: string }
  | { kind: 'ToolDone'; tool_id: string; output?: string }
  | { kind: 'Error'; message: string }
  | { kind: 'Done' }

export interface AgentStreamCallbacks {
  onText: (text: string) => void
  onThinking: (text: string) => void
  onToolStart: (toolName: string, toolId: string, input?: string) => void
  onToolDone: (toolId: string, output?: string) => void
  onError: (message: string) => void
  onDone: () => void
}

export interface StreamAiAgentRequest {
  agent: AiAgentId
  message: string
  systemPrompt?: string
  vaultPath: string
  permissionMode?: AiAgentPermissionMode
  callbacks: AgentStreamCallbacks
}

function mockAgentResponse(agent: AiAgentId, message: string): string {
  const agentLabel = getAiAgentDefinition(agent).label
  if (message.includes('<conversation_history>')) {
    const allUserLines = message.match(/\[user\]: .+/g) ?? []
    const turnCount = allUserLines.length
    const lastLine = allUserLines[allUserLines.length - 1] ?? ''
    const lastUserMsg = lastLine.replace('[user]: ', '')
    return `[mock-${agentLabel.toLowerCase()} turns=${turnCount}] You asked: "${lastUserMsg}" — This note is related to [[Build Laputa App]] and [[Matteo Cellini]].`
  }
  return `[mock-${agentLabel.toLowerCase()}] You said: "${message}" — This note is related to [[Build Laputa App]] and [[Matteo Cellini]].`
}

function handleStreamEvent(data: AiAgentStreamEvent, callbacks: AgentStreamCallbacks): void {
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

export async function streamAiAgent(
  request: StreamAiAgentRequest,
): Promise<void> {
  const {
    agent,
    message,
    systemPrompt,
    vaultPath,
    permissionMode,
    callbacks,
  } = request

  if (!isTauri()) {
    setTimeout(() => {
      callbacks.onText(mockAgentResponse(agent, message))
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

  const unlisten = await listen<AiAgentStreamEvent>('ai-agent-stream', (event) => {
    if (event.payload.kind === 'Done') {
      closeStream()
      return
    }

    handleStreamEvent(event.payload, callbacks)
  })

  try {
    await invoke<string>('stream_ai_agent', {
      request: {
        agent,
        message,
        system_prompt: systemPrompt || null,
        vault_path: vaultPath,
        permission_mode: normalizeAiAgentPermissionMode(permissionMode),
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
