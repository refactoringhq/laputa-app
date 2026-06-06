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
import { streamAiModel } from '../utils/streamAiModel'
import { hydrateNoteReferences } from '../utils/ai-reference-content'

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

interface RegenerateAgentMessageOptions {
  runtime: AiAgentSessionRuntime
  context: AgentExecutionContext
  messageId: string
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

function shouldIgnorePrompt(status: AgentStatus, prompt: PendingUserPrompt): boolean {
  return !prompt.text || status === 'thinking' || status === 'tool-executing'
}

function blockMissingVault(runtime: AiAgentSessionRuntime, context: AgentExecutionContext, prompt: PendingUserPrompt): void {
  trackAiAgentMessageBlocked(context.agent, 'missing_vault')
  appendLocalResponse(runtime.setMessages, prompt, 'No vault loaded. Open a vault first.')
}

function blockUnavailableAgent(runtime: AiAgentSessionRuntime, context: AgentExecutionContext, prompt: PendingUserPrompt): void {
  trackAiAgentMessageBlocked(context.agent, 'agent_unavailable')
  appendLocalResponse(
    runtime.setMessages,
    prompt,
    createMissingAgentResponse(context.agent),
  )
}

async function streamWithSelectedTarget(
  context: AgentExecutionContext,
  formattedMessage: string,
  systemPrompt: string,
  callbacks: ReturnType<typeof createStreamCallbacks>,
): Promise<void> {
  if (context.target?.kind === 'api_model') {
    await streamAiModel({
      provider: context.target.provider,
      model: context.target.model,
      message: formattedMessage,
      systemPrompt,
      vaultPath: context.vaultPath,
      vaultPaths: context.vaultPaths,
      callbacks,
    })
    return
  }

  await streamAiAgent({
    agent: context.agent,
    message: formattedMessage,
    systemPrompt,
    vaultPath: context.vaultPath,
    vaultPaths: context.vaultPaths,
    permissionMode: context.permissionMode,
    callbacks,
  })
}

export async function sendAgentMessage({
  runtime,
  context,
  prompt,
}: SendAgentMessageOptions): Promise<void> {
  const currentStatus = runtime.statusRef.current
  const normalizedPrompt = normalizePrompt(prompt)

  if (shouldIgnorePrompt(currentStatus, normalizedPrompt)) return

  if (!context.vaultPath) {
    blockMissingVault(runtime, context, normalizedPrompt)
    return
  }

  if (!context.ready) {
    blockUnavailableAgent(runtime, context, normalizedPrompt)
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
  const promptForAgent = {
    ...normalizedPrompt,
    references: await hydrateNoteReferences(normalizedPrompt.references),
  }

  const { formattedMessage, systemPrompt } = buildFormattedMessage(
    context,
    runtime.messagesRef.current,
    promptForAgent,
  )

  const callbacks = createStreamCallbacks({
    agent: context.agent,
    messageId,
    vaultPath: context.vaultPath,
    setMessages: runtime.setMessages,
    setStatus: runtime.setStatus,
    abortRef: runtime.abortRef,
    responseAccRef: runtime.responseAccRef,
    toolInputMapRef: runtime.toolInputMapRef,
    fileCallbacksRef: runtime.fileCallbacksRef,
  })

  await streamWithSelectedTarget(context, formattedMessage, systemPrompt, callbacks)
}

export async function regenerateAgentMessage({
  runtime,
  context,
  messageId,
}: RegenerateAgentMessageOptions): Promise<void> {
  const currentMessages = runtime.messagesRef.current
  const messageIndex = currentMessages.findIndex((message) => message.id === messageId)
  const message = currentMessages[messageIndex]
  if (!message || message.localMarker || runtime.statusRef.current === 'thinking' || runtime.statusRef.current === 'tool-executing') return

  const preservedMessages = currentMessages.slice(0, messageIndex)
  runtime.abortRef.current = { aborted: false }
  runtime.responseAccRef.current = ''
  runtime.toolInputMapRef.current = new Map()
  runtime.messagesRef.current = preservedMessages
  runtime.statusRef.current = 'idle'
  runtime.setMessages(preservedMessages)
  runtime.setStatus('idle')

  await sendAgentMessage({
    runtime,
    context,
    prompt: {
      text: message.userMessage,
      references: message.references,
    },
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
