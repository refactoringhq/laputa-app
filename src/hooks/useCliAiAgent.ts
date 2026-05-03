import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { AiAgentId } from '../lib/aiAgents'
import type { AiAgentPermissionMode } from '../lib/aiAgentPermissionMode'
import type { NoteReference } from '../utils/ai-context'
import {
  type AgentStatus,
  type AiAgentMessage,
} from '../lib/aiAgentConversation'
import type { AgentFileCallbacks } from '../lib/aiAgentFileOperations'
import {
  addAgentLocalMarker,
  clearAgentConversation,
  sendAgentMessage,
  type AiAgentSessionRuntime,
} from '../lib/aiAgentSession'
import type { ToolInvocation } from '../lib/aiAgentMessageState'

export type { AgentFileCallbacks } from '../lib/aiAgentFileOperations'
export type { AgentStatus } from '../lib/aiAgentConversation'
export type { AiAgentMessage } from '../lib/aiAgentConversation'

interface UseCliAiAgentOptions {
  agent: AiAgentId
  agentReady: boolean
  permissionMode: AiAgentPermissionMode
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

export function useCliAiAgent(
  vaultPath: string,
  contextPrompt: string | undefined,
  fileCallbacks: AgentFileCallbacks | undefined,
  options: UseCliAiAgentOptions,
) {
  const { agent, agentReady } = options
  const { permissionMode } = options
  const runtime = useCliAiAgentRuntime(fileCallbacks)
  const { messages, status } = runtime

  async function sendMessage(text: string, references?: NoteReference[]): Promise<void> {
    await sendAgentMessage({
      runtime,
      context: {
        agent,
        ready: agentReady,
        vaultPath,
        permissionMode,
        systemPromptOverride: contextPrompt,
      },
      prompt: { text, references },
    })
  }

  function clearConversation(): void {
    clearAgentConversation(runtime)
  }

  function addLocalMarker(text: string): void {
    addAgentLocalMarker(runtime, text)
  }

  return { messages, status, sendMessage, clearConversation, addLocalMarker }
}
