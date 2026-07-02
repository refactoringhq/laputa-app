import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import type { NoteReference } from '../utils/ai-context'
import type { QueuedAiPrompt } from '../utils/aiPromptBridge'
import { useQueuedAiPrompt } from './useQueuedAiPrompt'

interface AiAgentBridge {
  clearConversation: () => void
  sendMessage: (text: string, references: NoteReference[]) => void
}

interface UseAiPanelPromptQueueArgs {
  agent: AiAgentBridge
  currentTargetId?: string
  input: string
  isActive: boolean
  onTargetChange?: (targetId: string) => void
  setInput: (value: string) => void
  enabled?: boolean
}

function queuedPromptTargetChange(prompt: QueuedAiPrompt, currentTargetId: string | undefined): string | null {
  if (!prompt.targetId || !currentTargetId) return null
  return prompt.targetId === currentTargetId ? null : prompt.targetId
}

function shouldWaitForTargetChange(
  prompt: QueuedAiPrompt,
  currentTargetId: string | undefined,
  onTargetChange: ((targetId: string) => void) | undefined,
): boolean {
  return !!onTargetChange && queuedPromptTargetChange(prompt, currentTargetId) !== null
}

function readyQueuedPrompt({
  currentTargetId,
  enabled,
  input,
  isActive,
  onTargetChange,
  queuedPrompt,
}: {
  currentTargetId?: string
  enabled: boolean
  input: string
  isActive: boolean
  onTargetChange?: (targetId: string) => void
  queuedPrompt: QueuedAiPrompt | null
}): QueuedAiPrompt | null {
  if (!enabled) return null
  if (!queuedPrompt) return null
  if (isActive) return null
  if (input !== queuedPrompt.text) return null
  if (shouldWaitForTargetChange(queuedPrompt, currentTargetId, onTargetChange)) return null
  return queuedPrompt
}

export function useAiPanelPromptQueue({
  agent,
  currentTargetId,
  input,
  isActive,
  onTargetChange,
  setInput,
  enabled = true,
}: UseAiPanelPromptQueueArgs) {
  const [queuedPrompt, setQueuedPrompt] = useState<QueuedAiPrompt | null>(null)
  const consumedQueuedPromptIdRef = useRef<number | null>(null)

  const handleQueuedPrompt = useCallback((prompt: QueuedAiPrompt) => {
    setInput(prompt.text)
    setQueuedPrompt(prompt)
    const nextTargetId = queuedPromptTargetChange(prompt, currentTargetId)
    if (nextTargetId) onTargetChange?.(nextTargetId)
  }, [currentTargetId, onTargetChange, setInput])

  useQueuedAiPrompt(handleQueuedPrompt, enabled)

  useEffect(() => {
    const prompt = readyQueuedPrompt({ currentTargetId, enabled, input, isActive, onTargetChange, queuedPrompt })
    if (!prompt) return
    if (consumedQueuedPromptIdRef.current === prompt.id) return

    consumedQueuedPromptIdRef.current = prompt.id
    agent.clearConversation()
    agent.sendMessage(prompt.text, prompt.references)
    startTransition(() => {
      setInput('')
      setQueuedPrompt(null)
    })
  }, [agent, currentTargetId, enabled, input, isActive, onTargetChange, queuedPrompt, setInput])
}
