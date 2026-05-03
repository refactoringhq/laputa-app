import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAiAgentsStatus } from './useAiAgentsStatus'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: vi.fn(),
}))

const { mockInvoke } = await import('../mock-tauri') as { mockInvoke: ReturnType<typeof vi.fn> }

describe('useAiAgentsStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts in checking state and resolves agent statuses', async () => {
    mockInvoke.mockImplementation((command: string) => {
      if (command === 'get_ai_agents_status') {
        return Promise.resolve({
          claude_code: { installed: true, version: '1.0.20' },
          codex: { installed: false, version: null },
          opencode: { installed: true, version: '0.3.1' },
          pi: { installed: true, version: '0.70.2' },
          gemini: { installed: true, version: '0.5.1' },
        })
      }
      return Promise.resolve(null)
    })

    const { result } = renderHook(() => useAiAgentsStatus())

    expect(result.current.claude_code.status).toBe('checking')
    expect(result.current.codex.status).toBe('checking')
    expect(result.current.opencode.status).toBe('checking')
    expect(result.current.pi.status).toBe('checking')
    expect(result.current.gemini.status).toBe('checking')

    await waitFor(() => {
      expect(result.current.claude_code).toEqual({ status: 'installed', version: '1.0.20' })
      expect(result.current.codex).toEqual({ status: 'missing', version: null })
      expect(result.current.opencode).toEqual({ status: 'installed', version: '0.3.1' })
      expect(result.current.pi).toEqual({ status: 'installed', version: '0.70.2' })
      expect(result.current.gemini).toEqual({ status: 'installed', version: '0.5.1' })
    })
  })

  it('falls back to missing when the status call fails', async () => {
    mockInvoke.mockRejectedValue(new Error('failed'))

    const { result } = renderHook(() => useAiAgentsStatus())

    await waitFor(() => {
      expect(result.current.claude_code.status).toBe('missing')
      expect(result.current.codex.status).toBe('missing')
      expect(result.current.opencode.status).toBe('missing')
      expect(result.current.pi.status).toBe('missing')
      expect(result.current.gemini.status).toBe('missing')
    })
  })
})
