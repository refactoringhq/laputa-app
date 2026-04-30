import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  appendLocalResponse,
  appendLocalMarker,
  appendStreamingMessage,
  buildFormattedMessage,
  createMissingAgentResponse,
  type AgentStatus,
  type AgentExecutionContext,
  type AiAgentMessage,
  type PendingUserPrompt,
} from './aiAgentConversation'
import type { AgentFileCallbacks } from './aiAgentFileOperations'
import { createStreamCallbacks } from './aiAgentStreamCallbacks'
import type { ToolInvocation } from './aiAgentMessageState'
import { trackAiAgentMessageBlocked, trackAiAgentMessageSent } from './productAnalytics'
import { streamAiAgent } from '../utils/streamAiAgent'

export interface AiAgentSessionRuntime {
  setMessages: Dispatch<SetStateAction<AiAgentMessage[]>>
  setStatus: Dispatch<SetStateAction<AgentStatus>>
  abortRef: MutableRefObject<{ aborted: boolean }>
  responseAccRef: MutableRefObject<string>
  fileCallbacksRef: MutableRefObject<AgentFileCallbacks | undefined>
  toolInputMapRef: MutableRefObject<Map<string, ToolInvocation>>
  messagesRef: MutableRefObject<AiAgentMessage[]>
  statusRef: MutableRefObject<AgentStatus>
}

interface SendAgentMessageOptions {
  runtime: AiAgentSessionRuntime
  context: AgentExecutionContext
  prompt: PendingUserPrompt
}

function normalizePrompt(prompt: PendingUserPrompt): PendingUserPrompt {
  return {
    text: prompt.text.trim(),
    references: prompt.references && prompt.references.length > 0 ? prompt.references : undefined,
  }
}

function completedMessageCount(messages: AiAgentMessage[]): number {
  return messages.filter((message) => !message.isStreaming && !message.localMarker).length
}

export async function sendAgentMessage({
  runtime,
  context,
  prompt,
}: SendAgentMessageOptions): Promise<void> {
  const currentStatus = runtime.statusRef.current
  const normalizedPrompt = normalizePrompt(prompt)

  if (!normalizedPrompt.text || currentStatus === 'thinking' || currentStatus === 'tool-executing') return

  if (!context.vaultPath) {
    trackAiAgentMessageBlocked(context.agent, 'missing_vault')
    appendLocalResponse(runtime.setMessages, normalizedPrompt, 'No vault loaded. Open a vault first.')
    return
  }

  if (!context.ready) {
    trackAiAgentMessageBlocked(context.agent, 'agent_unavailable')
    appendLocalResponse(
      runtime.setMessages,
      normalizedPrompt,
      createMissingAgentResponse(context.agent),
    )
    return
  }

  trackAiAgentMessageSent({
    agent: context.agent,
    permissionMode: context.permissionMode,
    hasContext: !!context.systemPromptOverride,
    referenceCount: normalizedPrompt.references?.length ?? 0,
    historyMessageCount: completedMessageCount(runtime.messagesRef.current),
  })

  runtime.abortRef.current = { aborted: false }
  runtime.responseAccRef.current = ''
  runtime.toolInputMapRef.current = new Map()

  const messageId = appendStreamingMessage(runtime.setMessages, normalizedPrompt)
  runtime.setStatus('thinking')

  const { formattedMessage, systemPrompt } = buildFormattedMessage(
    context,
    runtime.messagesRef.current,
    normalizedPrompt,
  )

  await streamAiAgent({
    agent: context.agent,
    message: formattedMessage,
    systemPrompt,
    vaultPath: context.vaultPath,
    permissionMode: context.permissionMode,
    callbacks: createStreamCallbacks({
      agent: context.agent,
      messageId,
      vaultPath: context.vaultPath,
      setMessages: runtime.setMessages,
      setStatus: runtime.setStatus,
      abortRef: runtime.abortRef,
      responseAccRef: runtime.responseAccRef,
      toolInputMapRef: runtime.toolInputMapRef,
      fileCallbacksRef: runtime.fileCallbacksRef,
    }),
  })
}

export function addAgentLocalMarker(
  runtime: Pick<AiAgentSessionRuntime, 'setMessages'>,
  text: string,
): void {
  appendLocalMarker(runtime.setMessages, text)
}

export function clearAgentConversation(runtime: Pick<AiAgentSessionRuntime, 'abortRef' | 'responseAccRef' | 'toolInputMapRef' | 'setMessages' | 'setStatus'>): void {
  runtime.abortRef.current.aborted = true
  runtime.responseAccRef.current = ''
  runtime.toolInputMapRef.current = new Map()
  runtime.setMessages([])
  runtime.setStatus('idle')
}
