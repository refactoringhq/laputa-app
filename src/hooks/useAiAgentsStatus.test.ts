import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { AI_AGENTS_STATUS_PROBE_TIMEOUT_MS, useAiAgentsStatus } from './useAiAgentsStatus'
import { AI_AGENT_DEFINITIONS, type AiAgentsStatus } from '../lib/aiAgents'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: vi.fn(),
}))

const { mockInvoke } = await import('../mock-tauri') as { mockInvoke: ReturnType<typeof vi.fn> }

function installedStatusResponse() {
  return {
    claude_code: { installed: true, version: '1.0.20' },
    codex: { installed: false, version: null },
    opencode: { installed: true, version: '0.3.1' },
    pi: { installed: true, version: '0.70.2' },
    gemini: { installed: true, version: '0.5.1' },
    kiro: { installed: true, version: '0.4.0' },
    hermes: { installed: true, version: 'Hermes Agent 0.16.0' },
  }
}

function expectStatuses(statuses: AiAgentsStatus, expectedStatus: AiAgentsStatus[keyof AiAgentsStatus]['status']) {
  for (const definition of AI_AGENT_DEFINITIONS) {
    expect(statuses[definition.id].status).toBe(expectedStatus)
  }
}

describe('useAiAgentsStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('with real timers', () => {
    it('starts in checking state and resolves agent statuses', async () => {
      mockInvoke.mockImplementation((command: string) => {
        if (command === 'get_ai_agents_status') {
          return Promise.resolve(installedStatusResponse())
        }
        return Promise.resolve(null)
      })

      const { result } = renderHook(() => useAiAgentsStatus())

      expectStatuses(result.current, 'checking')

      // The probe is deferred via requestIdleCallback / setTimeout(0). With
      // real timers the deferred callback fires on the next event-loop tick.
      await waitFor(() => {
        expect(result.current.claude_code).toEqual({ status: 'installed', version: '1.0.20' })
        expect(result.current.codex).toEqual({ status: 'missing', version: null })
        expect(result.current.opencode).toEqual({ status: 'installed', version: '0.3.1' })
        expect(result.current.pi).toEqual({ status: 'installed', version: '0.70.2' })
        expect(result.current.gemini).toEqual({ status: 'installed', version: '0.5.1' })
        expect(result.current.kiro).toEqual({ status: 'installed', version: '0.4.0' })
        expect(result.current.hermes).toEqual({ status: 'installed', version: 'Hermes Agent 0.16.0' })
      })
    })

    it('falls back to missing when the status call fails', async () => {
      mockInvoke.mockRejectedValue(new Error('failed'))

      const { result } = renderHook(() => useAiAgentsStatus())

      await waitFor(() => {
        expectStatuses(result.current, 'missing')
      })
    })
  })

  describe('deferral and gating (fake timers)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('does not invoke the probe when disabled', async () => {
      mockInvoke.mockResolvedValue(installedStatusResponse())

      const { result } = renderHook(() => useAiAgentsStatus({ enabled: false }))

      await vi.runAllTimersAsync()

      expect(mockInvoke).not.toHaveBeenCalled()
      // Status stays in initial 'checking' state because no consumer renders it
      // when the gate is off, so it does not need to be reset.
      expect(result.current.claude_code.status).toBe('checking')
    })

    it('defers the probe until the next idle callback / timeout tick', async () => {
      mockInvoke.mockResolvedValue(installedStatusResponse())

      renderHook(() => useAiAgentsStatus({ enabled: true }))

      // Immediately after mount, the probe should not have fired yet — it is
      // queued behind requestIdleCallback (or setTimeout(0) in jsdom/WebKit).
      expect(mockInvoke).not.toHaveBeenCalled()

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(mockInvoke).toHaveBeenCalledWith('get_ai_agents_status')
    })

    it('fires a fresh probe when enabled toggles from false to true', async () => {
      mockInvoke.mockResolvedValue(installedStatusResponse())

      const { rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) => useAiAgentsStatus({ enabled }),
        { initialProps: { enabled: false } },
      )

      await vi.runAllTimersAsync()
      expect(mockInvoke).not.toHaveBeenCalled()

      rerender({ enabled: true })
      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(mockInvoke).toHaveBeenCalledTimes(1)
      expect(mockInvoke).toHaveBeenCalledWith('get_ai_agents_status')
    })

    it('cancels the deferred probe when the hook unmounts before idle fires', async () => {
      mockInvoke.mockResolvedValue(installedStatusResponse())

      const { unmount } = renderHook(() => useAiAgentsStatus({ enabled: true }))

      // Unmount before the idle callback runs.
      unmount()
      await vi.runAllTimersAsync()

      expect(mockInvoke).not.toHaveBeenCalled()
    })

    it('falls back to missing when the status probe never resolves', async () => {
      mockInvoke.mockReturnValue(new Promise(() => {}))

      const { result } = renderHook(() => useAiAgentsStatus({ enabled: true }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(mockInvoke).toHaveBeenCalledWith('get_ai_agents_status')
      expectStatuses(result.current, 'checking')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(AI_AGENTS_STATUS_PROBE_TIMEOUT_MS + 1)
      })

      expectStatuses(result.current, 'missing')
    })
  })
})
