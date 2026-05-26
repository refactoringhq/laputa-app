import { useEffect } from 'react'
import {
  AI_PROMPT_QUEUED_EVENT,
  takeQueuedAiPrompt,
  type QueuedAiPrompt,
} from '../utils/aiPromptBridge'

export function useQueuedAiPrompt(
  onPrompt: (prompt: QueuedAiPrompt) => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return

    const consumePrompt = () => {
      const queuedPrompt = takeQueuedAiPrompt()
      if (queuedPrompt) onPrompt(queuedPrompt)
    }

    consumePrompt()
    window.addEventListener(AI_PROMPT_QUEUED_EVENT, consumePrompt)
    return () => window.removeEventListener(AI_PROMPT_QUEUED_EVENT, consumePrompt)
  }, [enabled, onPrompt])
}
