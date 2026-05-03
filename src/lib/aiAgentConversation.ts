import type { Dispatch, SetStateAction } from 'react'
import type { AiAction } from '../components/AiMessage'
import { buildAgentSystemPrompt } from '../utils/ai-agent'
import {
  MAX_HISTORY_TOKENS,
  formatMessageWithHistory,
  nextMessageId,
  trimHistory,
  type ChatMessage,
} from '../utils/ai-chat'
import type { NoteReference } from '../utils/ai-context'
import type { AiAgentId } from './aiAgents'
import { getAiAgentDefinition } from './aiAgents'
import type { AiAgentPermissionMode } from './aiAgentPermissionMode'
import type { AiTarget } from './aiTargets'

export interface AiAgentMessage {
  userMessage: string
  references?: NoteReference[]
  localMarker?: string
  reasoning?: string
  reasoningDone?: boolean
  actions: AiAction[]
  response?: string
  isStreaming?: boolean
  id?: string
}

export type AgentStatus = 'idle' | 'thinking' | 'tool-executing' | 'done' | 'error'

export interface AgentExecutionContext {
  agent: AiAgentId
  target?: AiTarget
  ready: boolean
  vaultPath: string
  permissionMode: AiAgentPermissionMode
  systemPromptOverride?: string
}

export interface PendingUserPrompt {
  text: string
  references?: NoteReference[]
}

function toChatHistory(messages: AiAgentMessage[]): ChatMessage[] {
  return messages.filter((message) => !message.localMarker).flatMap((message) => {
    const history: ChatMessage[] = [{ role: 'user', content: message.userMessage, id: message.id ?? '' }]
    if (message.response) {
      history.push({ role: 'assistant', content: message.response, id: `${message.id}-resp` })
    }
    return history
  })
}

export function appendLocalMarker(
  setMessages: Dispatch<SetStateAction<AiAgentMessage[]>>,
  text: string,
): void {
  setMessages((current) => [
    ...current,
    {
      userMessage: '',
      localMarker: text,
      actions: [],
      id: nextMessageId(),
    },
  ])
}

export function createMissingAgentResponse(agent: AiAgentId): string {
  const definition = getAiAgentDefinition(agent)
  return `${definition.label} is not available on this machine. Install it or switch the default AI agent in Settings.`
}

export function appendLocalResponse(
  setMessages: Dispatch<SetStateAction<AiAgentMessage[]>>,
  prompt: PendingUserPrompt,
  response: string,
): void {
  setMessages((current) => [
    ...current,
    {
      userMessage: prompt.text,
      references: prompt.references,
      actions: [],
      response,
      id: nextMessageId(),
    },
  ])
}

export function appendStreamingMessage(
  setMessages: Dispatch<SetStateAction<AiAgentMessage[]>>,
  prompt: PendingUserPrompt,
): string {
  const messageId = nextMessageId()
  setMessages((current) => [
    ...current,
    {
      userMessage: prompt.text,
      references: prompt.references,
      actions: [],
      isStreaming: true,
      id: messageId,
    },
  ])
  return messageId
}

export function buildFormattedMessage(
  context: AgentExecutionContext,
  messages: AiAgentMessage[],
  prompt: PendingUserPrompt,
): { formattedMessage: string; systemPrompt: string } {
  const systemPrompt = buildAgentSystemPrompt({
    agent: context.agent,
    permissionMode: context.permissionMode,
    vaultContext: context.systemPromptOverride,
  })
  const chatHistory = toChatHistory(messages.filter((message) => !message.isStreaming))
  const trimmedHistory = trimHistory(chatHistory, MAX_HISTORY_TOKENS)

  return {
    formattedMessage: formatMessageWithHistory(trimmedHistory, prompt.text),
    systemPrompt,
  }
}
