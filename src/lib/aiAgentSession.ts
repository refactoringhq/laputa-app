import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  appendLocalResponse,
  appendStreamingMessage,
  buildFormattedMessage,
  createMissingAgentResponse,
  type AgentExecutionContext,
  type AiAgentMessage,
  type PendingUserPrompt,
} from './aiAgentConversation'
import { createStreamCallbacks } from './aiAgentStreamCallbacks'
import type { ToolInvocation } from './aiAgentMessageState'
import { streamAiAgent } from '../utils/streamAiAgent'
import type { AgentFileCallbacks, AgentStatus } from '../hooks/useAiAgent'

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

export async function sendAgentMessage({
  runtime,
  context,
  prompt,
}: SendAgentMessageOptions): Promise<void> {
  const currentStatus = runtime.statusRef.current
  const normalizedPrompt = normalizePrompt(prompt)

  if (!normalizedPrompt.text || currentStatus === 'thinking' || currentStatus === 'tool-executing') return

  if (!context.vaultPath) {
    appendLocalResponse(runtime.setMessages, normalizedPrompt, 'No vault loaded. Open a vault first.')
    return
  }

  if (!context.ready) {
    appendLocalResponse(
      runtime.setMessages,
      normalizedPrompt,
      createMissingAgentResponse(context.agent),
    )
    return
  }

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

export function clearAgentConversation(runtime: Pick<AiAgentSessionRuntime, 'abortRef' | 'responseAccRef' | 'toolInputMapRef' | 'setMessages' | 'setStatus'>): void {
  runtime.abortRef.current.aborted = true
  runtime.responseAccRef.current = ''
  runtime.toolInputMapRef.current = new Map()
  runtime.setMessages([])
  runtime.setStatus('idle')
}
