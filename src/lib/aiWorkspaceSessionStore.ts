import type { Dispatch, SetStateAction } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { AgentStatus, AiAgentMessage } from './aiAgentConversation'
import { isTauri } from '../mock-tauri'
import { createCrossWindowPersistedStore, type CrossWindowStoreReadReason } from './crossWindowPersistedStore'

const STORAGE_KEY = 'tolaria:ai-workspace-sessions:v1'
const BROADCAST_CHANNEL = 'tolaria-ai-workspace-sessions'
const NATIVE_WRITE_DEBOUNCE_MS = 250

export interface AiWorkspaceSessionSnapshot {
  messages: AiAgentMessage[]
  status: AgentStatus
}

type MessageId = string
type SessionId = string
type SessionMap = Record<SessionId, AiWorkspaceSessionSnapshot>

const EMPTY_SESSION: AiWorkspaceSessionSnapshot = {
  messages: [],
  status: 'idle',
}

const sessionStore = createCrossWindowPersistedStore<SessionMap>({
  broadcastChannelName: BROADCAST_CHANNEL,
  broadcastMessage: { type: 'ai-workspace-sessions-updated' },
  emptySnapshot: {},
  sanitizeStoredValue: normalizeStoredSessionsForReason,
  storageKey: STORAGE_KEY,
})
let storeVersion = 0
let nativeWriteTimer: ReturnType<typeof setTimeout> | null = null
let nativeWriteInFlight = false
let pendingNativeSessions: SessionMap | null = null

function isSessionSnapshot(value: unknown): value is AiWorkspaceSessionSnapshot {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AiWorkspaceSessionSnapshot>
  return Array.isArray(candidate.messages) && typeof candidate.status === 'string'
}

function normalizeStoredStatus(value: unknown, resetRunningStatus: boolean): AgentStatus {
  switch (value) {
    case 'idle':
    case 'done':
    case 'error':
      return value
    case 'thinking':
    case 'tool-executing':
      return resetRunningStatus ? 'idle' : value
    default:
      return 'idle'
  }
}

function normalizeStoredMessages(messages: AiAgentMessage[], resetRunningStatus: boolean): AiAgentMessage[] {
  if (!resetRunningStatus) return messages
  return messages.map((message) => (
    message.isStreaming ? { ...message, isStreaming: false } : message
  ))
}

function normalizeStoredSessions(value: unknown, resetRunningStatus: boolean): SessionMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, AiWorkspaceSessionSnapshot] => (
      typeof entry[0] === 'string' && isSessionSnapshot(entry[1])
    )).map(([sessionId, session]) => [
      sessionId,
      {
        messages: normalizeStoredMessages(session.messages, resetRunningStatus),
        status: normalizeStoredStatus(session.status, resetRunningStatus),
      },
    ]),
  )
}

function normalizeStoredSessionsForReason(
  value: unknown,
  reason: CrossWindowStoreReadReason,
): SessionMap {
  return normalizeStoredSessions(value, reason !== 'storage')
}

async function readNativeSessions(): Promise<SessionMap> {
  if (!isTauri()) return {}

  try {
    const stored = await invoke<unknown>('get_ai_workspace_sessions')
    return normalizeStoredSessions(stored, true)
  } catch {
    return {}
  }
}

async function flushNativeSessionsWrite(): Promise<void> {
  if (!isTauri() || nativeWriteInFlight || !pendingNativeSessions) return

  nativeWriteInFlight = true
  const nextSessions = pendingNativeSessions
  pendingNativeSessions = null
  nativeWriteTimer = null

  try {
    await invoke('save_ai_workspace_sessions', { sessions: nextSessions })
  } catch {
    // Transcript persistence should never interrupt the chat UI.
  } finally {
    nativeWriteInFlight = false
    if (pendingNativeSessions) scheduleNativeSessionsWrite(pendingNativeSessions)
  }
}

function scheduleNativeSessionsWrite(nextSessions: SessionMap): void {
  if (!isTauri()) return

  pendingNativeSessions = nextSessions
  if (nativeWriteTimer || nativeWriteInFlight) return

  nativeWriteTimer = setTimeout(() => {
    void flushNativeSessionsWrite()
  }, NATIVE_WRITE_DEBOUNCE_MS)
}

