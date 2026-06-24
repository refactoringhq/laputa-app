import type { NoteReference } from './ai-context'

export const OPEN_AI_CHAT_EVENT = 'tolaria:open-ai-chat'
export const AI_PROMPT_QUEUED_EVENT = 'tolaria:ai-prompt-queued'
export const NEW_AI_CHAT_EVENT = 'tolaria:new-ai-chat'
export const AI_WORKSPACE_DOCK_REQUESTED_EVENT = 'tolaria:ai-workspace-dock-requested'
export const AI_WORKSPACE_OPEN_NOTE_REQUESTED_EVENT = 'tolaria:ai-workspace-open-note-requested'
export const AI_WORKSPACE_FILE_CREATED_EVENT = 'tolaria:ai-workspace-file-created'
export const AI_WORKSPACE_FILE_MODIFIED_EVENT = 'tolaria:ai-workspace-file-modified'
export const AI_WORKSPACE_VAULT_CHANGED_EVENT = 'tolaria:ai-workspace-vault-changed'

export interface QueuedAiPrompt {
  id: number
  text: string
  references: NoteReference[]
  targetId?: string
}

let nextQueuedPromptId = 1
let pendingPrompt: QueuedAiPrompt | null = null

export function queueAiPrompt(
  text: string,
  references: NoteReference[],
  targetId?: string,
): QueuedAiPrompt {
  const queuedPrompt = {
    id: nextQueuedPromptId++,
    text,
    references,
    targetId,
  }
  pendingPrompt = queuedPrompt
  window.dispatchEvent(new Event(AI_PROMPT_QUEUED_EVENT))
  return queuedPrompt
}

export function takeQueuedAiPrompt(): QueuedAiPrompt | null {
  const queuedPrompt = pendingPrompt
  pendingPrompt = null
  return queuedPrompt
}

export function requestOpenAiChat() {
  window.dispatchEvent(new Event(OPEN_AI_CHAT_EVENT))
}

export function requestNewAiChat() {
  requestOpenAiChat()
  window.setTimeout(() => window.dispatchEvent(new Event(NEW_AI_CHAT_EVENT)), 0)
}

export function requestDockAiWorkspace() {
  window.dispatchEvent(new Event(AI_WORKSPACE_DOCK_REQUESTED_EVENT))
}
