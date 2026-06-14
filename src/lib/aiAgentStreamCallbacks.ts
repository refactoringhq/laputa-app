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
const ASCII_WORD_RE = /^[A-Za-z0-9_]$/u
const SENTENCE_START_RE = /^[A-ZÀ-ÖØ-Þ]$/u

type AssistantResponseText = string
type StreamErrorMessage = string
type ToolInvocationId = string
type ToolOutputText = string

interface ToolOutputInspection {
  output?: ToolOutputText
}

function normalizeAssistantResponseText(response: AssistantResponseText): AssistantResponseText {
  let normalized = ''

  for (let index = 0; index < response.length; index += 1) {
    normalized += response[index]

    if (needsSpaceAfterSentencePunctuation(response, index) || needsSpaceAfterWikilink(response, index)) {
      normalized += ' '
    }
  }

  return normalized
}

function needsSpaceAfterSentencePunctuation(response: AssistantResponseText, index: number): boolean {
  const char = response[index]
  if (char !== '.' && char !== '!' && char !== '?') return false
  if (isSingleLetterInitialBeforePunctuation(response, index)) return false

  return startsSentenceOrWikilink(response, index + 1)
}

function startsSentenceOrWikilink(response: AssistantResponseText, index: number): boolean {
  return startsWikilink(response, index) || SENTENCE_START_RE.test(response[index] ?? '')
}

function startsWikilink(response: AssistantResponseText, index: number): boolean {
  return response[index] === '[' && response[index + 1] === '['
}

function isSingleLetterInitialBeforePunctuation(response: AssistantResponseText, punctuationIndex: number): boolean {
  const initialIndex = punctuationIndex - 1
  if (!SENTENCE_START_RE.test(response[initialIndex] ?? '')) return false

  const previousChar = response[initialIndex - 1]
  return previousChar === undefined || !ASCII_WORD_RE.test(previousChar)
}

function needsSpaceAfterWikilink(response: AssistantResponseText, index: number): boolean {
  return response[index - 1] === ']' && response[index] === ']' && SENTENCE_START_RE.test(response[index + 1] ?? '')
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

function finalResponseText(response: AssistantResponseText, agent: AiAgentId): AssistantResponseText {
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

function retainedToolOutput({ output }: ToolOutputInspection): ToolOutputText | undefined {
  if (!output || output.length <= MAX_RETAINED_TOOL_OUTPUT_CHARS) return output

  const omitted = output.length - MAX_RETAINED_TOOL_OUTPUT_CHARS
  return [
    output.slice(0, MAX_RETAINED_TOOL_OUTPUT_CHARS),
    `[Tool output truncated: ${omitted} chars omitted]`,
  ].join('\n\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toolOutputIndicatesFailure({ output }: ToolOutputInspection): boolean {
  const trimmed = output?.trim()
  if (!trimmed) return false
  if (/^Error:/iu.test(trimmed)) return true

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return false
  }
  if (!parsed) return false
  if (!isRecord(parsed)) return false

  const error = parsed.error
  return parsed.isError === true || typeof error === 'string' || isRecord(error)
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

    onToolDone: (toolId: ToolInvocationId, output?: ToolOutputText) => {
      if (abortRef.current.aborted) return

      const info = toolInputMapRef.current.get(toolId)
      const toolOutput = { output }
      const failed = toolOutputIndicatesFailure(toolOutput)
      if (info && !failed) {
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
            ? { ...action, status: failed ? 'error' as const : 'done' as const, output: retainedToolOutput(toolOutput) }
            : action
        )),
      }))
    },

    onError: (error: StreamErrorMessage) => {
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
