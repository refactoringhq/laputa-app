import { useState, useSyncExternalStore } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queueAiPrompt, takeQueuedAiPrompt } from '../utils/aiPromptBridge'
import { useAiPanelPromptQueue } from './useAiPanelPromptQueue'

type ExternalListener = () => void

const externalListeners = new Set<ExternalListener>()
let externalSnapshot = 0

function resetExternalStore() {
  externalSnapshot = 0
  externalListeners.clear()
}

function publishExternalStoreUpdate() {
  externalSnapshot += 1
  for (const listener of externalListeners) listener()
}

function subscribeExternalStore(listener: ExternalListener) {
  externalListeners.add(listener)
  return () => {
    externalListeners.delete(listener)
  }
}

function readExternalSnapshot() {
  return externalSnapshot
}

function usePromptQueueHarness({
  clearConversation,
  sendMessage,
}: {
  clearConversation: () => void
  sendMessage: (text: string) => void
}) {
  const [input, setInput] = useState('')
  useSyncExternalStore(
    subscribeExternalStore,
    readExternalSnapshot,
    readExternalSnapshot,
  )
  useAiPanelPromptQueue({
    agent: {
      clearConversation: () => {
        clearConversation()
        publishExternalStoreUpdate()
      },
      sendMessage: (text) => {
        sendMessage(text)
        publishExternalStoreUpdate()
      },
    },
    input,
    isActive: false,
    setInput,
  })

  return input
}

describe('useAiPanelPromptQueue', () => {
  beforeEach(() => {
    resetExternalStore()
    takeQueuedAiPrompt()
  })

  it('consumes a queued prompt once when agent updates synchronously rerender the subscriber', async () => {
    const clearConversation = vi.fn()
    const sendMessage = vi.fn()

    renderHook(() => usePromptQueueHarness({ clearConversation, sendMessage }))

    await act(async () => {
      queueAiPrompt('summarize this note', [])
    })

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith('summarize this note')
    })
    expect(clearConversation).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})
