import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import {
  createCheckingAiAgentsStatus,
  createMissingAiAgentsStatus,
  normalizeAiAgentsStatus,
  type AiAgentId,
  type AiAgentsStatus,
} from '../lib/aiAgents'

type RawAiAgentsStatus = Partial<Record<AiAgentId, { installed?: boolean | null; version?: string | null }>>

function tauriCall<T>(command: string): Promise<T> {
  return isTauri() ? invoke<T>(command) : mockInvoke<T>(command)
}

export function useAiAgentsStatus(): AiAgentsStatus {
  const [statuses, setStatuses] = useState<AiAgentsStatus>(createCheckingAiAgentsStatus())

  useEffect(() => {
    let cancelled = false

    tauriCall<RawAiAgentsStatus>('get_ai_agents_status')
      .then((result) => {
        if (!cancelled) {
          setStatuses(normalizeAiAgentsStatus(result))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatuses(createMissingAiAgentsStatus())
        }
      })

    return () => { cancelled = true }
  }, [])

  return statuses
}
