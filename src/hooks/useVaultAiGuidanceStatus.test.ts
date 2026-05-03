import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVaultAiGuidanceStatus } from './useVaultAiGuidanceStatus'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: vi.fn(),
}))

const { mockInvoke } = await import('../mock-tauri') as { mockInvoke: ReturnType<typeof vi.fn> }

describe('useVaultAiGuidanceStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts in checking state and resolves guidance status', async () => {
    mockInvoke.mockResolvedValue({
      agents_state: 'managed',
      claude_state: 'broken',
      gemini_state: 'missing',
      can_restore: true,
    })

    const { result } = renderHook(() => useVaultAiGuidanceStatus('/vault'))

    expect(result.current.status.agentsState).toBe('checking')
    expect(result.current.status.claudeState).toBe('checking')
    expect(result.current.status.geminiState).toBe('checking')

    await waitFor(() => {
      expect(result.current.status).toEqual({
        agentsState: 'managed',
        claudeState: 'broken',
        geminiState: 'missing',
        canRestore: true,
      })
    })
  })

  it('refreshes on demand', async () => {
    mockInvoke
      .mockResolvedValueOnce({
        agents_state: 'managed',
        claude_state: 'managed',
        gemini_state: 'managed',
        can_restore: false,
      })
      .mockResolvedValueOnce({
        agents_state: 'managed',
        claude_state: 'broken',
        gemini_state: 'managed',
        can_restore: true,
      })

    const { result } = renderHook(() => useVaultAiGuidanceStatus('/vault'))

    await waitFor(() => {
      expect(result.current.status.canRestore).toBe(false)
    })

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.status).toEqual({
      agentsState: 'managed',
      claudeState: 'broken',
      geminiState: 'managed',
      canRestore: true,
    })
  })
})
