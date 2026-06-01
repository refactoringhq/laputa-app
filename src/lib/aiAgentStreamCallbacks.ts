import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { AgentStatus, AiAgentMessage } from './aiAgentConversation'
import { detectFileOperation, type AgentFileCallbacks } from './aiAgentFileOperations'
import {
  markReasoningDone,
  updateMessage,
  updateToolAction,
  type ToolInvocation,
} from './aiAgentMessageState'
import { getAiAgentDefinition, type AiAgentId } from './aiAgents'
import {
  trackAiAgentResponseCompleted,
  trackAiAgentResponseFailed,
} from './productAnalytics'

const MAX_RETAINED_TOOL_OUTPUT_CHARS = 20_000

function normalizeAssistantResponseText(response: string): string {
  return response
    .replace(/(?<!\b[A-Z])([.!?])(?=([A-ZÀ-ÖØ-Þ]|\[\[))/gu, '$1 ')
    .replace(/(\]\])(?=[A-ZÀ-ÖØ-Þ])/gu, '$1 ')
}

export interface StreamMutationContext {
  agent: AiAgentId
  messageId: string
  vaultPath: string
  setMessages: Dispatch<SetStateAction<AiAgentMessage[]>>
  setStatus: Dispatch<SetStateAction<AgentStatus>>
  abortRef: MutableRefObject<{ aborted: boolean }>
  responseAccRef: MutableRefObject<string>
  toolInputMapRef: MutableRefObject<Map<string, ToolInvocation>>
  fileCallbacksRef: MutableRefObject<AgentFileCallbacks | undefined>
}

function finalResponseText(response: string, agent: AiAgentId): string {
  if (response.trim()) return normalizeAssistantResponseText(response)

  if (agent === 'opencode') {
    return [
      'OpenCode returned no assistant text.',
      'Check the selected provider/model context limit or retry the request.',
      'For large active notes, Tolaria sends a compact note snapshot and OpenCode can read the full file with get_note(path).',
    ].join(' ')
  }

  return `${getAiAgentDefinition(agent).label} finished without returning a reply.`
}

function retainedToolOutput(output: string | undefined): string | undefined {
  if (!output || output.length <= MAX_RETAINED_TOOL_OUTPUT_CHARS) return output

  const omitted = output.length - MAX_RETAINED_TOOL_OUTPUT_CHARS
  return [
    output.slice(0, MAX_RETAINED_TOOL_OUTPUT_CHARS),
    `[Tool output truncated: ${omitted} chars omitted]`,
  ].join('\n\n')
}

export function createStreamCallbacks(context: StreamMutationContext) {
  const {
    messageId,
    agent,
    vaultPath,
    setMessages,
    setStatus,
    abortRef,
    responseAccRef,
    toolInputMapRef,
    fileCallbacksRef,
  } = context
  let failureTracked = false
  let streamFailed = false

  return {
    onThinking: (chunk: string) => {
      if (abortRef.current.aborted) return
      updateMessage(setMessages, messageId, (message) => ({
        ...message,
        reasoning: (message.reasoning ?? '') + chunk,
      }))
    },

    onText: (chunk: string) => {
      if (abortRef.current.aborted) return
      markReasoningDone(setMessages, messageId)
      responseAccRef.current += chunk
    },

    onToolStart: (toolName: string, toolId: string, input?: string) => {
      if (abortRef.current.aborted) return

      markReasoningDone(setMessages, messageId)
      setStatus('tool-executing')

      const previous = toolInputMapRef.current.get(toolId)
      toolInputMapRef.current.set(toolId, { tool: toolName, input: input ?? previous?.input })

      updateMessage(setMessages, messageId, (message) => updateToolAction(message, toolName, toolId, input))
    },

    onToolDone: (toolId: string, output?: string) => {
      if (abortRef.current.aborted) return

      const info = toolInputMapRef.current.get(toolId)
      if (info) {
        detectFileOperation({
          toolName: info.tool,
          input: info.input,
          vaultPath,
          callbacks: fileCallbacksRef.current,
        })
      }

      updateMessage(setMessages, messageId, (message) => ({
        ...message,
        actions: message.actions.map((action) => (
          action.toolId === toolId
            ? { ...action, status: 'done' as const, output: retainedToolOutput(output) }
            : action
        )),
      }))
    },

    onError: (error: string) => {
      if (abortRef.current.aborted) return

      setStatus('error')
      streamFailed = true
      const partial = normalizeAssistantResponseText(responseAccRef.current)
      failureTracked = true
      trackAiAgentResponseFailed(agent, partial, toolInputMapRef.current.size)
      updateMessage(setMessages, messageId, (message) => ({
        ...message,
        isStreaming: false,
        reasoningDone: true,
        response: partial ? `${partial}\n\nError: ${error}` : `Error: ${error}`,
        actions: message.actions.map((action) => (
          action.status === 'pending' ? { ...action, status: 'error' as const } : action
        )),
      }))
    },

    onDone: () => {
      if (abortRef.current.aborted) return
      if (streamFailed) return

      setStatus('done')
      const finalResponse = finalResponseText(responseAccRef.current, agent)
      trackAiAgentResponseCompleted(agent, responseAccRef.current, toolInputMapRef.current.size, failureTracked)
      updateMessage(setMessages, messageId, (message) => ({
        ...message,
        isStreaming: false,
        reasoningDone: true,
        response: finalResponse,
        actions: message.actions.map((action) => (
          action.status === 'pending' ? { ...action, status: 'done' as const } : action
        )),
      }))
      fileCallbacksRef.current?.onVaultChanged?.()
    },
  }
}
