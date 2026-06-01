import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { AiAgentId } from '../lib/aiAgents'
import type { AiAgentPermissionMode } from '../lib/aiAgentPermissionMode'
import type { AiTarget } from '../lib/aiTargets'
import { getAgentDocsPath } from '../lib/agentDocsPath'
import type { NoteReference } from '../utils/ai-context'
import {
  type AgentStatus,
  type AiAgentMessage,
} from '../lib/aiAgentConversation'
import type { AgentFileCallbacks } from '../lib/aiAgentFileOperations'
import {
  addAgentLocalMarker,
  clearAgentConversation,
  regenerateAgentMessage,
  sendAgentMessage,
  type AiAgentSessionRuntime,
} from '../lib/aiAgentSession'
import type { ToolInvocation } from '../lib/aiAgentMessageState'
import {
  aiWorkspaceSessionDispatchers,
  aiWorkspaceSessionSnapshot,
  subscribeAiWorkspaceSession,
} from '../lib/aiWorkspaceSessionStore'

export type { AgentFileCallbacks } from '../lib/aiAgentFileOperations'
export type { AgentStatus } from '../lib/aiAgentConversation'
export type { AiAgentMessage } from '../lib/aiAgentConversation'

interface UseCliAiAgentOptions {
  agent: AiAgentId
  target?: AiTarget
  agentReady: boolean
  permissionMode: AiAgentPermissionMode
  sessionId?: string
}

interface UseCliAiAgentRuntime extends AiAgentSessionRuntime {
  messages: AiAgentMessage[]
  setMessages: Dispatch<SetStateAction<AiAgentMessage[]>>
  status: AgentStatus
  setStatus: Dispatch<SetStateAction<AgentStatus>>
  messagesRef: MutableRefObject<AiAgentMessage[]>
  statusRef: MutableRefObject<AgentStatus>
}

function useCliAiAgentRuntime(fileCallbacks: AgentFileCallbacks | undefined): UseCliAiAgentRuntime {
  const [messages, setMessages] = useState<AiAgentMessage[]>([])
  const [status, setStatus] = useState<AgentStatus>('idle')
  const abortRef = useRef({ aborted: false })
  const responseAccRef = useRef('')
  const fileCallbacksRef = useRef(fileCallbacks)
  const toolInputMapRef = useRef<Map<string, ToolInvocation>>(new Map())
  const messagesRef = useRef<AiAgentMessage[]>([])
  const statusRef = useRef<AgentStatus>('idle')

  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { statusRef.current = status }, [status])
  useEffect(() => { fileCallbacksRef.current = fileCallbacks }, [fileCallbacks])

  return {
    messages,
    setMessages,
    status,
    setStatus,
    abortRef,
    responseAccRef,
    fileCallbacksRef,
    toolInputMapRef,
    messagesRef,
    statusRef,
  }
}

function useSharedCliAiAgentRuntime(
  sessionId: string | undefined,
  fileCallbacks: AgentFileCallbacks | undefined,
): UseCliAiAgentRuntime {
  const resolvedSessionId = sessionId ?? ''
  const subscribe = useCallback((listener: () => void) => (
    resolvedSessionId ? subscribeAiWorkspaceSession(resolvedSessionId, listener) : () => {}
  ), [resolvedSessionId])
  const getSnapshot = useCallback(() => aiWorkspaceSessionSnapshot(resolvedSessionId), [resolvedSessionId])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const dispatchers = resolvedSessionId
    ? aiWorkspaceSessionDispatchers(resolvedSessionId)
    : { setMessages: () => {}, setStatus: () => {} }
  const abortRef = useRef({ aborted: false })
  const responseAccRef = useRef('')
  const fileCallbacksRef = useRef(fileCallbacks)
  const toolInputMapRef = useRef<Map<string, ToolInvocation>>(new Map())
  const messagesRef = useRef<AiAgentMessage[]>(snapshot.messages)
  const statusRef = useRef<AgentStatus>(snapshot.status)

  useEffect(() => { messagesRef.current = snapshot.messages }, [snapshot.messages])
  useEffect(() => { statusRef.current = snapshot.status }, [snapshot.status])
  useEffect(() => { fileCallbacksRef.current = fileCallbacks }, [fileCallbacks])

  return {
    messages: snapshot.messages,
    setMessages: dispatchers.setMessages,
    status: snapshot.status,
    setStatus: dispatchers.setStatus,
    abortRef,
    responseAccRef,
    fileCallbacksRef,
    toolInputMapRef,
    messagesRef,
    statusRef,
  }
}

export function useCliAiAgent(
  vaultPath: string,
  vaultPaths: string[] | undefined,
  contextPrompt: string | undefined,
  fileCallbacks: AgentFileCallbacks | undefined,
  options: UseCliAiAgentOptions,
) {
  const { agent, agentReady, sessionId, target } = options
  const { permissionMode } = options
  const localRuntime = useCliAiAgentRuntime(fileCallbacks)
  const sharedRuntime = useSharedCliAiAgentRuntime(sessionId, fileCallbacks)
  const runtime = sessionId ? sharedRuntime : localRuntime
  const { messages, status } = runtime

  async function buildAgentContext() {
    const agentDocsPath = await getAgentDocsPath()

    return {
      agent,
      agentDocsPath,
      target,
      ready: agentReady,
      vaultPath,
      vaultPaths,
      permissionMode,
      systemPromptOverride: contextPrompt,
    }
  }

  async function sendPrompt(text: string, references?: NoteReference[]): Promise<void> {
    await sendAgentMessage({
      runtime,
      context: await buildAgentContext(),
      prompt: { text, references },
    })
  }

  async function sendMessage(text: string, references?: NoteReference[]): Promise<void> {
    await sendPrompt(text, references)
  }

  async function regenerateMessage(messageId: string): Promise<void> {
    await regenerateAgentMessage({
      runtime,
      context: await buildAgentContext(),
      messageId,
    })
  }

  function clearConversation(): void {
    clearAgentConversation(runtime)
  }

  function addLocalMarker(text: string): void {
    addAgentLocalMarker(runtime, text)
  }

  return { messages, status, sendMessage, regenerateMessage, clearConversation, addLocalMarker }
}
