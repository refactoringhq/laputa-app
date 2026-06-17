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

export const AI_AGENTS_STATUS_PROBE_TIMEOUT_MS = 5000

interface UseAiAgentsStatusOptions {
  /**
   * When false, the hook stays in its initial state and never calls the
   * Tauri probe. Used to skip the ~1 s discovery cost when AI features are
   * disabled or in lightweight window routes that never render agent-aware UI.
   *
   * Defaults to true to preserve existing behaviour for callers that pass
   * no options.
   */
  enabled?: boolean
}

type IdleHandle =
  | { kind: 'idle'; id: number }
  | { kind: 'timeout'; id: ReturnType<typeof setTimeout> }

function tauriCall<T>(command: string): Promise<T> {
  return isTauri() ? invoke<T>(command) : mockInvoke<T>(command)
}

function scheduleIdle(callback: () => void): IdleHandle {
  const requestIdle = (typeof window !== 'undefined' ? window.requestIdleCallback?.bind(window) : undefined)
  if (typeof requestIdle === 'function') {
    return { kind: 'idle', id: requestIdle(callback) }
  }
  return { kind: 'timeout', id: setTimeout(callback, 0) }
}

function cancelIdle(handle: IdleHandle): void {
  if (handle.kind === 'idle') {
    const cancelIdleFn = (typeof window !== 'undefined' ? window.cancelIdleCallback?.bind(window) : undefined)
    if (typeof cancelIdleFn === 'function') {
      cancelIdleFn(handle.id)
    }
    return
  }

  clearTimeout(handle.id)
}

export function useAiAgentsStatus(options?: UseAiAgentsStatusOptions): AiAgentsStatus {
  const enabled = options?.enabled ?? true
  const [statuses, setStatuses] = useState<AiAgentsStatus>(createCheckingAiAgentsStatus())

  useEffect(() => {
    if (!enabled) {
      // Skip the probe entirely. Status is intentionally NOT reset — last-known
      // results stay in memory across enabled/disabled toggles so that a brief
      // disable does not blank out the badge.
      return
    }

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const clearProbeTimeout = () => {
      if (timeoutId === null) return
      clearTimeout(timeoutId)
      timeoutId = null
    }

    const fire = () => {
      if (cancelled) return

      timeoutId = setTimeout(() => {
        if (!cancelled) {
          setStatuses(createMissingAiAgentsStatus())
        }
      }, AI_AGENTS_STATUS_PROBE_TIMEOUT_MS)

      tauriCall<RawAiAgentsStatus>('get_ai_agents_status')
        .then((result) => {
          clearProbeTimeout()
          if (!cancelled) {
            setStatuses(normalizeAiAgentsStatus(result))
          }
        })
        .catch(() => {
          clearProbeTimeout()
          if (!cancelled) {
            setStatuses(createMissingAiAgentsStatus())
          }
        })
    }

    // Defer the probe so it does not run on the cold-start critical path.
    // requestIdleCallback is unavailable in WKWebView (Tauri's macOS web view),
    // so fall back to setTimeout(0).
    const handle = scheduleIdle(fire)

    return () => {
      cancelled = true
      clearProbeTimeout()
      cancelIdle(handle)
    }
  }, [enabled])

  return statuses
}
