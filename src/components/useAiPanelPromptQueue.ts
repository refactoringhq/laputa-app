import { startTransition, useCallback, useEffect, useState } from 'react'
import type { NoteReference } from '../utils/ai-context'
import type { QueuedAiPrompt } from '../utils/aiPromptBridge'
import { useQueuedAiPrompt } from './useQueuedAiPrompt'

interface AiAgentBridge {
  clearConversation: () => void
  sendMessage: (text: string, references: NoteReference[]) => void
}

interface UseAiPanelPromptQueueArgs {
  agent: AiAgentBridge
  input: string
  isActive: boolean
  setInput: (value: string) => void
  enabled?: boolean
}

export function useAiPanelPromptQueue({
  agent,
  input,
  isActive,
  setInput,
  enabled = true,
}: UseAiPanelPromptQueueArgs) {
  const [queuedPrompt, setQueuedPrompt] = useState<QueuedAiPrompt | null>(null)

  const handleQueuedPrompt = useCallback((prompt: QueuedAiPrompt) => {
    setInput(prompt.text)
    setQueuedPrompt(prompt)
    agent.clearConversation()
  }, [agent, setInput])

  useQueuedAiPrompt(handleQueuedPrompt, enabled)

  useEffect(() => {
    if (!enabled) return
    if (!queuedPrompt || isActive) return
    if (input !== queuedPrompt.text) return

    agent.sendMessage(queuedPrompt.text, queuedPrompt.references)
    startTransition(() => {
      setInput('')
      setQueuedPrompt(null)
    })
  }, [agent, enabled, input, isActive, queuedPrompt, setInput])
}