function publishSessions(nextSessions: SessionMap): void {
  storeVersion += 1
  sessionStore.publishSnapshot(nextSessions)
  scheduleNativeSessionsWrite(nextSessions)
}

function publishSessionUpdate(
  sessionId: SessionId,
  update: (current: AiWorkspaceSessionSnapshot) => AiWorkspaceSessionSnapshot,
): void {
  const current = aiWorkspaceSessionSnapshot(sessionId)
  publishSessions({
    ...sessionStore.getSnapshot(),
    [sessionId]: update(current),
  })
}

async function syncFromNativeStorage(): Promise<void> {
  const loadVersion = storeVersion
  const nativeSessions = await readNativeSessions()
  if (storeVersion !== loadVersion) return
  if (Object.keys(nativeSessions).length === 0) {
    const currentSessions = sessionStore.getSnapshot()
    if (Object.keys(currentSessions).length > 0) scheduleNativeSessionsWrite(currentSessions)
    return
  }

  sessionStore.replaceSnapshot(nativeSessions)
  sessionStore.writeStoredSnapshot(nativeSessions)
}

function ensureSessionStoreSync(): void {
  if (typeof window === 'undefined') return

  sessionStore.ensureCrossWindowSync()
  window.addEventListener('pagehide', () => {
    if (nativeWriteTimer) clearTimeout(nativeWriteTimer)
    nativeWriteTimer = null
    void flushNativeSessionsWrite()
  })
}

ensureSessionStoreSync()
void syncFromNativeStorage()

export function aiWorkspaceSessionSnapshot(sessionId: SessionId): AiWorkspaceSessionSnapshot {
  return sessionStore.getSnapshot()[sessionId] ?? EMPTY_SESSION
}

export function subscribeAiWorkspaceSession(_sessionId: SessionId, listener: () => void): () => void {
  return sessionStore.subscribe(listener)
}

export function setAiWorkspaceSessionMessages(
  sessionId: SessionId,
  next: SetStateAction<AiAgentMessage[]>,
): void {
  publishSessionUpdate(sessionId, (current) => {
    const messages = typeof next === 'function' ? next(current.messages) : next
    return {
      ...current,
      messages,
    }
  })
}

export function setAiWorkspaceSessionStatus(
  sessionId: SessionId,
  next: SetStateAction<AgentStatus>,
): void {
  publishSessionUpdate(sessionId, (current) => {
    const status = typeof next === 'function' ? next(current.status) : next
    return {
      ...current,
      status,
    }
  })
}

export function resetAiWorkspaceSession(sessionId: SessionId): void {
  publishSessions({
    ...sessionStore.getSnapshot(),
    [sessionId]: EMPTY_SESSION,
  })
}

export function cloneAiWorkspaceSessionUntilMessage(
  sourceSessionId: SessionId,
  targetSessionId: SessionId,
  messageId: MessageId,
): void {
  const source = aiWorkspaceSessionSnapshot(sourceSessionId)
  const messageIndex = source.messages.findIndex((message) => message.id === messageId)
  const messages = messageIndex >= 0 ? source.messages.slice(0, messageIndex + 1) : source.messages
  publishSessions({
    ...sessionStore.getSnapshot(),
    [targetSessionId]: {
      messages: messages.map((message) => ({ ...message, isStreaming: false })),
      status: 'idle',
    },
  })
}

export function aiWorkspaceSessionDispatchers(sessionId: SessionId): {
  setMessages: Dispatch<SetStateAction<AiAgentMessage[]>>
  setStatus: Dispatch<SetStateAction<AgentStatus>>
} {
  return {
    setMessages: (next) => setAiWorkspaceSessionMessages(sessionId, next),
    setStatus: (next) => setAiWorkspaceSessionStatus(sessionId, next),
  }
}

export function resetAiWorkspaceSessionStoreForTests(): void {
  storeVersion = 0
  pendingNativeSessions = null
  if (nativeWriteTimer) clearTimeout(nativeWriteTimer)
  nativeWriteTimer = null
  nativeWriteInFlight = false
  sessionStore.publishSnapshot({})
}
