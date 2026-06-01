/**
 * AI Chat utilities — Claude CLI integration, token estimation, context building.
 */

import type { VaultEntry } from '../types'
import { isTauri } from '../mock-tauri'
import { cleanupTauriEventListener } from './tauriEventCleanup'

// --- Token estimation ---

/** Rough token estimate: ~4 chars per token for English text. */
export function estimateTokens(text: string | number): number {
  const len = typeof text === 'number' ? text : text.length
  return Math.ceil(len / 4)
}

const DEFAULT_CONTEXT_LIMIT = 180_000

export function getContextLimit(): number {
  return DEFAULT_CONTEXT_LIMIT
}

// --- Context building ---

/** Build system prompt from selected context notes (metadata only — content loaded via MCP). */
export function buildSystemPrompt(
  notes: VaultEntry[],
): { prompt: string; totalTokens: number; truncated: boolean } {
  if (notes.length === 0) {
    return { prompt: '', totalTokens: 0, truncated: false }
  }

  const preamble = [
    'You are a helpful AI assistant integrated into Tolaria, a personal knowledge management app.',
    'The user has selected the following notes as context. Use them to answer questions accurately.',
    'You can use MCP tools to read the full content of any note.',
    'When you mention or reference a note by name, always use [[Note Title]] wikilink syntax so the user can click to open it.',
    '',
  ].join('\n')

  const parts: string[] = [preamble]

  for (const note of notes) {
    const header = `--- Note: ${note.title} (${note.isA ?? 'Note'}) | Path: ${note.path} ---`
    parts.push(header)
  }

  const prompt = parts.join('\n')
  return { prompt, totalTokens: estimateTokens(prompt), truncated: false }
}

// --- Message types ---

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  id: string
}

let msgIdCounter = 0
export function nextMessageId(): string {
  return `msg-${++msgIdCounter}-${Date.now()}`
}

// --- Conversation history ---

/** Max tokens of history to include in each request. */
export const MAX_HISTORY_TOKENS = 100_000
const CONVERSATION_HISTORY_OPEN_MARKER = ['<', 'conversation_history', '>'].join('')
const CONVERSATION_HISTORY_CLOSE_MARKER = ['</', 'conversation_history', '>'].join('')

/** Keep the most recent messages that fit within `maxTokens`. Drops oldest first. */
export function trimHistory(history: ChatMessage[], maxTokens: number): ChatMessage[] {
  let tokenCount = 0
  const newestFirst = [...history].reverse()
  const keptNewestFirst: ChatMessage[] = []
  for (const message of newestFirst) {
    const tokens = estimateTokens(message.content)
    if (tokenCount + tokens > maxTokens) break
    keptNewestFirst.push(message)
    tokenCount += tokens
  }
  return keptNewestFirst.reverse()
}

/** Format conversation history + new message into a single prompt for the CLI. */
export function formatMessageWithHistory(history: ChatMessage[], newMessage: string): string {
  if (history.length === 0) return newMessage

  const lines = history.map(m => `[${m.role}]: ${m.content}`)
  lines.push(`[user]: ${newMessage}`)

  return `${CONVERSATION_HISTORY_OPEN_MARKER}\n${lines.join('\n\n')}\n${CONVERSATION_HISTORY_CLOSE_MARKER}\n\nContinue the conversation. Respond only to the latest [user] message.`
}

// --- Claude CLI status ---

export interface ClaudeCliStatus {
  installed: boolean
  version: string | null
}

export async function checkClaudeCli(): Promise<ClaudeCliStatus> {
  if (!isTauri()) {
    return { installed: false, version: null }
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<ClaudeCliStatus>('check_claude_cli')
}

// --- Claude CLI streaming ---

type ClaudeStreamEvent =
  | { kind: 'Init'; session_id: string }
  | { kind: 'TextDelta'; text: string }
  | { kind: 'ToolStart'; tool_name: string; tool_id: string }
  | { kind: 'ToolDone'; tool_id: string }
  | { kind: 'Result'; text: string; session_id: string }
  | { kind: 'Error'; message: string }
  | { kind: 'Done' }

export interface ChatStreamCallbacks {
  onInit?: (sessionId: string) => void
  onText: (text: string) => void
  onError: (message: string) => void
  onDone: () => void
}

/** Handle a single stream event from the Claude CLI, updating session state. */
function handleChatStreamEvent(
  data: ClaudeStreamEvent,
  state: { sessionId: string },
  callbacks: ChatStreamCallbacks,
): void {
  switch (data.kind) {
    case 'Init':
      state.sessionId = data.session_id
      callbacks.onInit?.(data.session_id)
      break
    case 'TextDelta':
      callbacks.onText(data.text)
      break
    case 'Result':
      if (data.session_id) state.sessionId = data.session_id
      break
    case 'Error':
      callbacks.onError(data.message)
      break
    case 'Done':
      callbacks.onDone()
      break
  }
}

/**
 * Generate a mock response for browser/test mode.
 * Inspects the message for conversation history so Playwright tests
 * can verify that history is actually being sent.
 */
function mockChatResponse(message: string): string {
  if (message.indexOf(CONVERSATION_HISTORY_OPEN_MARKER) >= 0) {
    const allUserLines = message.match(/\[user\]: .+/g) ?? []
    const turnCount = allUserLines.length
    // The last [user] line is the actual new message
    const lastLine = allUserLines.at(-1) ?? ''
    const lastUserMsg = lastLine.replace('[user]: ', '')
    return `[mock-with-history turns=${turnCount}] You asked: "${lastUserMsg}"`
  }
  return `[mock-no-history] You said: "${message}"`
}

/**
 * Stream a chat message through the Claude CLI subprocess.
 * Returns the session ID for conversation continuity via --resume.
 */
export async function streamClaudeChat(
  message: string,
  systemPrompt: string | undefined,
  sessionId: string | undefined,
  callbacks: ChatStreamCallbacks,
): Promise<string> {
  if (!isTauri()) {
    setTimeout(() => {
      callbacks.onText(mockChatResponse(message))
      callbacks.onDone()
    }, 300)
    return 'mock-session'
  }

  const { invoke } = await import('@tauri-apps/api/core')
  const { listen } = await import('@tauri-apps/api/event')

  const state = { sessionId: sessionId ?? '' }

  const unlisten = await listen<ClaudeStreamEvent>('claude-stream', (event) => {
    handleChatStreamEvent(event.payload, state, callbacks)
  })

  try {
    const result = await invoke<string>('stream_claude_chat', {
      request: {
        message,
        system_prompt: systemPrompt || null,
        session_id: sessionId || null,
      },
    })
    if (result) state.sessionId = result
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : String(err))
    callbacks.onDone()
  } finally {
    cleanupTauriEventListener(unlisten)
  }

  return state.sessionId
}
